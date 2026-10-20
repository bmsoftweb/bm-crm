import { pool } from './db.js';

/**
 * Campanhas › "Selecionar com IA": o usuário descreve em português quem deve receber a campanha; a IA (Configurações › IA)
 * recebe a estrutura real das tabelas e devolve um SELECT com os ids das pessoas. Gravado nos critérios da campanha como
 * { modo: 'ia', pedido, sql, explicacao }.
 *
 * O SQL vem da IA e roda no banco de produção, então tem três travas: só um SELECT, sem comentários nem palavras
 * perigosas (conferirSqlIa); roda numa transação SOMENTE LEITURA com limite de tempo; e o resultado é cruzado com as
 * pessoas da empresa logada (idsDaSelecaoIa). O resto da campanha (contar, testar, gerar disparos) usa só a lista de ids.
 */

export interface SelecaoIa {
  modo: 'ia';
  pedido: string;
  sql: string;
  explicacao: string;
}

/** Tabelas que a IA conhece (as que existirem no banco) */
const TABELAS = [
  'pessoas', 'pessoas_contatos', 'pessoas_enderecos', 'segmentos', 'negocios', 'funis', 'etapas', 'atividades', 'propostas', 'pedidos',
  'contratos', 'chamados', 'chamado_categorias', 'whatsapp_atendimentos', 'whatsapp_conversas', 'whatsapp_mensagens', 'vendas_produtos',
  'produtos', 'avaliacoes', 'campanhas', 'campanha_disparos', 'usuarios', 'departamentos',
];

/** Colunas que não interessam para selecionar pessoas (e só gastariam o pedido) */
export const COLUNAS_FORA = /(senha|token|hash|_cifrad|base64|dados|arquivo|assinatura|logo|foto|config_listas|permissoes)/i;

/** Palavras que não podem aparecer no SQL da IA (escrita, administração, leitura de arquivos, espera) */
const PROIBIDAS =
  /\b(insert|update|delete|replace|drop|alter|create|truncate|rename|grant|revoke|call|handler|lock|unlock|load_file|outfile|dumpfile|sleep|benchmark|get_lock|release_lock|set|use|show|describe|explain|information_schema|performance_schema|mysql|sys|for\s+update|lock\s+in\s+share)\b/i;

export const MAX_PESSOAS_IA = 50_000;
export const TEMPO_MS = 15_000;

/**
 * Confere o SQL da IA: um SELECT só, sem comentários, sem palavras proibidas, com o marcador da empresa (as Consultas
 * não pedem o marcador: lá cada tabela é trocada pelas linhas da empresa, server/consultas.ts)
 */
export function conferirSqlIa(bruto: unknown, exigirEmpresa = true): string {
  const sql = String(bruto ?? '').trim().replace(/;\s*$/, '');
  if (!sql) throw new Error('A IA não montou o SQL.');
  if (sql.length > 20_000) throw new Error('SQL grande demais.');
  if (!/^select\b/i.test(sql)) throw new Error('O SQL precisa ser um SELECT.');
  if (sql.includes(';')) throw new Error('O SQL precisa ser um comando só.');
  if (/--|\/\*|#/.test(sql)) throw new Error('O SQL não pode ter comentários.');
  if (/@/.test(sql)) throw new Error('O SQL não pode usar variáveis (@).');
  const m = PROIBIDAS.exec(sql.replace(/'[^']*'/g, "''"));
  if (m) throw new Error(`O SQL não pode usar "${m[1]}".`);
  if (exigirEmpresa && !sql.includes(':empresa')) throw new Error('O SQL precisa filtrar a empresa com :empresa.');
  return sql;
}

/** Seleção com IA gravada/da tela, conferida */
export function normalizarSelecaoIa(v: any): SelecaoIa {
  const pedido = String(v?.pedido ?? '').trim().slice(0, 2000);
  if (!pedido) throw new Error('Descreva quem deve receber a campanha.');
  if (!String(v?.sql ?? '').trim()) throw new Error('Gere a seleção com a IA antes de gravar.');
  return { modo: 'ia', pedido, sql: conferirSqlIa(v.sql), explicacao: String(v?.explicacao ?? '').slice(0, 2000) };
}

export const ehSelecaoIa = (v: any): boolean => {
  let o = v;
  if (typeof o === 'string') {
    try {
      o = JSON.parse(o);
    } catch {
      return false;
    }
  }
  return Boolean(o && !Array.isArray(o) && typeof o === 'object' && o.modo === 'ia');
};

/**
 * Ids das pessoas da empresa que o SQL da IA seleciona (no máximo MAX_PESSOAS_IA): transação somente leitura, limite
 * de tempo, e só pessoas desta empresa
 */
/** O comando que roda de verdade: o SQL da IA com o número da empresa, por dentro da trava de tempo e das pessoas da empresa */
export function sqlExecutadoIa(sqlIa: string, empresaId: string | number): string {
  const emp = Number(empresaId);
  const sql = conferirSqlIa(sqlIa).replace(/:empresa\b/g, String(emp));
  return `SELECT /*+ MAX_EXECUTION_TIME(${TEMPO_MS}) */ DISTINCT p.id FROM (${sql}) x JOIN pessoas p ON p.id = x.id AND p.empresa_id = ${emp} LIMIT ${MAX_PESSOAS_IA}`;
}

export async function idsDaSelecaoIa(sqlIa: string, empresaId: string | number): Promise<number[]> {
  const sql = sqlExecutadoIa(sqlIa, empresaId);
  const conn = await pool.getConnection();
  try {
    await conn.query('START TRANSACTION READ ONLY');
    const [r] = await conn.query<any[]>(sql);
    return r.map((l) => Number(l.id));
  } catch (err: any) {
    if (/max_execution_time|maximum statement execution time/i.test(err?.message ?? '')) throw new Error('A seleção demorou demais (mais de 15 s). Simplifique o pedido.');
    if (/Unknown column 'x.id'|x\.id/i.test(err?.message ?? '')) throw new Error('O SQL precisa devolver a coluna "id" das pessoas.');
    throw new Error(`O SQL da seleção não rodou: ${err?.sqlMessage || err?.message}`);
  } finally {
    await conn.query('ROLLBACK').catch(() => {});
    conn.release();
  }
}

/** Estrutura das tabelas (nome, colunas, tipos e comentários) para a IA */
export async function estrutura(tabelas: string[] = TABELAS): Promise<string> {
  const [cols] = await pool.query<any[]>(
    `SELECT TABLE_NAME t, COLUMN_NAME c, COLUMN_TYPE ty, COLUMN_COMMENT cm FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN (?) ORDER BY TABLE_NAME, ORDINAL_POSITION`,
    [tabelas],
  );
  const porTabela = new Map<string, string[]>();
  for (const l of cols) {
    if (COLUNAS_FORA.test(l.c)) continue;
    const lista = porTabela.get(l.t) ?? [];
    lista.push(`${l.c} ${String(l.ty).replace(/ unsigned/, '')}${l.cm ? ` -- ${String(l.cm).slice(0, 60)}` : ''}`);
    porTabela.set(l.t, lista);
  }
  return [...porTabela].map(([t, c]) => `${t}(\n  ${c.join(',\n  ')}\n)`).join('\n');
}

/** Pede à IA o SQL da seleção; com SQL recusado, pede de novo uma vez, dizendo o motivo */
export async function gerarSelecaoIa(pedidoBruto: unknown, empresaId: string | number): Promise<SelecaoIa & { total: number }> {
  const pedido = String(pedidoBruto ?? '').trim().slice(0, 2000);
  if (!pedido) throw Object.assign(new Error('Descreva quem deve receber a campanha.'), { status: 400 });
  const { conversarIa, lerChatbot, temChave } = await import('./chatbot.js');
  const cfg = await lerChatbot(empresaId);
  if (!temChave(cfg)) throw Object.assign(new Error('Configure a IA em Configurações › IA antes de selecionar com IA.'), { status: 400 });

  const [[{ hoje }]] = await pool.query<any>("SELECT DATE_FORMAT(CURDATE(), '%Y-%m-%d') AS hoje");
  const system = `Você monta consultas MySQL 8 para selecionar o público de uma campanha de marketing de um CRM.
Hoje é ${hoje}. A empresa logada é :empresa (escreva literalmente :empresa; ele é trocado pelo número da empresa).

Responda só com JSON, sem texto em volta: {"sql":"...","explicacao":"..."}
- sql: UM comando SELECT que devolve a coluna "id" da tabela pessoas (ex.: SELECT DISTINCT p.id FROM pessoas p ... ).
  Filtre SEMPRE p.empresa_id = :empresa e também empresa_id = :empresa em toda tabela que tiver empresa_id.
  Use só as tabelas e colunas abaixo. Nada de ponto e vírgula, comentários, variáveis (@) ou comandos que não sejam SELECT.
  Datas relativas com CURDATE() / DATE_SUB. Textos com LIKE e sem diferenciar acentos/maiúsculas quando fizer sentido.
- explicacao: em português, curta, o que o SQL seleciona (para o usuário conferir).

Ligações entre as tabelas:
- pessoas é o cliente/lead (empresa ou pessoa física). p.cpf guarda o CPF/CNPJ só com dígitos. tipo: 'cliente' ou 'lead'.
- pessoas_contatos.pessoa_id e pessoas_enderecos.pessoa_id → pessoas.id (endereço principal: principal = 1).
- pessoas.segmento_id → segmentos.id.
- negocios.pessoa_id → pessoas.id (status 'aberto', 'ganho', 'perdido'); negocios.etapa_id → etapas.id; etapas.funil_id → funis.id.
- atividades.pessoa_id, propostas.pessoa_id, pedidos.pessoa_id, contratos.pessoa_id, chamados.pessoa_id → pessoas.id.
- chamados: status ('aguardando','em_andamento','pendente_cliente','pausado','encerrado','cancelado'), criado_em, encerrado_em, categoria_id → chamado_categorias.id.
- whatsapp_atendimentos.pessoa_id → pessoas.id (atendimentos de WhatsApp; fim = quando terminou). whatsapp_mensagens.pessoa_id → pessoas.id (direcao 'recebida' = do cliente).
- vendas_produtos: produtos vendidos (do ERP), uma linha por produto de cada nota. Não tem pessoa_id: liga pelo documento,
  vendas_produtos.cli_cnpj = pessoas.cpf (escreva v.cli_cnpj COLLATE utf8mb4_unicode_ci = p.cpf). cancelado = 'S' é nota cancelada (normalmente fica de fora).
- avaliacoes.pessoa_id → pessoas.id (nota de 1 a 5 da pesquisa de satisfação).
- campanha_disparos.pessoa_id → pessoas.id (quem já recebeu cada campanha; situacao 'enviado','entregue','lido','falhou').
- Quem pediu para não receber campanhas (pessoas.nao_receber_campanhas = 1) é tirado depois, não precisa filtrar.

Tabelas:
${await estrutura()}`;

  let falas: { de: 'pessoa' | 'ia'; texto: string }[] = [{ de: 'pessoa', texto: pedido }];
  for (let tentativa = 0; ; tentativa++) {
    const r = await conversarIa(cfg, system, falas, []);
    let sql = '';
    let explicacao = '';
    try {
      const j = JSON.parse(/\{[\s\S]*\}/.exec(r.texto)?.[0] ?? '{}');
      sql = String(j.sql ?? '');
      explicacao = String(j.explicacao ?? '');
      conferirSqlIa(sql);
      const ids = await idsDaSelecaoIa(sql, empresaId);
      const [[{ n }]] = ids.length
        ? await pool.query<any>('SELECT COUNT(*) AS n FROM pessoas p WHERE p.id IN (?) AND p.nao_receber_campanhas = 0', [ids])
        : [[{ n: 0 }]];
      return { modo: 'ia', pedido, sql: conferirSqlIa(sql), explicacao, total: Number(n) };
    } catch (err: any) {
      if (tentativa >= 1) throw Object.assign(new Error(`A IA não montou uma seleção válida: ${err.message}`), { status: 400 });
      falas = [...falas, { de: 'ia', texto: r.texto }, { de: 'pessoa', texto: `Esse SQL foi recusado: ${err.message} Corrija e responda de novo só com o JSON.` }];
    }
  }
}
