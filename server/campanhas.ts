import { Router, Request, Response } from 'express';
import { pool } from './db.js';
import { friendlyDbError } from './crud.js';
import { enviarEmail } from './email.js';
import { chaveTelefone, enviarWhatsAppCampanha, imagemDaCampanha, telefoneWhatsApp } from './whatsapp.js';

/**
 * Campanhas (tudo numa tabela só): o público vem dos critérios da campanha, a mensagem (com variáveis
 * {{nome}}) e o canal também. "Gerar disparos" cria em campanha_disparos um registro por pessoa, já com o
 * destino e o texto personalizado; o envio sai sozinho enquanto a campanha está "em execução": WhatsApp por
 * server/whatsapp.ts, e-mail por aqui (enviarEmailsCampanha). Outro público ou outro texto = outra campanha.
 */

type Executor = { query: typeof pool.query };

// ------------------------------------------------------------
// Critérios de segmentação
// ------------------------------------------------------------

export const OPERADORES = ['=', '<>', '>', '>=', '<', '<=', 'contem', 'comeca'] as const;
/** Só nas regras de texto: "que contém" e "começa com" (LIKE) */
const OPERADORES_TEXTO: readonly string[] = ['=', '<>', 'contem', 'comeca'];
type Operador = (typeof OPERADORES)[number];

/**
 * Regras aceitas nos critérios. `sql` é uma expressão sobre a pessoa (alias "p")
 * comparada com o valor pelo operador; nada do navegador entra no SQL além do valor,
 * que vai como parâmetro.
 */
export const REGRAS: Record<string, { rotulo: string; valor: 'numero' | 'texto' | 'sim_nao' | 'tipo_pessoa' | 'segmento'; sql: string }> = {
  tipo: { rotulo: 'Tipo da pessoa', valor: 'tipo_pessoa', sql: 'p.tipo' },
  cod_integracao: { rotulo: 'Cód. integração', valor: 'texto', sql: 'p.cod_integracao' },
  segmento: { rotulo: 'Segmento da pessoa', valor: 'segmento', sql: 'p.segmento_id' },
  uf: {
    rotulo: 'UF do endereço principal',
    valor: 'texto',
    sql: `(SELECT e.uf FROM pessoas_enderecos e WHERE e.pessoa_id = p.id ORDER BY e.principal DESC, e.id LIMIT 1)`,
  },
  cidade: {
    rotulo: 'Cidade do endereço principal',
    valor: 'texto',
    sql: `(SELECT e.cidade FROM pessoas_enderecos e WHERE e.pessoa_id = p.id ORDER BY e.principal DESC, e.id LIMIT 1)`,
  },
  dias_cadastro: { rotulo: 'Dias desde o cadastro', valor: 'numero', sql: 'DATEDIFF(CURDATE(), p.criado_em)' },
  // Quem nunca comprou fica de fora (sem data): para esses, usar "Quantidade de pedidos = 0"
  ultima_compra: {
    rotulo: 'Dias desde a última compra',
    valor: 'numero',
    sql: `DATEDIFF(CURDATE(), (SELECT MAX(pd.data_emissao) FROM pedidos pd WHERE pd.pessoa_id = p.id AND pd.status <> 'cancelado'))`,
  },
  qtd_pedidos: {
    rotulo: 'Quantidade de pedidos',
    valor: 'numero',
    sql: `(SELECT COUNT(*) FROM pedidos pd WHERE pd.pessoa_id = p.id AND pd.status <> 'cancelado')`,
  },
  ultimo_contato: {
    rotulo: 'Dias desde o último contato',
    valor: 'numero',
    sql: `DATEDIFF(CURDATE(), (SELECT MAX(h.criado_em) FROM historico_interacoes h WHERE h.pessoa_id = p.id))`,
  },
  negocio_aberto: {
    rotulo: 'Tem negócio aberto',
    valor: 'sim_nao',
    sql: `EXISTS (SELECT 1 FROM negocios n WHERE n.pessoa_id = p.id AND n.status = 'aberto')`,
  },
  negocio_ganho: {
    rotulo: 'Tem negócio ganho',
    valor: 'sim_nao',
    sql: `EXISTS (SELECT 1 FROM negocios n WHERE n.pessoa_id = p.id AND n.status = 'ganho')`,
  },
  contrato_ativo: {
    rotulo: 'Tem contrato ativo',
    valor: 'sim_nao',
    sql: `EXISTS (SELECT 1 FROM contratos ct WHERE ct.pessoa_id = p.id AND ct.situacao = 'ativo')`,
  },
  // Quem não tem contrato ativo com data de fim fica de fora (sem data)
  dias_fim_contrato: {
    rotulo: 'Dias até o fim do contrato',
    valor: 'numero',
    sql: `(SELECT DATEDIFF(MIN(ct.data_fim), CURDATE()) FROM contratos ct WHERE ct.pessoa_id = p.id AND ct.situacao = 'ativo' AND ct.data_fim IS NOT NULL)`,
  },
  tem_email: { rotulo: 'Tem e-mail', valor: 'sim_nao', sql: `(p.email IS NOT NULL AND p.email <> '')` },
  tem_telefone: { rotulo: 'Tem telefone', valor: 'sim_nao', sql: `(p.telefone IS NOT NULL AND p.telefone <> '')` },
  tem_whatsapp: { rotulo: 'Tem WhatsApp cadastrado', valor: 'sim_nao', sql: `(p.whatsapp IS NOT NULL AND p.whatsapp <> '')` },
  // DDD + 9 + 8 dígitos (com ou sem 0/55 na frente), no WhatsApp ou, sem ele, no telefone; sem DDD não dá para mandar WhatsApp
  tem_celular: {
    rotulo: 'Tem celular (com DDD)',
    valor: 'sim_nao',
    sql: `(REGEXP_REPLACE(COALESCE(NULLIF(p.whatsapp, ''), p.telefone, ''), '[^0-9]', '') REGEXP '^0*(55)?[1-9]{2}9[0-9]{8}$')`,
  },
};

export interface Criterio {
  regra: string;
  operador: Operador;
  valor: string | number;
}

/**
 * Valida os critérios vindos do formulário (lista de regras, todas precisam valer).
 * Aceita também um objeto só, como no exemplo do migration.
 */
export function normalizarCriterios(bruto: unknown): Criterio[] {
  let v = bruto;
  if (typeof v === 'string') {
    try {
      v = JSON.parse(v);
    } catch {
      throw new Error('Os critérios estão em formato inválido.');
    }
  }
  if (v && !Array.isArray(v) && typeof v === 'object') v = [v];
  if (!Array.isArray(v) || !v.length) throw new Error('Informe ao menos um critério do público da campanha.');
  if (v.length > 20) throw new Error('São aceitos no máximo 20 critérios por campanha.');

  return v.map((c: any, i) => {
    const regra = REGRAS[String(c?.regra)];
    if (!regra) throw new Error(`Critério ${i + 1}: regra "${c?.regra}" não existe.`);
    const operador = String(c?.operador) as Operador;
    if (!OPERADORES.includes(operador)) throw new Error(`Critério ${i + 1}: operador "${c?.operador}" inválido.`);
    let valor: string | number = c?.valor ?? '';
    if (regra.valor === 'numero' || regra.valor === 'segmento') {
      valor = Number(valor);
      if (!Number.isFinite(valor)) throw new Error(`Critério ${i + 1} (${regra.rotulo}): informe um número.`);
    } else if (regra.valor === 'sim_nao') {
      valor = Number(valor) ? 1 : 0;
      if (operador !== '=' && operador !== '<>') throw new Error(`Critério ${i + 1} (${regra.rotulo}): use "=" ou "<>".`);
    } else {
      valor = String(valor).trim();
      if (!valor) throw new Error(`Critério ${i + 1} (${regra.rotulo}): informe o valor.`);
    }
    if ((operador === 'contem' || operador === 'comeca') && regra.valor !== 'texto') {
      throw new Error(`Critério ${i + 1} (${regra.rotulo}): "que contém" e "começa com" só valem para texto.`);
    }
    if (regra.valor === 'texto' && !OPERADORES_TEXTO.includes(operador)) {
      throw new Error(`Critério ${i + 1} (${regra.rotulo}): use igual a, diferente de, que contém ou começa com.`);
    }
    return { regra: String(c.regra), operador, valor };
  });
}

/** WHERE (sobre a pessoa "p") que seleciona as pessoas da empresa atendidas pelos critérios */
export function sqlCriterios(criterios: Criterio[], empresaId: string | number): { where: string; params: any[] } {
  const partes = ['p.empresa_id = ?'];
  const params: any[] = [empresaId];
  for (const c of criterios) {
    const regra = REGRAS[c.regra];
    // Texto vazio conta como '': "diferente de X" pega também quem não tem o campo preenchido
    const expr = regra.valor === 'texto' ? `COALESCE(${regra.sql}, '')` : regra.sql;
    if (c.operador === 'contem' || c.operador === 'comeca') {
      const literal = String(c.valor).replace(/[\\%_]/g, (x) => `\\${x}`);
      partes.push(`${expr} LIKE ?`);
      params.push(c.operador === 'contem' ? `%${literal}%` : `${literal}%`);
    } else {
      partes.push(`${expr} ${c.operador} ?`);
      params.push(c.valor);
    }
  }
  return { where: partes.join(' AND '), params };
}

// ------------------------------------------------------------
// Variáveis das mensagens
// ------------------------------------------------------------

/** Variáveis aceitas em {{...}} no assunto e no corpo, e de onde vem cada uma */
export const VARIAVEIS: Record<string, string> = {
  nome: 'p.nome',
  primeiro_nome: "SUBSTRING_INDEX(TRIM(p.nome), ' ', 1)",
  email: 'p.email',
  telefone: 'p.telefone',
  whatsapp: "COALESCE(NULLIF(p.whatsapp, ''), p.telefone)",
  cidade: `(SELECT e.cidade FROM pessoas_enderecos e WHERE e.pessoa_id = p.id ORDER BY e.principal DESC, e.id LIMIT 1)`,
  ultima_compra: `(SELECT DATE_FORMAT(MAX(pd.data_emissao), '%d/%m/%Y') FROM pedidos pd WHERE pd.pessoa_id = p.id AND pd.status <> 'cancelado')`,
  empresa: '(SELECT nome FROM empresas WHERE id = p.empresa_id)',
};

const RE_VARIAVEL = /\{\{\s*([a-z_]+)\s*\}\}/gi;

/** Variáveis usadas no texto; erro se alguma não existir */
export function variaveisDoTexto(...textos: (string | null | undefined)[]): string[] {
  const usadas = new Set<string>();
  for (const t of textos) for (const m of String(t ?? '').matchAll(RE_VARIAVEL)) usadas.add(m[1].toLowerCase());
  const invalidas = [...usadas].filter((v) => !VARIAVEIS[v]);
  if (invalidas.length) {
    throw new Error(
      `Variável inexistente: ${invalidas.map((v) => `{{${v}}}`).join(', ')}. Disponíveis: ${Object.keys(VARIAVEIS)
        .map((v) => `{{${v}}}`)
        .join(', ')}.`,
    );
  }
  return [...usadas];
}

/** Troca as variáveis pelos dados da pessoa (as que faltam ficam em branco) */
export function personalizar(texto: string | null | undefined, dados: Record<string, any>): string {
  return String(texto ?? '').replace(RE_VARIAVEL, (_, v) => String(dados[v.toLowerCase()] ?? ''));
}

/** No WhatsApp a campanha termina com o aviso de descadastro (PEDIU_SAIR), se o texto ainda não falar em SAIR */
export function comAvisoSair(texto: string, canal: string | undefined): string {
  return canal === 'whatsapp' && !/\bSAIR\b/i.test(texto) ? `${texto.trimEnd()}\n\n_Para não receber mais, responda SAIR._` : texto;
}


// ------------------------------------------------------------
// Público e disparos
// ------------------------------------------------------------

/** Canais com envio automático. Multicanal = WhatsApp quando a pessoa tem celular, senão e-mail */
export const CANAIS_COM_ENVIO = ['whatsapp', 'email', 'multicanal'];

/** Quem pediu para não receber campanhas (respondeu "SAIR" ou marcado no cadastro) fica fora de todo público */
const SEM_DESCADASTRADOS = 'AND p.nao_receber_campanhas = 0';

/** Quantas pessoas atendem aos critérios (o "público estimado" da campanha) */
export async function contarPublico(criterios: unknown, empresaId: string | number, db: Executor = pool): Promise<number> {
  const { where, params } = sqlCriterios(normalizarCriterios(criterios), empresaId);
  const [r] = await db.query<any[]>(`SELECT COUNT(*) AS n FROM pessoas p WHERE ${where} ${SEM_DESCADASTRADOS}`, params);
  return Number(r[0].n);
}

/** Botão "Testar" dos critérios: o total do público e as 50 primeiras pessoas (por nome), sem gravar nada */
export async function testarCriterios(criterios: unknown, empresaId: string | number) {
  const { where, params } = sqlCriterios(normalizarCriterios(criterios), empresaId);
  const [r] = await pool.query<any[]>(
    `SELECT p.id, p.nome, p.tipo, p.cod_integracao, COALESCE(NULLIF(p.whatsapp, ''), p.telefone) AS telefone, p.email,
            (SELECT CONCAT_WS(' / ', e.cidade, e.uf) FROM pessoas_enderecos e WHERE e.pessoa_id = p.id ORDER BY e.principal DESC, e.id LIMIT 1) AS cidade
       FROM pessoas p WHERE ${where} ${SEM_DESCADASTRADOS} ORDER BY p.nome LIMIT 50`,
    params,
  );
  return { total: await contarPublico(criterios, empresaId), pessoas: r };
}

const EMAIL_VALIDO = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Celular para WhatsApp (só dígitos, com DDI); no Brasil só celular (DDD + 9 + 8 dígitos): fixo não tem WhatsApp */
export function celularWhatsApp(bruto: string | null | undefined): string | null {
  try {
    const t = telefoneWhatsApp(bruto);
    return !t.startsWith('55') || /^55[1-9]{2}9\d{8}$/.test(t) ? t : null;
  } catch {
    return null;
  }
}

/** Canal e destino do disparo para a pessoa; null = sem o contato do canal (fica de fora) */
export function destinoDe(canal: string, p: { email?: string | null; whatsapp?: string | null }): { canal: 'whatsapp' | 'email'; destino: string } | null {
  const celular = canal === 'email' ? null : celularWhatsApp(p.whatsapp);
  const email = String(p.email ?? '').trim();
  if (canal === 'whatsapp') return celular ? { canal: 'whatsapp', destino: celular } : null;
  if (canal === 'email') return EMAIL_VALIDO.test(email) ? { canal: 'email', destino: email } : null;
  if (canal === 'multicanal') {
    if (celular) return { canal: 'whatsapp', destino: celular };
    return EMAIL_VALIDO.test(email) ? { canal: 'email', destino: email } : null;
  }
  return null;
}

/** Campanha da empresa, ainda não excluída */
async function campanhaDa(id: string | number, empresaId: string | number, db: Executor = pool) {
  const [r] = await db.query<any[]>('SELECT * FROM campanhas WHERE id = ? AND empresa_id = ? AND excluida_em IS NULL', [id, empresaId]);
  if (!r[0]) throw Object.assign(new Error('Campanha não encontrada.'), { status: 404 });
  return r[0];
}

/** Pessoas do público com as variáveis da mensagem (nome, email, whatsapp...) */
async function publicoDa(c: any, empresaId: string | number, db: Executor, limite?: number) {
  const { where, params } = sqlCriterios(normalizarCriterios(c.criterios), empresaId);
  const colunas = Object.entries(VARIAVEIS).map(([k, sql]) => `${sql} AS ${k}`).join(', ');
  const [r] = await db.query<any[]>(
    `SELECT p.id, ${colunas} FROM pessoas p WHERE ${where} ${SEM_DESCADASTRADOS} ORDER BY p.nome${limite ? ` LIMIT ${Number(limite)}` : ''}`,
    params,
  );
  return r;
}

/**
 * Gerar disparos: um registro por pessoa do público (nome, canal, destino, assunto e mensagem já personalizados),
 * agendado para agora ou para "Enviar a partir de". Pode ser repetido: os pendentes são refeitos com o texto e o
 * público atuais; quem já recebeu (ou falhou) não ganha outro. Não libera o envio: ver iniciarEnvio.
 */
export async function gerarDisparos(campanhaId: string | number, empresaId: string | number) {
  const conn = await pool.getConnection();
  try {
    const c = await campanhaDa(campanhaId, empresaId, conn);
    if (c.situacao === 'concluida' || c.situacao === 'cancelada') throw new Error(`A campanha está ${c.situacao}: não gera mais disparos.`);
    if (!CANAIS_COM_ENVIO.includes(c.canal)) throw new Error('Envio automático só por WhatsApp, e-mail ou multicanal: troque o canal da campanha.');
    if (!String(c.mensagem ?? '').trim()) throw new Error('Escreva a mensagem da campanha antes de gerar os disparos.');
    variaveisDoTexto(c.assunto, c.mensagem);
    const pessoas = await publicoDa(c, empresaId, conn);
    const [[{ quando }]] = await conn.query<any>(
      "SELECT DATE_FORMAT(GREATEST(NOW(), COALESCE(enviar_a_partir_de, NOW())), '%Y-%m-%d %H:%i:%s') AS quando FROM campanhas WHERE id = ?",
      [c.id],
    );

    await conn.beginTransaction();
    await conn.query("DELETE FROM campanha_disparos WHERE campanha_id = ? AND situacao = 'pendente'", [c.id]);
    const [feitos] = await conn.query<any[]>('SELECT pessoa_id, canal FROM campanha_disparos WHERE campanha_id = ?', [c.id]);
    const jaFeito = new Set(feitos.map((f) => `${f.pessoa_id}|${f.canal}`));
    const linhas: any[][] = [];
    let semContato = 0;
    let jaEnviados = 0;
    for (const p of pessoas) {
      const d = destinoDe(c.canal, p);
      if (!d) {
        semContato++;
        continue;
      }
      if (jaFeito.has(`${p.id}|${d.canal}`)) {
        jaEnviados++;
        continue;
      }
      const assunto = personalizar(c.assunto, p).trim().slice(0, 255) || null;
      linhas.push([c.id, p.id, String(p.nome ?? '').slice(0, 255), d.canal, d.destino, assunto, comAvisoSair(personalizar(c.mensagem, p), d.canal), quando]);
    }
    for (let i = 0; i < linhas.length; i += 500) {
      await conn.query('INSERT INTO campanha_disparos (campanha_id, pessoa_id, nome, canal, destino, assunto, mensagem, agendado_para) VALUES ?', [
        linhas.slice(i, i + 500),
      ]);
    }
    await conn.query(
      'UPDATE campanhas SET publico_estimado = ? WHERE id = ?',
      [pessoas.length, c.id],
    );
    await conn.commit();
    return { publico: pessoas.length, gerados: linhas.length, sem_contato: semContato, ja_enviados: jaEnviados, situacao: c.situacao };
  } catch (err) {
    await conn.rollback().catch(() => {});
    throw err;
  } finally {
    conn.release();
  }
}

/**
 * Ao gravar a campanha (tela de cadastro): já gera os disparos, sem enviar. Pula a que ainda não tem como gerar (sem
 * mensagem, canal sem envio, concluída ou cancelada). Devolve o aviso para a tela; a falha não desfaz a gravação
 */
export async function gerarDisparosAoGravar(campanhaId: string | number, empresaId: string | number): Promise<string | null> {
  const c = await campanhaDa(campanhaId, empresaId);
  if (['concluida', 'cancelada'].includes(c.situacao) || !CANAIS_COM_ENVIO.includes(c.canal) || !String(c.mensagem ?? '').trim()) return null;
  try {
    const r = await gerarDisparos(campanhaId, empresaId);
    return `${r.gerados} disparo(s) gerado(s), sem enviar${r.sem_contato ? `; ${r.sem_contato} sem contato` : ''}.`;
  } catch (err: any) {
    return `Os disparos não foram gerados: ${err.message}`;
  }
}

/** A campanha que a pessoa recebeu, para a Automação das campanhas conversar com o contexto dela */
export interface CampanhaDaConversa {
  id: number;
  nome: string;
  /** Mensagem que a pessoa recebeu (já personalizada) */
  mensagem: string;
  /** Instruções da campanha para a IA: o que explicar, preços, perguntas frequentes */
  instrucoes: string;
  pessoa_id: number | null;
}

/** Dias depois do envio em que a resposta ainda é "sobre a campanha" */
const DIAS_CONTEXTO = 15;

/** Último disparo de WhatsApp que saiu para o telefone (nos últimos 15 dias); o número pode vir com ou sem o 9 */
export async function campanhaDaConversa(empresaId: string | number, telefone: string): Promise<CampanhaDaConversa | null> {
  const chave = chaveTelefone(telefone, true);
  if (!chave) return null;
  const [r] = await pool.query<any[]>(
    `SELECT c.id, c.nome, c.instrucoes_ia, d.mensagem, d.pessoa_id, d.destino
       FROM campanha_disparos d JOIN campanhas c ON c.id = d.campanha_id
      WHERE c.empresa_id = ? AND d.canal = 'whatsapp' AND d.situacao IN ('enviado', 'entregue', 'lido')
        AND d.enviado_em >= NOW() - INTERVAL ? DAY AND RIGHT(d.destino, 8) = RIGHT(?, 8)
      ORDER BY d.enviado_em DESC, d.id DESC LIMIT 10`,
    [empresaId, DIAS_CONTEXTO, telefone],
  );
  const d = r.find((x) => chaveTelefone(x.destino, true) === chave);
  return d ? { id: d.id, nome: d.nome, mensagem: d.mensagem, instrucoes: String(d.instrucoes_ia ?? '').trim(), pessoa_id: d.pessoa_id } : null;
}

/**
 * Mensagem recebida da pessoa: o último disparo de WhatsApp para ela (até 15 dias) ganha "respondeu"
 * (respondido_em, a primeira resposta). Por qualquer número: vale também sem o WhatsApp das campanhas.
 */
export async function marcarRespondido(empresaId: string | number, telefone: string): Promise<void> {
  const chave = chaveTelefone(telefone, true);
  if (!chave) return;
  const [r] = await pool.query<any[]>(
    `SELECT d.id, d.destino, d.respondido_em
       FROM campanha_disparos d JOIN campanhas c ON c.id = d.campanha_id
      WHERE c.empresa_id = ? AND d.canal = 'whatsapp' AND d.situacao IN ('enviado', 'entregue', 'lido')
        AND d.enviado_em >= NOW() - INTERVAL ? DAY AND RIGHT(d.destino, 8) = RIGHT(?, 8)
      ORDER BY d.enviado_em DESC, d.id DESC LIMIT 10`,
    [empresaId, DIAS_CONTEXTO, telefone],
  );
  const d = r.find((x) => chaveTelefone(x.destino, true) === chave);
  if (d && !d.respondido_em) await pool.query('UPDATE campanha_disparos SET respondido_em = NOW() WHERE id = ? AND respondido_em IS NULL', [d.id]);
}

/** Contexto da campanha para o texto-base da IA (vazio quando a conversa não é de campanha) */
export function contextoDeCampanha(c: CampanhaDaConversa | null | undefined): string {
  if (!c) return '';
  return `\n\nCONTEXTO DA CAMPANHA: esta pessoa recebeu a mensagem abaixo da campanha "${c.nome}" e está respondendo a ela. Converse sobre ela e tire as dúvidas.
Mensagem que a pessoa recebeu:
«${c.mensagem}»${c.instrucoes ? `\nInstruções da campanha (o que explicar, condições, perguntas frequentes):\n${c.instrucoes}` : ''}`;
}

/** Resposta que pede para sair da lista: "SAIR", "parar", "não quero mais"... (só a mensagem inteira) */
export const PEDIU_SAIR = /^\s*(sair|parar|pare|stop|cancelar|descadastrar|remover|me\s+tire(\s+da\s+lista)?|n[ãa]o\s+quero(\s+mais)?(\s+receber)?)\s*[.!]*\s*$/i;

// ------------------------------------------------------------
// Envio por e-mail (o WhatsApp sai por server/whatsapp.ts)
// ------------------------------------------------------------

/** Imagem da campanha como anexo do e-mail */
const anexosDa = (imagem: string | null | undefined) => {
  const img = imagemDaCampanha(imagem);
  return img ? [{ nome: img.nome, conteudo: Buffer.from(img.base64, 'base64') }] : undefined;
};

/** Erro do servidor de e-mail da empresa (não do destinatário): o disparo continua pendente para o próximo ciclo */
const erroDoSmtp = (err: any) =>
  /^E-mail não configurado/.test(err?.message) || ['EAUTH', 'ECONNECTION', 'ETIMEDOUT', 'ESOCKET', 'EDNS', 'ECONNREFUSED'].includes(err?.code);

/** Um ciclo de envio dos disparos por e-mail das campanhas em execução; devolve quantos foram processados */
export async function enviarEmailsCampanha(limite = 50, prazoMs = Infinity): Promise<number> {
  const fim = Date.now() + prazoMs;
  const conn = await pool.getConnection();
  try {
    // Dois servidores no mesmo banco (Vercel e local) não mandam o mesmo e-mail duas vezes
    const [trava] = await conn.query<any[]>("SELECT GET_LOCK('crmweb_envio_email_campanha', 0) AS ok");
    if (!trava[0]?.ok) return 0;
    try {
      const [fila] = await conn.query<any[]>(
        `SELECT d.id, d.destino, d.assunto, d.mensagem, c.empresa_id, c.nome AS campanha, c.imagem
           FROM campanha_disparos d JOIN campanhas c ON c.id = d.campanha_id
          WHERE d.situacao = 'pendente' AND d.canal = 'email' AND d.agendado_para <= NOW()
            AND c.situacao = 'em_execucao' AND c.excluida_em IS NULL
          ORDER BY d.agendado_para, d.id LIMIT ?`,
        [limite],
      );
      const semSmtp = new Set<number>();
      let processados = 0;
      for (const d of fila) {
        if (Date.now() + 15_000 > fim) break;
        if (semSmtp.has(d.empresa_id)) continue;
        try {
          await enviarEmail(String(d.empresa_id), { para: d.destino, assunto: d.assunto || d.campanha, texto: d.mensagem, anexos: anexosDa(d.imagem) });
          await conn.query("UPDATE campanha_disparos SET situacao = 'enviado', enviado_em = NOW(), erro = NULL WHERE id = ? AND situacao = 'pendente'", [d.id]);
        } catch (err: any) {
          if (erroDoSmtp(err)) {
            semSmtp.add(d.empresa_id);
            console.error(`Campanhas: e-mail da empresa ${d.empresa_id}: ${err.message}`);
            continue;
          }
          await conn.query("UPDATE campanha_disparos SET situacao = 'falhou', erro = ? WHERE id = ? AND situacao = 'pendente'", [
            String(err?.message || err).slice(0, 255),
            d.id,
          ]);
        }
        processados++;
      }
      return processados;
    } finally {
      await conn.query("SELECT RELEASE_LOCK('crmweb_envio_email_campanha')");
    }
  } finally {
    conn.release();
  }
}

/** Iniciar envio: a campanha passa a "em execução" e os disparos pendentes saem (ou na data de "Enviar a partir de") */
export async function iniciarEnvio(campanhaId: string | number, empresaId: string | number) {
  const c = await campanhaDa(campanhaId, empresaId);
  if (c.situacao === 'concluida' || c.situacao === 'cancelada') throw new Error(`A campanha está ${c.situacao}: não envia mais.`);
  if (c.situacao === 'em_execucao') throw new Error('O envio desta campanha já está ligado.');
  const [[{ pendentes }]] = await pool.query<any>("SELECT COUNT(*) AS pendentes FROM campanha_disparos WHERE campanha_id = ? AND situacao = 'pendente'", [c.id]);
  if (!Number(pendentes)) throw new Error('Não há disparos pendentes: gere os disparos antes.');
  await pool.query("UPDATE campanhas SET situacao = 'em_execucao', iniciada_em = COALESCE(iniciada_em, NOW()) WHERE id = ?", [c.id]);
  return { pendentes: Number(pendentes) };
}

/** Encerrar: a campanha fica concluída (não gera nem envia mais) e os disparos que ainda não saíram são cancelados */
export async function encerrarCampanha(campanhaId: string | number, empresaId: string | number) {
  const c = await campanhaDa(campanhaId, empresaId);
  if (c.situacao === 'concluida' || c.situacao === 'cancelada') throw new Error(`A campanha já está ${c.situacao === 'concluida' ? 'concluída' : 'cancelada'}.`);
  const [d] = await pool.query<any>("UPDATE campanha_disparos SET situacao = 'cancelado' WHERE campanha_id = ? AND situacao = 'pendente'", [c.id]);
  await pool.query("UPDATE campanhas SET situacao = 'concluida', encerrada_em = NOW() WHERE id = ?", [c.id]);
  return { cancelados: Number(d.affectedRows) };
}

/**
 * Enviar agora (botão no detalhe Disparos): manda um disparo pendente ou que falhou, sem esperar o agendamento
 * nem a situação da campanha. Usa a mesma trava do envio automático do canal: os dois juntos não mandam duas vezes.
 */
export async function enviarDisparoAgora(id: string | number, empresaId: string | number): Promise<{ situacao: string }> {
  const [r] = await pool.query<any[]>(
    `SELECT d.id, d.canal FROM campanha_disparos d JOIN campanhas c ON c.id = d.campanha_id
      WHERE d.id = ? AND c.empresa_id = ? AND c.excluida_em IS NULL`,
    [id, empresaId],
  );
  if (!r[0]) throw Object.assign(new Error('Disparo não encontrado.'), { status: 404 });
  const trava = r[0].canal === 'email' ? 'crmweb_envio_email_campanha' : 'crmweb_envio_whatsapp';
  const conn = await pool.getConnection();
  try {
    const [t] = await conn.query<any[]>('SELECT GET_LOCK(?, 30) AS ok', [trava]);
    if (!t[0]?.ok) throw new Error('O envio automático está ocupado agora: tente de novo em instantes.');
    try {
      // Relido dentro da trava: o envio automático pode ter mandado enquanto esperava
      const [ds] = await conn.query<any[]>(
        'SELECT d.*, c.nome AS campanha, c.imagem FROM campanha_disparos d JOIN campanhas c ON c.id = d.campanha_id WHERE d.id = ?',
        [id],
      );
      const d = ds[0];
      if (!['pendente', 'falhou'].includes(d.situacao)) throw new Error(`Este disparo já está "${d.situacao}": não é enviado de novo.`);
      try {
        if (d.canal === 'email') {
          await enviarEmail(String(empresaId), { para: d.destino, assunto: d.assunto || d.campanha, texto: d.mensagem, anexos: anexosDa(d.imagem) });
        } else {
          const assunto = String(d.assunto ?? '').trim();
          await enviarWhatsAppCampanha(
            empresaId,
            telefoneWhatsApp(d.destino),
            (assunto ? `*${assunto}*\n\n` : '') + d.mensagem,
            { pessoa_id: d.pessoa_id, disparo_id: d.id },
            d.imagem,
          );
        }
      } catch (err: any) {
        await conn.query("UPDATE campanha_disparos SET situacao = 'falhou', erro = ? WHERE id = ?", [String(err?.message || err).slice(0, 255), d.id]);
        throw err;
      }
      await conn.query("UPDATE campanha_disparos SET situacao = 'enviado', enviado_em = NOW(), erro = NULL WHERE id = ?", [d.id]);
      return { situacao: 'enviado' };
    } finally {
      await conn.query('SELECT RELEASE_LOCK(?)', [trava]);
    }
  } finally {
    conn.release();
  }
}

/** Fora da Vercel: um ciclo por minuto (na Vercel é o cron de /api/cron/whatsapp) */
export function iniciarEmailsCampanha() {
  let rodando = false;
  setInterval(async () => {
    if (rodando) return;
    rodando = true;
    try {
      const n = await enviarEmailsCampanha();
      if (n) console.log(`Campanhas: ${n} e-mail(s) processado(s).`);
    } catch (err: any) {
      console.error('Campanhas: falha no ciclo de e-mail:', err.message);
    } finally {
      rodando = false;
    }
  }, 60_000);
}

// ------------------------------------------------------------
// Rotas
// ------------------------------------------------------------

export function createCampanhasRouter() {
  const router = Router();

  /** Regras disponíveis para o editor de critérios */
  /** Testar os critérios da tela (ainda sem gravar): total e as 50 primeiras pessoas */
  router.post('/campanhas/criterios/testar', async (req: Request, res: Response) => {
    try {
      res.json(await testarCriterios(req.body?.criterios, res.locals.empresaId));
    } catch (err: any) {
      res.status(err.status || 400).json({ error: friendlyDbError(err, 'campanha') });
    }
  });

  router.get('/campanhas/regras', (_req: Request, res: Response) => {
    res.json(Object.entries(REGRAS).map(([regra, r]) => ({ regra, rotulo: r.rotulo, valor: r.valor })));
  });

  /** Mensagem personalizada para as primeiras pessoas do público (sem gravar nada) */
  router.get('/campanhas/:id/previa', async (req: Request, res: Response) => {
    try {
      const c = await campanhaDa(req.params.id, res.locals.empresaId);
      if (!String(c.mensagem ?? '').trim()) return res.status(400).json({ error: 'A campanha ainda não tem mensagem.' });
      const pessoas = await publicoDa(c, res.locals.empresaId, pool, 3);
      res.json({
        publico: await contarPublico(c.criterios, res.locals.empresaId),
        imagem: c.imagem || null,
        exemplos: pessoas.map((p) => {
          const d = destinoDe(c.canal, p);
          return {
            nome: p.nome,
            destino: d?.destino ?? null,
            assunto: personalizar(c.assunto, p),
            corpo: comAvisoSair(personalizar(c.mensagem, p), d?.canal),
          };
        }),
      });
    } catch (err: any) {
      res.status(err.status || 400).json({ error: friendlyDbError(err, 'campanha') });
    }
  });

  /** Enviar agora um disparo (ver enviarDisparoAgora) */
  router.post('/campanhas/disparos/:id/enviar', async (req: Request, res: Response) => {
    try {
      res.json({ success: true, ...(await enviarDisparoAgora(req.params.id, res.locals.empresaId)) });
    } catch (err: any) {
      res.status(err.status || 400).json({ error: friendlyDbError(err, 'disparo') });
    }
  });

  /** Iniciar envio (ver iniciarEnvio) */
  router.post('/campanhas/:id/iniciar', async (req: Request, res: Response) => {
    try {
      res.json({ success: true, ...(await iniciarEnvio(req.params.id, res.locals.empresaId)) });
    } catch (err: any) {
      res.status(err.status || 400).json({ error: friendlyDbError(err, 'campanha') });
    }
  });

  /** Encerrar a campanha (ver encerrarCampanha) */
  router.post('/campanhas/:id/encerrar', async (req: Request, res: Response) => {
    try {
      res.json({ success: true, ...(await encerrarCampanha(req.params.id, res.locals.empresaId)) });
    } catch (err: any) {
      res.status(err.status || 400).json({ error: friendlyDbError(err, 'campanha') });
    }
  });

  /** Gerar disparos (ver gerarDisparos) */
  router.post('/campanhas/:id/disparos', async (req: Request, res: Response) => {
    try {
      res.json({ success: true, ...(await gerarDisparos(req.params.id, res.locals.empresaId)) });
    } catch (err: any) {
      res.status(err.status || 400).json({ error: friendlyDbError(err, 'campanha') });
    }
  });

  return router;
}
