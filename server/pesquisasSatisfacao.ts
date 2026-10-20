import { Router, Request, Response } from 'express';
import { waitUntil } from '@vercel/functions';
import { pool } from './db.js';
import { podeAcessar } from './permissoes.js';
import { aposGravar } from './regras.js';
import { enviarEmail, lerRespostas } from './email.js';
import { conversarIa, lerChatbot, marcarEvento, temChave } from './chatbot.js';
import { contaWhats, PESSOA_RECENTE } from './whatsapp.js';

/**
 * Pesquisa de satisfação (Suporte › Pesquisa de Satisfação; tabelas pesquisas_satisfacao e pesquisas_satisfacao_itens).
 * A pesquisa guarda o filtro (JSON), quantos sortear, o canal e o objetivo. O sorteio escolhe, ao acaso, atendimentos
 * encerrados (chamados e atendimentos do WhatsApp, tabela whatsapp_atendimentos) que passam no filtro; "Sortear +x"
 * acrescenta outro lote. Executar contata cada atendimento selecionado:
 * - WhatsApp: uma atividade executada pelo Bot (server/atividadeBot.ts), com o objetivo e o atendimento no roteiro.
 *   Quando a conversa termina, analisarConversaPesquisa extrai nota, comentário, resumo e se a empresa precisa retornar.
 * - E-mail: o texto (IA) sai com o código [PS-<item>] no assunto; lerRespostasPesquisa lê a caixa (IMAP) e analisa.
 * - Ligação: uma atividade de ligação para quem liga; o retorno é registrado num modal (POST .../retorno).
 * Precisa retornar: tarefa para o técnico que atendeu (sem ele, o responsável de Configurações › Chatbot / admin).
 */

const ID_TELA = 'pesquisas_satisfacao';
/** Código no assunto do e-mail: a resposta é achada por ele (ou pelo In-Reply-To) */
const codigo = (itemId: number) => `[PS-${itemId}]`;
/** E-mail sem resposta depois disso fica "sem resposta" */
const DIAS_EMAIL = 7;

function erro(status: number, msg: string) {
  return Object.assign(new Error(msg), { status });
}

const rota =
  (fn: (req: Request, res: Response) => Promise<any>) =>
  async (req: Request, res: Response) => {
    try {
      if (!podeAcessar(res.locals.usuario, ID_TELA)) throw erro(403, 'Você não tem permissão para acessar as pesquisas de satisfação.');
      await fn(req, res);
    } catch (err: any) {
      if (!err.status) console.error(`Pesquisas de satisfação: ${err.message}`);
      res.status(err.status || 400).json({ error: err.message });
    }
  };

// ------------------------------------------------------------
// Atendimentos: o universo do sorteio
// ------------------------------------------------------------

export interface FiltroPesquisa {
  data_de?: string | null;
  data_ate?: string | null;
  /** chamado, whatsapp (vazio = os dois) */
  origens?: string[];
  /** Notas de 1 a 5 da avaliação do atendimento (vazio = qualquer) */
  notas?: number[];
  /** Com as notas marcadas: também os atendimentos sem avaliação */
  sem_nota?: boolean;
  segmentos?: number[];
  pessoas?: number[];
  atendentes?: number[];
  departamentos?: number[];
  categorias?: number[];
  /** Não sortear cliente já pesquisado (em qualquer pesquisa) nos últimos X dias; 0 = sem essa regra */
  excluir_dias?: number;
}

const ids = (v: unknown) => (Array.isArray(v) ? [...new Set(v.map(Number).filter((n) => Number.isInteger(n) && n > 0))] : []);
const data = (v: unknown) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);

/** Filtro da tela → o que vai para o banco (só o que é conhecido, nos tipos certos) */
export function normalizarFiltro(f: any): FiltroPesquisa {
  return {
    data_de: data(f?.data_de),
    data_ate: data(f?.data_ate),
    origens: (Array.isArray(f?.origens) ? f.origens : []).filter((o: string) => o === 'chamado' || o === 'whatsapp'),
    notas: ids(f?.notas).filter((n) => n <= 5),
    sem_nota: Boolean(f?.sem_nota),
    segmentos: ids(f?.segmentos),
    pessoas: ids(f?.pessoas),
    atendentes: ids(f?.atendentes),
    departamentos: ids(f?.departamentos),
    categorias: ids(f?.categorias),
    excluir_dias: Math.max(0, Math.min(3650, Number(f?.excluir_dias) || 0)),
  };
}

/**
 * Atendimentos encerrados da empresa que passam no filtro (e ainda não estão nesta pesquisa), como subconsulta:
 * chamados encerrados e atendimentos do WhatsApp, só com cliente cadastrado (é para quem a pesquisa vai)
 */
function atendimentosFiltrados(empresaId: number, pesquisaId: number, f: FiltroPesquisa): { sql: string; params: any[] } {
  const base = `
    SELECT 'chamado' AS origem, c.id AS chamado_id, NULL AS atendimento_id, c.pessoa_id, c.atendente_id, c.departamento_id, c.categoria_id,
           c.encerrado_em AS data_atendimento, CONCAT('Chamado nº ', c.numero, ': ', c.titulo) AS assunto,
           (SELECT av.nota FROM avaliacoes av WHERE av.chamado_id = c.id AND av.nota IS NOT NULL ORDER BY av.id DESC LIMIT 1) AS nota
      FROM chamados c WHERE c.empresa_id = ? AND c.status = 'encerrado' AND c.pessoa_id IS NOT NULL
    UNION ALL
    SELECT 'whatsapp', NULL, w.id, w.pessoa_id, w.atendente_id, w.departamento_id, NULL,
           w.fim, 'Atendimento no WhatsApp', av.nota
      FROM whatsapp_atendimentos w LEFT JOIN avaliacoes av ON av.id = w.avaliacao_id
     WHERE w.empresa_id = ? AND w.pessoa_id IS NOT NULL`;
  const onde: string[] = [];
  const params: any[] = [empresaId, empresaId];
  if (f.data_de) (onde.push('u.data_atendimento >= ?'), params.push(`${f.data_de} 00:00:00`));
  if (f.data_ate) (onde.push('u.data_atendimento <= ?'), params.push(`${f.data_ate} 23:59:59`));
  if (f.origens?.length) (onde.push('u.origem IN (?)'), params.push(f.origens));
  if (f.notas?.length) (onde.push(`(u.nota IN (?)${f.sem_nota ? ' OR u.nota IS NULL' : ''})`), params.push(f.notas));
  if (f.segmentos?.length) (onde.push('p.segmento_id IN (?)'), params.push(f.segmentos));
  if (f.pessoas?.length) (onde.push('u.pessoa_id IN (?)'), params.push(f.pessoas));
  if (f.atendentes?.length) (onde.push('u.atendente_id IN (?)'), params.push(f.atendentes));
  if (f.departamentos?.length) (onde.push('u.departamento_id IN (?)'), params.push(f.departamentos));
  if (f.categorias?.length) (onde.push('u.categoria_id IN (?)'), params.push(f.categorias));
  // Já nesta pesquisa (outro lote) não entra de novo
  onde.push(`NOT EXISTS (SELECT 1 FROM pesquisas_satisfacao_itens i WHERE i.pesquisa_id = ?
                         AND ((u.origem = 'chamado' AND i.chamado_id = u.chamado_id) OR (u.origem = 'whatsapp' AND i.atendimento_id = u.atendimento_id)))`);
  params.push(pesquisaId);
  if (f.excluir_dias) {
    onde.push(`NOT EXISTS (SELECT 1 FROM pesquisas_satisfacao_itens i JOIN pesquisas_satisfacao ps ON ps.id = i.pesquisa_id
                            WHERE ps.empresa_id = ? AND i.pessoa_id = u.pessoa_id AND i.enviado_em >= NOW() - INTERVAL ? DAY)`);
    params.push(empresaId, f.excluir_dias);
    // A pesquisa pós-atendimento do WhatsApp também conta: quem já foi perguntado lá não recebe outra aqui (filtrando
    // por nota, a ideia é justamente voltar a quem avaliou)
    if (!f.notas?.length) {
      onde.push('NOT EXISTS (SELECT 1 FROM avaliacoes av WHERE av.empresa_id = ? AND av.pessoa_id = u.pessoa_id AND av.pedida_em >= NOW() - INTERVAL ? DAY)');
      params.push(empresaId, f.excluir_dias);
    }
  }
  return {
    sql: `SELECT u.* FROM (${base}) u JOIN pessoas p ON p.id = u.pessoa_id WHERE ${onde.join(' AND ')}`,
    params,
  };
}

async function pesquisaDaEmpresa(id: string | number, empresaId: number) {
  const [r] = await pool.query<any[]>('SELECT * FROM pesquisas_satisfacao WHERE id = ? AND empresa_id = ?', [id, empresaId]);
  if (!r[0]) throw erro(404, 'Pesquisa não encontrada.');
  return { ...r[0], filtro: normalizarFiltro(typeof r[0].filtro === 'string' ? JSON.parse(r[0].filtro) : r[0].filtro) };
}

/** Sorteia até "quantidade" atendimentos novos para a pesquisa, num lote novo. Devolve quantos entraram e quantos o filtro achou */
async function sortear(p: any, quantidade: number): Promise<{ sorteados: number; filtrados: number }> {
  const { sql, params } = atendimentosFiltrados(p.empresa_id, p.id, p.filtro);
  const [[{ n }]] = await pool.query<any>(`SELECT COUNT(*) AS n FROM (${sql}) x`, params);
  // Um cliente só uma vez na pesquisa: dois atendimentos dele no período dariam duas conversas iguais ao mesmo tempo
  const [todos] = await pool.query<any[]>(`${sql} ORDER BY RAND()`, params);
  const [ja] = await pool.query<any[]>('SELECT DISTINCT pessoa_id FROM pesquisas_satisfacao_itens WHERE pesquisa_id = ?', [p.id]);
  const vistos = new Set(ja.map((r) => Number(r.pessoa_id)));
  const lista = todos.filter((a) => !vistos.has(Number(a.pessoa_id)) && vistos.add(Number(a.pessoa_id))).slice(0, quantidade);
  const [[{ lote }]] = await pool.query<any>('SELECT COALESCE(MAX(lote), 0) + 1 AS lote FROM pesquisas_satisfacao_itens WHERE pesquisa_id = ?', [p.id]);
  if (lista.length) {
    await pool.query(
      `INSERT IGNORE INTO pesquisas_satisfacao_itens (pesquisa_id, lote, origem, chamado_id, atendimento_id, pessoa_id, atendente_id, data_atendimento, assunto) VALUES ?`,
      [lista.map((a) => [p.id, lote, a.origem, a.chamado_id, a.atendimento_id, a.pessoa_id, a.atendente_id, a.data_atendimento, String(a.assunto ?? '').slice(0, 255)])],
    );
  }
  await pool.query('UPDATE pesquisas_satisfacao SET total_filtrados = ? WHERE id = ?', [Number(n), p.id]);
  return { sorteados: lista.length, filtrados: Number(n) };
}

// ------------------------------------------------------------
// Execução
// ------------------------------------------------------------

/** O item com o que o contato precisa: cliente, técnico, pesquisa */
async function lerItem(itemId: number) {
  const [r] = await pool.query<any[]>(
    `SELECT i.*, ps.empresa_id, ps.descricao AS pesquisa_descricao, ps.objetivo, ps.canal, ps.responsavel_id,
            p.nome AS pessoa_nome, COALESCE(NULLIF(p.whatsapp, ''), p.telefone) AS pessoa_telefone, p.email AS pessoa_email,
            u.nome AS atendente_nome, e.nome AS empresa_nome, DATE_FORMAT(i.data_atendimento, '%d/%m/%Y') AS data_br
       FROM pesquisas_satisfacao_itens i
       JOIN pesquisas_satisfacao ps ON ps.id = i.pesquisa_id
       JOIN empresas e ON e.id = ps.empresa_id
       LEFT JOIN pessoas p ON p.id = i.pessoa_id
       LEFT JOIN usuarios u ON u.id = i.atendente_id
      WHERE i.id = ?`,
    [itemId],
  );
  return r[0] ?? null;
}

/** O roteiro da conversa/ligação: objetivo da pesquisa e o atendimento avaliado */
function roteiro(it: any): string {
  return `Pesquisa de satisfação sobre um atendimento: ${it.assunto ?? 'atendimento'} em ${it.data_br ?? '-'}${it.atendente_nome ? `, atendido por ${it.atendente_nome}` : ''}.
Objetivo: ${String(it.objetivo ?? '').trim() || 'saber como o cliente avalia o atendimento e se ficou alguma pendência.'}
Já no primeiro contato, peça tudo de uma vez: a nota de 1 a 5 para o atendimento (1 = péssimo, 5 = ótimo) e um comentário. Não faça uma pergunta por mensagem: os pontos do objetivo são sugestões do que o cliente pode comentar, não perguntas separadas.
Com a resposta, agradeça e encerre; não peça mais nada. Só continue se o cliente contar que ficou algo pendente, que falta alguma coisa ou que a empresa ficou devendo algo: entenda o que é (sem prometer prazo), diga que a equipe vai retornar e encerre.
Se o cliente disser que já avaliou, que não quer ou não pode responder, agradeça e encerre na hora, sem insistir.`;
}

/** Contata um item selecionado, pelo canal da pesquisa */
async function executarItem(it: any): Promise<void> {
  if (it.canal === 'ligacao') {
    const executor = it.responsavel_id ?? it.atendente_id ?? null;
    const [a] = await pool.query<any>(
      `INSERT INTO atividades (empresa_id, pessoa_id, chamado_id, assunto, tipo, data_vencimento, hora_vencimento, lembrete_para, executor_id, observacao)
       VALUES (?, ?, ?, ?, 'ligacao', CURDATE(), TIME_FORMAT(CURTIME(), '%H:%i:00'), 'nenhum', ?, ?)`,
      [it.empresa_id, it.pessoa_id, it.chamado_id, `Pesquisa de satisfação (ligar): ${it.pessoa_nome ?? 'cliente'}`.slice(0, 255), executor, roteiro(it)],
    );
    await pool.query("UPDATE pesquisas_satisfacao_itens SET atividade_id = ?, situacao = 'enviado', destino = ?, enviado_em = NOW() WHERE id = ?", [
      a.insertId,
      it.pessoa_telefone,
      it.id,
    ]);
    return;
  }
  if (it.canal === 'whatsapp') {
    // O Bot começa no próximo ciclo (dia e hora = agora); a conversa e o fim ficam com ele
    const [a] = await pool.query<any>(
      `INSERT INTO atividades (empresa_id, pessoa_id, chamado_id, assunto, tipo, data_vencimento, hora_vencimento, lembrete_para, executor_bot, observacao)
       VALUES (?, ?, ?, ?, 'whatsapp', CURDATE(), TIME_FORMAT(CURTIME(), '%H:%i:00'), 'cliente', 1, ?)`,
      [it.empresa_id, it.pessoa_id, it.chamado_id, `Pesquisa de satisfação: ${it.pesquisa_descricao}`.slice(0, 255), roteiro(it)],
    );
    await pool.query("UPDATE pesquisas_satisfacao_itens SET atividade_id = ?, situacao = 'enviado', destino = ?, enviado_em = NOW() WHERE id = ?", [
      a.insertId,
      it.pessoa_telefone,
      it.id,
    ]);
    return;
  }
  // E-mail: a IA escreve a mensagem; o código no assunto liga a resposta ao item
  if (!it.pessoa_email) throw new Error('Cliente sem e-mail no cadastro.');
  const cfg = await lerChatbot(it.empresa_id);
  if (!temChave(cfg)) throw erro(400, 'Configure a IA em Configurações › IA antes de executar a pesquisa por e-mail.');
  const r = await conversarIa(
    cfg,
    `Você é ${cfg.nome}, da empresa ${it.empresa_nome}. Escreva um e-mail curto para ${it.pessoa_nome ?? 'o cliente'} (saudação, o pedido e a despedida em nome da empresa, sem linha de assunto), em português do Brasil, cordial.
${roteiro(it)}
Peça para ele responder este e-mail com a nota de 1 a 5 e o comentário.`,
    [{ de: 'pessoa', texto: '(Escreva o e-mail.)' }],
    [],
  );
  if (!r.texto) throw new Error('a IA não escreveu o e-mail.');
  const messageId = await enviarEmail(String(it.empresa_id), {
    para: it.pessoa_email,
    assunto: `${it.empresa_nome}: pesquisa de satisfação ${codigo(it.id)}`,
    texto: r.texto,
  }, 'suporte');
  await pool.query("UPDATE pesquisas_satisfacao_itens SET situacao = 'enviado', destino = ?, email_message_id = ?, enviado_em = NOW() WHERE id = ?", [
    it.pessoa_email,
    messageId,
    it.id,
  ]);
}

// ------------------------------------------------------------
// Retorno do cliente
// ------------------------------------------------------------

interface Retorno {
  nota: number | null;
  comentario: string;
  resumo: string;
  precisa_retorno: boolean;
  motivo_retorno: string;
}

/** A IA lê o que o cliente respondeu (conversa ou e-mail) e devolve o retorno estruturado */
async function analisarRetorno(it: any, conversa: string): Promise<Retorno | null> {
  const cfg = await lerChatbot(it.empresa_id);
  if (!temChave(cfg)) return null;
  const r = await conversarIa(
    cfg,
    `Você analisa a resposta de um cliente a uma pesquisa de satisfação da empresa ${it.empresa_nome} sobre ${it.assunto ?? 'um atendimento'}${it.atendente_nome ? ` (atendido por ${it.atendente_nome})` : ''}.
Responda só com JSON, sem texto em volta:
{"nota": número de 1 a 5 que o cliente deu (null se não deu), "comentario": "o que o cliente disse, fiel às palavras dele", "resumo": "resumo em até 2 frases para a equipe", "precisa_retorno": true se o cliente contou algo pendente, que falta alguma coisa, que a empresa ficou devendo algo ou pediu contato, "motivo_retorno": "o que a empresa precisa fazer, em uma frase (vazio se não precisa)"}`,
    [{ de: 'pessoa', texto: conversa }],
    [],
  );
  try {
    const j = JSON.parse(/\{[\s\S]*\}/.exec(r.texto)?.[0] ?? '{}');
    const nota = Number(j.nota);
    return {
      nota: Number.isInteger(nota) && nota >= 1 && nota <= 5 ? nota : null,
      comentario: String(j.comentario ?? '').trim().slice(0, 4000),
      resumo: String(j.resumo ?? '').trim().slice(0, 2000),
      precisa_retorno: j.precisa_retorno === true,
      motivo_retorno: String(j.motivo_retorno ?? '').trim(),
    };
  } catch {
    throw new Error(`a IA não devolveu o retorno da pesquisa: ${r.texto.slice(0, 200)}`);
  }
}

/**
 * Grava o retorno no item; precisa retornar: tarefa para o técnico que atendeu (sem ele: o responsável pelas pendências
 * de Configurações › Chatbot ou o primeiro administrador). Depois vê se a pesquisa terminou
 */
async function gravarRetorno(it: any, r: Retorno, registradoPor: number | null = null) {
  let tarefaId: number | null = null;
  if (r.precisa_retorno) {
    // O técnico que atendeu; sem ele (ou inativo), o responsável pelas pendências; sem ele, o primeiro administrador
    const cfg: any = await lerChatbot(it.empresa_id);
    const [ativos] = await pool.query<any[]>("SELECT id, tipo FROM usuarios WHERE empresa_id = ? AND ativo = 1 ORDER BY id", [it.empresa_id]);
    const executor =
      ativos.find((u) => u.id === it.atendente_id) ?? ativos.find((u) => u.id === Number(cfg?.responsavel_pendencias_id)) ?? ativos.find((u) => u.tipo === 'admin');
    const motivo = r.motivo_retorno || r.resumo || 'Cliente pediu retorno na pesquisa de satisfação.';
    const [t] = await pool.query<any>(
      `INSERT INTO atividades (empresa_id, pessoa_id, chamado_id, assunto, tipo, data_vencimento, hora_vencimento, lembrete_para, executor_id, observacao)
       VALUES (?, ?, ?, ?, 'tarefa', CURDATE(), TIME_FORMAT(CURTIME(), '%H:%i:00'), 'nenhum', ?, ?)`,
      [
        it.empresa_id,
        it.pessoa_id,
        it.chamado_id,
        `Retorno da pesquisa de satisfação: ${motivo}`.slice(0, 255),
        executor?.id ?? null,
        `Retorno da pesquisa de satisfação "${it.pesquisa_descricao}" (${it.assunto ?? 'atendimento'} em ${it.data_br ?? '-'}).\nNota: ${r.nota ?? '-'}. ${r.comentario}`,
      ],
    );
    tarefaId = Number(t.insertId);
    await aposGravar('atividades', String(tarefaId));
  }
  await pool.query(
    `UPDATE pesquisas_satisfacao_itens SET situacao = 'respondido', nota = ?, comentario = ?, resumo = ?, precisa_retorno = ?, tarefa_id = COALESCE(?, tarefa_id),
            registrado_por = ?, respondido_em = NOW() WHERE id = ?`,
    [r.nota, r.comentario || null, r.resumo || null, r.precisa_retorno ? 1 : 0, tarefaId, registradoPor, it.id],
  );
  await verificarConclusao(it.pesquisa_id);
}

/** Todos os selecionados já têm resultado: a pesquisa fica concluída */
async function verificarConclusao(pesquisaId: number) {
  await pool.query(
    `UPDATE pesquisas_satisfacao ps SET ps.situacao = 'concluida', ps.concluida_em = NOW()
      WHERE ps.id = ? AND ps.situacao = 'em_andamento'
        AND NOT EXISTS (SELECT 1 FROM pesquisas_satisfacao_itens i WHERE i.pesquisa_id = ps.id AND i.selecionado = 1 AND i.situacao IN ('sorteado', 'enviado', 'em_conversa'))`,
    [pesquisaId],
  );
}

/** Item da pesquisa ligado a uma atividade (a do Bot no WhatsApp ou a de ligação) */
export async function itemDaAtividade(atividadeId: number): Promise<number | null> {
  const [r] = await pool.query<any[]>('SELECT id FROM pesquisas_satisfacao_itens WHERE atividade_id = ? LIMIT 1', [atividadeId]);
  return r[0]?.id ?? null;
}

/**
 * Conversa do Bot de uma pesquisa terminou (server/atividadeBot.ts chama no lugar da análise de pendências): sem
 * resposta/falha fica assim; senão a IA lê a conversa e grava o retorno. A linha de análise vai para a conversa do
 * WhatsApp (a análise do atendimento, depois, não repete estas mensagens)
 */
export function analisarConversaPesquisa(conversaId: number) {
  waitUntil(
    (async () => {
      const [c] = await pool.query<any[]>('SELECT c.*, a.empresa_id FROM atividade_conversas c JOIN atividades a ON a.id = c.atividade_id WHERE c.id = ?', [conversaId]);
      const conv = c[0];
      const itemId = conv && (await itemDaAtividade(conv.atividade_id));
      if (!itemId) return;
      const it = await lerItem(itemId);
      const [ms] = await pool.query<any[]>('SELECT direcao, texto FROM atividade_mensagens WHERE conversa_id = ? ORDER BY id', [conversaId]);
      if (!ms.some((m) => m.direcao === 'recebida')) {
        const situacao = conv.situacao === 'falhou' ? 'falhou' : 'sem_resposta';
        await pool.query('UPDATE pesquisas_satisfacao_itens SET situacao = ?, resumo = ? WHERE id = ?', [situacao, conv.resumo ?? null, itemId]);
        await verificarConclusao(it.pesquisa_id);
        return;
      }
      const r = await analisarRetorno(it, ms.map((m) => `${m.direcao === 'recebida' ? 'Cliente' : 'Empresa'}: ${m.texto}`).join('\n'));
      if (!r) return;
      await gravarRetorno(it, r);
      await marcarEvento(
        it.empresa_id,
        conv.destino,
        `Análise da conversa: pesquisa de satisfação registrada (nota ${r.nota ?? '-'})${r.precisa_retorno ? ' → tarefa de retorno para o técnico' : ''}`,
        null,
      );
    })().catch((err) => console.error(`Pesquisa de satisfação (conversa ${conversaId}): ${err.message}`)),
  );
}

/** Tira do e-mail de resposta o texto citado da mensagem original ("Em ... escreveu:", linhas com ">") */
export function textoDaResposta(texto: string): string {
  const linhas: string[] = [];
  for (const l of texto.split(/\r?\n/)) {
    if (/^\s*(Em .+escreveu:|On .+wrote:|-----\s*Mensagem original|De:\s.+@)/i.test(l)) break;
    if (!/^\s*>/.test(l)) linhas.push(l);
  }
  return linhas.join('\n').trim();
}

/**
 * Respostas por e-mail (ciclo de minuto): para cada empresa com itens de e-mail aguardando, lê a caixa e analisa as
 * respostas; enviados há mais de 7 dias sem resposta ficam "sem resposta"
 */
export async function lerRespostasPesquisa(): Promise<number> {
  await pool.query(
    `UPDATE pesquisas_satisfacao_itens i JOIN pesquisas_satisfacao ps ON ps.id = i.pesquisa_id
        SET i.situacao = 'sem_resposta'
      WHERE ps.canal = 'email' AND i.situacao = 'enviado' AND i.enviado_em < NOW() - INTERVAL ? DAY`,
    [DIAS_EMAIL],
  );
  const [empresas] = await pool.query<any[]>(
    `SELECT DISTINCT ps.empresa_id FROM pesquisas_satisfacao_itens i JOIN pesquisas_satisfacao ps ON ps.id = i.pesquisa_id
      WHERE ps.canal = 'email' AND i.situacao = 'enviado'`,
  );
  let lidas = 0;
  for (const { empresa_id } of empresas) {
    try {
      lidas +=
        (await lerRespostas(String(empresa_id), DIAS_EMAIL + 1, async (e) => {
          const pelo = /\[PS-(\d+)\]/.exec(e.assunto)?.[1];
          const [r] = await pool.query<any[]>(
            `SELECT i.id FROM pesquisas_satisfacao_itens i JOIN pesquisas_satisfacao ps ON ps.id = i.pesquisa_id
              WHERE ps.empresa_id = ? AND i.situacao = 'enviado' AND (i.id = ? OR (i.email_message_id IS NOT NULL AND i.email_message_id IN (?)))
              LIMIT 1`,
            [empresa_id, Number(pelo) || 0, e.emRespostaA.length ? e.emRespostaA : ['']],
          );
          if (!r[0]) return false;
          const it = await lerItem(r[0].id);
          const texto = textoDaResposta(e.texto) || e.texto;
          const ret = await analisarRetorno(it, `Cliente (por e-mail): ${texto}`);
          if (!ret) return false;
          await gravarRetorno(it, ret);
          return true;
        }, 'suporte')) ?? 0;
    } catch (err: any) {
      console.error(`Pesquisa de satisfação: leitura do e-mail (empresa ${empresa_id}): ${err.message}`);
    }
  }
  return lidas;
}

/** Fora da Vercel: lê as respostas por e-mail a cada 5 minutos (na Vercel é o cron /api/cron/whatsapp) */
export function iniciarRespostasPesquisa() {
  let rodando = false;
  setInterval(async () => {
    if (rodando) return;
    rodando = true;
    try {
      const n = await lerRespostasPesquisa();
      if (n) console.log(`Pesquisa de satisfação: ${n} resposta(s) por e-mail.`);
    } catch (err: any) {
      console.error('Pesquisa de satisfação: falha no ciclo:', err.message);
    } finally {
      rodando = false;
    }
  }, 5 * 60_000);
}

// ------------------------------------------------------------
// Atendimentos do WhatsApp (whatsapp_atendimentos): um registro por atendimento encerrado
// ------------------------------------------------------------

/**
 * Atendimento do WhatsApp encerrado (chatbot.ts, marcarEncerramento): registra de quando a quando, o cliente e quem
 * atendeu (o último da equipe que escreveu). Só se o cliente escreveu nele
 */
export async function registrarAtendimentoWhatsApp(empresaId: number, telefone: string, motivo: string) {
  // O atendimento vai do encerramento anterior até este (o último)
  const [e] = await pool.query<any[]>(
    "SELECT id FROM whatsapp_mensagens WHERE empresa_id = ? AND telefone = ? AND tipo = 'encerramento' ORDER BY id DESC LIMIT 2",
    [empresaId, telefone],
  );
  if (!e[0]) return;
  const faixa = [empresaId, telefone, e[1]?.id ?? 0, e[0].id];
  const [r] = await pool.query<any[]>(
    `SELECT MIN(data_hora) AS inicio, ${PESSOA_RECENTE()} AS pessoa_id, SUM(direcao = 'recebida' AND (origem IS NULL OR origem NOT LIKE 'pesquisa%')) AS recebidas
       FROM whatsapp_mensagens WHERE empresa_id = ? AND telefone = ? AND id > ? AND id < ? AND tipo NOT IN ('encerramento', 'evento')`,
    faixa,
  );
  if (!Number(r[0]?.recebidas)) return;
  // Quem atendeu: o último da equipe no atendimento (mensagem ou "começou o atendimento")
  const [u] = await pool.query<any[]>(
    `SELECT m.usuario_id, x.departamento_id FROM whatsapp_mensagens m JOIN usuarios x ON x.id = m.usuario_id
      WHERE m.empresa_id = ? AND m.telefone = ? AND m.id > ? AND m.id < ? ORDER BY m.id DESC LIMIT 1`,
    faixa,
  );
  await pool.query(
    'INSERT INTO whatsapp_atendimentos (empresa_id, telefone, pessoa_id, atendente_id, departamento_id, inicio, fim, motivo_fim) VALUES (?, ?, ?, ?, ?, ?, NOW(), ?)',
    [empresaId, telefone, r[0].pessoa_id, u[0]?.usuario_id ?? null, u[0]?.departamento_id ?? null, r[0].inicio, motivo],
  );
}

/** Pesquisa pós-atendimento enviada (pesquisa.ts): liga a avaliação ao atendimento que acabou de encerrar */
export async function ligarAvaliacao(empresaId: number, telefone: string, avaliacaoId: number) {
  await pool.query(
    `UPDATE whatsapp_atendimentos SET avaliacao_id = ?
      WHERE empresa_id = ? AND telefone = ? AND avaliacao_id IS NULL AND fim >= NOW() - INTERVAL 5 MINUTE ORDER BY id DESC LIMIT 1`,
    [avaliacaoId, empresaId, telefone],
  );
}

// ------------------------------------------------------------
// Rotas da tela
// ------------------------------------------------------------

export function createPesquisasSatisfacaoRouter(): Router {
  const router = Router();
  const emp = (res: Response) => Number(res.locals.empresaId);
  const eu = (res: Response) => Number(res.locals.usuarioId);

  /** Aba Pesquisas: a lista, com os totais */
  router.get('/pesquisas-satisfacao', rota(async (_req, res) => {
    const [r] = await pool.query<any[]>(
      `SELECT ps.id, ps.descricao, ps.canal, ps.situacao, ps.quantidade, ps.total_filtrados, ps.criado_em, ps.executada_em, ps.concluida_em, u.nome AS criado_por_nome,
              (SELECT COUNT(*) FROM pesquisas_satisfacao_itens i WHERE i.pesquisa_id = ps.id AND i.selecionado = 1) AS selecionados,
              (SELECT COUNT(*) FROM pesquisas_satisfacao_itens i WHERE i.pesquisa_id = ps.id AND i.situacao = 'respondido') AS respondidos,
              (SELECT ROUND(AVG(i.nota), 1) FROM pesquisas_satisfacao_itens i WHERE i.pesquisa_id = ps.id AND i.nota IS NOT NULL) AS media
         FROM pesquisas_satisfacao ps LEFT JOIN usuarios u ON u.id = ps.criado_por
        WHERE ps.empresa_id = ? ORDER BY ps.id DESC`,
      [emp(res)],
    );
    res.json(r.map((x) => ({ ...x, selecionados: Number(x.selecionados), respondidos: Number(x.respondidos), media: x.media == null ? null : Number(x.media) })));
  }));

  /** Uma pesquisa com os atendimentos sorteados */
  router.get('/pesquisas-satisfacao/:id', rota(async (req, res) => {
    const p = await pesquisaDaEmpresa(req.params.id, emp(res));
    const [itens] = await pool.query<any[]>(
      `SELECT i.*, pe.nome AS pessoa_nome, COALESCE(NULLIF(pe.whatsapp, ''), NULLIF(pe.telefone, '')) AS pessoa_telefone, NULLIF(pe.email, '') AS pessoa_email,
              u.nome AS atendente_nome, ch.numero AS chamado_numero, r.nome AS registrado_por_nome,
              a.executor_bot, a.tipo AS atividade_tipo
         FROM pesquisas_satisfacao_itens i
         LEFT JOIN pessoas pe ON pe.id = i.pessoa_id
         LEFT JOIN usuarios u ON u.id = i.atendente_id
         LEFT JOIN usuarios r ON r.id = i.registrado_por
         LEFT JOIN chamados ch ON ch.id = i.chamado_id
         LEFT JOIN atividades a ON a.id = i.atividade_id
        WHERE i.pesquisa_id = ? ORDER BY i.lote, i.data_atendimento DESC`,
      [p.id],
    );
    res.json({ ...p, itens: itens.map((i) => ({ ...i, selecionado: Boolean(i.selecionado), precisa_retorno: i.precisa_retorno == null ? null : Boolean(i.precisa_retorno) })) });
  }));

  const dadosDaTela = (b: any) => {
    const descricao = String(b?.descricao ?? '').trim().slice(0, 150);
    if (!descricao) throw erro(400, 'Informe a descrição da pesquisa.');
    const canal = ['whatsapp', 'email', 'ligacao'].includes(b?.canal) ? b.canal : 'whatsapp';
    const quantidade = Math.max(0, Math.min(1000, Math.trunc(Number(b?.quantidade) || 0)));
    return {
      descricao,
      objetivo: String(b?.objetivo ?? '').trim().slice(0, 4000) || null,
      canal,
      // WhatsApp por onde o Bot conversa (server/atividadeBot.ts)
      conta: contaWhats(b?.conta),
      filtro: JSON.stringify(normalizarFiltro(b?.filtro)),
      quantidade,
      responsavel_id: Number(b?.responsavel_id) || null,
    };
  };

  router.post('/pesquisas-satisfacao', rota(async (req, res) => {
    const d = dadosDaTela(req.body);
    const [r] = await pool.query<any>(
      'INSERT INTO pesquisas_satisfacao (empresa_id, descricao, objetivo, canal, conta, filtro, quantidade, responsavel_id, criado_por) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [emp(res), d.descricao, d.objetivo, d.canal, d.conta, d.filtro, d.quantidade, d.responsavel_id, eu(res)],
    );
    res.json({ id: Number(r.insertId) });
  }));

  router.put('/pesquisas-satisfacao/:id', rota(async (req, res) => {
    const p = await pesquisaDaEmpresa(req.params.id, emp(res));
    const d = dadosDaTela(req.body);
    // Já executada: o canal não muda (os contatos saíram por ele)
    if (p.situacao !== 'rascunho' && d.canal !== p.canal) throw erro(400, 'A pesquisa já foi executada: o tipo de contato não pode mudar.');
    // Nem o número: as conversas já começaram por ele
    if (p.situacao !== 'rascunho') d.conta = contaWhats(p.conta);
    // Já sorteada: o filtro e a quantidade ficam como no primeiro sorteio ("Sortear +x" usa o mesmo filtro)
    const [[{ sorteada }]] = await pool.query<any>('SELECT EXISTS (SELECT 1 FROM pesquisas_satisfacao_itens WHERE pesquisa_id = ?) AS sorteada', [p.id]);
    if (Number(sorteada)) {
      d.filtro = JSON.stringify(p.filtro);
      d.quantidade = p.quantidade;
    }
    await pool.query('UPDATE pesquisas_satisfacao SET descricao = ?, objetivo = ?, canal = ?, conta = ?, filtro = ?, quantidade = ?, responsavel_id = ? WHERE id = ?', [
      d.descricao,
      d.objetivo,
      d.canal,
      d.conta,
      d.filtro,
      d.quantidade,
      d.responsavel_id,
      p.id,
    ]);
    res.json({ success: true });
  }));

  router.delete('/pesquisas-satisfacao/:id', rota(async (req, res) => {
    const p = await pesquisaDaEmpresa(req.params.id, emp(res));
    await pool.query('DELETE FROM pesquisas_satisfacao WHERE id = ?', [p.id]);
    res.json({ success: true });
  }));

  /** Quantos atendimentos o filtro acha (sem sortear) */
  router.post('/pesquisas-satisfacao/previa', rota(async (req, res) => {
    const id = Number(req.body?.id) || 0;
    const { sql, params } = atendimentosFiltrados(emp(res), id, normalizarFiltro(req.body?.filtro));
    const [[{ n }]] = await pool.query<any>(`SELECT COUNT(*) AS n FROM (${sql}) x`, params);
    res.json({ filtrados: Number(n) });
  }));

  /** Sortear (a quantidade da pesquisa) ou "Sortear +x" (quantidade informada): um lote novo */
  router.post('/pesquisas-satisfacao/:id/sortear', rota(async (req, res) => {
    const p = await pesquisaDaEmpresa(req.params.id, emp(res));
    if (p.situacao === 'concluida' || p.situacao === 'cancelada') throw erro(400, 'Pesquisa encerrada: não dá para sortear mais.');
    const quantidade = Math.trunc(Number(req.body?.quantidade ?? p.quantidade) || 0);
    if (quantidade < 1 || quantidade > 1000) throw erro(400, 'Informe quantos atendimentos sortear (de 1 a 1.000).');
    res.json(await sortear(p, quantidade));
  }));

  /** Marcar/desmarcar um atendimento sorteado (só antes de contatá-lo) */
  router.put('/pesquisas-satisfacao/itens/:itemId', rota(async (req, res) => {
    const [r] = await pool.query<any>(
      `UPDATE pesquisas_satisfacao_itens i JOIN pesquisas_satisfacao ps ON ps.id = i.pesquisa_id
          SET i.selecionado = ?
        WHERE i.id = ? AND ps.empresa_id = ? AND i.situacao = 'sorteado'`,
      [req.body?.selecionado ? 1 : 0, req.params.itemId, emp(res)],
    );
    if (!r.affectedRows) throw erro(400, 'Este atendimento já foi contatado: não dá para desmarcar.');
    res.json({ success: true });
  }));

  /**
   * Concluir (forçado, pela lista): a pesquisa fica concluída mesmo com gente sem responder. Não contata mais
   * ninguém; quem já foi contatado e responder depois ainda tem a resposta gravada
   */
  router.post('/pesquisas-satisfacao/:id/concluir', rota(async (req, res) => {
    const p = await pesquisaDaEmpresa(req.params.id, emp(res));
    if (p.situacao === 'concluida' || p.situacao === 'cancelada') throw erro(400, `A pesquisa já está ${p.situacao === 'concluida' ? 'concluída' : 'cancelada'}.`);
    await pool.query("UPDATE pesquisas_satisfacao SET situacao = 'concluida', concluida_em = NOW() WHERE id = ?", [p.id]);
    res.json({ success: true });
  }));

  /** Executar: contata os selecionados ainda não contatados */
  router.post('/pesquisas-satisfacao/:id/executar', rota(async (req, res) => {
    const p = await pesquisaDaEmpresa(req.params.id, emp(res));
    if (p.situacao === 'concluida' || p.situacao === 'cancelada') throw erro(400, 'Pesquisa encerrada: não contata mais ninguém.');
    if (p.canal !== 'ligacao') {
      const cfg = await lerChatbot(emp(res));
      if (!temChave(cfg)) throw erro(400, 'Configure a IA em Configurações › IA antes de executar a pesquisa.');
    }
    const [itens] = await pool.query<any[]>("SELECT id FROM pesquisas_satisfacao_itens WHERE pesquisa_id = ? AND selecionado = 1 AND situacao = 'sorteado'", [p.id]);
    if (!itens.length) throw erro(400, 'Nenhum atendimento selecionado aguardando contato.');
    await pool.query("UPDATE pesquisas_satisfacao SET situacao = 'em_andamento', executada_em = COALESCE(executada_em, NOW()) WHERE id = ?", [p.id]);
    let feitos = 0;
    const falhas: string[] = [];
    for (const { id } of itens) {
      try {
        await executarItem(await lerItem(id));
        feitos++;
      } catch (err: any) {
        await pool.query("UPDATE pesquisas_satisfacao_itens SET situacao = 'falhou', resumo = ? WHERE id = ?", [String(err.message).slice(0, 500), id]);
        falhas.push(err.message);
      }
    }
    await verificarConclusao(p.id);
    res.json({ executados: feitos, falhas: falhas.length, erro: falhas[0] ?? null });
  }));

  /** Ligação: o retorno do cliente registrado por quem ligou (modal); "não atendeu" deixa sem resposta */
  router.post('/pesquisas-satisfacao/itens/:itemId/retorno', rota(async (req, res) => {
    const it = await lerItem(Number(req.params.itemId));
    if (!it || it.empresa_id !== emp(res)) throw erro(404, 'Atendimento da pesquisa não encontrado.');
    const b = req.body || {};
    if (b.nao_atendeu) {
      await pool.query("UPDATE pesquisas_satisfacao_itens SET situacao = 'sem_resposta', resumo = 'Cliente não atendeu a ligação.', registrado_por = ? WHERE id = ?", [eu(res), it.id]);
      await verificarConclusao(it.pesquisa_id);
    } else {
      const nota = Number(b.nota);
      if (!Number.isInteger(nota) || nota < 1 || nota > 5) throw erro(400, 'Escolha a nota de 1 a 5 que o cliente deu.');
      await gravarRetorno(
        it,
        {
          nota,
          comentario: String(b.comentario ?? '').trim().slice(0, 4000),
          resumo: String(b.resumo ?? '').trim().slice(0, 2000),
          precisa_retorno: Boolean(b.precisa_retorno),
          motivo_retorno: String(b.motivo_retorno ?? '').trim(),
        },
        eu(res),
      );
    }
    // A atividade da ligação fica concluída
    if (it.atividade_id) {
      await pool.query('UPDATE atividades SET concluida = 1 WHERE id = ?', [it.atividade_id]);
      await aposGravar('atividades', String(it.atividade_id), [], pool, eu(res));
    }
    res.json({ success: true });
  }));

  /** Item de pesquisa de uma atividade de ligação (para o modal aberto pela lista de Atividades) */
  router.get('/pesquisas-satisfacao/da-atividade/:atividadeId', rota(async (req, res) => {
    const id = await itemDaAtividade(Number(req.params.atividadeId));
    const it = id ? await lerItem(id) : null;
    if (!it || it.empresa_id !== emp(res)) throw erro(404, 'Esta atividade não é de uma pesquisa de satisfação.');
    res.json({ id: it.id, pessoa_nome: it.pessoa_nome, pessoa_telefone: it.pessoa_telefone, assunto: it.assunto, data_br: it.data_br, atendente_nome: it.atendente_nome, objetivo: it.objetivo, situacao: it.situacao, pesquisa_descricao: it.pesquisa_descricao });
  }));

  /** Busca de cliente para o filtro (a lista de pessoas passa do limite dos combos) */
  router.get('/pesquisas-satisfacao-pessoas', rota(async (req, res) => {
    const q = String(req.query.q || '').trim();
    if (q.length < 2) return res.json([]);
    const [r] = await pool.query<any[]>('SELECT id, nome FROM pessoas WHERE empresa_id = ? AND nome LIKE ? ORDER BY nome LIMIT 20', [emp(res), `%${q}%`]);
    res.json(r);
  }));

  return router;
}
