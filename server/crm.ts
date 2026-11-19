import { Router, Request, Response } from 'express';
import { pool } from './db.js';
import { aposGravar, sincronizarNegocio } from './regras.js';
import { exigirAcesso } from './permissoes.js';
import { friendlyDbError } from './crud.js';
import { calcularTotais, num } from './totais.js';
import { gerarPdf } from './pdf.js';
import { enviarEmail } from './email.js';
import { enviarMidiaWhatsApp, enviarPdfWhatsApp, telefoneWhatsApp } from './whatsapp.js';
import { anexosDaProposta, baixarAnexo } from './anexos.js';
import { htmlDocumento } from '../src/utils/imprimirDocumento.js';
import { lerConfig } from './config.js';
import { recalcularContrato } from './contratos.js';
import { linkAceite } from './aceite.js';
import { somaParcelas } from '../src/utils/parcelas.js';
import { refProposta, refPropostaArquivo } from '../src/utils/formatters.js';

/** Envolve a rota: qualquer exceção vira 400 com mensagem legível */
const rota =
  (fn: (req: Request, res: Response) => Promise<any>) =>
  async (req: Request, res: Response) => {
    try {
      await fn(req, res);
    } catch (err: any) {
      res.status(err.status || 400).json({ error: friendlyDbError(err) });
    }
  };

function erro(status: number, msg: string) {
  return Object.assign(new Error(msg), { status });
}

/** Executa em transação e devolve a conexão ao pool */
async function transacao<T>(fn: (conn: any) => Promise<T>): Promise<T> {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const r = await fn(conn);
    await conn.commit();
    return r;
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

const texto = (v: any) => (v === undefined || v === null || String(v).trim() === '' ? null : String(v));

/** Empresa (tenant) do usuário logado, resolvida pelo middleware de sessão em server.ts */
const empresaDa = (res: Response) => String(res.locals.empresaId);

/** Garante que o registro existe e é da empresa logada (ex.: contato informado numa proposta) */
async function exigirDaEmpresa(tabela: 'pessoas' | 'negocios', id: string | null, empresaId: string, rotulo: string) {
  if (!id) return;
  const [rows] = await pool.query<any[]>(`SELECT 1 FROM ${tabela} WHERE id = ? AND empresa_id = ?`, [id, empresaId]);
  if (!rows.length) throw new Error(`${rotulo} informado não existe nesta empresa.`);
}

/** Todos os produtos dos itens precisam ser do catálogo da empresa logada */
async function exigirProdutosDaEmpresa(produtoIds: string[], empresaId: string) {
  const unicos = [...new Set(produtoIds)];
  const [rows] = await pool.query<any[]>('SELECT COUNT(*) n FROM produtos WHERE id IN (?) AND empresa_id = ?', [unicos, empresaId]);
  if (Number(rows[0].n) !== unicos.length) throw new Error('Um dos produtos não existe no catálogo desta empresa.');
}

/** Chave primária: INT AUTO_INCREMENT no banco, texto quando vem da URL */
type Id = number | string;

type TipoDoc = 'proposta' | 'pedido';
const DOC = {
  proposta: { tabela: 'propostas', itens: 'proposta_itens', fk: 'proposta_id', numero: 'numero_proposta' },
  pedido: { tabela: 'pedidos', itens: 'pedido_itens', fk: 'pedido_id', numero: 'numero_pedido' },
} as const;

/**
 * Parcelas da proposta vindas do editor: vencimento válido, forma e valor positivo, e a soma igual ao total.
 * Sem parcelas (lista vazia) também vale.
 */
function conferirParcelas(lista: any, total: number) {
  if (!Array.isArray(lista) || !lista.length) return [];
  const parcelas = lista.map((p: any, i: number) => {
    const vencimento = String(p?.vencimento ?? '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(vencimento)) throw new Error(`Parcela ${i + 1}: informe o vencimento.`);
    const valor = Math.round(num(p?.valor) * 100) / 100;
    if (valor <= 0) throw new Error(`Parcela ${i + 1}: o valor deve ser maior que zero.`);
    const forma = String(p?.forma_pagamento ?? '').trim().slice(0, 30);
    if (!forma) throw new Error(`Parcela ${i + 1}: escolha a forma de pagamento.`);
    return { numero: i + 1, vencimento, forma_pagamento: forma, valor, ajustada: p?.ajustada === true ? 1 : 0 };
  });
  const soma = somaParcelas(parcelas.map((p) => p.valor));
  if (Math.round(soma * 100) !== Math.round(total * 100)) {
    const br = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
    throw new Error(`A soma das parcelas (${br(soma)}) é diferente do total (${br(total)}). Use "Recalcular" ou "Refazer Parcelas".`);
  }
  return parcelas;
}

/** Troca as parcelas do documento pelas conferidas (lista vazia = sem parcelas) */
async function gravarParcelas(conn: any, tipo: TipoDoc, id: number | string, parcelas: ReturnType<typeof conferirParcelas>) {
  const tabela = tipo === 'proposta' ? 'proposta_parcelas' : 'pedido_parcelas';
  const fk = DOC[tipo].fk;
  await conn.query(`DELETE FROM ${tabela} WHERE ${fk} = ?`, [id]);
  if (!parcelas.length) return;
  await conn.query(`INSERT INTO ${tabela} (${fk}, numero, vencimento, forma_pagamento, valor, ajustada) VALUES ?`, [
    parcelas.map((p) => [id, p.numero, p.vencimento, p.forma_pagamento, p.valor, p.ajustada]),
  ]);
}

/**
 * Documento com itens. "empresa_*" é a empresa logada (quem vende, no cabeçalho da impressão);
 * "pessoa_*" é o cliente.
 */
export async function lerDocumento(tipo: TipoDoc, id: string, empresaId: string) {
  const d = DOC[tipo];
  const [cab] = await pool.query<any[]>(
    `SELECT t.*, n.titulo AS negocio_titulo, p.nome AS pessoa_nome, p.email AS pessoa_email, p.telefone AS pessoa_telefone,
            p.whatsapp AS pessoa_whatsapp, p.cpf AS pessoa_cpf, e.nome AS empresa_nome, e.cnpj AS empresa_cnpj, e.endereco AS empresa_endereco, e.logo AS empresa_logo
       FROM ${d.tabela} t
       LEFT JOIN negocios n ON n.id = t.negocio_id
       LEFT JOIN pessoas p ON p.id = t.pessoa_id
       LEFT JOIN empresas e ON e.id = t.empresa_id
      WHERE t.id = ? AND t.empresa_id = ?`,
    [id, empresaId],
  );
  if (!cab.length) throw erro(404, `${tipo === 'proposta' ? 'Proposta' : 'Pedido'} não encontrado.`);
  const [itens] = await pool.query<any[]>(
    `SELECT i.id, i.produto_id, i.quantidade, i.preco_unitario, i.desconto, i.subtotal,
            pr.nome AS produto_nome, NULLIF(TRIM(pr.nome_proposta), '') AS nome_proposta, pr.codigo_sku, pr.unidade_medida, pr.grupo_id, g.nome AS grupo_nome
       FROM ${d.itens} i JOIN produtos pr ON pr.id = i.produto_id
       LEFT JOIN produtos_grupos g ON g.id = pr.grupo_id
      WHERE i.${d.fk} = ? ORDER BY i.criado_em, i.id`,
    [id],
  );
  // Pedido: número e versão da proposta de origem
  if (tipo === 'pedido' && cab[0].proposta_id) {
    const [pr] = await pool.query<any[]>('SELECT numero_proposta, versao, controle FROM propostas WHERE id = ?', [cab[0].proposta_id]);
    Object.assign(cab[0], { proposta_numero: pr[0]?.numero_proposta, proposta_versao: pr[0]?.versao, proposta_controle: pr[0]?.controle });
  }
  // Parcelas da condição de pagamento (vencimento, forma e valor); o pedido herda as da proposta ao aprovar
  const [parcelas] = await pool.query<any[]>(
    `SELECT numero, DATE_FORMAT(vencimento, '%Y-%m-%d') AS vencimento, forma_pagamento, valor, ajustada
       FROM ${tipo === 'proposta' ? 'proposta_parcelas' : 'pedido_parcelas'} WHERE ${d.fk} = ? ORDER BY numero`,
    [id],
  );
  return { ...cab[0], itens, parcelas };
}

async function gravarItens(conn: any, tipo: TipoDoc, id: Id, linhas: ReturnType<typeof calcularTotais>['linhas']) {
  const d = DOC[tipo];
  await conn.query(`DELETE FROM ${d.itens} WHERE ${d.fk} = ?`, [id]);
  // criado_em escalonado em 1s preserva a ordem digitada na releitura
  for (const [i, l] of linhas.entries()) {
    await conn.query(
      `INSERT INTO ${d.itens} (${d.fk}, produto_id, quantidade, preco_unitario, desconto, subtotal, criado_em)
       VALUES (?, ?, ?, ?, ?, ?, NOW() + INTERVAL ? SECOND)`,
      [id, l.produto_id, l.quantidade, l.preco_unitario, l.desconto, l.subtotal, i],
    );
  }
}

/** Contato do documento: o informado ou, na falta, o do negócio (sempre da empresa logada) */
async function vinculosDoNegocio(negocioId: string | null, empresaId: string) {
  if (!negocioId) return { pessoa_id: null };
  const [rows] = await pool.query<any[]>('SELECT pessoa_id FROM negocios WHERE id = ? AND empresa_id = ?', [negocioId, empresaId]);
  if (!rows.length) throw new Error('O negócio informado não existe nesta empresa.');
  return rows[0];
}

/**
 * Próximo número visível do documento (sequência por empresa). O id é do MySQL;
 * numero_proposta / numero_pedido é o número que o cliente enxerga.
 */
async function proximoNumero(conn: any, tabela: 'propostas' | 'pedidos', coluna: string, empresaId: string): Promise<number> {
  const [[{ n }]] = await conn.query(
    `SELECT COALESCE(MAX(${coluna}), 0) + 1 AS n FROM ${tabela} WHERE empresa_id = ? FOR UPDATE`,
    [empresaId],
  );
  return Number(n);
}

/**
 * Controle padrão da proposta: "AAAA/NNN", sequência por empresa dentro do ano (recomeça em
 * 001 a cada ano; o ano vem do MySQL, em horário de Brasília). Os controles editados à mão
 * fora desse formato não entram na conta. Chamar depois de proximoNumero, que trava a tabela.
 */
async function controleNovo(conn: any, empresaId: string): Promise<string> {
  const [[r]] = await conn.query(
    `SELECT YEAR(CURDATE()) AS ano,
            COALESCE(MAX(CAST(SUBSTRING_INDEX(SUBSTRING(controle, 6), '-', 1) AS UNSIGNED)), 0) + 1 AS seq
       FROM propostas
      WHERE empresa_id = ? AND controle REGEXP CONCAT('^', YEAR(CURDATE()), '/[0-9]+(-[0-9]+)?$')`,
    [empresaId],
  );
  return `${r.ano}/${String(r.seq).padStart(3, '0')}`;
}

/** Controle da versão: o da proposta sem sufixo + "-01", "-02"… (a versão 1 também leva sufixo) */
export function controleDaVersao(base: string, versao: number): string {
  const raiz = base.replace(/-\d+$/, '');
  return `${raiz}-${String(versao).padStart(2, '0')}`.slice(0, 30);
}

export async function registrarHistorico(
  conn: any,
  empresaId: string,
  dados: { negocio_id?: Id | null; proposta_id?: Id | null; pedido_id?: Id | null; pessoa_id?: Id | null; tipo?: 'nota' | 'email' | 'whatsapp'; descricao: string },
) {
  await conn.query(
    `INSERT INTO historico_interacoes (empresa_id, negocio_id, proposta_id, pedido_id, pessoa_id, tipo, descricao)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [empresaId, dados.negocio_id || null, dados.proposta_id || null, dados.pedido_id || null, dados.pessoa_id || null, dados.tipo || 'nota', dados.descricao],
  );
}

/**
 * Aprovação da proposta: passa a aceita, fecha as outras versões do mesmo número e gera o pedido.
 * Usada pelo botão Aprovar do CRM e pelo aceite do cliente no link (server/aceite.ts).
 */
export async function aprovarProposta(emp: string, id: string, como = 'aprovada pelo cliente'): Promise<{ pedidoId: number; numeroPedido: number }> {
  const p = await lerDocumento('proposta', id, emp);
  if (p.status === 'aceita') throw new Error('Esta proposta já foi aceita.');
  if (p.status === 'fechada') throw new Error('Proposta fechada: outra versão desta proposta já foi aceita.');
  if (!p.itens.length) throw new Error('A proposta não tem itens para gerar o pedido.');
  const gerado = await transacao(async (conn) => {
    // Uma versão aceita fecha a negociação: as demais versões da mesma proposta ficam "fechada"
    const [outras] = await conn.query(
      'SELECT id, versao, status FROM propostas WHERE empresa_id = ? AND numero_proposta = ? AND id <> ? FOR UPDATE',
      [emp, p.numero_proposta, p.id],
    );
    const jaAceita = (outras as any[]).find((o) => o.status === 'aceita');
    if (jaAceita) throw new Error(`A versão v${jaAceita.versao} desta proposta já foi aceita.`);
    await conn.query("UPDATE propostas SET status = 'aceita' WHERE id = ?", [p.id]);
    const fechadas = (outras as any[]).map((o) => o.versao).sort((a, b) => a - b);
    if (fechadas.length) {
      await conn.query(
        "UPDATE propostas SET status = 'fechada' WHERE empresa_id = ? AND numero_proposta = ? AND id <> ?",
        [emp, p.numero_proposta, p.id],
      );
    }
    const numeroPedido = await proximoNumero(conn, 'pedidos', 'numero_pedido', emp);
    const [novo] = await conn.query(
      `INSERT INTO pedidos (numero_pedido, negocio_id, proposta_id, pessoa_id, empresa_id, status, valor_subtotal, valor_desconto,
                            valor_total, condicao_pagamento, observacoes, data_emissao)
       VALUES (?, ?, ?, ?, ?, 'rascunho', ?, ?, ?, ?, ?, NOW())`,
      [numeroPedido, p.negocio_id, p.id, p.pessoa_id, p.empresa_id, p.valor_subtotal, p.valor_desconto, p.valor_total,
        p.condicoes_pagamento ? String(p.condicoes_pagamento).slice(0, 100) : null, p.observacoes],
    );
    const pedidoId = Number(novo.insertId);
    await conn.query(
      `INSERT INTO pedido_itens (pedido_id, produto_id, quantidade, preco_unitario, desconto, subtotal, criado_em)
       SELECT ?, produto_id, quantidade, preco_unitario, desconto, subtotal, criado_em
         FROM proposta_itens WHERE proposta_id = ?`,
      [pedidoId, p.id],
    );
    // As parcelas negociadas na proposta passam para o pedido
    await conn.query(
      `INSERT INTO pedido_parcelas (pedido_id, numero, vencimento, forma_pagamento, valor, ajustada)
       SELECT ?, numero, vencimento, forma_pagamento, valor, ajustada FROM proposta_parcelas WHERE proposta_id = ? ORDER BY numero`,
      [pedidoId, p.id],
    );
    await registrarHistorico(conn, emp, {
      negocio_id: p.negocio_id, proposta_id: p.id, pedido_id: pedidoId, pessoa_id: p.pessoa_id,
      descricao:
        `Proposta ${refProposta(p)} ${como}. Pedido #${numeroPedido} gerado.` +
        (fechadas.length ? ` Versões fechadas: ${fechadas.map((v) => `v${v}`).join(', ')}.` : ''),
    });
    await sincronizarNegocio(p.negocio_id, conn);
    return { pedidoId, numeroPedido };
  });
  return gerado;
}

export function createCrmRouter() {
  const router = Router();

  // ----------------------------------------------------------
  // Funis e Kanban
  // ----------------------------------------------------------
  router.get('/crm/funis', rota(async (_req, res) => {
    const emp = empresaDa(res);
    const [funis] = await pool.query<any[]>('SELECT id, nome FROM funis WHERE ativo = 1 AND empresa_id = ? ORDER BY ordem, nome', [emp]);
    const [etapas] = await pool.query<any[]>(
      'SELECT id, funil_id, nome, ordem, probabilidade, cor FROM etapas WHERE funil_id IN (SELECT id FROM funis WHERE empresa_id = ?) ORDER BY ordem, nome',
      [emp],
    );
    res.json(funis.map((f) => ({ ...f, etapas: etapas.filter((e) => e.funil_id === f.id) })));
  }));

  /** Cria um funil pronto para uso quando o banco ainda não tem nenhum */
  router.post('/crm/funis/padrao', rota(async (_req, res) => {
    const funilId = await transacao(async (conn) => {
      const [novo] = await conn.query('INSERT INTO funis (empresa_id, nome, ordem, ativo) VALUES (?, ?, 0, 1)', [empresaDa(res), 'Funil de Vendas']);
      const id = Number(novo.insertId);
      const etapas: [string, number][] = [
        ['Prospecção', 10], ['Qualificação', 25], ['Proposta Enviada', 50], ['Negociação', 75], ['Fechamento', 90],
      ];
      for (const [i, [nome, prob]] of etapas.entries()) {
        await conn.query('INSERT INTO etapas (funil_id, nome, ordem, probabilidade) VALUES (?, ?, ?, ?)', [id, nome, i + 1, prob]);
      }
      return id;
    });
    res.json({ success: true, id: funilId });
  }));

  /**
   * Atividades pendentes que o usuário executa ou que são do departamento dele (sem usuário definido):
   * a tela avisa quando aparece uma que não estava (criada por outra pessoa ou passada numa alteração)
   */
  // ponytail: devolve todas as pendentes do usuário; se alguém acumular milhares, trocar por "desde o último id/alteração"
  router.get('/crm/minhas-atividades', rota(async (_req, res) => {
    const [r] = await pool.query<any[]>(
      `SELECT a.id, a.assunto, DATE_FORMAT(a.data_vencimento, '%d/%m/%Y') AS vencimento, TIME_FORMAT(a.hora_vencimento, '%H:%i') AS hora,
              IF(a.executor_id IS NULL, d.nome, NULL) AS departamento
         FROM atividades a
         LEFT JOIN departamentos d ON d.id = a.departamento_id
        WHERE a.empresa_id = ? AND COALESCE(a.concluida, 0) = 0
          AND (a.executor_id = ?
               OR (a.executor_id IS NULL AND a.departamento_id = (SELECT u.departamento_id FROM usuarios u WHERE u.id = ?)))`,
      [empresaDa(res), res.locals.usuarioId, res.locals.usuarioId],
    );
    res.json(r);
  }));

  router.get('/crm/kanban/:funilId', rota(async (req, res) => {
    const [negocios] = await pool.query<any[]>(
      `SELECT n.id, n.titulo, n.valor, n.moeda, n.etapa_id, n.pessoa_id,
              n.data_fechamento_esperada, n.data_ultimo_contato, n.data_proximo_followup,
              p.nome AS pessoa_nome, p.telefone AS pessoa_telefone, n.proprietario_id, u.nome AS proprietario_nome,
              a.id AS prox_id, a.assunto AS prox_assunto, a.tipo AS prox_tipo,
              a.data_vencimento AS prox_data, a.hora_vencimento AS prox_hora,
              (SELECT COUNT(*) FROM atividades x WHERE x.negocio_id = n.id AND x.concluida = 0) AS pendentes
         FROM negocios n
         LEFT JOIN pessoas p ON p.id = n.pessoa_id
         LEFT JOIN usuarios u ON u.id = n.proprietario_id
         LEFT JOIN atividades a ON a.id = (
              SELECT a2.id FROM atividades a2
               WHERE a2.negocio_id = n.id AND a2.concluida = 0
               ORDER BY a2.data_vencimento, COALESCE(a2.hora_vencimento, '00:00:00')
               LIMIT 1)
        WHERE n.funil_id = ? AND n.empresa_id = ? AND n.status = 'aberto'
        ORDER BY n.criado_em`,
      [req.params.funilId, empresaDa(res)],
    );
    res.json(negocios.map((n) => ({ ...n, valor: Number(n.valor), pendentes: Number(n.pendentes) })));
  }));

  /** Arrastar o card para outra etapa do mesmo funil */
  router.patch('/crm/negocios/:id/etapa', rota(async (req, res) => {
    const etapaId = String(req.body?.etapa_id || '');
    const [r] = await pool.query<any>(
      `UPDATE negocios n JOIN etapas e ON e.id = ? AND e.funil_id = n.funil_id
          SET n.etapa_id = e.id
        WHERE n.id = ? AND n.empresa_id = ?`,
      [etapaId, req.params.id, empresaDa(res)],
    );
    if (!r.affectedRows) throw erro(404, 'Negócio ou etapa não encontrados neste funil.');
    res.json({ success: true });
  }));

  /** Ganho / perdido / reaberto / excluído */
  router.patch('/crm/negocios/:id/status', rota(async (req, res) => {
    const status = String(req.body?.status || '');
    if (!['aberto', 'ganho', 'perdido', 'excluido'].includes(status)) throw new Error('Status inválido.');
    const motivo = texto(req.body?.motivo_perda);
    if (status === 'perdido' && !motivo) throw new Error('Informe o motivo da perda.');
    const [r] = await pool.query<any>('UPDATE negocios SET status = ?, motivo_perda = ? WHERE id = ? AND empresa_id = ?', [status, motivo, req.params.id, empresaDa(res)]);
    if (!r.affectedRows) throw erro(404, 'Negócio não encontrado.');
    await aposGravar('negocios', req.params.id);
    res.json({ success: true });
  }));

  /** Tudo o que a ficha do negócio mostra, numa chamada só */
  router.get('/crm/negocios/:id', rota(async (req, res) => {
    const id = req.params.id;
    const [neg] = await pool.query<any[]>(
      `SELECT n.*, p.nome AS pessoa_nome, p.email AS pessoa_email, p.telefone AS pessoa_telefone, p.whatsapp AS pessoa_whatsapp,
              f.nome AS funil_nome, et.nome AS etapa_nome, u.nome AS proprietario_nome
         FROM negocios n
         LEFT JOIN pessoas p ON p.id = n.pessoa_id
         LEFT JOIN usuarios u ON u.id = n.proprietario_id
         LEFT JOIN funis f ON f.id = n.funil_id
         LEFT JOIN etapas et ON et.id = n.etapa_id
        WHERE n.id = ? AND n.empresa_id = ?`,
      [id, empresaDa(res)],
    );
    if (!neg.length) throw erro(404, 'Negócio não encontrado.');
    const [etapas] = await pool.query<any[]>('SELECT id, nome, ordem, probabilidade, cor FROM etapas WHERE funil_id = ? ORDER BY ordem, nome', [neg[0].funil_id]);
    const [atividades] = await pool.query<any[]>(
      `SELECT a.*, IF(a.executor_bot = 1, 'Bot', COALESCE(u.nome, d.nome)) AS quem_executa
         FROM atividades a LEFT JOIN usuarios u ON u.id = a.executor_id LEFT JOIN departamentos d ON d.id = a.departamento_id
        WHERE a.negocio_id = ? ORDER BY a.concluida, a.data_vencimento, COALESCE(a.hora_vencimento, '00:00:00')`,
      [id],
    );
    const [historico] = await pool.query<any[]>('SELECT * FROM historico_interacoes WHERE negocio_id = ? ORDER BY criado_em DESC', [id]);
    const [propostas] = await pool.query<any[]>('SELECT * FROM propostas WHERE negocio_id = ? ORDER BY versao DESC', [id]);
    const [pedidos] = await pool.query<any[]>('SELECT * FROM pedidos WHERE negocio_id = ? ORDER BY numero_pedido DESC', [id]);
    const [participantes] = await pool.query<any[]>(
      `SELECT np.usuario_id AS id, u.nome FROM negocios_participantes np JOIN usuarios u ON u.id = np.usuario_id
        WHERE np.negocio_id = ? ORDER BY u.nome`,
      [id],
    );
    res.json({ negocio: { ...neg[0], valor: Number(neg[0].valor) }, etapas, atividades, historico, propostas, pedidos, participantes });
  }));

  // ----------------------------------------------------------
  // Propostas
  // ----------------------------------------------------------
  router.get('/crm/propostas/:id', rota(async (req, res) => {
    res.json(await lerDocumento('proposta', req.params.id, empresaDa(res)));
  }));

  /**
   * Envia a proposta ou o pedido em PDF (o mesmo da impressão) por e-mail ou WhatsApp e registra
   * no histórico do negócio. Proposta em rascunho passa a "enviada" (pedido não tem esse status).
   */
  router.post('/crm/:tipo(propostas|pedidos)/:id/enviar', rota(async (req, res) => {
    const emp = empresaDa(res);
    const ehProposta = req.params.tipo === 'propostas';
    const canal = req.body?.canal;
    if (canal !== 'email' && canal !== 'whatsapp') throw erro(400, 'Canal de envio inválido.');
    const destino = String(req.body?.destino ?? '').trim();
    const mensagem = String(req.body?.mensagem ?? '').trim();
    if (canal === 'email' && !/^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/.test(destino)) throw erro(400, 'Informe um e-mail válido.');
    const telefone = canal === 'whatsapp' ? telefoneWhatsApp(destino) : '';

    const p = await lerDocumento(ehProposta ? 'proposta' : 'pedido', req.params.id, emp);
    if (ehProposta && p.status === 'fechada') throw erro(400, 'Proposta fechada: outra versão desta proposta foi aceita.');
    if (!ehProposta && p.status === 'cancelado') throw erro(400, 'Pedido cancelado não pode ser enviado.');
    // Como o documento aparece no assunto, no arquivo, no histórico e na tarefa de retorno
    const doc = ehProposta ? `Proposta ${refProposta(p)}` : `Pedido nº ${p.numero_pedido}`;
    const titulo = ehProposta ? p.titulo : p.negocio_titulo;
    const via = canal === 'email' ? 'e-mail' : 'WhatsApp';

    // Proposta ainda em negociação: o link para o cliente aprovar e assinar vai no fim da mensagem
    const link = ehProposta && !['aceita', 'recusada', 'fechada', 'expirada'].includes(p.status) ? await linkAceite(emp, p.id, req) : null;
    const corpo = link ? `${mensagem}

Para aprovar e assinar a proposta, acesse:
${link}` : mensagem;
    // Resumida: produtos agrupados pelo grupo (o cliente não vê o detalhe). Proposta vai sempre resumida
    const pdf = await gerarPdf(htmlDocumento(p, req.params.tipo as 'propostas' | 'pedidos', ehProposta || req.body?.resumida === true));
    const arquivo = ehProposta ? `Proposta ${refPropostaArquivo(p)}.pdf` : `Pedido ${p.numero_pedido}.pdf`;
    // Anexos da proposta vão junto: no e-mail, anexados (passando de 20 MB no total, vão como links no texto);
    // no WhatsApp, cada um numa mensagem logo depois do PDF
    const anexos = ehProposta ? await anexosDaProposta(emp, Number(p.numero_proposta)) : [];
    if (canal === 'email') {
      const assunto = ehProposta ? `Proposta ${refProposta(p)}` : `Pedido nº ${p.numero_pedido}`;
      const cabem = pdf.length + anexos.reduce((s, a) => s + a.tamanho, 0) <= 20 * 1024 * 1024;
      const arquivos = cabem ? await Promise.all(anexos.map(async (a) => ({ nome: a.nome, conteudo: await baixarAnexo(a.url) }))) : [];
      const texto = cabem || !anexos.length ? corpo : `${corpo}\n\nAnexos:\n${anexos.map((a) => `${a.nome}: ${a.url}`).join('\n')}`;
      await enviarEmail(emp, { para: destino, assunto: titulo ? `${assunto} — ${titulo}` : assunto, texto, anexos: [{ nome: arquivo, conteudo: pdf }, ...arquivos] });
    } else {
      // Proposta e pedido têm valores: ficam privados do departamento escolhido em Configurações › Vendas
      // (ex.: Comercial); sem escolha, do departamento de quem envia
      const privacidade = await lerConfig(emp, 'vendas', 'privacidade_envio');
      const reg = {
        pessoa_id: p.pessoa_id,
        usuario_id: res.locals.usuarioId,
        privado_departamento_id: Number(privacidade?.departamento_id) || res.locals.usuario?.departamento_id || null,
      };
      await enviarPdfWhatsApp(emp, telefone, pdf, arquivo, corpo, reg);
      for (const a of anexos) {
        const tipo = a.tipo?.startsWith('image/') ? 'imagem' : a.tipo?.startsWith('video/') ? 'video' : 'documento';
        const base64 = (await baixarAnexo(a.url)).toString('base64');
        await enviarMidiaWhatsApp(emp, telefone, { tipo, base64, mimetype: a.tipo || 'application/octet-stream', nome: a.nome, legenda: null }, reg);
      }
    }

    const status = ehProposta && p.status === 'rascunho' ? 'enviada' : p.status;
    if (status !== p.status) await pool.query("UPDATE propostas SET status = 'enviada' WHERE id = ?", [p.id]);
    await registrarHistorico(pool, emp, {
      negocio_id: p.negocio_id,
      proposta_id: ehProposta ? p.id : null,
      pedido_id: ehProposta ? null : p.id,
      pessoa_id: p.pessoa_id,
      tipo: canal,
      descricao: `${doc} enviad${ehProposta ? 'a' : 'o'} por ${via} para ${destino}.`,
    });
    // Follow-up do envio para o próximo dia útil (sexta e sábado pulam para segunda), se ligado
    // em Configurações › Vendas; sem configuração gravada, fica ligado
    const retorno = (await lerConfig(emp, 'vendas', 'retorno_envio'))?.ativo !== false;
    if (retorno) await pool.query(
      `INSERT INTO atividades (empresa_id, negocio_id, pessoa_id, assunto, tipo, data_vencimento, observacao)
       VALUES (?, ?, ?, 'Retorno Envio', 'tarefa',
               CURDATE() + INTERVAL (CASE DAYOFWEEK(CURDATE()) WHEN 6 THEN 3 WHEN 7 THEN 2 ELSE 1 END) DAY,
               CONCAT(?, DATE_FORMAT(CURDATE(), '%d/%m/%Y'), '.'))`,
      [
        emp,
        p.negocio_id,
        p.pessoa_id,
        `Contato para verificar se recebeu ${ehProposta ? 'a' : 'o'} ${doc.charAt(0).toLowerCase()}${doc.slice(1)}${titulo ? ` (${titulo})` : ''}, enviad${ehProposta ? 'a' : 'o'} por ${via} para ${destino} em `,
      ],
    );
    await sincronizarNegocio(p.negocio_id);
    res.json({ success: true, status, statusAlterado: status !== p.status, tarefaRetorno: retorno, link });
  }));

  /** Inclusão (sem :id) ou alteração da proposta com seus itens */
  const salvarProposta = rota(async (req, res) => {
    const b = req.body || {};
    const emp = empresaDa(res);
    const idExistente = req.params.id || null;
    if (!texto(b.titulo)) throw new Error('Informe o título da proposta.');
    if (!Array.isArray(b.itens) || !b.itens.length) throw new Error('Inclua pelo menos um produto na proposta.');
    const tot = calcularTotais(b.itens, b.desconto_adicional);
    const parcelas = conferirParcelas(b.parcelas, tot.total);

    let negocioId: string;
    if (idExistente) {
      const [atual] = await pool.query<any[]>('SELECT negocio_id, status FROM propostas WHERE id = ? AND empresa_id = ?', [idExistente, emp]);
      if (!atual.length) throw erro(404, 'Proposta não encontrada.');
      if (atual[0].status === 'aceita') throw new Error('Proposta aceita não pode mais ser alterada. Para uma nova negociação, use Clonar.');
      if (atual[0].status === 'fechada') throw new Error('Proposta fechada: outra versão desta proposta foi aceita. Ela não pode mais ser alterada.');
      negocioId = atual[0].negocio_id;
    } else {
      negocioId = String(b.negocio_id || '');
      if (!negocioId) throw new Error('Escolha o negócio da proposta.');
    }
    const vinc = await vinculosDoNegocio(negocioId, emp);
    await exigirDaEmpresa('pessoas', texto(b.pessoa_id), emp, 'O contato');
    await exigirProdutosDaEmpresa(tot.linhas.map((l) => l.produto_id), emp);
    const validadeDias = Math.max(0, Math.trunc(num(b.validade_dias ?? 15)));
    const status = ['rascunho', 'enviada', 'recusada', 'expirada'].includes(b.status) ? b.status : 'rascunho';

    const id = await transacao(async (conn) => {
      const cab = [
        String(b.titulo), texto(b.pessoa_id) ?? vinc.pessoa_id, emp, status,
        tot.subtotal, tot.desconto, tot.total, validadeDias, texto(b.condicoes_pagamento), texto(b.observacoes),
      ];
      let propostaId: number | string | null = idExistente;
      const controle = texto(b.controle)?.slice(0, 30) ?? null;
      // Impressão resumida do editor (envio e link de aprovação saem sempre resumidos)
      const resumida = b.impressao_resumida === true || b.impressao_resumida === 1 || b.impressao_resumida === '1' ? 1 : 0;
      if (propostaId) {
        await conn.query(
          `UPDATE propostas SET titulo = ?, pessoa_id = ?, empresa_id = ?, status = ?, valor_subtotal = ?, valor_desconto = ?,
                  valor_total = ?, validade_dias = ?, condicoes_pagamento = ?, observacoes = ?,
                  data_validade = DATE_ADD(DATE(criado_em), INTERVAL ? DAY), controle = ?, impressao_resumida = ?
            WHERE id = ? AND empresa_id = ?`,
          [...cab, validadeDias, controle, resumida, propostaId, emp],
        );
      } else {
        // Proposta nova = número novo, começando na versão 1 (as versões são por número)
        const v = 1;
        const numero = await proximoNumero(conn, 'propostas', 'numero_proposta', emp);
        // Em branco: controle padrão AAAA/NNN-01
        const ctrl = controle ?? controleDaVersao(await controleNovo(conn, emp), 1);
        const [nova] = await conn.query(
          `INSERT INTO propostas (titulo, pessoa_id, empresa_id, status, valor_subtotal, valor_desconto, valor_total,
                                  validade_dias, condicoes_pagamento, observacoes, data_validade, negocio_id, versao, numero_proposta, controle, impressao_resumida)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, DATE_ADD(CURDATE(), INTERVAL ? DAY), ?, ?, ?, ?, ?)`,
          [...cab, validadeDias, negocioId, v, numero, ctrl, resumida],
        );
        propostaId = Number(nova.insertId);
      }
      await gravarItens(conn, 'proposta', propostaId!, tot.linhas);
      await gravarParcelas(conn, 'proposta', propostaId!, parcelas);
      return propostaId!;
    });
    res.json({ success: true, id });
  });
  router.post('/crm/propostas', salvarProposta);
  router.put('/crm/propostas/:id', salvarProposta);

  /** Renegociação: clona a proposta como a próxima versão do negócio */
  router.post('/crm/propostas/:id/versao', rota(async (req, res) => {
    const emp = empresaDa(res);
    const origem = await lerDocumento('proposta', req.params.id, emp);
    // Negociação encerrada (uma versão aceita): nova rodada é outra proposta, via Clonar
    const [aceitas] = await pool.query<any[]>(
      "SELECT versao FROM propostas WHERE empresa_id = ? AND numero_proposta = ? AND status = 'aceita' LIMIT 1",
      [emp, origem.numero_proposta],
    );
    if (aceitas.length) {
      throw new Error(`A versão v${aceitas[0].versao} desta proposta já foi aceita: a negociação está fechada. Para uma nova negociação, use Clonar.`);
    }
    const novoId = await transacao(async (conn) => {
      const [[{ v }]] = await conn.query(
        'SELECT COALESCE(MAX(versao), 0) + 1 AS v FROM propostas WHERE empresa_id = ? AND numero_proposta = ? FOR UPDATE',
        [emp, origem.numero_proposta],
      );
      // A nova versão mantém o número da proposta: muda só o "v"; o controle ganha o sufixo "-0v".
      // Proposta antiga sem controle ganha um controle novo antes do sufixo.
      const controle = controleDaVersao(origem.controle || (await controleNovo(conn, emp)), v);
      const [nova] = await conn.query(
        `INSERT INTO propostas (versao, numero_proposta, negocio_id, pessoa_id, empresa_id, titulo, status, valor_subtotal, valor_desconto,
                                valor_total, validade_dias, data_validade, condicoes_pagamento, observacoes, controle, impressao_resumida)
         SELECT ?, numero_proposta, negocio_id, pessoa_id, empresa_id, titulo, 'rascunho', valor_subtotal, valor_desconto,
                valor_total, validade_dias, DATE_ADD(CURDATE(), INTERVAL COALESCE(validade_dias, 0) DAY), condicoes_pagamento, observacoes, ?, impressao_resumida
           FROM propostas WHERE id = ?`,
        [v, controle, origem.id],
      );
      const novoId = Number(nova.insertId);
      await conn.query(
        `INSERT INTO proposta_itens (proposta_id, produto_id, quantidade, preco_unitario, desconto, subtotal, criado_em)
         SELECT ?, produto_id, quantidade, preco_unitario, desconto, subtotal, criado_em
           FROM proposta_itens WHERE proposta_id = ?`,
        [novoId, origem.id],
      );
      // Parcelas (vencimento, forma e valor) vão junto
      await conn.query(
        `INSERT INTO proposta_parcelas (proposta_id, numero, vencimento, forma_pagamento, valor, ajustada)
         SELECT ?, numero, vencimento, forma_pagamento, valor, ajustada FROM proposta_parcelas WHERE proposta_id = ? ORDER BY numero`,
        [novoId, origem.id],
      );
      // A versão enviada deixa de valer: o cliente pediu renegociação
      if (origem.status === 'enviada') await conn.query("UPDATE propostas SET status = 'recusada' WHERE id = ?", [origem.id]);
      await registrarHistorico(conn, emp, {
        negocio_id: origem.negocio_id, proposta_id: novoId, pessoa_id: origem.pessoa_id,
        descricao: `Renegociação: proposta ${refProposta(origem)} gerou a versão ${refProposta({ controle, numero_proposta: origem.numero_proposta, versao: v })}.`,
      });
      await sincronizarNegocio(origem.negocio_id, conn);
      return novoId;
    });
    res.json({ success: true, id: novoId });
  }));

  /**
   * Clonar: cópia da proposta como proposta nova (número próprio, v1, rascunho), sem negócio (o editar não
   * troca o negócio de uma proposta que já tem um); o cliente vai junto, o do negócio se a proposta não tinha
   */
  router.post('/crm/propostas/:id/clonar', rota(async (req, res) => {
    const emp = empresaDa(res);
    const origem = await lerDocumento('proposta', req.params.id, emp);
    const pessoaId = origem.pessoa_id ?? (await vinculosDoNegocio(origem.negocio_id, emp).catch(() => ({ pessoa_id: null }))).pessoa_id;
    const novo = await transacao(async (conn) => {
      const numero = await proximoNumero(conn, 'propostas', 'numero_proposta', emp);
      const controle = controleDaVersao(await controleNovo(conn, emp), 1);
      const [nova] = await conn.query(
        `INSERT INTO propostas (controle, versao, numero_proposta, negocio_id, pessoa_id, empresa_id, titulo, status, valor_subtotal, valor_desconto,
                                valor_total, validade_dias, data_validade, condicoes_pagamento, observacoes, impressao_resumida)
         SELECT ?, 1, ?, NULL, ?, empresa_id, LEFT(CONCAT(titulo, ' (cópia)'), 255), 'rascunho', valor_subtotal, valor_desconto,
                valor_total, validade_dias, DATE_ADD(CURDATE(), INTERVAL COALESCE(validade_dias, 0) DAY), condicoes_pagamento, observacoes, impressao_resumida
           FROM propostas WHERE id = ? AND empresa_id = ?`,
        [controle, numero, pessoaId, origem.id, emp],
      );
      const id = Number(nova.insertId);
      await conn.query(
        `INSERT INTO proposta_itens (proposta_id, produto_id, quantidade, preco_unitario, desconto, subtotal)
         SELECT ?, produto_id, quantidade, preco_unitario, desconto, subtotal FROM proposta_itens WHERE proposta_id = ? ORDER BY id`,
        [id, origem.id],
      );
      // Parcelas (vencimento, forma e valor) vão junto
      await conn.query(
        `INSERT INTO proposta_parcelas (proposta_id, numero, vencimento, forma_pagamento, valor, ajustada)
         SELECT ?, numero, vencimento, forma_pagamento, valor, ajustada FROM proposta_parcelas WHERE proposta_id = ? ORDER BY numero`,
        [id, origem.id],
      );
      await registrarHistorico(conn, emp, {
        negocio_id: origem.negocio_id, proposta_id: id, pessoa_id: pessoaId,
        descricao: `Proposta ${refProposta(origem)} clonada como proposta ${refProposta({ controle, numero_proposta: numero, versao: 1 })}.`,
      });
      return { id, numero };
    });
    res.json({ success: true, id: novo.id, numero_proposta: novo.numero, titulo: `${origem.titulo} (cópia)`.slice(0, 255) });
  }));

  /** Aprovar Proposta e Gerar Pedido */
  /**
   * Gera o contrato da proposta aceita: título, cliente, negócio e itens copiados; nasce em
   * rascunho, começando hoje, 12 meses, mensal e com renovação automática, para ajustar
   * antes de mandar assinar. Uma proposta gera um contrato só.
   */
  router.post('/crm/propostas/:id/contrato', rota(async (req, res) => {
    const emp = empresaDa(res);
    const p = await lerDocumento('proposta', req.params.id, emp);
    if (p.status !== 'aceita') throw erro(400, 'Só a proposta aceita gera contrato.');
    const [existe] = await pool.query<any[]>('SELECT numero FROM contratos WHERE proposta_id = ? AND empresa_id = ? LIMIT 1', [p.id, emp]);
    if (existe.length) throw erro(400, `Esta proposta já gerou o contrato nº ${existe[0].numero}.`);
    const pessoaId = p.pessoa_id ?? (await vinculosDoNegocio(p.negocio_id, emp)).pessoa_id;
    if (!pessoaId) throw erro(400, 'A proposta (e o negócio dela) não tem cliente: informe o contato antes de gerar o contrato.');

    const contrato = await transacao(async (conn) => {
      const [[n]] = await conn.query('SELECT COALESCE(MAX(numero), 0) + 1 AS n FROM contratos WHERE empresa_id = ? FOR UPDATE', [emp]);
      const [r] = await conn.query(
        `INSERT INTO contratos (empresa_id, numero, titulo, pessoa_id, negocio_id, proposta_id, proprietario_id, tipo, situacao,
                                data_inicio, data_fim, renovacao_automatica, periodicidade, observacoes)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'recorrente', 'rascunho', CURDATE(), CURDATE() + INTERVAL 12 MONTH - INTERVAL 1 DAY, 1, 'mensal', ?)`,
        [emp, n.n, p.titulo, pessoaId, p.negocio_id, p.id, res.locals.usuario.id, p.condicoes_pagamento || null],
      );
      await conn.query(
        `INSERT INTO contrato_itens (contrato_id, produto_id, quantidade, preco_unitario, desconto, subtotal)
         SELECT ?, produto_id, quantidade, preco_unitario, desconto, subtotal FROM proposta_itens WHERE proposta_id = ? ORDER BY criado_em, id`,
        [r.insertId, p.id],
      );
      await recalcularContrato(r.insertId, conn);
      await conn.query(
        `INSERT INTO historico_interacoes (empresa_id, negocio_id, proposta_id, pessoa_id, contrato_id, tipo, descricao) VALUES (?, ?, ?, ?, ?, 'nota', ?)`,
        [emp, p.negocio_id, p.id, pessoaId, r.insertId, `Contrato nº ${n.n} gerado da proposta ${refProposta(p)}.`],
      );
      return { id: r.insertId, numero: n.n };
    });
    if (p.negocio_id) await sincronizarNegocio(p.negocio_id);
    res.json({ success: true, ...contrato });
  }));

  /** Link de aceite para o cliente (o mesmo que vai no envio), para copiar e mandar por outro meio */
  router.post('/crm/propostas/:id/link', rota(async (req, res) => {
    const emp = empresaDa(res);
    const p = await lerDocumento('proposta', req.params.id, emp);
    if (['aceita', 'recusada', 'fechada', 'expirada'].includes(p.status)) throw new Error('Esta proposta não está mais em negociação: o link não serve para ela.');
    res.json({ link: await linkAceite(emp, p.id, req) });
  }));

  router.post('/crm/propostas/:id/aprovar', rota(async (req, res) => {
    const gerado = await aprovarProposta(empresaDa(res), req.params.id);
    res.json({ success: true, id: gerado.pedidoId, numero_pedido: gerado.numeroPedido });
  }));

  // ----------------------------------------------------------
  // Pedidos
  // ----------------------------------------------------------
  router.get('/crm/pedidos/:id', rota(async (req, res) => {
    res.json(await lerDocumento('pedido', req.params.id, empresaDa(res)));
  }));

  const STATUS_PEDIDO = ['rascunho', 'aguardando_aprovacao', 'aprovado', 'faturado', 'cancelado'];
  const salvarPedido = rota(async (req, res) => {
    const b = req.body || {};
    const emp = empresaDa(res);
    const idExistente = req.params.id || null;
    const status = STATUS_PEDIDO.includes(b.status) ? b.status : 'rascunho';

    if (idExistente) {
      const [atual] = await pool.query<any[]>('SELECT status FROM pedidos WHERE id = ? AND empresa_id = ?', [idExistente, emp]);
      if (!atual.length) throw erro(404, 'Pedido não encontrado.');
      // Faturado ou cancelado: só o status pode mudar (ex.: estorno de um cancelamento indevido)
      if (['faturado', 'cancelado'].includes(atual[0].status)) {
        await pool.query('UPDATE pedidos SET status = ? WHERE id = ? AND empresa_id = ?', [status, idExistente, emp]);
        return res.json({ success: true, id: idExistente });
      }
    }

    if (!Array.isArray(b.itens) || !b.itens.length) throw new Error('Inclua pelo menos um produto no pedido.');
    const tot = calcularTotais(b.itens, b.desconto_adicional);
    const parcelas = conferirParcelas(b.parcelas, tot.total);
    const negocioId = texto(b.negocio_id);
    const vinc = await vinculosDoNegocio(negocioId, emp);
    await exigirDaEmpresa('pessoas', texto(b.pessoa_id), emp, 'O contato');
    await exigirProdutosDaEmpresa(tot.linhas.map((l) => l.produto_id), emp);

    const id = await transacao(async (conn) => {
      const cab = [
        negocioId, texto(b.pessoa_id) ?? vinc.pessoa_id, emp, status,
        tot.subtotal, tot.desconto, tot.total, texto(b.condicao_pagamento)?.slice(0, 100) ?? null, texto(b.observacoes),
      ];
      let pedidoId: number | string | null = idExistente;
      if (pedidoId) {
        await conn.query(
          `UPDATE pedidos SET negocio_id = ?, pessoa_id = ?, empresa_id = ?, status = ?, valor_subtotal = ?, valor_desconto = ?,
                  valor_total = ?, condicao_pagamento = ?, observacoes = ?
            WHERE id = ? AND empresa_id = ?`,
          [...cab, pedidoId, emp],
        );
      } else {
        const numeroPedido = await proximoNumero(conn, 'pedidos', 'numero_pedido', emp);
        const [novo] = await conn.query(
          `INSERT INTO pedidos (negocio_id, pessoa_id, empresa_id, status, valor_subtotal, valor_desconto, valor_total,
                                condicao_pagamento, observacoes, numero_pedido, data_emissao)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
          [...cab, numeroPedido],
        );
        pedidoId = Number(novo.insertId);
      }
      await gravarItens(conn, 'pedido', pedidoId!, tot.linhas);
      await gravarParcelas(conn, 'pedido', pedidoId!, parcelas);
      return pedidoId!;
    });
    res.json({ success: true, id });
  });
  router.post('/crm/pedidos', salvarPedido);
  router.put('/crm/pedidos/:id', salvarPedido);

  /**
   * Clonar: cópia do pedido como pedido novo (número próprio, rascunho, emitido agora).
   * Fica no mesmo negócio e cliente, mas sem a proposta de origem: não veio de uma aprovação.
   */
  router.post('/crm/pedidos/:id/clonar', rota(async (req, res) => {
    const emp = empresaDa(res);
    const origem = await lerDocumento('pedido', req.params.id, emp);
    const novo = await transacao(async (conn) => {
      const numero = await proximoNumero(conn, 'pedidos', 'numero_pedido', emp);
      const [nova] = await conn.query(
        `INSERT INTO pedidos (numero_pedido, negocio_id, pessoa_id, empresa_id, status, valor_subtotal, valor_desconto, valor_total,
                              condicao_pagamento, observacoes, data_emissao)
         SELECT ?, negocio_id, pessoa_id, empresa_id, 'rascunho', valor_subtotal, valor_desconto, valor_total,
                condicao_pagamento, observacoes, NOW()
           FROM pedidos WHERE id = ? AND empresa_id = ?`,
        [numero, origem.id, emp],
      );
      const id = Number(nova.insertId);
      await conn.query(
        `INSERT INTO pedido_itens (pedido_id, produto_id, quantidade, preco_unitario, desconto, subtotal)
         SELECT ?, produto_id, quantidade, preco_unitario, desconto, subtotal FROM pedido_itens WHERE pedido_id = ? ORDER BY id`,
        [id, origem.id],
      );
      await conn.query(
        `INSERT INTO pedido_parcelas (pedido_id, numero, vencimento, forma_pagamento, valor, ajustada)
         SELECT ?, numero, vencimento, forma_pagamento, valor, ajustada FROM pedido_parcelas WHERE pedido_id = ? ORDER BY numero`,
        [id, origem.id],
      );
      await registrarHistorico(conn, emp, {
        negocio_id: origem.negocio_id, pedido_id: id, pessoa_id: origem.pessoa_id,
        descricao: `Pedido #${origem.numero_pedido} clonado como pedido #${numero}.`,
      });
      return { id, numero };
    });
    res.json({ success: true, id: novo.id, numero_pedido: novo.numero });
  }));

  /**
   * Clonar produto: cópia com "(cópia)" no nome, sem SKU nem código de integração (são únicos na empresa)
   * e sem as fotos (são do produto original: excluir na cópia apagaria o arquivo da original)
   */
  router.post('/crm/produtos/:id/clonar', rota(async (req, res) => {
    exigirAcesso(res, 'produtos', 'Produtos');
    const emp = empresaDa(res);
    const [r] = await pool.query<any>(
      `INSERT INTO produtos (empresa_id, nome, descricao, preco_tabela, unidade_medida, ativo)
       SELECT empresa_id, LEFT(CONCAT(nome, ' (cópia)'), 255), descricao, preco_tabela, unidade_medida, ativo
         FROM produtos WHERE id = ? AND empresa_id = ?`,
      [req.params.id, emp],
    );
    if (!r.affectedRows) throw erro(404, 'Produto não encontrado.');
    res.json({ success: true, id: Number(r.insertId) });
  }));

  /** Produtos ativos para a pesquisa dos editores de proposta e pedido */
  /**
   * TEMPORÁRIO (para testes; tirar depois): volta a proposta aceita/recusada para "enviada", como antes da
   * resposta do cliente. Apaga a assinatura e o pedido em rascunho gerado por ela; as outras versões, fechadas
   * pela aceitação, voltam a "recusada". Só administrador; recusa se o pedido já andou ou se há contrato.
   */
  router.post('/crm/propostas/:id/reverter', rota(async (req, res) => {
    if (res.locals.usuario?.tipo !== 'admin') throw erro(403, 'Só o administrador pode reverter a proposta.');
    const emp = empresaDa(res);
    const p = await lerDocumento('proposta', req.params.id, emp);
    if (!['aceita', 'recusada'].includes(p.status) && !p.aceite_em) throw erro(400, 'A proposta não foi aceita nem recusada: não há o que reverter.');
    const [ped] = await pool.query<any[]>('SELECT id, numero_pedido, status FROM pedidos WHERE proposta_id = ? AND empresa_id = ?', [p.id, emp]);
    const andou = ped.find((x) => x.status !== 'rascunho');
    if (andou) throw erro(400, `O pedido nº ${andou.numero_pedido} gerado por esta proposta já saiu do rascunho: não dá para reverter.`);
    const [ct] = await pool.query<any[]>('SELECT id FROM contratos WHERE proposta_id = ? AND empresa_id = ? LIMIT 1', [p.id, emp]);
    if (ct.length) throw erro(400, 'Esta proposta já gerou um contrato: não dá para reverter.');
    await transacao(async (conn) => {
      if (ped.length) await conn.query('DELETE FROM pedidos WHERE id IN (?) AND empresa_id = ?', [ped.map((x) => x.id), emp]);
      await conn.query(
        `UPDATE propostas SET status = 'enviada', aceite_em = NULL, aceite_nome = NULL, aceite_documento = NULL, aceite_ip = NULL,
                aceite_navegador = NULL, aceite_assinatura = NULL, aceite_hash = NULL
          WHERE id = ? AND empresa_id = ?`,
        [p.id, emp],
      );
      if (p.status === 'aceita') {
        await conn.query("UPDATE propostas SET status = 'recusada' WHERE empresa_id = ? AND numero_proposta = ? AND id <> ? AND status = 'fechada'", [
          emp,
          p.numero_proposta,
          p.id,
        ]);
      }
      await registrarHistorico(conn, emp, {
        negocio_id: p.negocio_id, proposta_id: p.id, pessoa_id: p.pessoa_id,
        descricao: `Proposta ${refProposta(p)} revertida para Enviada (teste)${ped.length ? `; pedido #${ped.map((x) => x.numero_pedido).join(', #')} excluído` : ''}.`,
      });
      await sincronizarNegocio(p.negocio_id, conn);
    });
    res.json({ success: true, pedidos_excluidos: ped.length });
  }));

  /** Condições de pagamento ativas, com os prazos e a forma padrão, para o editor gerar as parcelas */
  router.get('/crm/condicoes-pagamento', rota(async (_req, res) => {
    const [rows] = await pool.query<any[]>(
      'SELECT id, nome, prazos, forma_pagamento FROM condicoes_pagamento WHERE empresa_id = ? AND ativo = 1 ORDER BY nome',
      [empresaDa(res)],
    );
    res.json(rows);
  }));

  router.get('/crm/produtos', rota(async (req, res) => {
    const q = `%${String(req.query.q || '').trim()}%`;
    const [rows] = await pool.query<any[]>(
      `SELECT id, codigo_sku, nome, preco_tabela, unidade_medida FROM produtos
        WHERE ativo = 1 AND empresa_id = ? AND (nome LIKE ? OR codigo_sku LIKE ? OR descricao LIKE ?)
        ORDER BY nome LIMIT 20`,
      [empresaDa(res), q, q, q],
    );
    res.json(rows.map((r) => ({ ...r, preco_tabela: Number(r.preco_tabela) })));
  }));

  // ----------------------------------------------------------
  // Painel
  // ----------------------------------------------------------
  router.get('/crm/dashboard', rota(async (_req, res) => {
    exigirAcesso(res, 'dashboard', 'o Painel de Vendas');
    // Cada consulta leva um único "?": a empresa logada
    const emp = empresaDa(res);
    const um = async (sql: string) => ((await pool.query<any[]>(sql, [emp]))[0][0] || {}) as Record<string, any>;
    const varios = async (sql: string) => (await pool.query<any[]>(sql, [emp]))[0];

    const abertos = await um(
      `SELECT COUNT(*) qtd, COALESCE(SUM(n.valor), 0) valor, COALESCE(SUM(n.valor * COALESCE(e.probabilidade, 100) / 100), 0) ponderado
         FROM negocios n LEFT JOIN etapas e ON e.id = n.etapa_id WHERE n.status = 'aberto' AND n.empresa_id = ?`,
    );
    const mes = await um(
      `SELECT COALESCE(SUM(status = 'ganho'), 0) ganhos_qtd,
              COALESCE(SUM(IF(status = 'ganho', valor, 0)), 0) ganhos_valor,
              COALESCE(SUM(status = 'perdido'), 0) perdidos_qtd,
              COALESCE(SUM(IF(status = 'perdido', valor, 0)), 0) perdidos_valor
         FROM negocios
        WHERE empresa_id = ?
          AND ((status = 'ganho' AND data_ganho >= DATE_FORMAT(CURDATE(), '%Y-%m-01'))
            OR (status = 'perdido' AND data_perda >= DATE_FORMAT(CURDATE(), '%Y-%m-01')))`,
    );
    const ativ = await um(
      `SELECT COALESCE(SUM(data_vencimento < CURDATE()), 0) atrasadas, COALESCE(SUM(data_vencimento = CURDATE()), 0) hoje
         FROM atividades WHERE concluida = 0 AND empresa_id = ?`,
    );
    const semAtividade = await um(
      `SELECT COUNT(*) qtd FROM negocios n WHERE n.status = 'aberto' AND n.empresa_id = ?
          AND NOT EXISTS (SELECT 1 FROM atividades a WHERE a.negocio_id = n.id AND a.concluida = 0)`,
    );
    const porEtapa = await varios(
      `SELECT f.nome funil, e.nome etapa, COUNT(n.id) qtd, COALESCE(SUM(n.valor), 0) valor
         FROM etapas e JOIN funis f ON f.id = e.funil_id AND f.ativo = 1 AND f.empresa_id = ?
         LEFT JOIN negocios n ON n.etapa_id = e.id AND n.status = 'aberto'
        GROUP BY f.id, f.nome, f.ordem, e.id, e.nome, e.ordem ORDER BY f.ordem, f.nome, e.ordem`,
    );
    const propostas = await varios("SELECT status, COUNT(*) qtd, COALESCE(SUM(valor_total), 0) valor FROM propostas WHERE empresa_id = ? AND status <> 'fechada' GROUP BY status");
    const pedidos = await varios("SELECT status, COUNT(*) qtd, COALESCE(SUM(valor_total), 0) valor FROM pedidos WHERE empresa_id = ? AND status <> 'cancelado' GROUP BY status");
    const proximas = await varios(
      `SELECT a.id, a.assunto, a.tipo, a.data_vencimento, a.hora_vencimento, a.negocio_id, n.titulo negocio_titulo, c.numero chamado_numero
         FROM atividades a LEFT JOIN negocios n ON n.id = a.negocio_id LEFT JOIN chamados c ON c.id = a.chamado_id
        WHERE a.concluida = 0 AND a.empresa_id = ?
        ORDER BY a.data_vencimento, COALESCE(a.hora_vencimento, '00:00:00') LIMIT 10`,
    );

    // Pesquisa de satisfação do mês (avaliações respondidas): média geral e por atendente (sem = bot/jornada)
    const satisfacao = await um(
      `SELECT ROUND(AVG(nota), 1) media, COUNT(*) qtd FROM avaliacoes
        WHERE empresa_id = ? AND nota IS NOT NULL AND pedida_em >= DATE_FORMAT(CURDATE(), '%Y-%m-01')`,
    ).catch(() => ({ media: null, qtd: 0 })); // sem a tabela: sem o card
    const satisfacaoPorAtendente = await varios(
      `SELECT COALESCE(u.nome, 'Bot / automação') nome, ROUND(AVG(a.nota), 1) media, COUNT(*) qtd
         FROM avaliacoes a LEFT JOIN usuarios u ON u.id = a.atendente_id
        WHERE a.empresa_id = ? AND a.nota IS NOT NULL AND a.pedida_em >= DATE_FORMAT(CURDATE(), '%Y-%m-01')
        GROUP BY a.atendente_id, u.nome ORDER BY media DESC, qtd DESC`,
    ).catch(() => [] as any[]);

    const n = (o: Record<string, any>) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, typeof v === 'string' && /^-?\d+(\.\d+)?$/.test(v) ? Number(v) : v]));
    res.json({
      abertos: n(abertos),
      mes: n(mes),
      atividades: { ...n(ativ), negocios_sem_atividade: Number(semAtividade.qtd || 0) },
      porEtapa: porEtapa.map(n),
      propostas: propostas.map(n),
      pedidos: pedidos.map(n),
      proximas,
      satisfacao: { media: satisfacao.media == null ? null : Number(satisfacao.media), qtd: Number(satisfacao.qtd || 0), porAtendente: satisfacaoPorAtendente.map(n) },
    });
  }));

  return router;
}
