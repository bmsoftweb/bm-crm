import { Router, Request, Response } from 'express';
import { del, put } from '@vercel/blob';
import { pool } from './db.js';
import { exigirAcesso } from './permissoes.js';
import { antesDeGravar, aposGravar } from './regras.js';

/**
 * Ordens de Serviço: o cadastro é o CRUD genérico (schema.ts); aqui fica o que a tela genérica não faz.
 * A OS completa para impressão e a sincronização do app do técnico (/tecnico), fotos de antes e depois inclusive.
 */

/** Foto já reduzida no aparelho (1600 px, JPEG); folga para foto com muito detalhe */
const MAX_FOTO = 1_500_000;
const MAX_FOTOS_POR_MOMENTO = 10;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function erro(status: number, msg: string) {
  return Object.assign(new Error(msg), { status });
}

/** OS do técnico logado e ainda dele: cancelada ou passada para outro recusa (409) */
async function osDoTecnico(id: string, res: Response): Promise<{ status: string }> {
  exigirAcesso(res, 'ordens_servico', 'as ordens de serviço');
  const [r] = await pool.query<any[]>('SELECT status, tecnico_id FROM ordens_servico WHERE id = ? AND empresa_id = ?', [id, res.locals.empresaId]);
  const os = r[0];
  if (!os) throw erro(404, 'A OS não existe mais.');
  if (Number(os.tecnico_id) !== Number(res.locals.usuarioId)) throw erro(409, 'A OS foi passada para outro técnico.');
  if (os.status === 'cancelada') throw erro(409, 'A OS foi cancelada pelo escritório.');
  return os;
}

/** Fotos das OS: { os_id: [{ uuid, momento, url }] } */
async function fotosDas(ids: number[]): Promise<Record<number, { uuid: string; momento: string; url: string }[]>> {
  if (!ids.length) return {};
  const [r] = await pool.query<any[]>('SELECT os_id, uuid, momento, url FROM os_fotos WHERE os_id IN (?) ORDER BY id', [ids]);
  const mapa: Record<number, any[]> = {};
  for (const f of r) (mapa[f.os_id] ??= []).push({ uuid: f.uuid, momento: f.momento, url: f.url });
  return mapa;
}

/** Data e hora da tela ("aaaa-mm-ddThh:mm") ou do app ("aaaa-mm-dd hh:mm:ss") → MySQL; vazio = null */
function dataHora(v: unknown, rotulo: string): string | null {
  if (v == null || v === '') return null;
  const m = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})(:\d{2})?$/.exec(String(v));
  if (!m) throw erro(400, `${rotulo}: data e hora inválidas.`);
  return `${m[1]} ${m[2]}${m[3] ?? ':00'}`;
}

/**
 * Troca os serviços da OS pela lista informada (a lista inteira: reenviar dá o mesmo resultado).
 * Preço em branco = o do cadastro; subtotal e conferências pela mesma regra do painel (regras.ts).
 */
export async function gravarItensOS(osId: string | number, empresaId: string, lista: unknown) {
  if (!Array.isArray(lista)) throw erro(400, 'Serviços em formato inválido.');
  if (lista.length > 100) throw erro(400, 'No máximo 100 serviços por OS.');
  const itens: Record<string, any>[] = [];
  for (const i of lista) {
    // Um serviço ou um produto da empresa
    const ehProduto = Boolean(i?.produto_id) && !i?.servico_id;
    const [s] = ehProduto
      ? await pool.query<any[]>('SELECT id FROM produtos WHERE id = ? AND empresa_id = ?', [i.produto_id, empresaId])
      : await pool.query<any[]>('SELECT id FROM servicos WHERE id = ? AND empresa_id = ?', [i?.servico_id, empresaId]);
    if (!s[0]) throw erro(400, `Um dos ${ehProduto ? 'produtos' : 'serviços'} não existe nesta empresa.`);
    const item = {
      servico_id: ehProduto ? null : s[0].id,
      produto_id: ehProduto ? s[0].id : null,
      quantidade: Number(i.quantidade ?? 1),
      preco_unitario: i.preco_unitario === '' || i.preco_unitario == null ? null : Number(i.preco_unitario),
      desconto: Number(i.desconto || 0),
    };
    await antesDeGravar('os_itens', item, empresaId);
    itens.push(item);
  }
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await conn.query('DELETE FROM os_itens WHERE os_id = ?', [osId]);
    for (const i of itens) {
      await conn.query('INSERT INTO os_itens (os_id, servico_id, produto_id, quantidade, preco_unitario, desconto, subtotal) VALUES (?, ?, ?, ?, ?, ?, ?)', [
        osId,
        i.servico_id,
        i.produto_id,
        i.quantidade,
        i.preco_unitario,
        i.desconto,
        i.subtotal,
      ]);
    }
    await conn.commit();
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
}

/** Serviços e produtos da OS como o app, a impressão e a tela de encerrar usam */
async function itensDas(ids: number[]): Promise<Record<number, any[]>> {
  if (!ids.length) return {};
  const [r] = await pool.query<any[]>(
    `SELECT i.os_id, i.servico_id, i.produto_id, i.quantidade, i.preco_unitario, i.desconto, i.subtotal,
            COALESCE(s.nome, p.nome) AS item_nome, COALESCE(s.codigo, p.codigo_sku) AS item_codigo, COALESCE(s.unidade, p.unidade_medida) AS unidade
       FROM os_itens i
       LEFT JOIN servicos s ON s.id = i.servico_id
       LEFT JOIN produtos p ON p.id = i.produto_id
      WHERE i.os_id IN (?) ORDER BY i.id`,
    [ids],
  );
  const mapa: Record<number, any[]> = {};
  for (const { os_id, ...i } of r) (mapa[os_id] ??= []).push(i);
  return mapa;
}

/** Últimas OS concluídas de cada cliente (de qualquer técnico), com os serviços e produtos: o histórico do app */
const HISTORICO_POR_CLIENTE = 10;
async function historicoDos(empresaId: string, pessoas: number[]): Promise<Record<number, any[]>> {
  const ids = [...new Set(pessoas)];
  if (!ids.length) return {};
  // ponytail: traz as concluídas dos clientes e corta 10 por cliente aqui; com milhares por cliente, cortar no SQL (ROW_NUMBER)
  const [r] = await pool.query<any[]>(
    `SELECT o.id, o.pessoa_id, o.numero, o.tipo, o.data_agendada, o.fim_em, o.servico_solicitado, o.servico_executado, u.nome AS tecnico_nome
       FROM ordens_servico o
       LEFT JOIN usuarios u ON u.id = o.tecnico_id
      WHERE o.empresa_id = ? AND o.pessoa_id IN (?) AND o.status = 'concluida'
      ORDER BY o.pessoa_id, COALESCE(o.fim_em, o.data_agendada) DESC
      LIMIT 2000`,
    [empresaId, ids],
  );
  const mapa: Record<number, any[]> = {};
  for (const { pessoa_id, ...h } of r) {
    const lista = (mapa[pessoa_id] ??= []);
    // Um a mais: a própria OS sai da lista dela
    if (lista.length <= HISTORICO_POR_CLIENTE) lista.push(h);
  }
  const itens = await itensDas(Object.values(mapa).flat().map((h) => h.id));
  for (const lista of Object.values(mapa)) for (const h of lista) h.itens = (itens[h.id] ?? []).map((i) => ({ item_nome: i.item_nome, quantidade: i.quantidade, unidade: i.unidade }));
  return mapa;
}

export function createOsRouter() {
  const router = Router();

  router.get('/os/:id', async (req: Request, res: Response) => {
    try {
      exigirAcesso(res, 'ordens_servico', 'as ordens de serviço');
      const [r] = await pool.query<any[]>(
        `SELECT o.*,
                p.nome AS pessoa_nome, p.cpf AS pessoa_cpf, p.telefone AS pessoa_telefone, p.whatsapp AS pessoa_whatsapp,
                u.nome AS tecnico_nome, c.numero AS chamado_numero,
                e.nome AS empresa_nome, e.cnpj AS empresa_cnpj, e.endereco AS empresa_endereco, e.logo AS empresa_logo
           FROM ordens_servico o
           JOIN empresas e ON e.id = o.empresa_id
           JOIN pessoas p ON p.id = o.pessoa_id
           LEFT JOIN usuarios u ON u.id = o.tecnico_id
           LEFT JOIN chamados c ON c.id = o.chamado_id
          WHERE o.id = ? AND o.empresa_id = ?`,
        [req.params.id, res.locals.empresaId],
      );
      if (!r[0]) return res.status(404).json({ error: 'Ordem de serviço não encontrada.' });
      res.json({ ...r[0], itens: (await itensDas([r[0].id]))[r[0].id] ?? [], fotos: (await fotosDas([r[0].id]))[r[0].id] ?? [] });
    } catch (err: any) {
      res.status(err.status || 400).json({ error: err.message });
    }
  });

  /**
   * Encerrar pela web (a OS voltou no papel): o que foi feito, horários, quem assinou e os serviços, de uma vez.
   * Encerrada pode ser encerrada de novo (corrige o fechamento); cancelada, não.
   */
  router.post('/os/:id/encerrar', async (req: Request, res: Response) => {
    try {
      exigirAcesso(res, 'ordens_servico', 'as ordens de serviço');
      const [r] = await pool.query<any[]>('SELECT status FROM ordens_servico WHERE id = ? AND empresa_id = ?', [req.params.id, res.locals.empresaId]);
      if (!r[0]) throw erro(404, 'Ordem de serviço não encontrada.');
      if (r[0].status === 'cancelada') throw erro(409, 'OS cancelada não pode ser encerrada.');
      const b = req.body || {};
      const feito = String(b.servico_executado ?? '').trim().slice(0, 20000);
      if (!feito) throw erro(400, 'Descreva o que foi feito.');
      const inicio = dataHora(b.inicio_em, 'Início');
      const fim = dataHora(b.fim_em, 'Término');
      if (inicio && fim && fim < inicio) throw erro(400, 'O término não pode ser antes do início.');
      await gravarItensOS(req.params.id, res.locals.empresaId, b.itens ?? []);
      await pool.query(
        `UPDATE ordens_servico SET status = 'concluida', servico_executado = ?, inicio_em = ?, fim_em = ?,
                assinatura_nome = COALESCE(?, assinatura_nome), assinatura_documento = COALESCE(?, assinatura_documento)
          WHERE id = ?`,
        [feito, inicio, fim, String(b.assinatura_nome ?? '').trim().slice(0, 120) || null, String(b.assinatura_documento ?? '').trim().slice(0, 20) || null, req.params.id],
      );
      await aposGravar('ordens_servico', String(req.params.id));
      res.json({ ok: true });
    } catch (err: any) {
      res.status(err.status || 400).json({ error: err.message });
    }
  });

  // ------------------------------------------------------------
  // App do técnico (/tecnico, PWA offline): baixa as OS dele e recebe o que foi feito no cliente
  // ------------------------------------------------------------

  /** As OS do técnico logado: as abertas/em execução e as concluídas/canceladas dos últimos 7 dias */
  router.get('/os-tecnico', async (_req: Request, res: Response) => {
    try {
      exigirAcesso(res, 'ordens_servico', 'as ordens de serviço');
      const [r] = await pool.query<any[]>(
        `SELECT o.id, o.numero, o.tipo, o.status, o.data_agendada, o.hora_inicio, o.hora_fim, o.contato_nome, o.contato_telefone,
                o.endereco, o.servico_solicitado, o.servico_executado, o.inicio_em, o.fim_em, o.assinatura_nome,
                o.assinatura_documento, o.assinatura IS NOT NULL AS assinada, o.atualizado_em,
                o.pessoa_id, p.nome AS pessoa_nome, p.cpf AS pessoa_cpf, p.telefone AS pessoa_telefone, p.whatsapp AS pessoa_whatsapp
           FROM ordens_servico o
           JOIN pessoas p ON p.id = o.pessoa_id
          WHERE o.empresa_id = ? AND o.tecnico_id = ?
            AND (o.status IN ('aberta', 'em_execucao') OR o.atualizado_em >= NOW() - INTERVAL 7 DAY)
          ORDER BY o.data_agendada, o.hora_inicio, o.numero
          LIMIT 500`,
        [res.locals.empresaId, res.locals.usuarioId],
      );
      const fotos = await fotosDas(r.map((o) => o.id));
      const itens = await itensDas(r.map((o) => o.id));
      const historico = await historicoDos(res.locals.empresaId, r.map((o) => o.pessoa_id));
      res.json(
        r.map(({ pessoa_id, ...o }) => ({
          ...o,
          fotos: fotos[o.id] ?? [],
          itens: itens[o.id] ?? [],
          // Histórico do cliente sem a própria OS
          historico: (historico[pessoa_id] ?? []).filter((h) => h.id !== o.id).slice(0, HISTORICO_POR_CLIENTE),
        })),
      );
    } catch (err: any) {
      res.status(err.status || 400).json({ error: err.message });
    }
  });

  /** Catálogo de serviços e produtos ativos para o app lançar sem sinal (chave "s:id" ou "p:id") */
  router.get('/os-tecnico-servicos', async (_req: Request, res: Response) => {
    try {
      exigirAcesso(res, 'ordens_servico', 'as ordens de serviço');
      const [r] = await pool.query<any[]>(
        `SELECT CONCAT('s:', id) AS chave, 'servico' AS tipo, id, codigo, nome, unidade FROM servicos WHERE empresa_id = ? AND ativo = 1
         UNION ALL
         SELECT CONCAT('p:', id), 'produto', id, codigo_sku, nome, unidade_medida FROM produtos WHERE empresa_id = ? AND ativo = 1`,
        [res.locals.empresaId, res.locals.empresaId],
      );
      res.json(r);
    } catch (err: any) {
      res.status(err.status || 400).json({ error: err.message });
    }
  });

  /**
   * Alteração feita no app (pode chegar horas depois, quando o aparelho volta a ter sinal). Só os campos da
   * execução; a agenda e o cliente continuam sendo do escritório. Repetir o envio dá o mesmo resultado.
   */
  router.post('/os-tecnico/:id', async (req: Request, res: Response) => {
    try {
      const os = await osDoTecnico(req.params.id, res);

      const b = req.body || {};
      const dados: Record<string, unknown> = {};
      const DATA_HORA = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;
      const GEO = /^-?\d{1,3}\.\d+,-?\d{1,3}\.\d+$/;
      for (const c of ['inicio_em', 'fim_em']) if (c in b) {
        if (b[c] !== null && !DATA_HORA.test(String(b[c]))) throw new Error(`Data inválida em ${c}.`);
        dados[c] = b[c];
      }
      for (const c of ['inicio_geo', 'fim_geo']) if (c in b) dados[c] = GEO.test(String(b[c])) ? b[c] : null;
      if ('servico_executado' in b) dados.servico_executado = b.servico_executado == null ? null : String(b.servico_executado).slice(0, 20000);
      if ('assinatura_nome' in b) dados.assinatura_nome = String(b.assinatura_nome ?? '').slice(0, 120) || null;
      if ('assinatura_documento' in b) dados.assinatura_documento = String(b.assinatura_documento ?? '').slice(0, 20) || null;
      if ('assinatura' in b) {
        if (b.assinatura !== null && !/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(String(b.assinatura))) throw new Error('Assinatura inválida.');
        dados.assinatura = b.assinatura;
      }
      if ('status' in b) {
        if (!['em_execucao', 'concluida'].includes(b.status)) throw new Error('Status inválido.');
        // Concluída fica concluída: um "iniciar" atrasado na fila não reabre a OS
        if (!(os.status === 'concluida' && b.status === 'em_execucao')) dados.status = b.status;
      }
      if (dados.status === 'concluida') {
        const [[atual]] = await pool.query<any>('SELECT servico_executado, assinatura IS NOT NULL AS assinada FROM ordens_servico WHERE id = ?', [req.params.id]);
        if (!String(dados.servico_executado ?? atual.servico_executado ?? '').trim()) throw new Error('Para encerrar, descreva o que foi feito.');
        if (!(dados.assinatura ?? (Number(atual.assinada) || null))) throw new Error('Para encerrar, colete a assinatura do cliente.');
      }

      // Serviços feitos: a lista inteira do app troca a da OS
      if ('itens' in b) await gravarItensOS(req.params.id, res.locals.empresaId, b.itens);

      const cols = Object.keys(dados);
      if (cols.length) {
        await pool.query(`UPDATE ordens_servico SET ${cols.map((c) => `${c} = ?`).join(', ')} WHERE id = ?`, [...cols.map((c) => dados[c]), req.params.id]);
        await aposGravar('ordens_servico', String(req.params.id));
      }
      res.json({ ok: true });
    } catch (err: any) {
      res.status(err.status || 400).json({ error: err.message });
    }
  });

  /**
   * Foto de antes/depois tirada no app (data URI JPEG). O uuid vem do aparelho: o mesmo envio repetido
   * sobrescreve o mesmo arquivo e não cria outra linha. Vale também para OS já concluída (foto enviada depois).
   */
  router.post('/os-tecnico/:id/fotos', async (req: Request, res: Response) => {
    try {
      await osDoTecnico(req.params.id, res);
      const { uuid, momento } = req.body || {};
      if (!UUID.test(String(uuid))) throw erro(400, 'Foto sem identificação.');
      if (!['antes', 'depois'].includes(momento)) throw erro(400, 'A foto precisa ser de antes ou de depois.');
      const m = /^data:image\/jpeg;base64,([A-Za-z0-9+/=]+)$/.exec(String(req.body?.imagem ?? ''));
      const dados = m ? Buffer.from(m[1], 'base64') : Buffer.alloc(0);
      if (!(dados[0] === 0xff && dados[1] === 0xd8 && dados[2] === 0xff)) throw erro(415, 'A foto precisa chegar em JPEG.');
      if (dados.length > MAX_FOTO) throw erro(413, 'Foto grande demais depois de reduzida.');
      const [[n]] = await pool.query<any>('SELECT COUNT(*) AS n FROM os_fotos WHERE os_id = ? AND momento = ? AND uuid <> ?', [req.params.id, momento, uuid]);
      if (n.n >= MAX_FOTOS_POR_MOMENTO) throw erro(409, `No máximo ${MAX_FOTOS_POR_MOMENTO} fotos de ${momento}.`);
      if (!process.env.BLOB_READ_WRITE_TOKEN && !process.env.BLOB_STORE_ID) throw erro(503, 'Storage de fotos não configurado (BLOB_READ_WRITE_TOKEN).');

      // Mesma estrutura das fotos dos produtos: os/<empresa_id>/<id da OS com 9 dígitos>-<antes|depois>-<uuid>.jpg
      // (público, mas o uuid no nome não é adivinhável; o arquivo nunca muda, então cache de 1 ano)
      const blob = await put(`os/${res.locals.empresaId}/${String(req.params.id).padStart(9, '0')}-${momento}-${uuid}.jpg`, dados, {
        access: 'public',
        contentType: 'image/jpeg',
        addRandomSuffix: false,
        allowOverwrite: true,
        cacheControlMaxAge: 31_536_000,
      });
      await pool.query(
        `INSERT INTO os_fotos (empresa_id, os_id, uuid, momento, url, criado_por) VALUES (?, ?, ?, ?, ?, ?)
           ON DUPLICATE KEY UPDATE url = VALUES(url)`,
        [res.locals.empresaId, req.params.id, uuid, momento, blob.url, res.locals.usuarioId],
      );
      res.json({ url: blob.url });
    } catch (err: any) {
      res.status(err.status || 400).json({ error: err.message });
    }
  });

  /** Foto removida no app (só enquanto a OS está em execução); repetir não dá erro */
  router.delete('/os-tecnico/:id/fotos/:uuid', async (req: Request, res: Response) => {
    try {
      const os = await osDoTecnico(req.params.id, res);
      if (os.status === 'concluida') throw erro(409, 'A OS já foi encerrada: a foto não pode mais sair.');
      const [r] = await pool.query<any[]>('SELECT id, url FROM os_fotos WHERE os_id = ? AND uuid = ?', [req.params.id, req.params.uuid]);
      if (r[0]) {
        await pool.query('DELETE FROM os_fotos WHERE id = ?', [r[0].id]);
        await del(r[0].url).catch((e) => console.error(`OS: foto não apagada do Blob: ${e.message}`));
      }
      res.json({ ok: true });
    } catch (err: any) {
      res.status(err.status || 400).json({ error: err.message });
    }
  });

  return router;
}
