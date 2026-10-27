import { Router, Request, Response } from 'express';
import { pool } from './db.js';
import { aposGravar } from './regras.js';
import { exigirAcesso } from './permissoes.js';

/**
 * Leads (tabela leads): contatos ainda não clientes — Prospecção, contato novo pelo WhatsApp (chatbot,
 * Jornada) e "Cadastrar contato" das Conversas. Ficam fora de pessoas, que guarda só o cadastro de trabalho.
 *
 * Enquanto lead, ele tem disparos de campanha, conversas/atendimentos/avaliações do WhatsApp e atividades,
 * pelo lead_id dessas tabelas. Vira cliente (converterLead) pelo botão da lista ou ao abrir negócio,
 * chamado, OS, proposta ou pedido: é copiado para pessoas e tudo o que era dele passa para a pessoa.
 * O lead fica com pessoa_id e convertido_em (some da lista).
 */

type Executor = { query: typeof pool.query };

/** Tabelas com lead_id: na conversão, o lead_id vira o pessoa_id da pessoa nova */
const LIGADAS = ['campanha_disparos', 'whatsapp_mensagens', 'whatsapp_atendimentos', 'avaliacoes', 'atividades', 'atividade_conversas'];

/**
 * Copia o lead para pessoas (cliente) e passa para a pessoa tudo o que era do lead.
 * Já convertido: devolve a pessoa de antes. Lead de outra empresa ou inexistente: erro.
 */
export async function converterLead(empresaId: number | string, leadId: number | string, db: Executor = pool): Promise<number> {
  const [[l]] = await db.query<any>('SELECT * FROM leads WHERE id = ? AND empresa_id = ?', [leadId, empresaId]);
  if (!l) throw Object.assign(new Error('Lead não encontrado.'), { status: 404 });
  if (l.pessoa_id) return Number(l.pessoa_id);

  const [r] = await db.query<any>(
    `INSERT INTO pessoas (empresa_id, tipo, nome, email, telefone, whatsapp, obs, segmento_id, google_place_id, prospeccao_busca_id, nao_receber_campanhas)
     VALUES (?, 'cliente', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [empresaId, l.nome, l.email, l.telefone, l.whatsapp, l.obs, l.segmento_id, l.google_place_id, l.prospeccao_busca_id, l.nao_receber_campanhas ? 1 : 0],
  );
  const pessoaId = Number(r.insertId);
  await aposGravar('pessoas', String(pessoaId), [], db as any);
  if (l.cidade || l.uf) {
    await db.query("INSERT INTO pessoas_enderecos (empresa_id, pessoa_id, tipo, principal, cidade, uf) VALUES (?, ?, 'comercial', 1, ?, ?)", [
      empresaId,
      pessoaId,
      l.cidade,
      l.uf,
    ]);
  }
  // Com quem se fala na empresa: vira o contato principal
  if (l.contato) {
    await db.query('INSERT INTO pessoas_contatos (empresa_id, pessoa_id, nome, whatsapp, celular, email, principal) VALUES (?, ?, ?, ?, ?, ?, 1)', [
      empresaId,
      pessoaId,
      l.contato,
      l.whatsapp,
      l.whatsapp,
      l.email,
    ]);
  }
  for (const t of LIGADAS) await db.query(`UPDATE ${t} SET pessoa_id = ?, lead_id = NULL WHERE lead_id = ?`, [pessoaId, l.id]);
  await db.query('UPDATE leads SET pessoa_id = ?, convertido_em = NOW() WHERE id = ?', [pessoaId, l.id]);
  return pessoaId;
}

/** Lead excluído: o que era dele fica sem dono (as mensagens e atividades continuam) */
export async function soltarLead(leadId: number | string, db: Executor = pool) {
  for (const t of LIGADAS) await db.query(`UPDATE ${t} SET lead_id = NULL WHERE lead_id = ?`, [leadId]);
}

export function createLeadsRouter(): Router {
  const router = Router();

  /** Botão "Converter em cliente" da lista de leads */
  router.post('/leads/:id/converter', async (req: Request, res: Response) => {
    const conn = await pool.getConnection();
    try {
      exigirAcesso(res, 'leads', 'os leads');
      await conn.beginTransaction();
      const pessoaId = await converterLead(res.locals.empresaId, req.params.id, conn);
      await conn.commit();
      res.json({ pessoa_id: pessoaId });
    } catch (err: any) {
      await conn.rollback().catch(() => {});
      res.status(err.status || 400).json({ error: err.message || 'Não foi possível converter o lead.' });
    } finally {
      conn.release();
    }
  });

  return router;
}
