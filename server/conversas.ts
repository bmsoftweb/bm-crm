import { Router, Request, Response } from 'express';
import { pool } from './db.js';
import { apagarParaTodos, ArquivoEnvio, chaveTelefone, citacaoDa, contaWhats, CONTATO_RECENTE, donoDoTelefone, LEAD_RECENTE, PESSOA_RECENTE, enviarMidiaWhatsApp, enviarWhatsApp, midiaDaMensagem, telefoneWhatsApp, contaDaConversa } from './whatsapp.js';
import { sincronizarNegocio } from './regras.js';
import { lerConfig } from './config.js';
import { atendimentoAtual, encerrarAtendimento, marcarEncerramento, marcarEvento, minutosDevolver, minutosInatividade, mudarAtendimento } from './chatbot.js';
import { jornadaAtende, lerJornadaConfig } from './jornada.js';
import { podeAcessar } from './permissoes.js';
import { notificar } from './notificacoes.js';

/** Mensagem privada: vê quem é do departamento dela ou o administrador; sem departamento, todos */
function podeVerPrivada(res: Response, departamentoId: unknown): boolean {
  if (!departamentoId) return true;
  const u = res.locals.usuario;
  return u?.tipo === 'admin' || Number(u?.departamento_id) === Number(departamentoId);
}

/** Tira o conteúdo da mensagem privada que o usuário não pode ver (fica só o aviso "privada de <departamento>") */
function mascararPrivada<T extends Record<string, any>>(res: Response, m: T): T {
  const privada = m.privado_departamento_id ? { departamento: m.privado_departamento ?? 'outro departamento' } : null;
  if (!privada || podeVerPrivada(res, m.privado_departamento_id)) return { ...m, privada };
  return { ...m, privada: { ...privada, oculta: true }, texto: null, arquivo_nome: null };
}
import { ehCortesia, enviarPesquisa } from './pesquisa.js';

/** Começo do evento de transferência (para um atendente ou um departamento): /whatsapp/nao-vistas acha por ele a transferida para mim */
const TRANSFERIDO_PARA = 'Transferido para ';

/**
 * Tela de conversas do WhatsApp: uma conversa por telefone (whatsapp_mensagens.telefone, só
 * dígitos com DDI). As mensagens chegam pelo webhook da Evolution (server/whatsapp.ts).
 */

const TELEFONE = /^\d{8,15}$/;

/** Nome de perfil mais recente da conversa da mensagem m (quem mandou, no WhatsApp) */
const NOME_CONTATO = (m: string) =>
  `(SELECT z.nome_contato FROM whatsapp_mensagens z
     WHERE z.empresa_id = ${m}.empresa_id AND z.telefone = ${m}.telefone AND z.nome_contato IS NOT NULL
     ORDER BY z.id DESC LIMIT 1)`;

const falha = (res: Response, err: any) => res.status(err.status || 400).json({ error: err.message });

/**
 * Número da conversa para um telefone do cadastro: a conversa que já existe com ele (o WhatsApp
 * costuma guardar sem o 9), ou o próprio número com DDI
 */
async function numeroDaConversa(empresaId: string, telefone: string): Promise<string> {
  const chave = chaveTelefone(telefone, true);
  if (!chave) return telefone;
  const [rows] = await pool.query<any[]>(
    'SELECT DISTINCT telefone FROM whatsapp_mensagens WHERE empresa_id = ? AND RIGHT(telefone, 8) = ?',
    [empresaId, chave.slice(-8)],
  );
  return rows.find((r) => chaveTelefone(r.telefone, true) === chave)?.telefone ?? telefone;
}

/** Quem está atendendo a conversa (null = ninguém pegou) */
async function atendenteDa(empresaId: string, telefone: string): Promise<{ id: number; nome: string } | null> {
  const [r] = await pool.query<any[]>(
    'SELECT u.id, u.nome FROM whatsapp_conversas c JOIN usuarios u ON u.id = c.atendente_id WHERE c.empresa_id = ? AND c.telefone = ?',
    [empresaId, telefone],
  );
  return r[0] ?? null;
}

/**
 * Trava do atendimento: conversa em atendimento com outro usuário só é mexida por ele (o
 * administrador pode, se `adminPode`). Lança 403 com o nome de quem está atendendo.
 */
async function conferirTrava(res: Response, telefone: string, adminPode: boolean) {
  const dono = await atendenteDa(res.locals.empresaId, telefone);
  if (!dono || Number(dono.id) === Number(res.locals.usuarioId)) return dono;
  // Em atendimento com outro: quem não é o atendente (administrador também) só vê. adminPode ficou sem efeito
  void adminPode;
  throw Object.assign(new Error(`Esta conversa está em atendimento com ${dono.nome}: você só pode ver.`), { status: 403 });
}

/**
 * Há o que encerrar: alguém atendendo, aguardando atendente, com departamento ou no meio da jornada.
 * Depois de encerrada, a conversa fica sem nada disso até o cliente escrever de novo
 */
const ENCERRAVEL = `(c.atendente_id IS NOT NULL OR c.atendimento = 'humano' OR c.departamento_id IS NOT NULL
  OR (c.no_atual IS NOT NULL AND c.no_atual <> '__fim') OR c.retomar_em IS NOT NULL)`;

/** Pega a conversa para o usuário (trava para ele); registra a linha na conversa */
async function atender(res: Response, telefone: string, anterior: { id: number; nome: string } | null) {
  const emp = res.locals.empresaId;
  await pool.query(
    `INSERT INTO whatsapp_conversas (empresa_id, telefone, atendimento, atendente_id, atendido_em, humano_desde) VALUES (?, ?, 'humano', ?, NOW(), NOW())
     ON DUPLICATE KEY UPDATE atendimento = 'humano', atendente_id = VALUES(atendente_id), atendido_em = NOW(),
       humano_desde = COALESCE(humano_desde, NOW()), retomar_em = NULL, atualizado_em = NOW()`,
    [emp, telefone, res.locals.usuarioId],
  );
  const nome = res.locals.usuario?.nome ?? 'Atendente';
  await marcarEvento(emp, telefone, anterior && Number(anterior.id) !== Number(res.locals.usuarioId) ? `${nome} assumiu o atendimento de ${anterior.nome}` : `${nome} começou o atendimento`, res.locals.usuarioId);
}

export function createConversasRouter(): Router {
  const router = Router();

  // Tela Conversas: só com permissão (a conversa aberta pela atividade da ficha também passa por aqui)
  router.use('/whatsapp/conversas', (_req: Request, res: Response, next) => {
    if (podeAcessar(res.locals.usuario, 'conversas')) return next();
    res.status(403).json({ error: 'Você não tem permissão para acessar as Conversas. Fale com o administrador.' });
  });

  /**
   * Conversa de uma atividade (clique na ficha do negócio, duplo clique na lista): o número em que a pessoa
   * da atividade (ou a do negócio) conversou no WhatsApp, de preferência a conversa de antes da atividade
   * ter sido criada (a que gerou a pendência); sem conversa, o telefone do cadastro
   */
  router.get('/whatsapp/atividades/:id/conversa', async (req: Request, res: Response) => {
    try {
      const emp = res.locals.empresaId;
      const [rows] = await pool.query<any[]>(
        `SELECT a.id, a.assunto, a.concluida, COALESCE(pa.id, pn.id) AS pessoa_id,
                COALESCE(NULLIF(pa.whatsapp, ''), NULLIF(pa.telefone, ''), NULLIF(pn.whatsapp, ''), pn.telefone) AS telefone,
                IF(COALESCE(NULLIF(pa.whatsapp, ''), NULLIF(pa.telefone, '')) IS NULL, pn.nome, pa.nome) AS nome
           FROM atividades a
           LEFT JOIN pessoas pa ON pa.id = a.pessoa_id
           LEFT JOIN negocios n ON n.id = a.negocio_id
           LEFT JOIN pessoas pn ON pn.id = n.pessoa_id
          WHERE a.id = ? AND a.empresa_id = ?`,
        [req.params.id, emp],
      );
      const a = rows[0];
      if (!a) return res.status(404).json({ error: 'Atividade não encontrada.' });
      const [conv] = a.pessoa_id
        ? await pool.query<any[]>(
            `SELECT w.telefone FROM whatsapp_mensagens w JOIN atividades a ON a.id = ?
              WHERE w.empresa_id = ? AND w.pessoa_id = ?
              ORDER BY (w.data_hora <= a.criado_em + INTERVAL 5 MINUTE) DESC, w.id DESC LIMIT 1`,
            [a.id, emp, a.pessoa_id],
          )
        : [[]];
      if (conv[0]) {
        return res.json({ telefone: conv[0].telefone, nome: a.nome, atividade: { id: a.id, assunto: a.assunto, concluida: Boolean(Number(a.concluida)) } });
      }
      if (!a.telefone) return res.status(400).json({ error: `${a.nome ? `${a.nome} não tem` : 'A atividade não tem pessoa com'} telefone cadastrado.` });
      const telefone = await numeroDaConversa(emp, telefoneWhatsApp(a.telefone));
      res.json({ telefone, nome: a.nome, atividade: { id: a.id, assunto: a.assunto, concluida: Boolean(Number(a.concluida)) } });
    } catch (err: any) {
      falha(res, err);
    }
  });

  /**
   * Conversa de uma pessoa (WhatsApp; sem ele, telefone) ou de um contato (WhatsApp, celular,
   * telefone): ícone do WhatsApp nas listas de Pessoas e de Contatos
   */
  router.get('/whatsapp/numero', async (req: Request, res: Response) => {
    try {
      const emp = String(res.locals.empresaId);
      // Um número (ex.: destino do disparo de campanha, com o 9): a conversa gravada dele, que pode estar sem o 9
      if (req.query.telefone) {
        let numero: string;
        try {
          numero = telefoneWhatsApp(String(req.query.telefone));
        } catch {
          return res.status(400).json({ error: 'Telefone inválido.' });
        }
        return res.json({ telefone: await numeroDaConversa(emp, numero), nome: '' });
      }
      const contatoId = Number(req.query.contato_id) || null;
      const pessoaId = Number(req.query.pessoa_id) || null;
      const [rows] = contatoId
        ? await pool.query<any[]>(
            `SELECT nome, COALESCE(NULLIF(whatsapp, ''), NULLIF(celular, ''), NULLIF(telefone, '')) AS fone
               FROM pessoas_contatos WHERE id = ? AND empresa_id = ?`,
            [contatoId, emp],
          )
        : await pool.query<any[]>(
            "SELECT nome, COALESCE(NULLIF(whatsapp, ''), NULLIF(telefone, '')) AS fone FROM pessoas WHERE id = ? AND empresa_id = ?",
            [pessoaId, emp],
          );
      const r = rows[0];
      if (!r) return res.status(404).json({ error: contatoId ? 'Contato não encontrado.' : 'Pessoa não encontrada.' });
      if (!r.fone) return res.status(400).json({ error: `${r.nome} não tem WhatsApp nem telefone cadastrado.` });
      let numero: string;
      try {
        numero = telefoneWhatsApp(r.fone);
      } catch {
        return res.status(400).json({ error: `O telefone de ${r.nome} (${r.fone}) não tem DDD: corrija o cadastro para conversar pelo WhatsApp.` });
      }
      res.json({ telefone: await numeroDaConversa(emp, numero), nome: r.nome });
    } catch (err: any) {
      falha(res, err);
    }
  });

  /**
   * Nova conversa: pessoas e contatos (ativos) pelo nome ou pelo número. Cada um vem com o número
   * da conversa (WhatsApp; sem ele, telefone/celular) ou o motivo de não ter como mandar.
   * Busca só com dígitos (10 ou mais) oferece também o número digitado.
   */
  router.get('/whatsapp/destinos', async (req: Request, res: Response) => {
    try {
      const emp = String(res.locals.empresaId);
      const busca = String(req.query.busca ?? '').trim().slice(0, 100);
      if (busca.length < 2) return res.json([]);
      const digitos = busca.replace(/\D/g, '');
      const nome = `%${busca}%`;
      // Número: compara os dígitos do cadastro (a busca pode vir formatada ou não)
      const numero = (c: string) => (digitos.length >= 4 ? `REGEXP_REPLACE(COALESCE(${c}, ''), '[^0-9]', '') LIKE ?` : 'FALSE');
      const pNum = digitos.length >= 4 ? [`%${digitos}%`, `%${digitos}%`] : [];
      const cNum = digitos.length >= 4 ? [`%${digitos}%`, `%${digitos}%`, `%${digitos}%`] : [];
      const [pessoas] = await pool.query<any[]>(
        `SELECT id AS pessoa_id, nome, COALESCE(NULLIF(whatsapp, ''), NULLIF(telefone, '')) AS fone
           FROM pessoas WHERE empresa_id = ? AND (nome LIKE ? OR ${numero('whatsapp')} OR ${numero('telefone')})
          ORDER BY COALESCE(NULLIF(whatsapp, ''), NULLIF(telefone, '')) IS NULL, nome LIMIT 15`,
        [emp, nome, ...pNum],
      );
      const [contatos] = await pool.query<any[]>(
        `SELECT c.id AS contato_id, c.pessoa_id, c.nome, p.nome AS pessoa_nome, COALESCE(c.departamento, c.cargo) AS setor,
                COALESCE(NULLIF(c.whatsapp, ''), NULLIF(c.celular, ''), NULLIF(c.telefone, '')) AS fone
           FROM pessoas_contatos c JOIN pessoas p ON p.id = c.pessoa_id
          WHERE c.empresa_id = ? AND c.ativo = 1 AND (c.nome LIKE ? OR p.nome LIKE ? OR ${numero('c.whatsapp')} OR ${numero('c.celular')} OR ${numero('c.telefone')})
          ORDER BY COALESCE(NULLIF(c.whatsapp, ''), NULLIF(c.celular, ''), NULLIF(c.telefone, '')) IS NULL, p.nome, c.principal DESC, c.nome LIMIT 15`,
        [emp, nome, nome, ...cNum],
      );
      /** Número da conversa, ou o motivo de não dar para mandar */
      const destino = async (fone: string | null) => {
        if (!fone) return { telefone: null, aviso: 'sem telefone cadastrado' };
        try {
          return { telefone: await numeroDaConversa(emp, telefoneWhatsApp(fone)), aviso: null };
        } catch {
          return { telefone: null, aviso: `telefone sem DDD (${fone})` };
        }
      };
      const lista: any[] = [];
      for (const p of pessoas) lista.push({ tipo: 'pessoa', pessoa_id: p.pessoa_id, contato_id: null, nome: p.nome, detalhe: null, fone: p.fone, ...(await destino(p.fone)) });
      for (const c of contatos) {
        lista.push({
          tipo: 'contato',
          pessoa_id: c.pessoa_id,
          contato_id: c.contato_id,
          nome: c.nome,
          detalhe: [c.setor, c.pessoa_nome].filter(Boolean).join(' — '),
          fone: c.fone,
          ...(await destino(c.fone)),
        });
      }
      // Quem dá para chamar primeiro (pessoas e contatos juntos); sem número (ou sem DDD) vai para o fim
      lista.sort((a, b) => Number(!a.telefone) - Number(!b.telefone));
      // Só dígitos: o próprio número digitado, mesmo sem cadastro
      if (digitos.length >= 10 && digitos.length === busca.replace(/[\s()+-]/g, '').length) {
        try {
          lista.unshift({ tipo: 'numero', pessoa_id: null, contato_id: null, nome: 'Número digitado', detalhe: null, fone: busca, telefone: await numeroDaConversa(emp, telefoneWhatsApp(digitos)), aviso: null });
        } catch {
          // número inválido: fica só o que achou no cadastro
        }
      }
      res.json(lista);
    } catch (err: any) {
      falha(res, err);
    }
  });

  /** Assumir a conversa (o chatbot para) ou devolvê-la ao chatbot */
  /** Encerrar: fim da sessão, como se o tempo de devolver ao bot tivesse passado */
  router.post('/whatsapp/conversas/:telefone/encerrar', async (req: Request, res: Response) => {
    try {
      const telefone = req.params.telefone;
      if (!TELEFONE.test(telefone)) return res.status(400).json({ error: 'Telefone inválido.' });
      const emp = res.locals.empresaId;
      await conferirTrava(res, telefone, true);
      // Clique repetido (ou conversa já encerrada): não grava outra linha
      const [ok] = await pool.query<any[]>(`SELECT 1 FROM whatsapp_conversas c WHERE c.empresa_id = ? AND c.telefone = ? AND ${ENCERRAVEL}`, [emp, telefone]);
      if (!ok.length) return res.status(400).json({ error: 'Não há atendimento em andamento para encerrar.' });
      // O departamento, antes de limpar: vai para a pesquisa de satisfação
      const [antes] = await pool.query<any[]>(
        'SELECT c.departamento_id FROM whatsapp_conversas c WHERE c.empresa_id = ? AND c.telefone = ?',
        [emp, telefone],
      );
      await encerrarAtendimento(emp, telefone);
      await marcarEncerramento(emp, telefone, res.locals.usuarioId);
      // Pesquisa só se alguém da equipe escreveu no atendimento (enviarPesquisa confere), mesmo que a conversa tenha voltado a aguardar
      await enviarPesquisa(emp, telefone, 'atendente', null, antes[0]?.departamento_id ?? null);
      res.json({ success: true });
    } catch (err: any) {
      falha(res, err);
    }
  });

  /**
   * Descartar: a mensagem que caiu em Aguardando não pedia atendimento (ex.: o bot de outra empresa respondendo).
   * A conversa sai da fila como encerrada, sem pesquisa de satisfação e sem contar como atendimento; uma mensagem
   * nova do cliente volta a abrir um atendimento.
   */
  router.post('/whatsapp/conversas/:telefone/descartar', async (req: Request, res: Response) => {
    try {
      const telefone = req.params.telefone;
      if (!TELEFONE.test(telefone)) return res.status(400).json({ error: 'Telefone inválido.' });
      const emp = res.locals.empresaId;
      const [c] = await pool.query<any[]>('SELECT atendente_id FROM whatsapp_conversas WHERE empresa_id = ? AND telefone = ?', [emp, telefone]);
      if (c[0]?.atendente_id) return res.status(400).json({ error: 'Esta conversa está em atendimento: encerre em vez de descartar.' });
      await encerrarAtendimento(emp, telefone);
      await marcarEncerramento(emp, telefone, res.locals.usuarioId, null, 'Descartada', false);
      await pool.query("UPDATE whatsapp_mensagens SET vista = 1 WHERE empresa_id = ? AND telefone = ? AND direcao = 'recebida' AND vista = 0", [emp, telefone]);
      res.json({ success: true });
    } catch (err: any) {
      falha(res, err);
    }
  });

  /**
   * Limpar (só administrador): apaga o histórico do número no CRM (mensagens e situação do atendimento, com a
   * automação); a conversa sai da lista e a próxima mensagem do cliente começa do zero. No WhatsApp do cliente nada muda.
   * Chamados que citavam uma resposta enviada perdem só a ligação; pesquisa pendente expira.
   */
  router.delete('/whatsapp/conversas/:telefone', async (req: Request, res: Response) => {
    try {
      const telefone = req.params.telefone;
      if (!TELEFONE.test(telefone)) return res.status(400).json({ error: 'Telefone inválido.' });
      if (res.locals.usuario?.tipo !== 'admin') return res.status(403).json({ error: 'Só o administrador pode limpar a conversa.' });
      const emp = res.locals.empresaId;
      const conn = await pool.getConnection();
      try {
        await conn.beginTransaction();
        await conn.query(
          'UPDATE chamado_mensagens SET whatsapp_id = NULL WHERE whatsapp_id IN (SELECT id FROM (SELECT id FROM whatsapp_mensagens WHERE empresa_id = ? AND telefone = ?) x)',
          [emp, telefone],
        );
        await conn.query(
          "UPDATE avaliacoes SET situacao = 'expirada' WHERE empresa_id = ? AND telefone = ? AND situacao IN ('aguardando_nota', 'aguardando_comentario')",
          [emp, telefone],
        );
        const [r] = await conn.query<any>('DELETE FROM whatsapp_mensagens WHERE empresa_id = ? AND telefone = ?', [emp, telefone]);
        await conn.query('DELETE FROM whatsapp_conversas WHERE empresa_id = ? AND telefone = ?', [emp, telefone]);
        await conn.commit();
        res.json({ success: true, apagadas: Number(r.affectedRows) });
      } catch (e) {
        await conn.rollback();
        throw e;
      } finally {
        conn.release();
      }
    } catch (err: any) {
      falha(res, err);
    }
  });

  /** Templates ativos do canal (Cadastros › Templates) para o botão dos chats: quem atende usa, mesmo sem acesso ao cadastro */
  router.get('/templates/ativos', async (req: Request, res: Response) => {
    try {
      const canal = req.query.canal === 'suporte' ? 'suporte' : 'whatsapp';
      const [r] = await pool.query<any[]>(
        "SELECT id, descricao, texto FROM templates_mensagens WHERE empresa_id = ? AND ativo = 1 AND canal IN ('todos', ?) ORDER BY descricao LIMIT 500",
        [res.locals.empresaId, canal],
      );
      res.json(r);
    } catch (err: any) {
      falha(res, err);
    }
  });

  /** Atender: pega a conversa (o bot para, o aviso sonoro para e só este usuário responde) */
  router.post('/whatsapp/conversas/:telefone/atender', async (req: Request, res: Response) => {
    try {
      const telefone = req.params.telefone;
      if (!TELEFONE.test(telefone)) return res.status(400).json({ error: 'Telefone inválido.' });
      const anterior = await conferirTrava(res, telefone, true);
      await atender(res, telefone, anterior);
      res.json({ success: true });
    } catch (err: any) {
      falha(res, err);
    }
  });

  /**
   * Pausar: a conversa sai de quem atende e volta para a Fila de Chamados (aguardando, mesmo departamento),
   * sem voltar ao bot; mantém o "aguardando desde" original, como o chamado pausado mantém a chegada
   */
  router.post('/whatsapp/conversas/:telefone/pausar', async (req: Request, res: Response) => {
    try {
      const telefone = req.params.telefone;
      if (!TELEFONE.test(telefone)) return res.status(400).json({ error: 'Telefone inválido.' });
      const emp = res.locals.empresaId;
      await conferirTrava(res, telefone, true);
      const [r] = await pool.query<any>(
        "UPDATE whatsapp_conversas SET atendimento = 'humano', atendente_id = NULL, atendido_em = NULL, humano_desde = COALESCE(humano_desde, NOW()), retomar_em = NULL, atualizado_em = NOW() WHERE empresa_id = ? AND telefone = ? AND atendente_id IS NOT NULL",
        [emp, telefone],
      );
      if (!r.affectedRows) return res.status(400).json({ error: 'Ninguém está atendendo esta conversa.' });
      await marcarEvento(emp, telefone, `Pausado por ${res.locals.usuario?.nome ?? 'atendente'}: voltou para a fila`, res.locals.usuarioId);
      res.json({ success: true });
    } catch (err: any) {
      falha(res, err);
    }
  });

  /** Transferir para outro atendente (já em atendimento com ele) ou para um departamento (aguardando) */
  router.post('/whatsapp/conversas/:telefone/transferir', async (req: Request, res: Response) => {
    try {
      const telefone = req.params.telefone;
      if (!TELEFONE.test(telefone)) return res.status(400).json({ error: 'Telefone inválido.' });
      const emp = res.locals.empresaId;
      await conferirTrava(res, telefone, true);
      const eu = res.locals.usuario?.nome ?? 'Atendente';
      const usuarioId = Number(req.body?.usuario_id) || null;
      const departamentoId = Number(req.body?.departamento_id) || null;
      await pool.query('INSERT IGNORE INTO whatsapp_conversas (empresa_id, telefone) VALUES (?, ?)', [emp, telefone]);
      if (usuarioId) {
        const [u] = await pool.query<any[]>('SELECT id, nome FROM usuarios WHERE id = ? AND empresa_id = ? AND ativo = 1', [usuarioId, emp]);
        if (!u[0]) return res.status(400).json({ error: 'Usuário não encontrado.' });
        await pool.query(
          "UPDATE whatsapp_conversas SET atendimento = 'humano', atendente_id = ?, atendido_em = NOW(), humano_desde = COALESCE(humano_desde, NOW()), retomar_em = NULL, atualizado_em = NOW() WHERE empresa_id = ? AND telefone = ?",
          [u[0].id, emp, telefone],
        );
        await marcarEvento(emp, telefone, `${TRANSFERIDO_PARA}${u[0].nome} por ${eu}`, res.locals.usuarioId);
        await notificar(emp, { usuarios: [u[0].id], exceto: res.locals.usuarioId }, {
          tipo: 'transferencia',
          titulo: 'Conversa do WhatsApp transferida para você',
          texto: `${telefone} — por ${eu}`,
          link: `conversas|${telefone}`,
        });
      } else if (departamentoId) {
        const [d] = await pool.query<any[]>('SELECT id, nome FROM departamentos WHERE id = ? AND empresa_id = ?', [departamentoId, emp]);
        if (!d[0]) return res.status(400).json({ error: 'Departamento não encontrado.' });
        // Aguardando de novo, desde agora: quem é do departamento recebe o aviso sonoro
        await pool.query(
          "UPDATE whatsapp_conversas SET atendimento = 'humano', atendente_id = NULL, atendido_em = NULL, departamento_id = ?, humano_desde = NOW(), retomar_em = NULL, atualizado_em = NOW() WHERE empresa_id = ? AND telefone = ?",
          [d[0].id, emp, telefone],
        );
        await marcarEvento(emp, telefone, `${TRANSFERIDO_PARA}${d[0].nome} por ${eu}`, res.locals.usuarioId);
        await notificar(emp, { departamentoId: d[0].id, exceto: res.locals.usuarioId }, {
          tipo: 'transferencia',
          titulo: `Conversa do WhatsApp transferida para o ${d[0].nome}`,
          texto: `${telefone} — por ${eu}`,
          link: `conversas|${telefone}`,
        });
      } else {
        return res.status(400).json({ error: 'Escolha um atendente ou um departamento.' });
      }
      res.json({ success: true });
    } catch (err: any) {
      falha(res, err);
    }
  });

  /** Devolver ao bot (só quem está atendendo, ou o administrador) */
  router.post('/whatsapp/conversas/:telefone/atendimento', async (req: Request, res: Response) => {
    try {
      const telefone = req.params.telefone;
      if (!TELEFONE.test(telefone)) return res.status(400).json({ error: 'Telefone inválido.' });
      if (req.body?.atendimento !== 'bot') return res.status(400).json({ error: 'Use Atender para pegar a conversa.' });
      await conferirTrava(res, telefone, true);
      await mudarAtendimento(res.locals.empresaId, telefone, 'bot');
      await marcarEvento(res.locals.empresaId, telefone, `Devolvido ao bot por ${res.locals.usuario?.nome ?? 'atendente'}`, res.locals.usuarioId);
      res.json({ success: true });
    } catch (err: any) {
      falha(res, err);
    }
  });

  /** Recebidas ainda não vistas, para a etiqueta do menu */
  router.get('/whatsapp/nao-vistas', async (_req: Request, res: Response) => {
    try {
      const [r] = await pool.query<any[]>(
        "SELECT COUNT(*) AS total FROM whatsapp_mensagens WHERE empresa_id = ? AND direcao = 'recebida' AND vista = 0",
        [res.locals.empresaId],
      );
      // Conversas passadas ao meu departamento que ninguém assumiu ainda (a tela toca o aviso sonoro)
      const [encaminhadas] = await pool.query<any[]>(
        `SELECT c.telefone, d.nome AS departamento, DATE_FORMAT(c.humano_desde, '%Y-%m-%d %H:%i:%s') AS desde,
                COALESCE((SELECT p.nome FROM whatsapp_mensagens w JOIN pessoas p ON p.id = w.pessoa_id
                           WHERE w.empresa_id = c.empresa_id AND w.telefone = c.telefone ORDER BY w.id DESC LIMIT 1), ${NOME_CONTATO('c')}) AS nome
           FROM whatsapp_conversas c JOIN departamentos d ON d.id = c.departamento_id
          WHERE c.empresa_id = ? AND c.atendimento = 'humano' AND c.atendente_id IS NULL
            AND c.departamento_id = (SELECT u.departamento_id FROM usuarios u WHERE u.id = ?)`,
        [res.locals.empresaId, res.locals.usuario.id],
      );
      // Última conversa transferida para mim por outra pessoa (evento da transferência): a tela toca a campainha
      const [t] = await pool.query<any[]>(
        `SELECT w.id, c.telefone, u.nome AS de,
                COALESCE((SELECT p.nome FROM whatsapp_mensagens x JOIN pessoas p ON p.id = x.pessoa_id
                           WHERE x.empresa_id = c.empresa_id AND x.telefone = c.telefone ORDER BY x.id DESC LIMIT 1), ${NOME_CONTATO('c')}) AS nome
           FROM whatsapp_conversas c
           JOIN whatsapp_mensagens w ON w.id = (SELECT MAX(e.id) FROM whatsapp_mensagens e
                                                 WHERE e.empresa_id = c.empresa_id AND e.telefone = c.telefone AND e.tipo = 'evento' AND e.texto LIKE ?)
           LEFT JOIN usuarios u ON u.id = w.usuario_id
          WHERE c.empresa_id = ? AND c.atendente_id = ? AND w.usuario_id <> ?
          ORDER BY w.id DESC LIMIT 1`,
        [`${TRANSFERIDO_PARA}%`, res.locals.empresaId, res.locals.usuario.id, res.locals.usuario.id],
      );
      // Conversas minhas em que o cliente espera a minha resposta há X minutos (Configurações › Chatbot): a tela toca
      // a campainha uma vez por mensagem. "ok, obrigado" não espera nada (o cron passa para aguardando: server/inatividade.ts)
      const minutos = minutosInatividade((await lerConfig(String(res.locals.empresaId), 'whatsapp', 'chatbot')) as any);
      const [e] = minutos
        ? await pool.query<any[]>(
            `SELECT m.id, c.telefone, m.tipo, m.texto,
                    COALESCE((SELECT p.nome FROM pessoas p WHERE p.id = m.pessoa_id), ${NOME_CONTATO('c')}) AS nome
               FROM whatsapp_conversas c
               JOIN whatsapp_mensagens m ON m.id = (SELECT MAX(z.id) FROM whatsapp_mensagens z
                                                     WHERE z.empresa_id = c.empresa_id AND z.telefone = c.telefone AND z.tipo <> 'evento')
              WHERE c.empresa_id = ? AND c.atendente_id = ? AND m.direcao = 'recebida' AND m.data_hora <= NOW() - INTERVAL ? MINUTE
              ORDER BY m.id DESC LIMIT 20`,
            [res.locals.empresaId, res.locals.usuario.id, minutos],
          )
        : [[]];
      const esperando = e.filter((m: any) => m.tipo !== 'texto' || !ehCortesia(m.texto)).map(({ id, telefone, nome }: any) => ({ id, telefone, nome }));
      res.json({ total: Number(r[0].total), encaminhadas, transferida: t[0] ?? null, esperando });
    } catch (err: any) {
      falha(res, err);
    }
  });

  /**
   * Conversas, da mais recente para a mais antiga, com a última mensagem, as não vistas e o
   * departamento escolhido no menu do chatbot. Estado "encerrado": atendimento encerrado e o cliente ainda não
   * escreveu de novo. ?minhas=1: as sem departamento, as do meu departamento
   * as que eu assumi e as dos clientes de que sou o técnico padrão.
   */
  router.get('/whatsapp/conversas', async (req: Request, res: Response) => {
    try {
      const busca = String(req.query.busca ?? '').trim().slice(0, 100);
      const digitos = busca.replace(/\D/g, '');
      const minhas = req.query.minhas === '1';
      const eu = res.locals.usuario.id;
      const chatbot: any = await lerConfig(String(res.locals.empresaId), 'whatsapp', 'chatbot');
      // A Automação de cada número: quem veio pelo WhatsApp das campanhas é atendido pela das campanhas
      const jornadas = { provedor: await lerJornadaConfig(res.locals.empresaId), campanhas: await lerJornadaConfig(res.locals.empresaId, 'campanhas') };
      const [rows] = await pool.query<any[]>(
        `SELECT w.telefone, x.pessoa_id, COALESCE(p.nome, ld.nome) AS nome, IF(x.pessoa_id, NULL, ld.id) AS lead_id, x.contato_id, c.nome AS contato_nome, COALESCE(c.departamento, c.cargo) AS contato_setor,
                ${NOME_CONTATO('w')} AS nome_contato, w.direcao, w.tipo, w.texto, w.arquivo_nome, w.situacao,
                DATE_FORMAT(w.data_hora, '%Y-%m-%d %H:%i:%s') AS data_hora, x.nao_vistas, x.encerrada, d.nome AS departamento,
                w.privado_departamento_id, (SELECT dp.nome FROM departamentos dp WHERE dp.id = w.privado_departamento_id) AS privado_departamento,
                wc.atendimento, wc.atendente_id, COALESCE(wc.conta, 'provedor') AS conta, ua.nome AS atendente_nome, tp.nome AS tecnico_padrao_nome, DATE_FORMAT(wc.atendido_em, '%Y-%m-%d %H:%i:%s') AS atendido_em,
                DATE_FORMAT(COALESCE(wc.humano_desde, w.data_hora), '%Y-%m-%d %H:%i:%s') AS aguardando_desde,
                -- Quando o cliente chegou: a 1ª mensagem dele depois do último encerramento
                (SELECT DATE_FORMAT(MIN(r.data_hora), '%Y-%m-%d %H:%i:%s') FROM whatsapp_mensagens r
                  WHERE r.empresa_id = w.empresa_id AND r.telefone = w.telefone AND r.direcao = 'recebida' AND r.id > COALESCE(x.ultimo_encerramento, 0)) AS chegou_em,
                -- Pausada: o último evento é a pausa, e depois dela não começou outra espera
                COALESCE(ev.texto LIKE 'Pausado por%' AND ev.data_hora >= COALESCE(wc.humano_desde, ev.data_hora), 0) AS pausada
           FROM (SELECT telefone, MAX(IF(tipo NOT IN ('encerramento', 'evento'), id, NULL)) AS ultima, ${PESSOA_RECENTE()} AS pessoa_id, ${CONTATO_RECENTE()} AS contato_id, ${LEAD_RECENTE()} AS lead_id,
                        MAX(IF(tipo = 'evento', id, NULL)) AS ultimo_evento,
                        MAX(IF(tipo = 'encerramento', id, NULL)) AS ultimo_encerramento,
                        SUM(direcao = 'recebida' AND vista = 0) AS nao_vistas,
                        -- Encerrado (botão, tempo ou fim da automação) e o cliente ainda não escreveu de novo (a nota da pesquisa não conta)
                        COALESCE(MAX(IF(tipo = 'encerramento', data_hora, NULL))
                                 > COALESCE(MAX(IF(direcao = 'recebida' AND (origem IS NULL OR origem NOT LIKE 'pesquisa%'), data_hora, NULL)), '1000-01-01'), 0) AS encerrada
                   FROM whatsapp_mensagens WHERE empresa_id = ? GROUP BY telefone HAVING ultima IS NOT NULL) x
           JOIN whatsapp_mensagens w ON w.id = x.ultima
           LEFT JOIN whatsapp_mensagens ev ON ev.id = x.ultimo_evento
           LEFT JOIN pessoas p ON p.id = x.pessoa_id
           LEFT JOIN leads ld ON ld.id = x.lead_id AND x.pessoa_id IS NULL
           LEFT JOIN pessoas_contatos c ON c.id = x.contato_id
           LEFT JOIN whatsapp_conversas wc ON wc.empresa_id = w.empresa_id AND wc.telefone = w.telefone
           LEFT JOIN departamentos d ON d.id = wc.departamento_id
           LEFT JOIN usuarios ua ON ua.id = wc.atendente_id
           LEFT JOIN usuarios tp ON tp.id = p.tecnico_padrao_id
          WHERE (? = '' OR p.nome LIKE ? OR ld.nome LIKE ? OR c.nome LIKE ? OR ${NOME_CONTATO('w')} LIKE ? OR (? <> '' AND w.telefone LIKE ?))
            AND (? = 0 OR wc.atendente_id = ?
                 OR (wc.atendente_id IS NULL AND (wc.departamento_id IS NULL OR p.tecnico_padrao_id = ?
                     OR wc.departamento_id = (SELECT u.departamento_id FROM usuarios u WHERE u.id = ?))))
          ORDER BY w.data_hora DESC, w.id DESC
          LIMIT 200`,
        [res.locals.empresaId, busca, `%${busca}%`, `%${busca}%`, `%${busca}%`, `%${busca}%`, digitos, `%${digitos}%`, minhas ? 1 : 0, eu, eu, eu],
      );
      // Estado: em atendimento (alguém pegou), aguardando (humano sem atendente; sem bot, quando o
      // cliente foi o último a escrever) ou com o bot
      res.json(
        rows.map(({ atendimento, atendente_id, encerrada, ...linha }) => {
          // Última mensagem privada de outro departamento: a prévia não mostra o conteúdo
          const r = mascararPrivada(res, linha);
          const comBot = jornadaAtende(r.conta === 'campanhas' ? jornadas.campanhas : jornadas.provedor, r.telefone);
          // Encerrada fica marcada até o cliente mandar mensagem de novo (aí começa outro ciclo)
          const estado = atendente_id
            ? 'atendimento'
            : Number(encerrada)
              ? 'encerrado'
            : atendimento === 'humano' || (!comBot && r.direcao === 'recebida')
              ? 'aguardando'
              : comBot
                ? 'bot'
                : null;
          return { ...r, atendente_id: atendente_id ?? null, estado, nao_vistas: Number(r.nao_vistas), pausada: estado === 'aguardando' && Boolean(Number(r.pausada)) };
        }),
      );
    } catch (err: any) {
      falha(res, err);
    }
  });

  /**
   * Imagem, figurinha, áudio, vídeo ou documento da mensagem, buscado no provedor (o arquivo não fica no CRM).
   * Documento vai como anexo (a tela baixa com o nome original): nunca é exibido pelo navegador no CRM.
   */
  /**
   * Marca (departamento_id) ou desmarca (null) a mensagem como privada. O administrador escolhe qualquer
   * departamento; os demais só o próprio, e só mexem no que conseguem ver.
   */
  router.post('/whatsapp/mensagens/:id/privada', async (req: Request, res: Response) => {
    try {
      const u = res.locals.usuario;
      const admin = u?.tipo === 'admin';
      const [rows] = await pool.query<any[]>('SELECT id, privado_departamento_id FROM whatsapp_mensagens WHERE id = ? AND empresa_id = ?', [
        Number(req.params.id) || 0,
        res.locals.empresaId,
      ]);
      if (!rows[0]) return res.status(404).json({ error: 'Mensagem não encontrada.' });
      if (!podeVerPrivada(res, rows[0].privado_departamento_id)) return res.status(403).json({ error: 'Mensagem privada de outro departamento.' });
      // privada: false = pública; senão o departamento escolhido (administrador) ou o do próprio usuário
      const dep = req.body?.privada === false ? null : Number(req.body?.departamento_id) || Number(u?.departamento_id) || null;
      if (req.body?.privada !== false && !dep) return res.status(400).json({ error: 'Você não está em nenhum departamento: peça ao administrador para marcar.' });
      if (dep) {
        if (!admin && dep !== Number(u?.departamento_id)) return res.status(403).json({ error: 'Você só pode deixar a mensagem privada do seu departamento.' });
        const [d] = await pool.query<any[]>('SELECT id FROM departamentos WHERE id = ? AND empresa_id = ?', [dep, res.locals.empresaId]);
        if (!d[0]) return res.status(400).json({ error: 'Departamento não encontrado.' });
      }
      await pool.query('UPDATE whatsapp_mensagens SET privado_departamento_id = ? WHERE id = ?', [dep, rows[0].id]);
      res.json({ success: true });
    } catch (err: any) {
      falha(res, err);
    }
  });

  /** Apagar para todos: só quem enviou pela tela, até 1 minuto depois (o cliente vê "Mensagem apagada") */
  router.delete('/whatsapp/mensagens/:id', async (req: Request, res: Response) => {
    try {
      const [r] = await pool.query<any[]>(
        `SELECT id, telefone, wa_id, TIMESTAMPDIFF(SECOND, data_hora, NOW()) AS idade FROM whatsapp_mensagens
          WHERE id = ? AND empresa_id = ? AND direcao = 'enviada' AND usuario_id = ? AND tipo NOT IN ('evento', 'encerramento', 'apagada')`,
        [Number(req.params.id) || 0, res.locals.empresaId, res.locals.usuarioId],
      );
      if (!r[0]) return res.status(404).json({ error: 'Mensagem não encontrada, ou não foi você quem enviou.' });
      if (!r[0].wa_id) return res.status(400).json({ error: 'Essa mensagem não chegou ao WhatsApp.' });
      // 1 minuto + folga para o tempo da confirmação na tela
      if (Number(r[0].idade) > 70) return res.status(400).json({ error: 'Só dá para apagar até 1 minuto depois do envio.' });
      await apagarParaTodos(res.locals.empresaId, r[0].telefone, r[0].wa_id);
      await pool.query("UPDATE whatsapp_mensagens SET tipo = 'apagada', texto = NULL, arquivo_nome = NULL WHERE id = ?", [r[0].id]);
      res.json({ success: true });
    } catch (err: any) {
      falha(res, err);
    }
  });

  router.get('/whatsapp/mensagens/:id/midia', async (req: Request, res: Response) => {
    try {
      const [rows] = await pool.query<any[]>(
        "SELECT wa_id, tipo, arquivo_nome, telefone, privado_departamento_id, disparo_id FROM whatsapp_mensagens WHERE id = ? AND empresa_id = ? AND tipo IN ('imagem', 'figurinha', 'audio', 'video', 'documento')",
        [Number(req.params.id) || 0, res.locals.empresaId],
      );
      if (!rows[0]?.wa_id) return res.status(404).json({ error: 'Arquivo não encontrado.' });
      if (!podeVerPrivada(res, rows[0].privado_departamento_id)) return res.status(403).json({ error: 'Mensagem privada de outro departamento.' });
      // Campanha sai pelo número das campanhas, mesmo que a conversa seja do principal (o cliente ainda não respondeu)
      const { mimetype, dados } = await midiaDaMensagem(res.locals.empresaId, rows[0].wa_id, rows[0].telefone, rows[0].disparo_id ? 'campanhas' : undefined);
      res.set({ 'Cache-Control': 'private, max-age=86400', 'X-Content-Type-Options': 'nosniff' });
      if (rows[0].tipo === 'documento') return res.attachment(rows[0].arquivo_nome || 'arquivo').type(mimetype).send(dados);
      if (!/^(image|audio|video)\//.test(mimetype)) return res.status(415).json({ error: 'Tipo de arquivo não exibível.' });
      res.type(mimetype).send(dados);
    } catch (err: any) {
      falha(res, err);
    }
  });

  /**
   * Mensagens da conversa (as 300 mais recentes, em ordem) e a pessoa. Abrir marca as recebidas
   * como vistas. Conversa sem pessoa tenta achá-la de novo (ela pode ter sido cadastrada depois).
   */
  router.get('/whatsapp/conversas/:telefone', async (req: Request, res: Response) => {
    try {
      const emp = res.locals.empresaId;
      const telefone = req.params.telefone;
      if (!TELEFONE.test(telefone)) return res.status(400).json({ error: 'Telefone inválido.' });
      const [ult] = await pool.query<any[]>(
        `SELECT ${PESSOA_RECENTE('w.')} AS pessoa_id, ${CONTATO_RECENTE('w.')} AS contato_id, ${NOME_CONTATO('w')} AS nome_contato
           FROM whatsapp_mensagens w WHERE w.empresa_id = ? AND w.telefone = ?
          GROUP BY w.empresa_id, w.telefone`,
        [emp, telefone],
      );
      let pessoaId: number | null = ult[0]?.pessoa_id ?? null;
      let contatoId: number | null = ult[0]?.contato_id ?? null;
      let leadId: number | null = null;
      if (!pessoaId) {
        let lead: number | null | undefined;
        ({ pessoa_id: pessoaId, contato_id: contatoId, lead_id: lead } = await donoDoTelefone(emp, telefone));
        if (pessoaId) {
          await pool.query('UPDATE whatsapp_mensagens SET pessoa_id = ?, contato_id = ?, lead_id = NULL WHERE empresa_id = ? AND telefone = ? AND pessoa_id IS NULL', [pessoaId, contatoId, emp, telefone]);
        } else if (lead) {
          // Lead cadastrado depois das mensagens (Cadastrar da conversa): liga as que estão sem dono
          leadId = lead;
          await pool.query('UPDATE whatsapp_mensagens SET lead_id = ? WHERE empresa_id = ? AND telefone = ? AND pessoa_id IS NULL AND lead_id IS NULL', [lead, emp, telefone]);
        }
      }
      await pool.query("UPDATE whatsapp_mensagens SET vista = 1 WHERE empresa_id = ? AND telefone = ? AND direcao = 'recebida' AND vista = 0", [emp, telefone]);
      const [mensagens] = await pool.query<any[]>(
        `SELECT * FROM (
           SELECT w.id, w.direcao, w.tipo, w.texto, w.arquivo_nome, w.situacao, u.nome AS usuario_nome, w.resposta_de,
                  rq.direcao AS resposta_direcao, rq.tipo AS resposta_tipo, rq.texto AS resposta_texto, rq.arquivo_nome AS resposta_arquivo,
                  rq.privado_departamento_id AS resposta_privado_id,
                  w.privado_departamento_id, dp.nome AS privado_departamento,
                  (w.disparo_id IS NOT NULL) AS campanha, (w.origem IS NOT NULL AND w.origem NOT LIKE 'bot:%') AS automatica,
                  (w.origem LIKE 'bot:%') AS bot, w.erro, DATE_FORMAT(w.data_hora, '%Y-%m-%d %H:%i:%s') AS data_hora,
                  -- Segundos que faltam para quem enviou poder apagar (1 minuto); null = não pode
                  IF(w.usuario_id = ? AND w.direcao = 'enviada' AND w.wa_id IS NOT NULL AND w.tipo <> 'apagada'
                       AND TIMESTAMPDIFF(SECOND, w.data_hora, NOW()) < 60, 60 - TIMESTAMPDIFF(SECOND, w.data_hora, NOW()), NULL) AS apagar_seg
             FROM whatsapp_mensagens w LEFT JOIN usuarios u ON u.id = w.usuario_id
             LEFT JOIN departamentos dp ON dp.id = w.privado_departamento_id
             LEFT JOIN whatsapp_mensagens rq ON rq.id = w.resposta_de
            WHERE w.empresa_id = ? AND w.telefone = ?
            ORDER BY w.data_hora DESC, w.id DESC LIMIT 300) m
          ORDER BY m.data_hora, m.id`,
        [res.locals.usuarioId, emp, telefone],
      );
      const [pessoa] = pessoaId ? await pool.query<any[]>('SELECT id, nome FROM pessoas WHERE id = ? AND empresa_id = ?', [pessoaId, emp]) : [[]];
      const [lead] = leadId ? await pool.query<any[]>('SELECT id, nome FROM leads WHERE id = ? AND empresa_id = ?', [leadId, emp]) : [[]];
      const [contato] = contatoId
        ? await pool.query<any[]>('SELECT id, nome, cargo, departamento FROM pessoas_contatos WHERE id = ? AND empresa_id = ?', [contatoId, emp])
        : [[]];
      // Situação do atendimento: com o bot (ou jornada), aguardando alguém atender ou em atendimento
      const chatbot: any = await lerConfig(String(emp), 'whatsapp', 'chatbot');
      const conta = await contaDaConversa(emp, telefone);
      const comBot = jornadaAtende(await lerJornadaConfig(emp, conta), telefone);
      const atendimento = await atendimentoAtual(emp, telefone, minutosDevolver(chatbot));
      const [cv] = await pool.query<any[]>(
        `SELECT d.nome AS departamento, c.atendente_id, u.nome AS atendente_nome, DATE_FORMAT(c.atendido_em, '%Y-%m-%d %H:%i:%s') AS atendido_em,
                DATE_FORMAT(c.humano_desde, '%Y-%m-%d %H:%i:%s') AS aguardando_desde, ${ENCERRAVEL} AS encerravel,
                -- Encerrada e o cliente ainda não escreveu de novo (resposta de pesquisa/cortesia não conta): como na lista
                (SELECT COALESCE(MAX(IF(w.tipo = 'encerramento', w.data_hora, NULL))
                          > COALESCE(MAX(IF(w.direcao = 'recebida' AND (w.origem IS NULL OR w.origem NOT LIKE 'pesquisa%'), w.data_hora, NULL)), '1000-01-01'), 0)
                   FROM whatsapp_mensagens w WHERE w.empresa_id = c.empresa_id AND w.telefone = c.telefone) AS encerrada
           FROM whatsapp_conversas c LEFT JOIN departamentos d ON d.id = c.departamento_id LEFT JOIN usuarios u ON u.id = c.atendente_id
          WHERE c.empresa_id = ? AND c.telefone = ?`,
        [emp, telefone],
      );
      const c = cv[0] ?? {};
      const estado = c.atendente_id ? 'atendimento' : Number(c.encerrada) ? 'encerrado' : atendimento === 'humano' || !comBot ? 'aguardando' : 'bot';
      res.json({
        pessoa: pessoa[0] ?? null,
        lead: lead[0] ?? null,
        contato: contato[0] ?? null,
        atendimento: comBot ? atendimento : null,
        estado,
        atendente: c.atendente_id ? { id: c.atendente_id, nome: c.atendente_nome } : null,
        atendido_em: c.atendido_em ?? null,
        aguardando_desde: c.aguardando_desde ?? null,
        eu_atendo: Boolean(c.atendente_id) && Number(c.atendente_id) === Number(res.locals.usuarioId),
        sou_admin: res.locals.usuario?.tipo === 'admin',
        com_bot: comBot,
        /** Número por onde o cliente escreveu por último: a tela já vem com ele escolhido para responder */
        conta,
        /** Há WhatsApp das campanhas configurado: a tela mostra a escolha do número */
        tem_campanhas: Boolean(((await lerConfig(String(emp), 'whatsapp', 'campanhas')) as any)?.provedor),
        encerravel: Boolean(Number(c.encerravel)),
        departamento: c.departamento ?? null, bot_nome: chatbot?.nome || null, nome_contato: ult[0]?.nome_contato ?? null, mensagens: mensagens.map(({ resposta_de, resposta_direcao, resposta_tipo, resposta_texto, resposta_arquivo, resposta_privado_id, ...m }) =>
          mascararPrivada(res, {
            ...m,
            campanha: Boolean(m.campanha),
            automatica: Boolean(m.automatica),
            bot: Boolean(m.bot),
            // Mensagem citada (resposta): privada de outro departamento vai sem o conteúdo
            resposta: resposta_de
              ? {
                  id: resposta_de,
                  direcao: resposta_direcao ?? null,
                  tipo: resposta_tipo ?? null,
                  texto: resposta_privado_id && !podeVerPrivada(res, resposta_privado_id) ? null : (resposta_texto ?? null),
                  arquivo_nome: resposta_privado_id && !podeVerPrivada(res, resposta_privado_id) ? null : (resposta_arquivo ?? null),
                }
              : null,
          }),
        ) });
    } catch (err: any) {
      falha(res, err);
    }
  });

  /**
   * Responde pela tela: texto enviado pelo WhatsApp da empresa, registrado com o usuário. Devolve o
   * número da conversa (pode vir sem o 9) e se concluiu a atividade que abriu a conversa
   */
  router.post('/whatsapp/conversas/:telefone', async (req: Request, res: Response) => {
    try {
      const emp = res.locals.empresaId;
      const telefone = req.params.telefone;
      if (!TELEFONE.test(telefone)) return res.status(400).json({ error: 'Telefone inválido.' });
      const texto = String(req.body?.texto ?? '').trim();
      // Com arquivo, o texto é a legenda (áudio não tem legenda)
      const a = req.body?.arquivo;
      let arquivo: ArquivoEnvio | null = null;
      if (a) {
        if (!['imagem', 'video', 'audio', 'documento'].includes(a.tipo) || typeof a.base64 !== 'string' || !a.base64) {
          return res.status(400).json({ error: 'Arquivo inválido.' });
        }
        const mimetype = String(a.mimetype || 'application/octet-stream').slice(0, 100);
        const nome = String(a.nome || 'arquivo').replace(/[\\/]/g, '_').slice(0, 150);
        arquivo = { tipo: a.tipo, base64: a.base64, mimetype, nome, legenda: a.tipo === 'audio' ? null : texto || null };
      }
      if (!texto && !arquivo) return res.status(400).json({ error: 'Digite a mensagem.' });
      if (texto.length > 4000) return res.status(400).json({ error: 'Mensagem grande demais (máximo de 4.000 caracteres).' });
      const [ult] = await pool.query<any[]>(
        `SELECT ${PESSOA_RECENTE()} AS pessoa_id, ${CONTATO_RECENTE()} AS contato_id FROM whatsapp_mensagens WHERE empresa_id = ? AND telefone = ?`,
        [emp, telefone],
      );
      // Em atendimento com outro: recusa. Ninguém atendendo: quem responde pega a conversa (o bot para)
      const dono = await conferirTrava(res, telefone, false);
      if (!dono) await atender(res, telefone, null);
      const reg = { pessoa_id: ult[0]?.pessoa_id ?? null, contato_id: ult[0]?.contato_id ?? null, usuario_id: res.locals.usuarioId };
      // Vários atendentes na mesma conversa: o cliente vê quem escreveu ("*Luis:* ...")
      const assinatura = String(res.locals.usuario?.nome ?? '').trim() || undefined;
      // Responder: a mensagem escolhida aparece citada no WhatsApp do cliente
      const citacao = await citacaoDa(emp, telefone, req.body?.resposta_de);
      // Número escolhido na tela (padrão: por onde o cliente escreveu por último)
      const conta = req.body?.conta ? contaWhats(req.body.conta) : await contaDaConversa(emp, telefone);
      const numero = arquivo
        ? await enviarMidiaWhatsApp(emp, telefone, arquivo, reg, assinatura, citacao, conta)
        : await enviarWhatsApp(emp, telefone, texto, reg, assinatura, citacao, conta);
      // Conversa aberta pela atividade WhatsApp: a mensagem enviada conclui a atividade
      let concluida = false;
      const atividadeId = Number(req.body?.atividade_id) || null;
      if (atividadeId) {
        const [r] = await pool.query<any>(
          'UPDATE atividades SET concluida = 1, concluida_por = ?, concluida_em = COALESCE(concluida_em, NOW()) WHERE id = ? AND empresa_id = ? AND concluida = 0',
          [Number(res.locals.usuarioId) || null, atividadeId, emp],
        );
        concluida = r.affectedRows > 0;
        if (concluida) {
          const [a] = await pool.query<any[]>('SELECT negocio_id FROM atividades WHERE id = ?', [atividadeId]);
          if (a[0]?.negocio_id) await sincronizarNegocio(a[0].negocio_id);
        }
      }
      res.json({ success: true, telefone: numero, atividade_concluida: concluida });
    } catch (err: any) {
      falha(res, err);
    }
  });

  return router;
}
