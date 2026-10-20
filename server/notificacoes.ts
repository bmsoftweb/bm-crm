import { Router, Request, Response } from 'express';
import { pool } from './db.js';
import { podeAcessar } from './permissoes.js';
import { lerConfig } from './config.js';

/**
 * Notificações dos usuários (tabela notificacoes): a campainha do cabeçalho mostra as do usuário logado, com lida/não
 * lida. Quem gera: visita no site (server/suporte.ts), chamado novo na fila (suporte.ts e chamados.ts), chamado ou
 * conversa do WhatsApp transferido para o usuário (chamados.ts e conversas.ts), tarefa criada pelas automações para ele
 * (pendencias.ts, jornada.ts, chatbot.ts, crud.ts/os.ts) e avaliação com nota baixa (pesquisa.ts).
 *
 * link: a tela que abre ao clicar (o id do menu: chamados_ativos, atividades...), com o que ela precisa depois de "|"
 * quando não é um id (ex.: "conversas|5547999998888"); registro_id: o chamado, a atividade, a OS...
 */

export interface Notificacao {
  tipo: 'visita_site' | 'chamado' | 'transferencia' | 'tarefa' | 'avaliacao';
  titulo: string;
  texto?: string | null;
  link?: string | null;
  registroId?: number | null;
}

/**
 * Tipos que o usuário pode desligar (Usuários › Permissões › Notificações). Os outros são obrigatórios: transferência
 * para ele, tarefa para ele e avaliação com nota baixa
 */
export const NOTIFICACOES_OPCIONAIS = ['visita_site', 'chamado'];

/** Desligadas por usuário, numa linha de config da empresa: { "<id do usuário>": ["visita_site", ...] } */
const GRUPO = 'notificacoes';
const CHAVE = 'usuarios';
const desligadasDaEmpresa = async (empresaId: string | number): Promise<Record<string, string[]>> =>
  (await lerConfig(String(empresaId), GRUPO, CHAVE)) ?? {};

/** Para quem: usuários, os de um departamento, quem acessa uma tela; "exceto" = quem causou (não avisa a si mesmo) */
export interface Destino {
  usuarios?: (number | null | undefined)[];
  departamentoId?: number | null;
  tela?: string;
  exceto?: number | null;
}

/** Grava a notificação para cada destinatário ativo da empresa. Nunca derruba quem chamou: falha só vai para o log */
export async function notificar(empresaId: string | number, para: Destino, n: Notificacao): Promise<number> {
  try {
    const ids = new Set<number>();
    for (const u of para.usuarios ?? []) if (Number(u) > 0) ids.add(Number(u));
    if (para.departamentoId || para.tela) {
      const [us] = await pool.query<any[]>('SELECT id, tipo, permissoes, departamento_id FROM usuarios WHERE empresa_id = ? AND ativo = 1', [empresaId]);
      for (const u of us) {
        if (para.departamentoId && Number(u.departamento_id) === Number(para.departamentoId)) ids.add(Number(u.id));
        if (para.tela && podeAcessar(u, para.tela)) ids.add(Number(u.id));
      }
    }
    if (para.exceto) ids.delete(Number(para.exceto));
    if (NOTIFICACOES_OPCIONAIS.includes(n.tipo) && ids.size) {
      const desligadas = await desligadasDaEmpresa(empresaId);
      for (const id of [...ids]) if (desligadas[id]?.includes(n.tipo)) ids.delete(id);
    }
    if (!ids.size) return 0;
    // Só usuários ativos desta empresa (os ids vindos de fora também passam por aqui)
    const [ativos] = await pool.query<any[]>('SELECT id FROM usuarios WHERE empresa_id = ? AND ativo = 1 AND id IN (?)', [empresaId, [...ids]]);
    if (!ativos.length) return 0;
    await pool.query('INSERT INTO notificacoes (empresa_id, usuario_id, tipo, titulo, texto, link, registro_id) VALUES ?', [
      ativos.map((u) => [
        empresaId,
        u.id,
        n.tipo,
        n.titulo.slice(0, 150),
        n.texto ? String(n.texto).slice(0, 500) : null,
        n.link ? String(n.link).slice(0, 100) : null,
        n.registroId ?? null,
      ]),
    ]);
    return ativos.length;
  } catch (err: any) {
    console.error(`Notificação (${n.tipo}): ${err.message}`);
    return 0;
  }
}

export function createNotificacoesRouter(): Router {
  const router = Router();

  /** As últimas 50 do usuário logado (só as não lidas com ?naoLidas=1) e quantas não lidas há */
  router.get('/notificacoes', async (req: Request, res: Response) => {
    try {
      const emp = res.locals.empresaId;
      const eu = res.locals.usuarioId;
      const so = req.query.naoLidas === '1' ? ' AND lida_em IS NULL' : '';
      const [itens] = await pool.query<any[]>(
        `SELECT id, tipo, titulo, texto, link, registro_id, DATE_FORMAT(lida_em, '%Y-%m-%d %H:%i:%s') AS lida_em,
                DATE_FORMAT(criada_em, '%Y-%m-%d %H:%i:%s') AS criada_em
           FROM notificacoes WHERE empresa_id = ? AND usuario_id = ?${so} ORDER BY id DESC LIMIT 50`,
        [emp, eu],
      );
      const [[{ n }]] = await pool.query<any>('SELECT COUNT(*) AS n FROM notificacoes WHERE empresa_id = ? AND usuario_id = ? AND lida_em IS NULL', [emp, eu]);
      res.json({ itens, naoLidas: Number(n) });
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  /** Marca uma como lida (ou não lida, com { lida: false }) */
  router.post('/notificacoes/:id/lida', async (req: Request, res: Response) => {
    try {
      const lida = req.body?.lida !== false;
      await pool.query(`UPDATE notificacoes SET lida_em = ${lida ? 'COALESCE(lida_em, NOW())' : 'NULL'} WHERE id = ? AND empresa_id = ? AND usuario_id = ?`, [
        req.params.id,
        res.locals.empresaId,
        res.locals.usuarioId,
      ]);
      res.json({ success: true });
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  /** Marca todas as do usuário como lidas */
  router.post('/notificacoes/lidas', async (_req: Request, res: Response) => {
    try {
      await pool.query('UPDATE notificacoes SET lida_em = NOW() WHERE empresa_id = ? AND usuario_id = ? AND lida_em IS NULL', [res.locals.empresaId, res.locals.usuarioId]);
      res.json({ success: true });
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  /** Notificações desligadas de um usuário (só os tipos opcionais) */
  router.get('/usuarios/:id/notificacoes', async (req: Request, res: Response) => {
    try {
      res.json({ desligadas: (await desligadasDaEmpresa(res.locals.empresaId))[Number(req.params.id)] ?? [] });
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  /** Grava as desligadas de um usuário: só administradores (como as permissões) */
  router.put('/usuarios/:id/notificacoes', async (req: Request, res: Response) => {
    try {
      if (res.locals.usuario?.tipo !== 'admin') return res.status(403).json({ error: 'Somente administradores alteram as notificações dos usuários.' });
      const emp = res.locals.empresaId;
      const id = Number(req.params.id) || 0;
      const lista = (Array.isArray(req.body?.desligadas) ? req.body.desligadas : []).map(String).filter((t: string) => NOTIFICACOES_OPCIONAIS.includes(t));
      const todas = await desligadasDaEmpresa(emp);
      if (lista.length) todas[id] = lista;
      else delete todas[id];
      const valor = JSON.stringify(todas);
      const [existe] = await pool.query<any[]>('SELECT id FROM config WHERE empresa_id = ? AND grupo = ? AND chave = ? LIMIT 1', [emp, GRUPO, CHAVE]);
      if (existe.length) await pool.query('UPDATE config SET valor = ? WHERE id = ?', [valor, existe[0].id]);
      else await pool.query('INSERT INTO config (empresa_id, grupo, chave, valor) VALUES (?, ?, ?, ?)', [emp, GRUPO, CHAVE, valor]);
      res.json({ success: true, desligadas: lista });
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  return router;
}
