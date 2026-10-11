import express, { Router, Request, Response } from 'express';
import { pool } from './db.js';
import { friendlyDbError } from './crud.js';
import { sincronizarNegocio } from './regras.js';
import {
  baixarAssinado,
  camposWebhook,
  CAMINHO_WEBHOOK,
  cancelarDocumento,
  enviarParaAssinatura,
  hmacValido,
  reenviarLink,
  signatariosDocumento,
  situacaoDocumento,
  usaWebhook,
} from './d4sign.js';
import { somenteAdmin } from './config.js';
import { gerarPdf } from './pdf.js';
import { reaisPorExtenso } from './extenso.js';
import { getResource } from './schema.js';

/**
 * Contratos: totais calculados, documentos (PDF no banco), assinatura pela D4Sign e a
 * rotina que avisa a renovação, renova ou encerra os vencidos e acompanha as assinaturas.
 * O cadastro em si (cabeçalho e itens) usa as telas genéricas (server/schema.ts).
 */

type Executor = { query: typeof pool.query };

/** Meses de cada periodicidade de cobrança (a "unica" não se repete) */
const MESES_PERIODO = `CASE c.periodicidade WHEN 'mensal' THEN 1 WHEN 'bimestral' THEN 2 WHEN 'trimestral' THEN 3
                                            WHEN 'semestral' THEN 6 WHEN 'anual' THEN 12 END`;

/**
 * Recalcula os totais do contrato a partir dos itens:
 *  - valor_periodo: soma dos subtotais (o valor cobrado a cada período);
 *  - valor_total: o valor da vigência (períodos entre início e fim); sem data de fim,
 *    12 meses; cobrança única, o próprio valor.
 */
export async function recalcularContrato(contratoId: string | number, db: Executor = pool) {
  await db.query(
    `UPDATE contratos c
        SET c.valor_periodo = (SELECT COALESCE(SUM(i.subtotal), 0) FROM contrato_itens i WHERE i.contrato_id = c.id)
      WHERE c.id = ?`,
    [contratoId],
  );
  await db.query(
    `UPDATE contratos c
        SET c.valor_total = ROUND(c.valor_periodo * CASE
              WHEN c.periodicidade = 'unica' THEN 1
              WHEN c.data_fim IS NULL THEN 12 / ${MESES_PERIODO}
              ELSE GREATEST(1, CEIL(TIMESTAMPDIFF(MONTH, c.data_inicio, c.data_fim + INTERVAL 1 DAY) / ${MESES_PERIODO}))
            END, 2),
            c.encerrado_em = IF(c.situacao IN ('encerrado', 'cancelado'), COALESCE(c.encerrado_em, NOW()), NULL)
      WHERE c.id = ?`,
    [contratoId],
  );
}

/** Contrato do item (lido antes de excluir o item, para recalcular depois) */
export async function contratoDoItem(itemId: string): Promise<string | null> {
  const [r] = await pool.query<any[]>('SELECT contrato_id FROM contrato_itens WHERE id = ?', [itemId]);
  return r[0]?.contrato_id ?? null;
}

async function historico(db: Executor, c: any, descricao: string) {
  await db.query(
    `INSERT INTO historico_interacoes (empresa_id, negocio_id, pessoa_id, contrato_id, tipo, descricao) VALUES (?, ?, ?, ?, 'nota', ?)`,
    [c.empresa_id, c.negocio_id, c.pessoa_id, c.id, descricao],
  );
}

const TAMANHO_MAX_PDF = 15 * 1024 * 1024;
const EMAIL = /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/;

/** Documento com o contrato, conferindo que é da empresa logada */
async function documentoDaEmpresa(docId: string, empresaId: string) {
  const [r] = await pool.query<any[]>(
    `SELECT d.*, c.empresa_id, c.negocio_id, c.pessoa_id, c.numero, c.titulo, c.situacao AS contrato_situacao
       FROM contrato_documentos d JOIN contratos c ON c.id = d.contrato_id
      WHERE d.id = ? AND c.empresa_id = ?`,
    [docId, empresaId],
  );
  if (!r.length) throw Object.assign(new Error('Documento não encontrado.'), { status: 404 });
  return r[0];
}

/**
 * Consulta a D4Sign e atualiza o documento. Finalizado: guarda a via assinada como um
 * documento novo e o contrato que aguardava assinatura passa a ativo. Devolve a situação.
 */
export async function atualizarAssinatura(doc: any): Promise<string> {
  const empresaId = String(doc.empresa_id);
  const { statusId, statusName } = await situacaoDocumento(empresaId, doc.assinatura_envelope_id);
  const signatarios = await signatariosDocumento(empresaId, doc.assinatura_envelope_id);
  if (signatarios) {
    await pool.query('UPDATE contrato_documentos SET signatarios = ? WHERE id = ?', [JSON.stringify(signatarios), doc.id]);
  }

  if (statusId === 4 || statusId === 5) {
    const pdf = await baixarAssinado(empresaId, doc.assinatura_envelope_id);
    // Webhook e rotina podem chegar juntos: só quem virar a situação guarda a via assinada
    const [virou] = await pool.query<any>(
      "UPDATE contrato_documentos SET assinatura_situacao = 'assinado', assinatura_concluida_em = NOW() WHERE id = ? AND assinatura_situacao IN ('enviado', 'visualizado')",
      [doc.id],
    );
    if (!virou.affectedRows) return 'assinado';
    const nome = doc.nome_arquivo.replace(/\.pdf$/i, '') + ' (assinado).pdf';
    await pool.query(
      `INSERT INTO contrato_documentos (contrato_id, tipo, nome_arquivo, mime_type, tamanho, conteudo, assinatura_situacao)
       VALUES (?, 'assinado', ?, 'application/pdf', ?, ?, 'nao_enviado')`,
      [doc.contrato_id, nome, pdf.length, pdf],
    );
    await pool.query("UPDATE contratos SET situacao = 'ativo' WHERE id = ? AND situacao = 'aguardando_assinatura'", [doc.contrato_id]);
    const travou = await travarDeNovo(doc.contrato_id);
    await historico(pool, { ...doc, id: doc.contrato_id }, `Contrato nº ${doc.numero}: "${doc.nome_arquivo}" assinado por todos na D4Sign. Via assinada guardada nos documentos.${travou ? ' Contrato travado de novo.' : ''}`);
    if (doc.negocio_id) await sincronizarNegocio(doc.negocio_id);
    return 'assinado';
  }
  if (statusId === 6) {
    const [virou] = await pool.query<any>(
      "UPDATE contrato_documentos SET assinatura_situacao = 'cancelado' WHERE id = ? AND assinatura_situacao IN ('enviado', 'visualizado')",
      [doc.id],
    );
    if (!virou.affectedRows) return 'cancelado';
    await historico(pool, { ...doc, id: doc.contrato_id }, `Contrato nº ${doc.numero}: assinatura de "${doc.nome_arquivo}" cancelada na D4Sign.`);
    await pool.query("UPDATE contratos SET situacao = 'rascunho' WHERE id = ? AND situacao = 'aguardando_assinatura'", [doc.contrato_id]);
    return 'cancelado';
  }
  // Algum signatário já assinou: "visualizado" indica andamento
  const andamento = signatarios?.some((s) => s.assinado) ? 'visualizado' : 'enviado';
  await pool.query("UPDATE contrato_documentos SET assinatura_situacao = ? WHERE id = ? AND assinatura_situacao IN ('enviado', 'visualizado')", [andamento, doc.id]);
  return `${andamento} (${statusName || `situação ${statusId}`})`;
}

// ------------------------------------------------------------
// Trava do contrato assinado: o que está no contrato só muda por aditivo
// ------------------------------------------------------------

/** Campos de controle interno, que continuam editáveis no contrato assinado */
const LIVRES_NO_ASSINADO = new Set([
  'situacao',
  'motivo_encerramento',
  'proprietario_id',
  'observacoes',
  'cod_integracao',
  'aviso_renovacao_dias',
  'data_proximo_reajuste',
]);

/** Assinado: via assinada pela D4Sign ou PDF anexado como "Assinado" (mesmo critério da lista) */
const ASSINADO_SQL = `EXISTS (SELECT 1 FROM contrato_documentos d WHERE d.contrato_id = c.id AND (d.assinatura_situacao = 'assinado' OR d.tipo = 'assinado'))`;

export interface SituacaoTrava {
  assinado: boolean;
  /** Liberado para aditivo por um administrador (null: travado, se assinado) */
  liberado_em: string | null;
  liberado_por: string | null;
  /** false: faltam as colunas liberado_aditivo_* (extras/contratos_liberar_aditivo.sql) */
  pode_liberar: boolean;
}

export async function situacaoTrava(contratoId: string | number): Promise<SituacaoTrava> {
  try {
    const [r] = await pool.query<any[]>(
      `SELECT ${ASSINADO_SQL} AS assinado, DATE_FORMAT(c.liberado_aditivo_em, '%Y-%m-%d %H:%i:%s') AS em, u.nome AS por
         FROM contratos c LEFT JOIN usuarios u ON u.id = c.liberado_aditivo_por WHERE c.id = ?`,
      [contratoId],
    );
    return { assinado: Boolean(r[0]?.assinado), liberado_em: r[0]?.em ?? null, liberado_por: r[0]?.por ?? null, pode_liberar: true };
  } catch (err: any) {
    // Sem as colunas novas o contrato assinado fica travado, só sem a opção de liberar
    if (err?.code !== 'ER_BAD_FIELD_ERROR') throw err;
    const [r] = await pool.query<any[]>(`SELECT ${ASSINADO_SQL} AS assinado FROM contratos c WHERE c.id = ?`, [contratoId]);
    return { assinado: Boolean(r[0]?.assinado), liberado_em: null, liberado_por: null, pode_liberar: false };
  }
}

const travado = (s: SituacaoTrava) => s.assinado && !s.liberado_em;

const ERRO_TRAVA =
  'Contrato assinado: o que está no contrato só muda por aditivo. Um administrador pode "Liberar para aditivo" na janela de documentos do contrato (clipe).';

/** Compara o valor gravado com o da tela (datas em texto, decimais, 0/1 × true/false, vazio × null) */
function mesmoValor(a: unknown, b: unknown) {
  const n = (v: unknown) => (v === true ? '1' : v === false ? '0' : v == null ? '' : String(v).trim());
  const x = n(a);
  const y = n(b);
  if (x === y) return true;
  return x !== '' && y !== '' && !isNaN(Number(x)) && !isNaN(Number(y)) && Number(x) === Number(y);
}

/**
 * Barra, no cadastro genérico, mudanças no contrato assinado e travado: cláusulas do contrato
 * (os campos fora de LIVRES_NO_ASSINADO), itens e exclusão. A rotina de renovação não passa
 * por aqui: ela aplica a cláusula de renovação do próprio contrato.
 */
export async function conferirTrava(recurso: string, acao: 'incluir' | 'alterar' | 'excluir', id: string | null, payload: Record<string, any> | null) {
  // OS: concluir só pelo Encerrar (web) ou pelo app, que gravam o que foi feito, os horários e os serviços
  if (recurso === 'ordens_servico' && id && payload?.status === 'concluida') {
    const [r] = await pool.query<any[]>('SELECT status FROM ordens_servico WHERE id = ?', [id]);
    if (r[0] && r[0].status !== 'concluida') throw new Error('Para concluir a OS, use a ação Encerrar (o que foi feito, horários e serviços).');
  }
  if (recurso === 'contratos' && id && acao !== 'incluir') {
    if (!travado(await situacaoTrava(id))) return;
    if (acao === 'excluir') throw new Error('Contrato assinado não pode ser excluído. Para encerrá-lo, mude a situação para Encerrado ou Cancelado.');
    const [r] = await pool.query<any[]>('SELECT * FROM contratos WHERE id = ?', [id]);
    const atual = r[0] ?? {};
    const campos = getResource('contratos')?.fields ?? [];
    const mudou = Object.keys(payload ?? {}).filter((k) => !LIVRES_NO_ASSINADO.has(k) && k in atual && !mesmoValor(atual[k], payload![k]));
    if (mudou.length) {
      throw new Error(`${ERRO_TRAVA} Alterado: ${mudou.map((k) => campos.find((f) => f.name === k)?.label ?? k).join(', ')}.`);
    }
  }
  // Campanha já iniciada (disparos saindo): não é excluída e só a situação muda (pausar, cancelar, concluir); o resto é descartado
  if (recurso === 'campanhas' && id && acao !== 'incluir') {
    const [r] = await pool.query<any[]>('SELECT iniciada_em FROM campanhas WHERE id = ?', [id]);
    if (r[0]?.iniciada_em && acao === 'excluir') throw new Error('Campanha iniciada não pode ser excluída. Para encerrá-la, mude a situação para Cancelada ou Concluída.');
    if (r[0]?.iniciada_em && payload) for (const k of Object.keys(payload)) if (k !== 'situacao') delete payload[k];
  }
  if (recurso === 'contrato_itens') {
    const contratos = new Set([payload?.contrato_id, id ? await contratoDoItem(id) : null].filter(Boolean).map(String));
    for (const c of contratos) if (travado(await situacaoTrava(c))) throw new Error(ERRO_TRAVA);
  }
}

/** Trava de novo (aditivo assinado ou pedido do administrador). Devolve se estava liberado */
async function travarDeNovo(contratoId: string | number): Promise<boolean> {
  try {
    const [r] = await pool.query<any>(
      'UPDATE contratos SET liberado_aditivo_em = NULL, liberado_aditivo_por = NULL WHERE id = ? AND liberado_aditivo_em IS NOT NULL',
      [contratoId],
    );
    return r.affectedRows > 0;
  } catch (err: any) {
    if (err?.code !== 'ER_BAD_FIELD_ERROR') throw err;
    return false;
  }
}

// ------------------------------------------------------------
// Modelos de contrato (Configurações › Modelos de contrato): HTML com {{variáveis}},
// na tabela empresas_contratos_modelos (a empresa pode ter vários)
// ------------------------------------------------------------

/** Variáveis aceitas no modelo, com a explicação que aparece no editor */
export const VARIAVEIS_CONTRATO: { nome: string; descricao: string }[] = [
  { nome: 'contrato_numero', descricao: 'Número do contrato' },
  { nome: 'contrato_titulo', descricao: 'Título do contrato' },
  { nome: 'contrato_tipo', descricao: 'Recorrente ou Prazo fechado' },
  { nome: 'data_inicio', descricao: 'Início da vigência (dd/mm/aaaa)' },
  { nome: 'data_fim', descricao: 'Fim da vigência (ou "prazo indeterminado")' },
  { nome: 'vigencia', descricao: 'Frase da vigência: "de 01/01/2026 a 31/12/2026"' },
  { nome: 'prazo_meses', descricao: 'Duração em meses (vazio se indeterminado)' },
  { nome: 'periodicidade', descricao: 'mensal, trimestral, anual…' },
  { nome: 'dia_vencimento', descricao: 'Dia de vencimento das parcelas' },
  { nome: 'valor_periodo', descricao: 'Valor por período (R$)' },
  { nome: 'valor_periodo_extenso', descricao: 'Valor por período por extenso' },
  { nome: 'valor_total', descricao: 'Valor total do contrato (R$)' },
  { nome: 'valor_total_extenso', descricao: 'Valor total por extenso' },
  { nome: 'renovacao_automatica', descricao: 'Sim ou Não' },
  { nome: 'indice_reajuste', descricao: 'Índice de reajuste (IPCA, IGP-M…)' },
  { nome: 'observacoes', descricao: 'Observações do contrato' },
  { nome: 'itens', descricao: 'Tabela com os itens (produto, quantidade, valores)' },
  { nome: 'cliente_nome', descricao: 'Nome / razão social do cliente' },
  { nome: 'cliente_documento', descricao: 'CPF ou CNPJ do cliente' },
  { nome: 'cliente_email', descricao: 'E-mail do cliente' },
  { nome: 'cliente_telefone', descricao: 'Telefone do cliente' },
  { nome: 'cliente_endereco', descricao: 'Endereço principal do cliente, completo' },
  { nome: 'empresa_nome', descricao: 'Nome da sua empresa' },
  { nome: 'empresa_cnpj', descricao: 'CNPJ da sua empresa' },
  { nome: 'empresa_endereco', descricao: 'Endereço da sua empresa' },
  { nome: 'empresa_logo', descricao: 'Logo da sua empresa (imagem)' },
  { nome: 'responsavel', descricao: 'Responsável pelo contrato (usuário)' },
  { nome: 'data_hoje', descricao: 'Data de hoje (dd/mm/aaaa)' },
  { nome: 'data_hoje_extenso', descricao: 'Data de hoje por extenso: 24 de setembro de 2026' },
];

const esc = (v: unknown) =>
  String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const moeda = (v: unknown) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(v) || 0);
const qtd = (v: unknown) => new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 3 }).format(Number(v) || 0);
/** "2026-01-31" → "31/01/2026" (datas vêm do MySQL como texto) */
const dataBR = (d: unknown) => (d ? String(d).slice(0, 10).split('-').reverse().join('/') : '');
const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
const ROTULOS: Record<string, string> = {
  recorrente: 'Recorrente', prazo_fechado: 'Prazo fechado',
  mensal: 'Mensal', bimestral: 'Bimestral', trimestral: 'Trimestral', semestral: 'Semestral', anual: 'Anual', unica: 'Única',
};

/**
 * Tira do modelo o que executaria código ao abrir no editor ou no gerador de PDF
 * (script, iframe, atributos on*, links javascript:). O resto do HTML fica como veio.
 */
export function sanitizarModelo(html: string): string {
  return String(html ?? '')
    .replace(/<\s*(script|iframe|object|embed)[\s\S]*?<\s*\/\s*\1\s*>/gi, '')
    .replace(/<\s*(script|iframe|object|embed)[^>]*>/gi, '')
    .replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/(href|src)\s*=\s*(["']?)\s*javascript:[^"'\s>]*\2/gi, '$1="#"')
    .trim();
}

const TAMANHO_MAX_MODELO = 1_000_000;

/** Descrição e HTML do modelo vindos da tela, validados e limpos */
function modeloDaTela(body: any) {
  const descricao = String(body?.descricao ?? '').trim();
  if (!descricao) throw new Error('Informe a descrição do modelo.');
  if (descricao.length > 255) throw new Error('Descrição grande demais (máximo 255 caracteres).');
  const html = sanitizarModelo(body?.formato_html);
  if (!html) throw new Error('O modelo está vazio.');
  if (html.length > TAMANHO_MAX_MODELO) throw new Error('Modelo grande demais.');
  return { descricao, html };
}

/** Valores das variáveis para o contrato (já em HTML: texto escapado; itens e logo são HTML) */
async function dadosDoContrato(contratoId: string, empresaId: string): Promise<Record<string, string>> {
  const [cs] = await pool.query<any[]>(
    `SELECT c.*, TIMESTAMPDIFF(MONTH, c.data_inicio, c.data_fim + INTERVAL 1 DAY) AS meses,
            p.nome AS cliente_nome, p.cpf AS cliente_documento, p.email AS cliente_email, p.telefone AS cliente_telefone,
            e.nome AS empresa_nome, e.cnpj AS empresa_cnpj, e.endereco AS empresa_endereco, e.logo AS empresa_logo,
            u.nome AS responsavel, CURDATE() AS hoje
       FROM contratos c
       JOIN pessoas p ON p.id = c.pessoa_id
       JOIN empresas e ON e.id = c.empresa_id
       LEFT JOIN usuarios u ON u.id = c.proprietario_id
      WHERE c.id = ? AND c.empresa_id = ?`,
    [contratoId, empresaId],
  );
  if (!cs.length) throw Object.assign(new Error('Contrato não encontrado.'), { status: 404 });
  const c = cs[0];
  const [ends] = await pool.query<any[]>(
    'SELECT * FROM pessoas_enderecos WHERE pessoa_id = ? ORDER BY principal DESC, id LIMIT 1',
    [c.pessoa_id],
  );
  const e = ends[0];
  const endereco = e
    ? [[e.logradouro, e.numero].filter(Boolean).join(', '), e.complemento, e.bairro, [e.cidade, e.uf].filter(Boolean).join('/'), e.cep && `CEP ${e.cep}`]
        .filter(Boolean)
        .join(' – ')
    : '';
  const [itens] = await pool.query<any[]>(
    `SELECT i.*, pr.nome AS produto_nome, pr.unidade_medida FROM contrato_itens i JOIN produtos pr ON pr.id = i.produto_id
      WHERE i.contrato_id = ? ORDER BY i.id`,
    [contratoId],
  );
  const td = 'style="padding:4px 6px;border:1px solid #d6d3d1"';
  const tabelaItens = itens.length
    ? `<table style="width:100%;border-collapse:collapse;font-size:10pt;margin:6px 0">
         <thead><tr style="background:#f5f5f4">
           <th ${td} align="left">Produto / Serviço</th><th ${td} align="right">Qtd.</th><th ${td} align="right">Valor por período</th>
           <th ${td} align="right">Desconto</th><th ${td} align="right">Subtotal</th></tr></thead>
         <tbody>${itens
           .map(
             (i) => `<tr><td ${td}>${esc(i.produto_nome)}</td><td ${td} align="right">${qtd(i.quantidade)} ${esc(i.unidade_medida || '')}</td>
                     <td ${td} align="right">${moeda(i.preco_unitario)}</td><td ${td} align="right">${Number(i.desconto) ? moeda(i.desconto) : '—'}</td>
                     <td ${td} align="right">${moeda(i.subtotal)}</td></tr>`,
           )
           .join('')}
           <tr><td ${td} colspan="4" align="right"><b>Total por período</b></td><td ${td} align="right"><b>${moeda(c.valor_periodo)}</b></td></tr>
         </tbody></table>`
    : '';
  const hoje = String(c.hoje).slice(0, 10).split('-').map(Number);
  const indeterminado = !c.data_fim;
  const doc = String(c.cliente_documento || '').replace(/\D/g, '');
  const documento =
    doc.length === 14 ? doc.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5') : doc.length === 11 ? doc.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, '$1.$2.$3-$4') : c.cliente_documento;
  const cnpj = String(c.empresa_cnpj || '').replace(/\D/g, '');

  const texto: Record<string, unknown> = {
    contrato_numero: c.numero,
    contrato_titulo: c.titulo,
    contrato_tipo: ROTULOS[c.tipo] || c.tipo,
    data_inicio: dataBR(c.data_inicio),
    data_fim: indeterminado ? 'prazo indeterminado' : dataBR(c.data_fim),
    vigencia: indeterminado ? `a partir de ${dataBR(c.data_inicio)}, por prazo indeterminado` : `de ${dataBR(c.data_inicio)} a ${dataBR(c.data_fim)}`,
    prazo_meses: indeterminado ? '' : c.meses,
    // Minúscula: a variável costuma vir no meio da frase ("com periodicidade mensal")
    periodicidade: (ROTULOS[c.periodicidade] || c.periodicidade).toLowerCase(),
    dia_vencimento: c.dia_vencimento ?? '',
    valor_periodo: moeda(c.valor_periodo),
    valor_periodo_extenso: reaisPorExtenso(c.valor_periodo),
    valor_total: moeda(c.valor_total),
    valor_total_extenso: reaisPorExtenso(c.valor_total),
    renovacao_automatica: c.renovacao_automatica ? 'Sim' : 'Não',
    indice_reajuste: c.indice_reajuste || '',
    observacoes: c.observacoes || '',
    cliente_nome: c.cliente_nome,
    cliente_documento: documento || '',
    cliente_email: c.cliente_email || '',
    cliente_telefone: c.cliente_telefone || '',
    cliente_endereco: endereco,
    empresa_nome: c.empresa_nome,
    empresa_cnpj: cnpj.length === 14 ? cnpj.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5') : c.empresa_cnpj || '',
    empresa_endereco: c.empresa_endereco || '',
    responsavel: c.responsavel || '',
    data_hoje: dataBR(c.hoje),
    data_hoje_extenso: `${hoje[2]} de ${MESES[hoje[1] - 1]} de ${hoje[0]}`,
  };
  const dados: Record<string, string> = {};
  for (const [k, v] of Object.entries(texto)) dados[k] = esc(v).replace(/\n/g, '<br>');
  dados.itens = tabelaItens;
  dados.empresa_logo = c.empresa_logo ? `<img src="${c.empresa_logo}" alt="" style="max-height:60px;max-width:200px">` : '';
  dados.__numero = String(c.numero);
  return dados;
}

/** Página A4 do contrato: o modelo com as variáveis trocadas (as desconhecidas ficam à vista) */
function htmlDoContrato(modelo: string, dados: Record<string, string>): string {
  const corpo = modelo.replace(/\{\{\s*([a-z_]+)\s*\}\}/gi, (inteira, nome) => dados[nome.toLowerCase()] ?? inteira);
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Contrato nº ${esc(dados.__numero)}</title>
<style>
  @page {
    size: A4;
    margin: 20mm 20mm 22mm;
    @bottom-right {
      content: "Contrato nº ${esc(dados.__numero)} — página " counter(page) " de " counter(pages);
      font: 8pt "Segoe UI", Roboto, Arial, sans-serif;
      color: #78716c;
    }
  }
  body { font-family: "Segoe UI", Roboto, Arial, sans-serif; font-size: 11pt; line-height: 1.5; color: #1c1917; margin: 0; }
  h1 { font-size: 15pt; } h2 { font-size: 13pt; } h3 { font-size: 11.5pt; }
  p { margin: 0 0 8px; text-align: justify; }
  table { page-break-inside: auto; } tr { page-break-inside: avoid; }
</style></head><body>${corpo}</body></html>`;
}

export function createContratosRouter() {
  const router = Router();

  const rota =
    (fn: (req: Request, res: Response) => Promise<any>) =>
    async (req: Request, res: Response) => {
      try {
        await fn(req, res);
      } catch (err: any) {
        res.status(err.status || 400).json({ error: friendlyDbError(err, 'documento') });
      }
    };

  /** Variáveis dos modelos de contrato, para o editor em Configurações */
  router.get('/contratos/modelo/variaveis', (_req: Request, res: Response) => {
    res.json(VARIAVEIS_CONTRATO);
  });

  // ---- Modelos de contrato: todos leem (para escolher ao gerar); só administradores alteram
  router.get('/contratos/modelos', rota(async (_req, res) => {
    const [rows] = await pool.query<any[]>(
      'SELECT id, descricao FROM empresas_contratos_modelos WHERE empresa_id = ? ORDER BY descricao, id',
      [res.locals.empresaId],
    );
    res.json(rows);
  }));

  router.get('/contratos/modelos/:modeloId', rota(async (req, res) => {
    const [rows] = await pool.query<any[]>(
      'SELECT id, descricao, formato_html FROM empresas_contratos_modelos WHERE id = ? AND empresa_id = ?',
      [req.params.modeloId, res.locals.empresaId],
    );
    if (!rows.length) throw Object.assign(new Error('Modelo não encontrado.'), { status: 404 });
    res.json(rows[0]);
  }));

  router.post('/contratos/modelos', rota(async (req, res) => {
    somenteAdmin(res);
    const m = modeloDaTela(req.body);
    const [r] = await pool.query<any>(
      'INSERT INTO empresas_contratos_modelos (empresa_id, descricao, formato_html) VALUES (?, ?, ?)',
      [res.locals.empresaId, m.descricao, m.html],
    );
    res.json({ success: true, id: r.insertId });
  }));

  router.put('/contratos/modelos/:modeloId', rota(async (req, res) => {
    somenteAdmin(res);
    const m = modeloDaTela(req.body);
    const [r] = await pool.query<any>(
      'UPDATE empresas_contratos_modelos SET descricao = ?, formato_html = ? WHERE id = ? AND empresa_id = ?',
      [m.descricao, m.html, req.params.modeloId, res.locals.empresaId],
    );
    if (!r.affectedRows) throw Object.assign(new Error('Modelo não encontrado.'), { status: 404 });
    res.json({ success: true });
  }));

  router.delete('/contratos/modelos/:modeloId', rota(async (req, res) => {
    somenteAdmin(res);
    const [r] = await pool.query<any>('DELETE FROM empresas_contratos_modelos WHERE id = ? AND empresa_id = ?', [
      req.params.modeloId,
      res.locals.empresaId,
    ]);
    if (!r.affectedRows) throw Object.assign(new Error('Modelo não encontrado.'), { status: 404 });
    res.json({ success: true });
  }));

  /**
   * Gera o PDF do contrato pelo modelo escolhido e guarda como minuta. Sem modelo_id, vale o
   * único modelo da empresa (com mais de um, a tela precisa dizer qual).
   */
  router.post('/contratos/:id/gerar-minuta', rota(async (req, res) => {
    const empresaId = String(res.locals.empresaId);
    const modeloId = req.body?.modelo_id;
    const [modelos] = await pool.query<any[]>(
      `SELECT id, descricao, formato_html FROM empresas_contratos_modelos WHERE empresa_id = ? ${modeloId ? 'AND id = ?' : ''} LIMIT 2`,
      modeloId ? [empresaId, modeloId] : [empresaId],
    );
    if (!modelos.length) {
      throw new Error(modeloId ? 'Modelo não encontrado.' : 'Não há modelo de contrato: cadastre um em Configurações › Modelos de contrato.');
    }
    if (modelos.length > 1) throw new Error('Escolha o modelo de contrato.');
    const modelo = modelos[0];
    const dados = await dadosDoContrato(req.params.id, empresaId);
    const pdf = await gerarPdf(htmlDoContrato(modelo.formato_html || '', dados));
    const nome = `Contrato nº ${dados.__numero} - ${String(modelo.descricao).replace(/[\\/:*?"<>|]+/g, ' ').trim().slice(0, 120)}.pdf`;
    const [r] = await pool.query<any>(
      "INSERT INTO contrato_documentos (contrato_id, tipo, nome_arquivo, mime_type, tamanho, conteudo, enviado_por) VALUES (?, 'minuta', ?, 'application/pdf', ?, ?, ?)",
      [req.params.id, nome, pdf.length, pdf, res.locals.usuarioId],
    );
    res.json({ success: true, id: r.insertId, nome });
  }));

  /** Situação da trava do contrato (janela de documentos) */
  router.get('/contratos/:id/trava', rota(async (req, res) => {
    const [c] = await pool.query<any[]>('SELECT id FROM contratos WHERE id = ? AND empresa_id = ?', [req.params.id, res.locals.empresaId]);
    if (!c.length) throw Object.assign(new Error('Contrato não encontrado.'), { status: 404 });
    const s = await situacaoTrava(req.params.id);
    res.json({ ...s, travado: travado(s), campos_livres: [...LIVRES_NO_ASSINADO] });
  }));

  /** Libera o contrato assinado para o aditivo (só administrador; fica no histórico) */
  router.post('/contratos/:id/liberar-aditivo', rota(async (req, res) => {
    somenteAdmin(res);
    const [c] = await pool.query<any[]>('SELECT * FROM contratos WHERE id = ? AND empresa_id = ?', [req.params.id, res.locals.empresaId]);
    if (!c.length) throw Object.assign(new Error('Contrato não encontrado.'), { status: 404 });
    const s = await situacaoTrava(req.params.id);
    if (!s.pode_liberar) throw new Error('Falta atualizar o banco: rode extras/contratos_liberar_aditivo.sql.');
    if (!s.assinado) throw new Error('O contrato não está assinado: já pode ser alterado.');
    if (s.liberado_em) throw new Error('O contrato já está liberado para aditivo.');
    const motivo = String(req.body?.motivo ?? '').trim().slice(0, 300);
    await pool.query('UPDATE contratos SET liberado_aditivo_em = NOW(), liberado_aditivo_por = ? WHERE id = ?', [res.locals.usuarioId, req.params.id]);
    await historico(pool, c[0], `Contrato nº ${c[0].numero}: liberado para aditivo por ${res.locals.usuario?.nome ?? 'administrador'}${motivo ? ` (${motivo})` : ''}.`);
    res.json({ success: true });
  }));

  /** Trava de novo o contrato liberado (o aditivo assinado também trava sozinho) */
  router.post('/contratos/:id/travar', rota(async (req, res) => {
    somenteAdmin(res);
    const [c] = await pool.query<any[]>('SELECT * FROM contratos WHERE id = ? AND empresa_id = ?', [req.params.id, res.locals.empresaId]);
    if (!c.length) throw Object.assign(new Error('Contrato não encontrado.'), { status: 404 });
    const s = await situacaoTrava(req.params.id);
    if (!s.liberado_em) throw new Error('O contrato não está liberado.');
    await travarDeNovo(req.params.id);
    await historico(pool, c[0], `Contrato nº ${c[0].numero}: travado de novo por ${res.locals.usuario?.nome ?? 'administrador'}.`);
    res.json({ success: true });
  }));

  /** Documentos do contrato (sem o conteúdo) */
  router.get('/contratos/:id/documentos', rota(async (req, res) => {
    const [rows] = await pool.query<any[]>(
      `SELECT d.id, d.tipo, d.nome_arquivo, d.mime_type, d.tamanho, d.assinatura_provedor, d.assinatura_situacao,
              d.assinatura_enviada_em, d.assinatura_concluida_em, d.signatarios, d.criado_em
         FROM contrato_documentos d JOIN contratos c ON c.id = d.contrato_id
        WHERE d.contrato_id = ? AND c.empresa_id = ?
        ORDER BY d.criado_em DESC, d.id DESC`,
      [req.params.id, res.locals.empresaId],
    );
    res.json(rows);
  }));

  /** Anexa um arquivo (base64) ao contrato */
  router.post('/contratos/:id/documentos', rota(async (req, res) => {
    const [c] = await pool.query<any[]>('SELECT * FROM contratos WHERE id = ? AND empresa_id = ?', [req.params.id, res.locals.empresaId]);
    if (!c.length) throw Object.assign(new Error('Contrato não encontrado.'), { status: 404 });
    const tipos = ['minuta', 'assinado', 'aditivo', 'distrato', 'outro'];
    const tipo = tipos.includes(req.body?.tipo) ? req.body.tipo : 'outro';
    const nome = String(req.body?.nome_arquivo ?? '').trim().slice(0, 255);
    const mime = String(req.body?.mime_type || 'application/pdf').slice(0, 100);
    const conteudo = Buffer.from(String(req.body?.conteudo_base64 ?? ''), 'base64');
    if (!nome || !conteudo.length) throw new Error('Escolha o arquivo.');
    if (conteudo.length > TAMANHO_MAX_PDF) throw new Error('Arquivo grande demais (máximo 15 MB).');
    const [r] = await pool.query<any>(
      'INSERT INTO contrato_documentos (contrato_id, tipo, nome_arquivo, mime_type, tamanho, conteudo, enviado_por) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [req.params.id, tipo, nome, mime, conteudo.length, conteudo, res.locals.usuarioId],
    );
    if (tipo === 'assinado' && (await travarDeNovo(req.params.id))) {
      await historico(pool, c[0], `Contrato nº ${c[0].numero}: via assinada "${nome}" anexada. Contrato travado de novo.`);
    }
    res.json({ success: true, id: r.insertId });
  }));

  /** Conteúdo do arquivo, para baixar */
  router.get('/contratos/documentos/:docId/arquivo', rota(async (req, res) => {
    const d = await documentoDaEmpresa(req.params.docId, res.locals.empresaId);
    res.setHeader('Content-Type', d.mime_type);
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(d.nome_arquivo)}`);
    res.send(d.conteudo);
  }));

  router.delete('/contratos/documentos/:docId', rota(async (req, res) => {
    const d = await documentoDaEmpresa(req.params.docId, res.locals.empresaId);
    if (d.assinatura_situacao === 'enviado' || d.assinatura_situacao === 'visualizado') {
      throw new Error('O documento está em assinatura na D4Sign: cancele a assinatura antes de excluir.');
    }
    if ((d.tipo === 'assinado' || d.assinatura_situacao === 'assinado') && travado(await situacaoTrava(d.contrato_id))) {
      throw new Error('Documento assinado não pode ser excluído do contrato travado. Um administrador pode "Liberar para aditivo" antes, se for mesmo preciso.');
    }
    await pool.query('DELETE FROM contrato_documentos WHERE id = ?', [d.id]);
    res.json({ success: true });
  }));

  /** Envia o PDF para assinatura na D4Sign */
  router.post('/contratos/documentos/:docId/assinatura', rota(async (req, res) => {
    const d = await documentoDaEmpresa(req.params.docId, res.locals.empresaId);
    if (d.mime_type !== 'application/pdf') throw new Error('Só PDF pode ser enviado para assinatura.');
    if (['enviado', 'visualizado', 'assinado'].includes(d.assinatura_situacao)) throw new Error('Este documento já foi enviado para assinatura.');
    const emails: string[] = [...new Set<string>((req.body?.emails ?? []).map((e: unknown) => String(e).trim().toLowerCase()).filter(Boolean))];
    if (!emails.length) throw new Error('Informe ao menos um e-mail de signatário.');
    const invalido = emails.find((e) => !EMAIL.test(e));
    if (invalido) throw new Error(`E-mail inválido: ${invalido}`);
    const mensagem = String(req.body?.mensagem ?? '').slice(0, 1000);

    const uuid = await enviarParaAssinatura(String(d.empresa_id), d.conteudo, d.nome_arquivo, emails, mensagem);
    await pool.query(
      `UPDATE contrato_documentos SET assinatura_provedor = 'd4sign', assinatura_envelope_id = ?, assinatura_situacao = 'enviado',
              assinatura_enviada_em = NOW(), assinatura_concluida_em = NULL, signatarios = ?, enviado_por = ? WHERE id = ?`,
      [uuid, JSON.stringify(emails.map((email) => ({ email, assinado: false, assinado_em: null }))), res.locals.usuarioId, d.id],
    );
    await pool.query("UPDATE contratos SET situacao = 'aguardando_assinatura' WHERE id = ? AND situacao = 'rascunho'", [d.contrato_id]);
    await historico(pool, { ...d, id: d.contrato_id }, `Contrato nº ${d.numero}: "${d.nome_arquivo}" enviado para assinatura na D4Sign (${emails.join(', ')}).`);
    if (d.negocio_id) await sincronizarNegocio(d.negocio_id);
    res.json({ success: true });
  }));

  /** Consulta agora a situação da assinatura (a rotina também consulta sozinha) */
  router.post('/contratos/documentos/:docId/assinatura/atualizar', rota(async (req, res) => {
    const d = await documentoDaEmpresa(req.params.docId, res.locals.empresaId);
    if (!d.assinatura_envelope_id) throw new Error('Este documento não foi enviado para assinatura.');
    res.json({ success: true, situacao: await atualizarAssinatura(d) });
  }));

  /** Cancela a assinatura na D4Sign: os links deixam de valer e o documento pode ser reenviado ou excluído */
  router.post('/contratos/documentos/:docId/assinatura/cancelar', rota(async (req, res) => {
    const d = await documentoDaEmpresa(req.params.docId, res.locals.empresaId);
    if (!['enviado', 'visualizado'].includes(d.assinatura_situacao)) throw new Error('Este documento não está em assinatura.');
    const motivo = String(req.body?.motivo ?? '').trim().slice(0, 500) || 'Cancelado pelo CRM.';
    await cancelarDocumento(String(d.empresa_id), d.assinatura_envelope_id, motivo);
    await pool.query("UPDATE contrato_documentos SET assinatura_situacao = 'cancelado' WHERE id = ?", [d.id]); // antes do webhook, que então não repete o histórico
    await pool.query("UPDATE contratos SET situacao = 'rascunho' WHERE id = ? AND situacao = 'aguardando_assinatura'", [d.contrato_id]);
    await historico(pool, { ...d, id: d.contrato_id }, `Contrato nº ${d.numero}: assinatura de "${d.nome_arquivo}" cancelada na D4Sign (${motivo}).`);
    if (d.negocio_id) await sincronizarNegocio(d.negocio_id);
    res.json({ success: true });
  }));

  /** Reenvia o link de assinatura a um signatário pendente */
  router.post('/contratos/documentos/:docId/assinatura/reenviar', rota(async (req, res) => {
    const d = await documentoDaEmpresa(req.params.docId, res.locals.empresaId);
    if (!['enviado', 'visualizado'].includes(d.assinatura_situacao)) throw new Error('Este documento não está em assinatura.');
    const email = String(req.body?.email ?? '').trim();
    if (!EMAIL.test(email)) throw new Error('Informe o e-mail do signatário.');
    await reenviarLink(String(d.empresa_id), d.assinatura_envelope_id, email);
    res.json({ success: true });
  }));

  return router;
}

// ------------------------------------------------------------
// Rotina: renovação, vencimento e assinaturas pendentes
// ------------------------------------------------------------

/** Um ciclo da rotina; devolve um resumo do que fez */
export async function rotinaContratos(): Promise<{ tarefas: number; renovados: number; encerrados: number; assinaturas: number }> {
  const conn = await pool.getConnection();
  const feito = { tarefas: 0, renovados: 0, encerrados: 0, assinaturas: 0 };
  try {
    // Trava no MySQL: dois servidores no mesmo banco não duplicam tarefas nem renovações
    const [trava] = await conn.query<any[]>("SELECT GET_LOCK('crmweb_rotina_contratos', 0) AS ok");
    if (!trava[0]?.ok) return feito;
    try {
      // 1. Tarefa "Renovar contrato" ao entrar no prazo de aviso (uma por ciclo de vigência)
      const [avisar] = await conn.query<any[]>(
        `SELECT c.* FROM contratos c
          WHERE c.situacao = 'ativo' AND c.data_fim IS NOT NULL
            AND CURDATE() >= c.data_fim - INTERVAL c.aviso_renovacao_dias DAY
            AND NOT EXISTS (SELECT 1 FROM atividades a WHERE a.contrato_id = c.id AND a.assunto = 'Renovar contrato'
                               AND a.criado_em >= c.data_fim - INTERVAL c.aviso_renovacao_dias DAY)`,
      );
      for (const c of avisar) {
        await conn.query(
          `INSERT INTO atividades (empresa_id, negocio_id, pessoa_id, contrato_id, assunto, tipo, data_vencimento, observacao)
           VALUES (?, ?, ?, ?, 'Renovar contrato', 'tarefa', CURDATE(), CONCAT(?, DATE_FORMAT(?, '%d/%m/%Y'), ?))`,
          [
            c.empresa_id,
            c.negocio_id,
            c.pessoa_id,
            c.id,
            `Contrato nº ${c.numero} (${c.titulo}) vence em `,
            c.data_fim,
            c.renovacao_automatica ? '. Renovação automática: confirmar condições e reajuste com o cliente.' : '. Sem renovação automática: negociar a renovação.',
          ],
        );
        if (c.negocio_id) await sincronizarNegocio(c.negocio_id, conn);
        feito.tarefas++;
      }

      // 2. Vigência vencida: renova por mais 12 meses (renovação automática) ou encerra
      const [vencidos] = await conn.query<any[]>(`SELECT c.* FROM contratos c WHERE c.situacao = 'ativo' AND c.data_fim < CURDATE()`);
      for (const c of vencidos) {
        if (c.renovacao_automatica) {
          // ponytail: renova sempre por 12 meses; prazo de renovação próprio pede uma coluna no contrato
          await conn.query('UPDATE contratos SET data_fim = data_fim + INTERVAL 12 MONTH WHERE id = ?', [c.id]);
          const [[n]] = await conn.query<any>("SELECT DATE_FORMAT(data_fim, '%d/%m/%Y') fim FROM contratos WHERE id = ?", [c.id]);
          await historico(conn, c, `Contrato nº ${c.numero} renovado automaticamente até ${n.fim}.`);
          feito.renovados++;
        } else {
          await conn.query("UPDATE contratos SET situacao = 'encerrado', motivo_encerramento = COALESCE(motivo_encerramento, 'Fim da vigência') WHERE id = ?", [c.id]);
          await historico(conn, c, `Contrato nº ${c.numero} encerrado: fim da vigência, sem renovação automática.`);
          feito.encerrados++;
        }
        await recalcularContrato(c.id, conn);
      }
    } finally {
      await conn.query("SELECT RELEASE_LOCK('crmweb_rotina_contratos')");
    }
  } finally {
    conn.release();
  }

  // 3. Assinaturas pendentes (fora da trava: cada consulta à D4Sign pode demorar)
  const [pendentes] = await pool.query<any[]>(
    `SELECT d.*, c.empresa_id, c.negocio_id, c.pessoa_id, c.numero, c.titulo
       FROM contrato_documentos d JOIN contratos c ON c.id = d.contrato_id
      WHERE d.assinatura_situacao IN ('enviado', 'visualizado') AND d.assinatura_envelope_id IS NOT NULL`,
  );
  // Com webhook a D4Sign avisa sozinha: a consulta fica só como conferência diária, às 7h,
  // poupando o limite de chamadas da API
  const [[{ hora }]] = await pool.query<any[]>('SELECT HOUR(NOW()) AS hora');
  const comWebhook = new Map<string, boolean>();
  for (const d of pendentes) {
    try {
      const emp = String(d.empresa_id);
      if (!comWebhook.has(emp)) comWebhook.set(emp, await usaWebhook(emp));
      if (comWebhook.get(emp) && Number(hora) !== 7) continue;
      if ((await atualizarAssinatura(d)) === 'assinado') feito.assinaturas++;
    } catch (err: any) {
      console.error(`Contratos: documento ${d.id}: ${err.message}`);
    }
  }
  return feito;
}

/** Liga a rotina: ao subir e a cada hora */
export function iniciarRotinaContratos() {
  let rodando = false;
  const ciclo = async () => {
    if (rodando) return;
    rodando = true;
    try {
      const f = await rotinaContratos();
      if (f.tarefas || f.renovados || f.encerrados || f.assinaturas) {
        console.log(`Contratos: ${f.tarefas} tarefa(s) de renovação, ${f.renovados} renovado(s), ${f.encerrados} encerrado(s), ${f.assinaturas} assinatura(s) concluída(s).`);
      }
    } catch (err: any) {
      console.error('Contratos: falha na rotina:', err.message);
    } finally {
      rodando = false;
    }
  };
  setInterval(ciclo, 60 * 60_000);
  ciclo();
}

// ------------------------------------------------------------
// Webhook da D4Sign (rota pública, sem sessão: registrar antes da checagem do token)
// ------------------------------------------------------------

/**
 * A D4Sign avisa por POST (form-data) quando um signatário assina (type_post 4), o documento
 * é finalizado (1) ou cancelado (3), ou um e-mail não foi entregue (2). O conteúdo não é
 * confiável por si: serve de gatilho, e a situação real é consultada na própria D4Sign.
 * Responde 200 logo e processa em seguida (baixar a via assinada pode demorar); se algo
 * falhar, a conferência diária da rotina corrige.
 */
/** E-mail do signatário: v1 manda "email"; a 2.0 manda o objeto "signer" (em JSON ou como signer[email]) */
function emailDoAviso(campos: Record<string, string>): string {
  if (campos['signer[email]']) return campos['signer[email]'];
  try {
    const s = JSON.parse(campos.signer || 'null');
    if (s?.email) return String(s.email);
  } catch {
    // não era JSON
  }
  return String(campos.email || '');
}

export function createWebhookD4SignRouter() {
  const router = Router();
  router.post(CAMINHO_WEBHOOK, express.raw({ type: () => true, limit: '1mb' }), async (req: Request, res: Response) => {
    // Em JSON o parser geral do app já leu o corpo; nos outros formatos ele chega bruto
    const campos: Record<string, string> = Buffer.isBuffer(req.body)
      ? camposWebhook(String(req.headers['content-type'] || ''), req.body.toString('utf8'))
      : Object.fromEntries(Object.entries(req.body ?? {}).map(([k, v]) => [k, typeof v === 'string' ? v : JSON.stringify(v)]));
    const uuid = String(campos.uuid || '').trim();
    if (!/^[\w-]{8,64}$/.test(uuid)) return res.status(400).json({ error: 'uuid ausente.' });

    const [r] = await pool.query<any[]>(
      `SELECT d.*, c.empresa_id, c.negocio_id, c.pessoa_id, c.numero, c.titulo
         FROM contrato_documentos d JOIN contratos c ON c.id = d.contrato_id
        WHERE d.assinatura_envelope_id = ? AND d.assinatura_provedor = 'd4sign'`,
      [uuid],
    );
    // Documento desconhecido: 200 para a D4Sign não ficar repetindo o aviso
    if (!r.length) return res.json({ ok: true });
    const doc = r[0];
    const hmac = await hmacValido(String(doc.empresa_id), uuid, req.header('content-hmac')).catch(() => false);
    if (hmac === false) {
      console.warn(`D4Sign webhook: assinatura HMAC inválida para o documento ${uuid}.`);
      return res.status(401).json({ error: 'Content-Hmac inválido.' });
    }
    // Processa antes de responder: na Vercel a função pode ser congelada logo após a resposta.
    // Se algo falhar, a rotina de hora em hora corrige.
    try {
      // E-mail não entregue: só registra (com HMAC conferido, o texto vem mesmo da D4Sign)
      if (campos.type_post === '2' && hmac) {
        const email = emailDoAviso(campos).slice(0, 150);
        await historico(pool, { ...doc, id: doc.contrato_id }, `Contrato nº ${doc.numero}: a D4Sign não conseguiu entregar o e-mail de assinatura${email ? ` para ${email}` : ''}.`);
      }
      if (['enviado', 'visualizado'].includes(doc.assinatura_situacao)) await atualizarAssinatura(doc);
    } catch (err: any) {
      console.error(`D4Sign webhook: documento ${uuid}: ${err.message}`);
    }
    res.json({ ok: true });
  });
  return router;
}
