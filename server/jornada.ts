import dns from 'node:dns/promises';
import net from 'node:net';
import { Router, Request, Response } from 'express';
import { pool } from './db.js';
import { lerConfig, somenteAdmin } from './config.js';
import { cifrar, decifrar } from './segredo.js';
import { chaveTelefone, CONTATO_RECENTE, contaDaConversa, donoDoTelefone, PESSOA_RECENTE, enviarReservada, mostrarDigitando, reservarEnvio, type ArquivoEnvio, type ContaWhats, type MensagemNova } from './whatsapp.js';
import { campanhaDaConversa, contextoDeCampanha } from './campanhas.js';
import {
  avisarDepartamento,
  avisarFalha,
  escolhaDoTexto,
  escolhaPelaIa,
  gerarRespostaIa,
  iaComOpcoes,
  lerChatbot,
  temChave,
  marcarEvento,
  mudarAtendimento,
  registrarLead,
  telefoneCadastro,
  type ConfigChatbot,
  type Contexto,
  type OpcaoMenu,
} from './chatbot.js';
import { TEXTO_ENCERRAMENTO as ENCERRADA_POR_INATIVIDADE } from './inatividade.js';
import { notificar } from './notificacoes.js';

/**
 * Jornada de atendimento do WhatsApp (Configurações › Jornada): um fluxo de nós ligados, desenhado
 * na tela. A conversa guarda em que nó está (whatsapp_conversas.no_atual), as respostas coletadas
 * (variaveis) e, no nó Esperar, quando continuar (retomar_em, retomado pelo cron a cada minuto).
 * Nós que esperam o cliente: Menu, Pergunta, IA e Esperar (este, se "interromper" estiver ligado).
 * Ligada, a jornada atende no lugar do bot (modo teste: só os números da lista).
 */

const ONDE = 'Configurações › Automação';
const MAX_NOS = 200;
/** Ao cliente, quando a IA falha e a conversa passa para a equipe */
const AVISO_IA_FALHOU = 'No momento não consegui responder por aqui. Vou te passar para um atendente, que já continua a conversa.';
/** Passos por mensagem: laço sem nó de espera (Mensagem → Mensagem → ...) para aqui */
const MAX_PASSOS = 50;
const MAX_ARQUIVO = 3 * 1024 * 1024;
/** Estado da conversa depois de um nó Fim (ou saída sem ligação) */
const FIM = '__fim';

export const TIPOS_NO = ['inicio', 'mensagem', 'imagem', 'menu', 'pergunta', 'condicao', 'case', 'esperar', 'api', 'ia', 'iaex', 'lead', 'prospeccao', 'tarefa', 'departamento', 'fim'] as const;
export type TipoNo = (typeof TIPOS_NO)[number];

export interface No {
  id: string;
  tipo: TipoNo;
  x: number;
  y: number;
  dados: Record<string, any>;
}
export interface Ligacao {
  de: string;
  saida: string;
  para: string;
}
export interface Jornada {
  ativo: boolean;
  /** teste: só os números de numeros_teste passam pela jornada */
  modo: 'teste' | 'todos';
  numeros_teste: string[];
  nos: No[];
  ligacoes: Ligacao[];
}

/** Saídas de cada nó (a tela tem a mesma regra em src/utils/jornada.ts) */
export function saidasDoNo(no: Pick<No, 'tipo' | 'dados'>): string[] {
  switch (no.tipo) {
    case 'menu':
      return [...(no.dados.opcoes ?? []).map((o: any) => String(o.id)), 'invalida'];
    case 'condicao':
      return ['sim', 'nao'];
    case 'case':
      return [...(no.dados.casos ?? []).map((c: any) => String(c.id)), 'nenhum'];
    case 'api':
      return ['sucesso', 'erro'];
    case 'ia':
      return ['humano'];
    case 'iaex':
      return [...(no.dados.opcoes ?? []).map((o: any) => String(o.id)), 'nenhuma'];
    case 'departamento':
    case 'fim':
      return [];
    default:
      return ['proximo'];
  }
}

const VAZIA: Jornada = {
  ativo: false,
  modo: 'teste',
  numeros_teste: [],
  nos: [
    { id: 'inicio', tipo: 'inicio', x: 0, y: 0, dados: {} },
    { id: 'fim', tipo: 'fim', x: 0, y: 200, dados: {} },
  ],
  ligacoes: [{ de: 'inicio', saida: 'proximo', para: 'fim' }],
};

// ------------------------------------------------------------
// Gravação (tela → banco) e leitura (banco → tela)
// ------------------------------------------------------------

const ID = /^[A-Za-z0-9_-]{1,40}$/;
const VARIAVEL = /^[A-Za-z_][A-Za-z0-9_]{0,39}$/;
const texto = (v: unknown, max: number) => String(v ?? '').slice(0, max);

/** Valor da tela → banco: confere a estrutura e cifra os cabeçalhos secretos das chamadas de API */
export function prepararJornada(valor: any, anterior: Jornada | null): Jornada {
  const nosBrutos: any[] = Array.isArray(valor?.nos) ? valor.nos : [];
  if (nosBrutos.length > MAX_NOS) throw new Error(`Automação: no máximo ${MAX_NOS} nós.`);
  const nos: No[] = [];
  for (const n of nosBrutos) {
    const id = String(n?.id ?? '');
    if (!ID.test(id) || nos.some((x) => x.id === id)) throw new Error(`Automação: nó com identificador inválido ou repetido ("${id}").`);
    if (!TIPOS_NO.includes(n?.tipo)) throw new Error(`Automação: tipo de nó desconhecido ("${n?.tipo}").`);
    const no: No = { id, tipo: n.tipo, x: Number(n.x) || 0, y: Number(n.y) || 0, dados: prepararDados(n.tipo, n.dados ?? {}, id, anterior) };
    nos.push(no);
  }
  if (nos.filter((n) => n.tipo === 'inicio').length !== 1) throw new Error('Automação: precisa ter exatamente um nó Início.');

  const ligacoes: Ligacao[] = [];
  for (const l of Array.isArray(valor?.ligacoes) ? valor.ligacoes : []) {
    const de = nos.find((n) => n.id === l?.de);
    const para = nos.find((n) => n.id === l?.para);
    const saida = String(l?.saida ?? '');
    if (!de || !para) throw new Error('Automação: ligação com nó que não existe.');
    if (para.tipo === 'inicio') throw new Error('Automação: nenhuma ligação pode chegar no Início.');
    if (!saidasDoNo(de).includes(saida)) throw new Error(`Automação: a saída "${saida}" não existe no nó "${rotulo(de)}".`);
    if (ligacoes.some((x) => x.de === de.id && x.saida === saida)) throw new Error(`Automação: a saída "${saida}" do nó "${rotulo(de)}" tem mais de uma ligação.`);
    ligacoes.push({ de: de.id, saida, para: para.id });
  }

  const numeros_teste: string[] = [];
  for (const t of Array.isArray(valor?.numeros_teste) ? valor.numeros_teste : []) {
    const d = String(t ?? '').replace(/\D/g, '');
    if (!d) continue;
    if (!chaveTelefone(d, d.length >= 12)) throw new Error(`Automação: número de teste inválido ("${t}"). Use DDD + número.`);
    if (!numeros_teste.includes(d)) numeros_teste.push(d);
  }
  const modo = valor?.modo === 'todos' ? 'todos' : 'teste';
  const ativo = Boolean(valor?.ativo);
  if (ativo && modo === 'teste' && !numeros_teste.length) throw new Error('Automação: no modo teste, informe pelo menos um número de teste.');
  return { ativo, modo, numeros_teste, nos, ligacoes };
}

const rotulo = (n: Pick<No, 'id' | 'tipo' | 'dados'>) => String(n.dados?.titulo || '').trim() || `${n.tipo} ${n.id}`;

function prepararDados(tipo: TipoNo, d: any, id: string, anterior: Jornada | null): Record<string, any> {
  const erro = (msg: string) => new Error(`Automação, nó ${rotulo({ id, tipo, dados: d })}: ${msg}`);
  const base = { titulo: texto(d.titulo, 60) };
  const listaIds = (itens: any[], nome: string) => {
    const vistos = new Set<string>();
    for (const i of itens) {
      if (!ID.test(String(i?.id ?? '')) || vistos.has(String(i.id))) throw erro(`${nome} com identificador inválido.`);
      vistos.add(String(i.id));
    }
  };
  switch (tipo) {
    case 'mensagem':
    case 'fim':
      return { ...base, texto: texto(d.texto, 4000) };
    case 'imagem': {
      const arquivo_id = Number(d.arquivo_id) || null;
      const url = texto(d.url, 1000).trim();
      if (!arquivo_id && !/^https:\/\//i.test(url)) throw erro('escolha uma imagem ou informe um link https.');
      return { ...base, arquivo_id, arquivo_nome: texto(d.arquivo_nome, 150), url: arquivo_id ? '' : url, legenda: texto(d.legenda, 1000) };
    }
    case 'menu': {
      const opcoes = (Array.isArray(d.opcoes) ? d.opcoes : []).map((o: any) => ({ id: String(o?.id ?? ''), rotulo: texto(o?.rotulo, 80).trim() }));
      if (!opcoes.length || opcoes.length > 9) throw erro('o menu precisa ter de 1 a 9 opções.');
      if (opcoes.some((o: any) => !o.rotulo)) throw erro('toda opção precisa de um texto.');
      listaIds(opcoes, 'opção');
      return { ...base, texto: texto(d.texto, 1000), opcoes, invalida: texto(d.invalida, 500) };
    }
    case 'pergunta': {
      const variavel = String(d.variavel ?? '').trim();
      if (!VARIAVEL.test(variavel)) throw erro('informe a variável que guarda a resposta (letras, números e _).');
      if (!String(d.texto ?? '').trim()) throw erro('escreva a pergunta.');
      return { ...base, texto: texto(d.texto, 1000), variavel };
    }
    case 'condicao': {
      const tipoCond = ['horario', 'cadastrado', 'negocio', 'variavel'].includes(d.tipo) ? d.tipo : 'variavel';
      const dias = (Array.isArray(d.dias) ? d.dias : [1, 2, 3, 4, 5]).map(Number).filter((n: number) => n >= 0 && n <= 6);
      const hora = (h: unknown, padrao: string) => (/^\d{2}:\d{2}$/.test(String(h)) ? String(h) : padrao);
      if (tipoCond === 'variavel' && !VARIAVEL.test(String(d.variavel ?? ''))) throw erro('informe a variável a comparar.');
      return {
        ...base,
        tipo: tipoCond,
        dias,
        das: hora(d.das, '08:00'),
        ate: hora(d.ate, '18:00'),
        variavel: texto(d.variavel, 40),
        operador: OPERADORES.includes(d.operador) ? d.operador : 'igual',
        valor: texto(d.valor, 500),
      };
    }
    case 'case': {
      if (!VARIAVEL.test(String(d.variavel ?? ''))) throw erro('informe a variável a comparar.');
      const casos = (Array.isArray(d.casos) ? d.casos : []).map((c: any) => ({
        id: String(c?.id ?? ''),
        operador: OPERADORES.includes(c?.operador) ? c.operador : 'igual',
        valor: texto(c?.valor, 500),
        rotulo: texto(c?.rotulo, 60),
      }));
      if (!casos.length || casos.length > 20) throw erro('informe de 1 a 20 casos.');
      listaIds(casos, 'caso');
      return { ...base, variavel: texto(d.variavel, 40), casos };
    }
    case 'esperar': {
      const minutos = Number(d.minutos);
      if (!Number.isInteger(minutos) || minutos < 1 || minutos > 43_200) throw erro('os minutos devem ser de 1 a 43.200.');
      return { ...base, minutos, interromper: Boolean(d.interromper) };
    }
    case 'api': {
      const metodo = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(d.metodo) ? d.metodo : 'GET';
      const url = texto(d.url, 2000).trim();
      if (!/^https:\/\//i.test(url)) throw erro('a URL precisa começar com https://.');
      const antes: any[] = anterior?.nos.find((n) => n.id === id && n.tipo === 'api')?.dados.cabecalhos ?? [];
      const cabecalhos = (Array.isArray(d.cabecalhos) ? d.cabecalhos : [])
        .map((h: any) => {
          const nome = texto(h?.nome, 100).trim();
          if (!nome) return null;
          if (!/^[A-Za-z0-9-]+$/.test(nome)) throw erro(`cabeçalho com nome inválido ("${nome}").`);
          if (!h?.secreto) return { nome, valor: texto(h?.valor, 2000), secreto: false };
          // Secreto: gravado cifrado; em branco mantém o que já estava gravado
          const valor = String(h?.valor ?? '');
          const valor_cifrado = valor ? cifrar(valor.slice(0, 2000)) : antes.find((a) => a.nome === nome && a.secreto)?.valor_cifrado;
          if (!valor_cifrado) throw erro(`informe o valor do cabeçalho secreto "${nome}".`);
          return { nome, valor: '', secreto: true, valor_cifrado };
        })
        .filter(Boolean);
      const extrair = (Array.isArray(d.extrair) ? d.extrair : [])
        .map((e: any) => ({ caminho: texto(e?.caminho, 200).trim(), variavel: String(e?.variavel ?? '').trim() }))
        .filter((e: any) => e.caminho || e.variavel);
      for (const e of extrair) if (!e.caminho || !VARIAVEL.test(e.variavel)) throw erro('cada campo da resposta precisa do caminho e da variável.');
      return { ...base, metodo, url, cabecalhos, corpo: texto(d.corpo, 20_000), extrair };
    }
    case 'ia':
      return { ...base, texto: texto(d.texto, 50_000) };
    case 'iaex': {
      if (!String(d.texto ?? '').trim()) throw erro('escreva o texto-base (o que a IA deve perguntar ou fazer).');
      const opcoes = (Array.isArray(d.opcoes) ? d.opcoes : []).map((o: any) => ({ id: String(o?.id ?? ''), rotulo: texto(o?.rotulo, 200).trim() }));
      if (!opcoes.length || opcoes.length > 9) throw erro('informe de 1 a 9 saídas.');
      if (opcoes.some((o: any) => !o.rotulo)) throw erro('toda saída precisa dizer quando ela vale.');
      listaIds(opcoes, 'saída');
      const tentativas = Number(d.tentativas ?? 3);
      if (!Number.isInteger(tentativas) || tentativas < 1 || tentativas > 10) throw erro('as tentativas devem ser de 1 a 10.');
      return { ...base, texto: texto(d.texto, 4000), opcoes, tentativas };
    }
    case 'lead':
      return { ...base, nome: texto(d.nome, 200), empresa: texto(d.empresa, 200), email: texto(d.email, 200), interesse: texto(d.interesse, 300) };
    case 'prospeccao': {
      // Funil e etapa vazios: o primeiro funil e a primeira etapa dele
      const idOuNulo = (v: unknown) => (Number.isInteger(Number(v)) && Number(v) > 0 ? Number(v) : null);
      return {
        ...base,
        funil_id: idOuNulo(d.funil_id),
        etapa_id: idOuNulo(d.etapa_id),
        negocio: texto(d.negocio, 200),
        nome: texto(d.nome, 200),
        empresa: texto(d.empresa, 200),
        email: texto(d.email, 200),
        observacao: texto(d.observacao, 1000),
      };
    }
    case 'tarefa': {
      const departamento_id = Number(d.departamento_id) || null;
      if (!String(d.assunto ?? '').trim()) throw erro('informe o assunto da tarefa.');
      return { ...base, departamento_id, assunto: texto(d.assunto, 255), observacao: texto(d.observacao, 2000) };
    }
    case 'departamento': {
      const departamento_id = Number(d.departamento_id);
      if (!Number.isInteger(departamento_id) || departamento_id < 1) throw erro('escolha o departamento.');
      return { ...base, departamento_id, texto: texto(d.texto, 1000) };
    }
    default:
      return base;
  }
}

/** Banco → tela: sem os segredos */
export function jornadaPublica(cfg: Jornada | null): Jornada {
  const j = cfg ?? VAZIA;
  return {
    ...j,
    nos: j.nos.map((n) =>
      n.tipo === 'api'
        ? { ...n, dados: { ...n.dados, cabecalhos: (n.dados.cabecalhos ?? []).map(({ valor_cifrado, ...h }: any) => ({ ...h, definido: Boolean(valor_cifrado) })) } }
        : n,
    ),
  };
}

/** A Automação de cada número: a do atendimento (jornada) e a de quem responde no WhatsApp das campanhas */
const chaveJornada = (conta: ContaWhats) => (conta === 'campanhas' ? 'jornada_campanhas' : 'jornada');
const lerJornada = async (empresaId: string | number, conta: ContaWhats = 'provedor'): Promise<Jornada | null> =>
  lerConfig(String(empresaId), 'whatsapp', chaveJornada(conta));

export const lerJornadaConfig = lerJornada;

/** Número está na lista de teste da jornada */
function ehNumeroDeTeste(j: Jornada, telefone: string): boolean {
  const chave = chaveTelefone(telefone, true);
  return Boolean(chave) && j.numeros_teste.some((n) => chaveTelefone(n, n.length >= 12) === chave || chaveTelefone(`55${n}`, true) === chave);
}

/** A jornada (já lida) atende este número: ligada, e no modo teste só os números de teste */
export const jornadaAtende = (j: Jornada | null, telefone: string): boolean => Boolean(j?.ativo) && (j!.modo === 'todos' || ehNumeroDeTeste(j!, telefone));

/**
 * Qual Automação atende a conversa. Pelo número padrão, a do atendimento. Pelo número das campanhas, a das campanhas
 * só enquanto a conversa responde a uma campanha: a que já está rodando continua; recomeçando, só se chegou uma
 * campanha depois do último encerramento (atendente ou fim da automação). Exceção: encerrada só por falta de interação
 * e o cliente respondeu atrasado (até 24 h): continua na das campanhas, recomeçando dela. Fora isso, a do atendimento.
 */
export async function contaDaJornada(empresaId: number, telefone: string): Promise<ContaWhats> {
  if ((await contaDaConversa(empresaId, telefone)) !== 'campanhas') return 'provedor';
  const [c] = await pool.query<any[]>('SELECT no_atual, variaveis FROM whatsapp_conversas WHERE empresa_id = ? AND telefone = ?', [empresaId, telefone]);
  if (c[0]?.no_atual && c[0].no_atual !== FIM) {
    let vars: any = {};
    try {
      vars = typeof c[0].variaveis === 'string' ? JSON.parse(c[0].variaveis) : (c[0].variaveis ?? {});
    } catch {
      vars = {};
    }
    return vars?._jornada === 'provedor' ? 'provedor' : 'campanhas';
  }
  const [r] = await pool.query<any[]>(
    `SELECT MAX(IF(disparo_id IS NOT NULL, id, NULL)) AS campanha, MAX(IF(tipo = 'encerramento', id, NULL)) AS encerrou
       FROM whatsapp_mensagens WHERE empresa_id = ? AND telefone = ?`,
    [empresaId, telefone],
  );
  const { campanha, encerrou } = r[0] ?? {};
  if (!campanha) return 'provedor';
  if (!encerrou || Number(campanha) > Number(encerrou)) return 'campanhas';
  // Resposta atrasada: o último encerramento foi por falta de interação, há até 24 h, e a campanha veio depois do anterior
  const [e] = await pool.query<any[]>(
    `SELECT e.texto, e.data_hora > NOW() - INTERVAL 24 HOUR AS recente,
            (SELECT MAX(a.id) FROM whatsapp_mensagens a
              WHERE a.empresa_id = e.empresa_id AND a.telefone = e.telefone AND a.tipo = 'encerramento' AND a.id < e.id) AS anterior
       FROM whatsapp_mensagens e WHERE e.id = ?`,
    [encerrou],
  );
  const atrasada = e[0]?.texto === ENCERRADA_POR_INATIVIDADE && Number(e[0].recente) && Number(campanha) > Number(e[0].anterior ?? 0);
  return atrasada ? 'campanhas' : 'provedor';
}

/** A jornada que atende este número (ligada, e no modo teste só para os números de teste) */
export async function jornadaDoNumero(empresaId: number, telefone: string): Promise<{ jornada: Jornada; numeroDeTeste: boolean; conta: ContaWhats } | null> {
  const conta = await contaDaJornada(empresaId, telefone);
  const j = await lerJornada(empresaId, conta);
  if (!j || !jornadaAtende(j, telefone)) return null;
  return { jornada: j, numeroDeTeste: ehNumeroDeTeste(j, telefone), conta };
}

// ------------------------------------------------------------
// Variáveis, comparações e condições
// ------------------------------------------------------------

/** {{variavel}} → valor; esc trata o valor (JSON no corpo, encodeURIComponent na URL) */
export function preencher(modelo: string, vars: Record<string, unknown>, esc: (v: string) => string = (v) => v): string {
  return String(modelo ?? '').replace(/\{\{\s*([A-Za-z0-9_.]+)\s*\}\}/g, (_, nome) => esc(String(vars[nome] ?? '')));
}
const emJson = (v: string) => JSON.stringify(v).slice(1, -1);

export const OPERADORES = ['igual', 'diferente', 'contem', 'comeca', 'maior', 'menor', 'vazio', 'preenchido', 'regex'];
const normal = (t: unknown) =>
  String(t ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim();
const numero = (t: unknown) => Number(String(t ?? '').replace(/\./g, '').replace(',', '.'));

/** Compara o valor da variável com o do caso (texto sem acento e sem diferença de maiúsculas) */
export function comparar(operador: string, valor: unknown, alvo: string): boolean {
  const a = normal(valor);
  const b = normal(alvo);
  switch (operador) {
    case 'igual':
      return a === b;
    case 'diferente':
      return a !== b;
    case 'contem':
      return a.includes(b);
    case 'comeca':
      return a.startsWith(b);
    case 'maior':
      return numero(valor) > numero(alvo);
    case 'menor':
      return numero(valor) < numero(alvo);
    case 'vazio':
      return !a;
    case 'preenchido':
      return Boolean(a);
    case 'regex':
      // ponytail: regex escrita pelo administrador roda sem limite de tempo; limitar o tamanho se virar problema
      try {
        return new RegExp(alvo, 'i').test(String(valor ?? ''));
      } catch {
        return false;
      }
    default:
      return false;
  }
}

/** Dia da semana (0 = domingo) e hora "HH:MM" em Brasília */
export function agoraBrasilia(d = new Date()): { dia: number; hora: string } {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', { timeZone: 'America/Sao_Paulo', weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
      .formatToParts(d)
      .map((x) => [x.type, x.value]),
  );
  return { dia: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(p.weekday), hora: `${p.hour}:${p.minute}` };
}

const NOMES_DIA = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];

/** "seg a sex, das 08:00 às 18:00" ({{horario}} depois de uma Condição de horário) */
export function descreverHorario(dados: { dias: number[]; das: string; ate: string }): string {
  const dias = [...dados.dias].sort((a, b) => a - b);
  const seguidos = dias.length > 2 && dias.every((x, i) => !i || x === dias[i - 1] + 1);
  const quais = seguidos ? `${NOMES_DIA[dias[0]]} a ${NOMES_DIA[dias.at(-1)!]}` : dias.map((x) => NOMES_DIA[x]).join(', ');
  return `${quais}, das ${dados.das} às ${dados.ate}`;
}

export function dentroDoHorario(dados: { dias: number[]; das: string; ate: string }, agora = agoraBrasilia()): boolean {
  return dados.dias.includes(agora.dia) && agora.hora >= dados.das && agora.hora < dados.ate;
}

/** Caminho "cliente.contatos.0.nome" dentro da resposta JSON */
export function pegar(obj: unknown, caminho: string): unknown {
  return caminho.split('.').reduce<any>((o, k) => (o == null ? undefined : o[k]), obj);
}

// ------------------------------------------------------------
// Chamadas para fora (API, imagem por link): só https e nunca para a rede interna
// ------------------------------------------------------------

export function ipInterno(ip: string): boolean {
  if (ip.startsWith('::ffff:')) return ipInterno(ip.slice(7));
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || a >= 224;
  }
  const v6 = ip.toLowerCase();
  return v6 === '::' || v6 === '::1' || /^f[cd]/.test(v6) || /^fe[89ab]/.test(v6);
}

/** ponytail: confere o DNS antes do fetch; um DNS que muda entre a consulta e a conexão passa (rebinding) */
async function conferirDestino(url: string) {
  const u = new URL(url);
  if (u.protocol !== 'https:') throw new Error('Só endereços https.');
  const host = u.hostname.replace(/^\[|\]$/g, '');
  const ips = net.isIP(host) ? [host] : (await dns.lookup(host, { all: true })).map((r) => r.address);
  if (!ips.length || ips.some(ipInterno)) throw new Error(`Endereço não permitido: ${u.hostname}.`);
}

/** fetch para fora com a trava de rede interna; GET segue até 3 redirecionamentos, conferindo cada destino */
export async function buscarFora(url: string, init: RequestInit = {}): Promise<globalThis.Response> {
  let atual = url;
  for (let salto = 0; ; salto++) {
    await conferirDestino(atual);
    const r = await fetch(atual, { ...init, redirect: 'manual', signal: AbortSignal.timeout(10_000) });
    const destino = r.status >= 300 && r.status < 400 ? r.headers.get('location') : null;
    if (!destino) return r;
    // Só GET segue (POST/PUT redirecionado mudaria de método ou reenviaria o corpo)
    if ((init.method ?? 'GET').toUpperCase() !== 'GET') throw new Error(`o endereço redirecionou (HTTP ${r.status}).`);
    if (salto >= 3) throw new Error('redirecionamentos demais.');
    atual = new URL(destino, atual).toString();
  }
}

// ------------------------------------------------------------
// Execução
// ------------------------------------------------------------

interface Estado {
  conversaId: number;
  no: string | null;
  vars: Record<string, any>;
  /** Nó Esperar: manter a espera gravada, limpar, ou esperar N minutos a partir de agora (relógio do banco) */
  retomar: 'manter' | 'limpar' | number;
  /** A espera gravada já venceu */
  vencido: boolean;
}

async function lerEstado(empresaId: number, telefone: string): Promise<Estado> {
  await pool.query('INSERT IGNORE INTO whatsapp_conversas (empresa_id, telefone) VALUES (?, ?)', [empresaId, telefone]);
  const [r] = await pool.query<any[]>(
    'SELECT id, no_atual, variaveis, retomar_em IS NOT NULL AND retomar_em <= NOW() AS vencido FROM whatsapp_conversas WHERE empresa_id = ? AND telefone = ?',
    [empresaId, telefone],
  );
  let vars: Record<string, any> = {};
  try {
    vars = typeof r[0].variaveis === 'string' ? JSON.parse(r[0].variaveis) : (r[0].variaveis ?? {});
  } catch {
    vars = {};
  }
  return { conversaId: r[0].id, no: r[0].no_atual, vars, retomar: 'manter', vencido: Boolean(Number(r[0].vencido)) };
}

async function gravarEstado(empresaId: number, telefone: string, e: Estado) {
  const retomar = e.retomar === 'manter' ? 'retomar_em' : e.retomar === 'limpar' ? 'NULL' : 'NOW() + INTERVAL ? MINUTE';
  await pool.query(`UPDATE whatsapp_conversas SET no_atual = ?, variaveis = ?, retomar_em = ${retomar} WHERE empresa_id = ? AND telefone = ?`, [
    e.no,
    JSON.stringify(e.vars),
    ...(typeof e.retomar === 'number' ? [e.retomar] : []),
    empresaId,
    telefone,
  ]);
}

async function contextoDaConversa(empresaId: number, telefone: string, conta: ContaWhats): Promise<Contexto> {
  const [d] = await pool.query<any[]>(`SELECT ${PESSOA_RECENTE()} AS pessoa_id, ${CONTATO_RECENTE()} AS contato_id FROM whatsapp_mensagens WHERE empresa_id = ? AND telefone = ?`, [
    empresaId,
    telefone,
  ]);
  const dono = d[0]?.pessoa_id ? { pessoa_id: d[0].pessoa_id, contato_id: d[0].contato_id } : await donoDoTelefone(empresaId, telefone);
  const [dep] = await pool.query<any[]>(
    'SELECT d.id, d.nome FROM whatsapp_conversas c JOIN departamentos d ON d.id = c.departamento_id WHERE c.empresa_id = ? AND c.telefone = ?',
    [empresaId, telefone],
  );
  // Automação das campanhas: a campanha que a pessoa recebeu vira contexto da IA (na do atendimento, não)
  const campanha = conta === 'campanhas' ? await campanhaDaConversa(empresaId, telefone) : null;
  // Pessoa que recebeu a campanha: é ela, mesmo quando o número está em outros cadastros (ex.: o mesmo celular em duas empresas)
  const donoFinal = campanha?.pessoa_id && campanha.pessoa_id !== dono.pessoa_id ? { pessoa_id: campanha.pessoa_id, contato_id: null } : dono;
  return {
    empresaId,
    telefone,
    dono: donoFinal,
    departamento: dep[0] ? { id: dep[0].id, nome: dep[0].nome } : null,
    jornada: { transferencia: null },
    campanha,
    numero: await contaDaConversa(empresaId, telefone),
  };
}

/** Variáveis prontas: as coletadas, mais nome (cadastro ou perfil do WhatsApp) e telefone */
async function variaveisDe(ctx: Contexto, vars: Record<string, any>): Promise<Record<string, unknown>> {
  const [p] = ctx.dono.pessoa_id ? await pool.query<any[]>('SELECT nome FROM pessoas WHERE id = ?', [ctx.dono.pessoa_id]) : [[]];
  const [perfil] = await pool.query<any[]>(
    'SELECT nome_contato FROM whatsapp_mensagens WHERE empresa_id = ? AND telefone = ? AND nome_contato IS NOT NULL ORDER BY id DESC LIMIT 1',
    [ctx.empresaId, ctx.telefone],
  );
  const publicas = Object.fromEntries(Object.entries(vars).filter(([k]) => !k.startsWith('_')));
  return {
    nome: p[0]?.nome ?? perfil[0]?.nome_contato ?? '',
    telefone: telefoneCadastro(ctx.telefone),
    numero: ctx.telefone,
    departamento: ctx.departamento?.nome ?? '',
    campanha: ctx.campanha?.nome ?? '',
    ...publicas,
  };
}

class Execucao {
  /** Mensagens já mandadas nesta execução: entre uma e outra, "digitando..." e uma pausa curta */
  private enviadas = 0;
  /** A jornada passou a conversa para a equipe (Departamento, IA sem ligação em "humano"): não é o fim do atendimento */
  private paraHumano = false;

  constructor(
    private ctx: Contexto,
    private jornada: Jornada,
    private bot: ConfigChatbot | null,
    private estado: Estado,
  ) {}

  no = (id: string | null) => this.jornada.nos.find((n) => n.id === id) ?? null;
  destino = (de: No, saida: string) => this.no(this.jornada.ligacoes.find((l) => l.de === de.id && l.saida === saida)?.para ?? null);

  private async vars() {
    return variaveisDe(this.ctx, this.estado.vars);
  }

  /** Aviso de falha na conversa (só a equipe vê), com o nó em que aconteceu */
  falha(no: No | null, msg: string, depois = '') {
    return avisarFalha(this.ctx.empresaId, this.ctx.telefone, no ? `nó ${rotulo(no)}: ${msg}` : msg, depois);
  }

  /** A IA falhou: o cliente não fica sem retorno; a conversa vai para a equipe (aguardando atendente) */
  private async iaFalhou(no: No, msg: string): Promise<'fim'> {
    delete this.estado.vars._iaex;
    await this.falha(no, msg, ' Conversa passada para um atendente.');
    // Falha no envio do aviso não segura a passagem para a equipe
    await this.enviar(AVISO_IA_FALHOU).catch((e) => this.falha(no, `aviso ao cliente: ${e.message}`));
    await mudarAtendimento(this.ctx.empresaId, this.ctx.telefone, 'humano');
    this.paraHumano = true;
    return 'fim';
  }

  async enviar(textoMsg: string, midia?: ArquivoEnvio) {
    const t = textoMsg.trim();
    if (!t && !midia) return;
    if (this.enviadas) {
      await mostrarDigitando(this.ctx.empresaId, this.ctx.telefone, 1000 + Math.random() * 2000, this.ctx.numero);
    }
    this.enviadas++;
    const seq = (Number(this.estado.vars._seq) || 0) + 1;
    this.estado.vars._seq = seq;
    const origem = `bot:j${this.estado.conversaId}:${seq}`;
    const id = await reservarEnvio(this.ctx.empresaId, origem, this.ctx.dono, this.ctx.telefone, t);
    if (id) await enviarReservada(this.ctx.empresaId, id, origem, this.ctx.telefone, t.slice(0, 4000), midia, this.bot?.nome || 'Assistente', this.ctx.numero);
  }

  private async menu(no: No, prefixo = '') {
    const opcoes = (no.dados.opcoes ?? []).map((o: any, i: number) => `${i + 1} - ${o.rotulo}`).join('\n');
    await this.enviar(`${prefixo}${preencher(no.dados.texto ?? '', await this.vars())}\n${opcoes}`.trim());
  }

  private opcoesMenu(no: No): (OpcaoMenu & { id: string })[] {
    return (no.dados.opcoes ?? []).map((o: any, i: number) => ({ numero: i + 1, departamento_id: i + 1, nome: o.rotulo, bot: false, id: o.id }));
  }

  /** O cliente respondeu no nó em que a conversa parou: devolve o próximo nó (null = continua parada ali) */
  async responder(no: No, entrada: string): Promise<No | null | 'fim'> {
    switch (no.tipo) {
      case 'menu': {
        const opcoes = this.opcoesMenu(no);
        let escolha = entrada ? escolhaDoTexto(entrada, opcoes) : null;
        if (!escolha && entrada && temChave(this.bot)) escolha = await escolhaPelaIa(this.bot, entrada, opcoes).catch(async (e) => (await this.falha(no, e.message), null));
        if (escolha) return this.destino(no, (escolha as any).id) ?? 'fim';
        const invalida = this.destino(no, 'invalida');
        if (invalida) return invalida;
        await this.menu(no, `${no.dados.invalida || 'Desculpe, não entendi. Responda com o número de uma das opções:'}\n`);
        return null;
      }
      case 'pergunta':
        this.estado.vars[no.dados.variavel] = entrada;
        return this.destino(no, 'proximo') ?? 'fim';
      case 'ia':
        return this.ia(no);
      case 'iaex':
        return this.iaex(no, false);
      case 'esperar':
        if (!no.dados.interromper) return null;
        this.estado.retomar = 'limpar';
        return this.destino(no, 'proximo') ?? 'fim';
      default:
        return this.no(this.jornada.nos.find((n) => n.tipo === 'inicio')!.id);
    }
  }

  /** IA responde com o histórico; se ela passar para humano, segue a saída "humano" */
  private async ia(no: No): Promise<No | null | 'fim'> {
    // Texto-base do nó; sem ele, o texto-base antigo do Chatbot (automações feitas antes da mudança)
    const semCampanha = String(no.dados.texto ?? '').trim() || String(this.bot?.texto_base ?? '').trim();
    // Quem responde a uma campanha: a IA conhece a mensagem que a pessoa recebeu e as instruções da campanha
    const textoBase = semCampanha ? semCampanha + contextoDeCampanha(this.ctx.campanha) : '';
    if (!temChave(this.bot) || !textoBase) {
      await this.falha(no, `sem a chave da IA (Configurações › IA) ou sem texto-base (${ONDE}).`);
      return this.destino(no, 'humano') ?? 'fim';
    }
    this.ctx.jornada = { transferencia: null };
    void mostrarDigitando(this.ctx.empresaId, this.ctx.telefone, 3000, this.ctx.numero);
    let resposta: string;
    try {
      resposta = await gerarRespostaIa(this.ctx, this.bot, textoBase);
    } catch (err: any) {
      return this.iaFalhou(no, err.message);
    }
    if (!resposta && this.ctx.jornada.transferencia === null) return this.iaFalhou(no, 'a IA não devolveu resposta.');
    await this.enviar(resposta);
    if (this.ctx.jornada.transferencia === null) return null;
    this.estado.vars.motivo = this.ctx.jornada.transferencia;
    const humano = this.destino(no, 'humano');
    if (humano) return humano;
    await mudarAtendimento(this.ctx.empresaId, this.ctx.telefone, 'humano');
    this.paraHumano = true;
    return 'fim';
  }

  /**
   * IA Ex: a IA conversa pelo texto-base do nó até o cliente indicar uma das saídas (vai para
   * ela, com a escolha em {{ia_opcao}}). Sem entender depois das tentativas, ou sem IA: saída "nenhuma".
   */
  private async iaex(no: No, abertura: boolean): Promise<No | null | 'fim'> {
    const opcoes = (no.dados.opcoes ?? []).map((o: any, i: number) => ({ numero: i + 1, rotulo: String(o.rotulo), id: String(o.id) }));
    const nenhuma = () => {
      this.estado.vars.ia_opcao = '';
      delete this.estado.vars._iaex;
      return this.destino(no, 'nenhuma') ?? 'fim';
    };
    if (!temChave(this.bot)) {
      await this.falha(no, 'sem a chave da IA (Configurações › IA).');
      return nenhuma();
    }
    if (!abertura) this.estado.vars._iaex = (Number(this.estado.vars._iaex) || 0) + 1;
    let r: { opcao: number; mensagem: string };
    try {
      void mostrarDigitando(this.ctx.empresaId, this.ctx.telefone, 3000, this.ctx.numero);
      r = await iaComOpcoes(this.ctx, this.bot, preencher(no.dados.texto ?? '', await this.vars()) + contextoDeCampanha(this.ctx.campanha), opcoes, abertura);
    } catch (err: any) {
      return this.iaFalhou(no, err.message);
    }
    const escolha = opcoes.find((o: any) => o.numero === r.opcao);
    if (escolha) {
      this.estado.vars.ia_opcao = escolha.rotulo;
      delete this.estado.vars._iaex;
      return this.destino(no, escolha.id) ?? 'fim';
    }
    if (Number(this.estado.vars._iaex) >= (Number(no.dados.tentativas) || 3)) return nenhuma();
    await this.enviar(r.mensagem || 'Desculpe, não entendi. Pode me dizer com outras palavras o que você precisa?');
    return null;
  }

  /** Executa a partir do nó até um que espere o cliente, uma pausa ou o fim */
  async percorrer(inicio: No | null | 'fim') {
    let no: No | null | 'fim' = inicio;
    for (let passo = 0; passo < MAX_PASSOS; passo++) {
      if (no === null) return; // continua parado onde está
      if (no === 'fim') {
        this.estado.no = FIM;
        // Fim da jornada (nó Fim ou saída sem ligação): o app não encerra sozinho; a conversa fica aguardando alguém da equipe encerrar
        if (!this.paraHumano) {
          await mudarAtendimento(this.ctx.empresaId, this.ctx.telefone, 'humano');
          await marcarEvento(this.ctx.empresaId, this.ctx.telefone, 'Fim da automação: aguardando alguém da equipe encerrar', null);
        }
        return;
      }
      this.estado.no = no.id;
      const d = no.dados;
      const seguir = (saida = 'proximo') => this.destino(no as No, saida) ?? 'fim';
      switch (no.tipo) {
        case 'inicio':
          no = seguir();
          break;
        case 'mensagem':
          await this.enviar(preencher(d.texto, await this.vars()));
          no = seguir();
          break;
        case 'imagem':
          await this.enviarImagem(no);
          no = seguir();
          break;
        case 'menu':
          await this.menu(no);
          return;
        case 'pergunta':
          await this.enviar(preencher(d.texto, await this.vars()));
          return;
        case 'condicao':
          no = seguir((await this.condicao(no)) ? 'sim' : 'nao');
          break;
        case 'case': {
          const v = await this.vars();
          const caso = (d.casos ?? []).find((c: any) => comparar(c.operador, v[d.variavel], preencher(c.valor, v)));
          no = seguir(caso ? caso.id : 'nenhum');
          break;
        }
        case 'esperar':
          this.estado.retomar = d.minutos;
          return;
        case 'api':
          no = seguir((await this.api(no)) ? 'sucesso' : 'erro');
          break;
        case 'ia':
          no = await this.ia(no);
          break;
        case 'iaex':
          this.estado.vars._iaex = 0;
          no = await this.iaex(no, true);
          break;
        case 'lead': {
          const v = await this.vars();
          const campo = (modelo: string, padrao: string) => preencher(modelo || padrao, v).trim();
          const r: any = await registrarLead(this.ctx, {
            nome: campo(d.nome, '{{nome}}') || 'Cliente do WhatsApp',
            empresa: campo(d.empresa, '{{empresa}}'),
            email: campo(d.email, '{{email}}'),
            interesse: campo(d.interesse, '{{interesse}}') || 'Contato pelo WhatsApp',
          });
          if (!r?.ok) await this.falha(no, `registrar lead: ${r?.erro}`);
          no = seguir();
          break;
        }
        case 'prospeccao': {
          const v = await this.vars();
          const campo = (modelo: string, padrao: string) => preencher(modelo ?? padrao, v).trim();
          const r: any = await registrarLead(
            this.ctx,
            {
              nome: campo(d.nome, '{{nome}}') || 'Cliente do WhatsApp',
              empresa: campo(d.empresa, '{{empresa}}'),
              email: campo(d.email, '{{email}}'),
              interesse: campo(d.negocio, 'Prospecção') || 'Prospecção',
            },
            { funil_id: d.funil_id, etapa_id: d.etapa_id, assunto: 'Prospecção pelo WhatsApp', observacao: campo(d.observacao, '') },
          );
          if (!r?.ok) await this.falha(no, `registrar prospecção: ${r?.erro}`);
          no = seguir();
          break;
        }
        case 'tarefa': {
          const v = await this.vars();
          // Sem executor: fica para o departamento (ou para a equipe); vence agora, aparece como pendente para quem abrir as atividades
          const [tarefa] = await pool.query<any>(
            `INSERT INTO atividades (empresa_id, pessoa_id, departamento_id, assunto, tipo, data_vencimento, hora_vencimento, observacao, lembrete_para, criada_por_bot)
             VALUES (?, ?, ?, ?, 'tarefa', CURDATE(), TIME_FORMAT(CURTIME(), '%H:%i:00'), ?, 'nenhum', 1)`,
            [
              this.ctx.empresaId,
              this.ctx.dono.pessoa_id,
              d.departamento_id,
              preencher(d.assunto, v).trim().slice(0, 255) || 'Retornar contato do WhatsApp',
              `${preencher(d.observacao ?? '', v).trim()}
WhatsApp: ${v.telefone}`.trim(),
            ],
          );
          // Avisa o departamento; sem departamento, quem acessa as Atividades
          await notificar(this.ctx.empresaId, d.departamento_id ? { departamentoId: d.departamento_id } : { tela: 'atividades' }, {
            tipo: 'tarefa',
            titulo: 'Tarefa nova da Automação do WhatsApp',
            texto: preencher(d.assunto, v).trim().slice(0, 255) || 'Retornar contato do WhatsApp',
            link: 'atividades',
            registroId: Number(tarefa.insertId),
          });
          no = seguir();
          break;
        }
        case 'departamento': {
          const [dep] = await pool.query<any[]>('SELECT id, nome FROM departamentos WHERE id = ? AND empresa_id = ?', [d.departamento_id, this.ctx.empresaId]);
          await this.enviar(preencher(d.texto ?? '', await this.vars()));
          await mudarAtendimento(this.ctx.empresaId, this.ctx.telefone, 'humano');
          if (dep[0]) {
            this.ctx.departamento = { id: dep[0].id, nome: dep[0].nome };
            await pool.query('UPDATE whatsapp_conversas SET departamento_id = ? WHERE empresa_id = ? AND telefone = ?', [dep[0].id, this.ctx.empresaId, this.ctx.telefone]);
            await avisarDepartamento(this.ctx, this.ctx.departamento, String(this.estado.vars.motivo || 'Jornada de atendimento.'));
          }
          this.paraHumano = true;
          no = 'fim';
          break;
        }
        case 'fim':
          await this.enviar(preencher(d.texto ?? '', await this.vars()));
          no = 'fim';
          break;
      }
    }
    await this.falha(null, `${MAX_PASSOS} passos sem parar: a automação tem um laço sem nó de espera.`);
    this.estado.no = FIM;
  }

  private async condicao(no: No): Promise<boolean> {
    const d = no.dados;
    if (d.tipo === 'horario') {
      this.estado.vars.horario = descreverHorario(d as any);
      return dentroDoHorario(d as any);
    }
    if (d.tipo === 'cadastrado') return Boolean(this.ctx.dono.pessoa_id);
    if (d.tipo === 'negocio') {
      if (!this.ctx.dono.pessoa_id) return false;
      const [r] = await pool.query<any[]>("SELECT 1 FROM negocios WHERE empresa_id = ? AND pessoa_id = ? AND status = 'aberto' LIMIT 1", [this.ctx.empresaId, this.ctx.dono.pessoa_id]);
      return r.length > 0;
    }
    const v = await this.vars();
    return comparar(d.operador, v[d.variavel], preencher(d.valor, v));
  }

  private async enviarImagem(no: No) {
    const d = no.dados;
    const legenda = preencher(d.legenda ?? '', await this.vars()) || null;
    try {
      let arquivo: ArquivoEnvio;
      if (d.arquivo_id) {
        const [a] = await pool.query<any[]>('SELECT nome, mimetype, dados FROM jornada_arquivos WHERE id = ? AND empresa_id = ?', [d.arquivo_id, this.ctx.empresaId]);
        if (!a[0]) throw new Error('imagem não encontrada.');
        arquivo = { tipo: 'imagem', base64: Buffer.from(a[0].dados).toString('base64'), mimetype: a[0].mimetype, nome: a[0].nome, legenda };
      } else {
        const r = await buscarFora(d.url);
        const mimetype = (r.headers.get('content-type') || '').split(';')[0];
        if (!r.ok || !mimetype.startsWith('image/')) throw new Error(`o link não devolveu uma imagem (HTTP ${r.status}).`);
        const dados = Buffer.from(await r.arrayBuffer());
        if (dados.length > MAX_ARQUIVO) throw new Error('imagem do link maior que 3 MB.');
        arquivo = { tipo: 'imagem', base64: dados.toString('base64'), mimetype, nome: d.url.split('/').pop() || 'imagem', legenda };
      }
      await this.enviar(legenda ?? '', arquivo);
    } catch (err: any) {
      await this.falha(no, err.message);
    }
  }

  /** Chamada de API: sucesso = HTTP 2xx; os campos pedidos da resposta viram variáveis */
  private async api(no: No): Promise<boolean> {
    const d = no.dados;
    const v = await this.vars();
    try {
      const headers: Record<string, string> = {};
      for (const h of d.cabecalhos ?? []) headers[h.nome] = h.secreto ? decifrar(h.valor_cifrado, ONDE) : preencher(h.valor, v);
      const corpo = d.metodo !== 'GET' && d.corpo?.trim() ? preencher(d.corpo, v, emJson) : undefined;
      if (corpo && !Object.keys(headers).some((k) => k.toLowerCase() === 'content-type')) headers['Content-Type'] = 'application/json';
      const r = await buscarFora(preencher(d.url, v, encodeURIComponent), { method: d.metodo, headers, body: corpo });
      const bruto = (await r.text()).slice(0, 200_000);
      let json: unknown = null;
      try {
        json = JSON.parse(bruto);
      } catch {
        json = null;
      }
      this.estado.vars.api_status = String(r.status);
      for (const e of d.extrair ?? []) {
        const valor = pegar(json, e.caminho);
        this.estado.vars[e.variavel] = valor == null ? '' : typeof valor === 'object' ? JSON.stringify(valor) : String(valor);
      }
      return r.ok;
    } catch (err: any) {
      this.estado.vars.api_status = '0';
      await this.falha(no, err.message);
      return false;
    }
  }
}

/** Trava por conversa (duas mensagens seguidas, ou cron e mensagem ao mesmo tempo) */
async function comTrava(empresaId: number, telefone: string, fn: () => Promise<void>) {
  const conn = await pool.getConnection();
  const nome = `crmweb_jornada:${empresaId}:${telefone}`;
  try {
    const [t] = await conn.query<any[]>('SELECT GET_LOCK(?, 15) AS ok', [nome]);
    if (!t[0]?.ok) return;
    try {
      await fn();
    } finally {
      await conn.query('SELECT RELEASE_LOCK(?)', [nome]);
    }
  } finally {
    conn.release();
  }
}

/** Mensagem recebida numa conversa atendida pela jornada (chamada pelo responderComBot) */
export async function executarJornada(nova: MensagemNova, jornada: Jornada, bot: ConfigChatbot | null, conta: ContaWhats = 'provedor'): Promise<void> {
  await comTrava(nova.empresaId, nova.telefone, async () => {
    const estado = await lerEstado(nova.empresaId, nova.telefone);
    // Aviso repetido da Evolution, ou mensagem mais antiga que a última tratada
    if (Number(estado.vars._msg) >= nova.id) return;
    estado.vars._msg = nova.id;
    const [m] = await pool.query<any[]>('SELECT tipo, texto FROM whatsapp_mensagens WHERE id = ?', [nova.id]);
    const entrada = m[0]?.tipo === 'texto' ? String(m[0].texto ?? '').trim() : '';
    estado.vars.mensagem = entrada;

    const inicio = jornada.nos.find((n) => n.tipo === 'inicio')!;
    const recomeca = !estado.no || estado.no === FIM || !jornada.nos.some((n) => n.id === estado.no);
    if (recomeca) {
      // Nova rodada: as respostas da anterior (nome, e-mail...) não valem mais; _seq continua (origem única das mensagens)
      estado.vars = { _msg: estado.vars._msg, _seq: estado.vars._seq, mensagem: entrada, _jornada: conta };
    }
    const ctx = await contextoDaConversa(nova.empresaId, nova.telefone, conta);
    const exec = new Execucao(ctx, jornada, bot, estado);
    const atual = exec.no(estado.no);
    try {
      if (recomeca || !atual) {
        // Sem ponto na jornada, ou depois do Fim (ou de uma saída sem ligação): recomeça do Início
        estado.retomar = 'limpar';
        await exec.percorrer(inicio);
      } else {
        await exec.percorrer(await exec.responder(atual, entrada));
      }
    } catch (err: any) {
      await avisarFalha(nova.empresaId, nova.telefone, err.message);
    } finally {
      await gravarEstado(nova.empresaId, nova.telefone, estado);
    }
  });
}

/**
 * Um ciclo do cron: conversas paradas num nó Esperar cujo tempo acabou continuam a jornada.
 * Devolve quantas continuaram.
 */
export async function retomarJornadas(prazoMs = Infinity): Promise<number> {
  const fim = Date.now() + prazoMs;
  const [rows] = await pool.query<any[]>(
    "SELECT empresa_id, telefone FROM whatsapp_conversas WHERE retomar_em IS NOT NULL AND retomar_em <= NOW() AND atendimento = 'bot' ORDER BY retomar_em LIMIT 50",
  );
  let n = 0;
  for (const r of rows) {
    if (Date.now() > fim) break;
    await comTrava(r.empresa_id, r.telefone, async () => {
      const estado = await lerEstado(r.empresa_id, r.telefone);
      if (!estado.vencido) return;
      estado.retomar = 'limpar';
      try {
        const j = await jornadaDoNumero(r.empresa_id, r.telefone);
        if (!j) return; // jornada desligada (ou número saiu do teste): só limpa a espera
        const ctx = await contextoDaConversa(r.empresa_id, r.telefone, j.conta);
        const exec = new Execucao(ctx, j.jornada, await lerChatbot(r.empresa_id), estado);
        const esperando = exec.no(estado.no);
        await exec.percorrer(esperando?.tipo === 'esperar' ? (exec.destino(esperando, 'proximo') ?? 'fim') : null);
        n++;
      } catch (err: any) {
        await avisarFalha(r.empresa_id, r.telefone, `retomar depois do Esperar: ${err.message}`);
      } finally {
        await gravarEstado(r.empresa_id, r.telefone, estado);
      }
    });
  }
  return n;
}

/** Fora da Vercel: um ciclo a cada minuto (na Vercel é o cron de /api/cron/whatsapp) */
export function iniciarJornadas() {
  let rodando = false;
  setInterval(async () => {
    if (rodando) return;
    rodando = true;
    try {
      const n = await retomarJornadas();
      if (n) console.log(`Jornada: ${n} conversa(s) retomada(s) depois do Esperar.`);
    } catch (err: any) {
      console.error('Jornada: falha no ciclo:', err.message);
    } finally {
      rodando = false;
    }
  }, 60_000);
}

// ------------------------------------------------------------
// Imagens dos nós "Enviar imagem"
// ------------------------------------------------------------

export function createJornadaRouter(): Router {
  const router = Router();

  router.post('/jornada/arquivos', async (req: Request, res: Response) => {
    try {
      somenteAdmin(res);
      const mimetype = String(req.body?.mimetype ?? '');
      if (!/^image\/(png|jpe?g|gif|webp)$/.test(mimetype)) return res.status(400).json({ error: 'Envie uma imagem PNG, JPG, GIF ou WEBP.' });
      const dados = Buffer.from(String(req.body?.base64 ?? ''), 'base64');
      if (!dados.length) return res.status(400).json({ error: 'Imagem vazia.' });
      if (dados.length > MAX_ARQUIVO) return res.status(400).json({ error: 'Imagem maior que 3 MB.' });
      const nome = String(req.body?.nome || 'imagem').replace(/[\\/]/g, '_').slice(0, 150);
      const [r] = await pool.query<any>('INSERT INTO jornada_arquivos (empresa_id, nome, mimetype, dados) VALUES (?, ?, ?, ?)', [res.locals.empresaId, nome, mimetype, dados]);
      res.json({ id: r.insertId, nome });
    } catch (err: any) {
      res.status(err.status || 400).json({ error: err.message });
    }
  });

  router.get('/jornada/arquivos/:id', async (req: Request, res: Response) => {
    try {
      const [r] = await pool.query<any[]>('SELECT mimetype, dados FROM jornada_arquivos WHERE id = ? AND empresa_id = ?', [Number(req.params.id) || 0, res.locals.empresaId]);
      if (!r[0]) return res.status(404).json({ error: 'Imagem não encontrada.' });
      res.set('Cache-Control', 'private, max-age=86400').type(r[0].mimetype).send(Buffer.from(r[0].dados));
    } catch (err: any) {
      res.status(err.status || 400).json({ error: err.message });
    }
  });

  return router;
}
