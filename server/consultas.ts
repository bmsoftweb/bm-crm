import { Router, Request, Response } from 'express';
import { pool } from './db.js';
import { exigirAcesso } from './permissoes.js';
import { COLUNAS_FORA, conferirSqlIa, estrutura, TEMPO_MS } from './selecaoIa.js';

/**
 * Marketing › Consultas: um chat em que o usuário pergunta em português ("quantos clientes eu tenho em Rio do Sul?") e
 * a IA (Configurações › IA) responde com um SELECT e uma frase; o SELECT roda no banco e o resultado volta em grade.
 *
 * O SQL vem da IA, então além das travas da seleção com IA (só SELECT, sem comentários nem palavras perigosas,
 * transação SOMENTE LEITURA com limite de tempo), cada tabela citada no FROM/JOIN é trocada pelas linhas da empresa
 * logada e só com as colunas liberadas (isolarEmpresa): mesmo que a IA esqueça o filtro, não vê outra empresa nem
 * senhas/tokens.
 */

/** Tabelas que a IA conhece */
export const TABELAS_CONSULTA = [
  'pessoas', 'pessoas_contatos', 'pessoas_enderecos', 'segmentos', 'negocios', 'funis', 'etapas', 'atividades', 'historico_interacoes',
  'propostas', 'proposta_itens', 'pedidos', 'pedido_itens', 'contratos', 'chamados', 'chamado_categorias', 'whatsapp_atendimentos',
  'whatsapp_conversas', 'whatsapp_mensagens', 'vendas_produtos', 'produtos', 'avaliacoes', 'campanhas', 'campanha_disparos',
  'ordens_servico', 'usuarios', 'departamentos',
];

/** Tabelas sem empresa_id: valem as linhas cujo "pai" é da empresa */
const PAIS: Record<string, { fk: string; pai: string }> = {
  etapas: { fk: 'funil_id', pai: 'funis' },
  proposta_itens: { fk: 'proposta_id', pai: 'propostas' },
  pedido_itens: { fk: 'pedido_id', pai: 'pedidos' },
  campanha_disparos: { fk: 'campanha_id', pai: 'campanhas' },
};

export const MAX_LINHAS = 500;

/** Palavras que não podem ser apelido de tabela (vêm logo depois do nome dela) */
const NAO_APELIDO = new Set([
  'where', 'join', 'left', 'right', 'inner', 'outer', 'cross', 'natural', 'straight_join', 'on', 'using', 'group', 'order',
  'limit', 'having', 'union', 'window', 'for', 'lock', 'into', 'as',
]);

/** Colunas liberadas de cada tabela (as de senha/token/arquivos ficam de fora) */
export type ColunasPorTabela = Record<string, string[]>;
let cacheColunas: { quando: number; colunas: ColunasPorTabela } | null = null;
async function colunasLiberadas(): Promise<ColunasPorTabela> {
  if (cacheColunas && Date.now() - cacheColunas.quando < 10 * 60_000) return cacheColunas.colunas;
  const [r] = await pool.query<any[]>(
    `SELECT TABLE_NAME t, COLUMN_NAME c FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN (?) ORDER BY TABLE_NAME, ORDINAL_POSITION`,
    [TABELAS_CONSULTA],
  );
  const colunas: ColunasPorTabela = {};
  for (const l of r) if (!COLUNAS_FORA.test(l.c)) (colunas[l.t] ??= []).push(l.c);
  cacheColunas = { quando: Date.now(), colunas };
  return colunas;
}

/**
 * Troca cada tabela do FROM/JOIN por uma subconsulta com as linhas da empresa e as colunas liberadas, mantendo o
 * apelido. Recusa o que escaparia disso: tabela fora da lista, outro banco, tabelas separadas por vírgula.
 */
export function isolarEmpresa(sql: string, empresaId: string | number, colunas: ColunasPorTabela): string {
  const emp = Number(empresaId);
  if (!Number.isInteger(emp) || emp < 0) throw new Error('Empresa inválida.');
  // Textos entre aspas saem do caminho (um nome de tabela dentro de um texto não é tabela)
  const textos: string[] = [];
  let s = sql.replace(/'(?:[^'\\]|\\.|'')*'/g, (t) => `\u0001${textos.push(t) - 1}\u0001`);
  const subconsultas: string[] = [];
  const nomes = Object.keys(colunas).sort((a, b) => b.length - a.length);
  const re = new RegExp(`\\b(from|join)\\s+\`?(${nomes.join('|')})\`?(?![\\w.\`])(\\s+(?:as\\s+)?\`?([a-z_][a-z0-9_]*)\`?)?`, 'gi');
  s = s.replace(re, (_m, palavra: string, tabelaBruta: string, resto: string | undefined, apelidoBruto: string | undefined) => {
    const tabela = tabelaBruta.toLowerCase();
    let apelido = apelidoBruto;
    let sobra = '';
    if (apelido && NAO_APELIDO.has(apelido.toLowerCase())) {
      sobra = resto ?? '';
      apelido = undefined;
    }
    const cols = colunas[tabela].map((c) => `\`${c}\``).join(', ');
    const pai = PAIS[tabela];
    const filtro = pai ? `\`${pai.fk}\` IN (SELECT id FROM ${pai.pai} WHERE empresa_id = ${emp})` : `empresa_id = ${emp}`;
    subconsultas.push(`(SELECT ${cols} FROM ${tabela} WHERE ${filtro})`);
    return `${palavra} \u0002${subconsultas.length - 1}\u0002 AS ${apelido ?? tabela}${sobra}`;
  });
  if (/\b(from|join)\s+(?![\s(\u0002])/i.test(s)) {
    throw new Error(`Use só as tabelas do CRM (${TABELAS_CONSULTA.join(', ')}), sem nome de banco na frente.`);
  }
  if (new RegExp(`,\\s*\`?(${nomes.join('|')})\`?(?![\\w.\`(])`, 'i').test(s)) {
    throw new Error('Ligue as tabelas com JOIN, não com vírgula.');
  }
  return s.replace(/\u0002(\d+)\u0002/g, (_m, i) => subconsultas[Number(i)]).replace(/\u0001(\d+)\u0001/g, (_m, i) => textos[Number(i)]);
}

/** Tipo de cada coluna do resultado (para alinhar e formatar na grade) */
function tipoDaColuna(columnType: number): 'numero' | 'data' | 'datahora' | 'texto' {
  if ([0, 1, 2, 3, 4, 5, 8, 9, 246].includes(columnType)) return 'numero';
  if (columnType === 10) return 'data';
  if (columnType === 7 || columnType === 12) return 'datahora';
  return 'texto';
}

export interface ResultadoConsulta {
  colunas: { nome: string; tipo: 'numero' | 'data' | 'datahora' | 'texto' }[];
  linhas: unknown[][];
  /** Passou de MAX_LINHAS: só as primeiras vieram */
  truncado: boolean;
}

/** Roda o SELECT da IA isolado na empresa: transação somente leitura, limite de tempo e de linhas */
export async function executarConsulta(sqlIa: string, empresaId: string | number): Promise<ResultadoConsulta & { sqlExecutado: string }> {
  const sql = isolarEmpresa(conferirSqlIa(sqlIa, false), empresaId, await colunasLiberadas());
  const sqlExecutado = `SELECT /*+ MAX_EXECUTION_TIME(${TEMPO_MS}) */ * FROM (${sql}) resultado LIMIT ${MAX_LINHAS + 1}`;
  const conn = await pool.getConnection();
  try {
    await conn.query('START TRANSACTION READ ONLY');
    const [linhas, campos] = await conn.query<any[]>({ sql: sqlExecutado, rowsAsArray: true });
    return {
      colunas: (campos as any[]).map((f) => ({ nome: String(f.name), tipo: tipoDaColuna(f.columnType) })),
      linhas: (linhas as unknown[][]).slice(0, MAX_LINHAS),
      truncado: linhas.length > MAX_LINHAS,
      sqlExecutado,
    };
  } catch (err: any) {
    if (/max_execution_time|maximum statement execution time/i.test(err?.message ?? '')) throw new Error('A consulta demorou demais (mais de 15 s).');
    throw new Error(err?.sqlMessage || err?.message);
  } finally {
    await conn.query('ROLLBACK').catch(() => {});
    conn.release();
  }
}

/** Troca {{linhas}} pelo número de linhas e {{coluna}} pelo valor da 1ª linha (assim o número da frase é o do banco) */
export function preencherResposta(texto: string, r: ResultadoConsulta): string {
  return texto.replace(/\{\{\s*([^}]+?)\s*\}\}/g, (m, nome: string) => {
    if (nome.toLowerCase() === 'linhas') return r.truncado ? `mais de ${MAX_LINHAS}` : r.linhas.length.toLocaleString('pt-BR');
    const i = r.colunas.findIndex((c) => c.nome.toLowerCase() === nome.toLowerCase());
    if (i < 0 || !r.linhas.length) return m;
    const v = r.linhas[0][i];
    if (v === null || v === undefined) return '—';
    if (r.colunas[i].tipo === 'numero' && Number.isFinite(Number(v))) return Number(v).toLocaleString('pt-BR');
    if (r.colunas[i].tipo !== 'texto') return String(v).slice(0, 10).split('-').reverse().join('/');
    return String(v);
  });
}

/** Opções da pergunta de volta da IA (dúvida ou informação que falta): 2 a 6 textos curtos; inválido = sem opções */
export function conferirOpcoes(o: any): { lista: string[]; multipla: boolean } | null {
  const lista = [...new Set((Array.isArray(o?.lista) ? o.lista : []).map((t: unknown) => String(t ?? '').trim().slice(0, 100)).filter(Boolean))] as string[];
  return lista.length >= 2 ? { lista: lista.slice(0, 6), multipla: o?.multipla === true } : null;
}

/** A pergunta pede gráfico explicitamente */
export const PEDE_GRAFICO = /gr[aá]fico|pizza|chart/i;

export interface Grafico {
  tipo: 'barras' | 'linha' | 'pizza';
  x: string;
  y: string[];
}

/** Gráfico pedido pela IA, só com colunas que existem no resultado (as de y numéricas); inválido = sem gráfico */
export function conferirGrafico(g: any, r: ResultadoConsulta): Grafico | null {
  if (!g || !['barras', 'linha', 'pizza'].includes(g.tipo) || !r.linhas.length) return null;
  const coluna = (nome: unknown) => r.colunas.find((c) => c.nome.toLowerCase() === String(nome ?? '').toLowerCase());
  const x = coluna(g.x);
  const y = (Array.isArray(g.y) ? g.y : [g.y]).map(coluna).filter((c: any) => c && c.tipo === 'numero' && c !== x);
  if (!x || !y.length) return null;
  return { tipo: g.tipo, x: x.nome, y: (g.tipo === 'pizza' ? y.slice(0, 1) : y.slice(0, 6)).map((c: any) => c.nome) };
}

interface Fala {
  de: 'pessoa' | 'ia';
  texto: string;
}

/** Pergunta → SQL da IA → resultado. Com SQL recusado ou com erro, pede de novo uma vez, dizendo o motivo */
async function perguntar(pergunta: string, historico: Fala[], empresaId: string | number) {
  const { conversarIa, lerChatbot, temChave } = await import('./chatbot.js');
  const cfg = await lerChatbot(empresaId);
  if (!temChave(cfg)) throw Object.assign(new Error('Configure a IA em Configurações › IA antes de usar as Consultas.'), { status: 400 });
  const [[{ hoje }]] = await pool.query<any>("SELECT DATE_FORMAT(CURDATE(), '%Y-%m-%d') AS hoje");
  const system = `Você é o assistente de consultas de um CRM. O usuário pergunta em português sobre os dados da empresa dele e
você responde com uma consulta MySQL 8 e uma frase curta. Hoje é ${hoje}.

Responda só com JSON, sem texto em volta: {"sql":"...","resposta":"...","grafico":null,"opcoes":null}
- sql: UM comando SELECT. Não precisa filtrar a empresa (o sistema já filtra). Use só as tabelas e colunas abaixo, ligadas
  com JOIN (nunca vírgula). Nada de ponto e vírgula, comentários, variáveis (@) ou outro comando além de SELECT.
  Dê nomes legíveis em português às colunas, entre crases (ex.: p.nome AS \`Nome\`, COUNT(*) AS \`Total\`), sem repetir nomes.
  Em listas, traga as colunas úteis para o usuário (nome, cidade, telefone, e-mail...), não os ids, e ordene de forma natural.
  Textos (nomes, cidades) com LIKE ou =; a comparação já ignora maiúsculas e acentos.
  Datas com YEAR(), MONTH(), DATE_FORMAT(), DATEDIFF() (nunca EXTRACT(... FROM ...) nem TRIM(... FROM ...)).
- resposta: a frase para o usuário. NUNCA escreva números do resultado: use {{linhas}} (quantidade de linhas do resultado)
  ou {{Nome da coluna}} (valor da 1ª linha daquela coluna). Ex.: "Você tem {{Total}} clientes em Rio do Sul."
  ou "Estes são os {{linhas}} clientes de Ituporanga:".
- grafico: SÓ quando o usuário pedir explicitamente um gráfico (escrever "gráfico" ou "pizza"); senão null (o padrão é tabela). Pedido, um objeto
  {"tipo":"barras"|"linha"|"pizza","x":"<coluna dos rótulos>","y":["<coluna numérica>", ...]}; senão null.
  Use o tipo que o usuário pedir. Se ele não disser: dados por período (dia, mês, ano) = "linha" (rótulo como texto,
  ex.: DATE_FORMAT(data, '%m/%Y'), em ordem cronológica); partes de um todo (uma coluna em y, até uns 10 itens) = "pizza";
  comparar categorias = "barras". Nunca pizza para período.
  O SQL do gráfico agrupa os dados: uma linha por rótulo, com as colunas numéricas já somadas/contadas.
- opcoes: quando faltar uma informação ou decisão que muda o resultado e não houver um padrão óbvio (ex.: "melhores
  clientes" = por valor comprado ou por quantidade de pedidos? de qual período?), NÃO monte o SQL: deixe sql vazio, faça a
  pergunta em "resposta" e mande {"lista":["opção 1","opção 2",...],"multipla":false} com 2 a 6 opções curtas
  (multipla: true quando der para escolher mais de uma, ex.: quais cidades/colunas incluir). Pergunte uma coisa por vez
  e só quando precisar; com um padrão razoável (ex.: período não citado em "quantos clientes tenho"), responda direto.
  Quando o usuário responder, use a resposta junto com a pergunta original da conversa.
- Se a pergunta não pedir dados (ex.: cumprimento) ou não der para responder com as tabelas, deixe sql vazio e explique na resposta.

Ligações entre as tabelas:
- pessoas é o cliente/lead (tipo 'cliente' ou 'lead'; ativo = 1). p.cpf guarda o CPF/CNPJ só com dígitos.
- Cidade/UF ficam em pessoas_enderecos (pessoa_id → pessoas.id; o principal tem principal = 1).
- pessoas_contatos.pessoa_id → pessoas.id. pessoas.segmento_id → segmentos.id. Campos personalizados em pessoas.personalizados (JSON).
- negocios.pessoa_id → pessoas.id (status 'aberto', 'ganho', 'perdido'); negocios.etapa_id → etapas.id; etapas.funil_id → funis.id.
- atividades, historico_interacoes, propostas, pedidos, contratos, chamados, ordens_servico, avaliacoes: pessoa_id → pessoas.id.
- proposta_itens.proposta_id → propostas.id; pedido_itens.pedido_id → pedidos.id; *_itens.produto_id → produtos.id.
- chamados: status ('aguardando','em_andamento','pendente_cliente','pausado','encerrado','cancelado'), categoria_id → chamado_categorias.id.
- vendas_produtos: produtos vendidos (do ERP), uma linha por produto de cada nota; liga com pessoas por
  vendas_produtos.cli_cnpj = pessoas.cpf (escreva v.cli_cnpj COLLATE utf8mb4_unicode_ci = p.cpf). cancelado = 'S' é nota cancelada.
- whatsapp_atendimentos / whatsapp_mensagens: pessoa_id → pessoas.id. campanha_disparos: campanha_id → campanhas.id, pessoa_id → pessoas.id.
- Usuários (vendedores, técnicos): usuarios.id; departamentos.id ← usuarios.departamento_id.

Tabelas:
${await estrutura(TABELAS_CONSULTA)}`;

  let falas: Fala[] = [...historico, { de: 'pessoa', texto: pergunta }];
  for (let tentativa = 0; ; tentativa++) {
    const r = await conversarIa(cfg, system, falas, []);
    let sql = '';
    let resposta = '';
    try {
      const j = JSON.parse(/\{[\s\S]*\}/.exec(r.texto)?.[0] ?? '{}');
      sql = String(j.sql ?? '').trim();
      resposta = String(j.resposta ?? '').trim();
      if (!sql) return { resposta: resposta || 'Não entendi. Pode perguntar de outro jeito?', sql: '', resultado: null, grafico: null, opcoes: conferirOpcoes(j.opcoes) };
      const resultado = await executarConsulta(sql, empresaId);
      // Gráfico só quando a pergunta pede (o padrão é a tabela), mesmo que a IA mande um
      const grafico = PEDE_GRAFICO.test(pergunta) ? conferirGrafico(j.grafico, resultado) : null;
      return { resposta: preencherResposta(resposta, resultado), sql, resultado, grafico, opcoes: null };
    } catch (err: any) {
      if (tentativa >= 1) throw Object.assign(new Error(`Não consegui montar a consulta: ${err.message}`), { status: 400 });
      falas = [...falas, { de: 'ia', texto: r.texto }, { de: 'pessoa', texto: `Esse SQL deu erro: ${err.message} Corrija e responda de novo só com o JSON.` }];
    }
  }
}

export function createConsultasRouter(): Router {
  const router = Router();

  /** { pergunta, historico: [{ de, texto }] } → { resposta, sql, resultado } */
  router.post('/consultas/perguntar', async (req: Request, res: Response) => {
    try {
      exigirAcesso(res, 'consultas', 'as Consultas');
      const pergunta = String(req.body?.pergunta ?? '').trim().slice(0, 2000);
      if (!pergunta) return res.status(400).json({ error: 'Escreva a pergunta.' });
      // As últimas falas, para a IA entender "e em Ituporanga?" depois de "quantos clientes em Rio do Sul?"
      const historico: Fala[] = (Array.isArray(req.body?.historico) ? req.body.historico : [])
        .slice(-10)
        .map((f: any) => ({ de: f?.de === 'ia' ? 'ia' : 'pessoa', texto: String(f?.texto ?? '').slice(0, 4000) }))
        .filter((f: Fala) => f.texto);
      res.json(await perguntar(pergunta, historico, res.locals.empresaId));
    } catch (err: any) {
      res.status(err.status || 400).json({ error: err.message });
    }
  });

  return router;
}
