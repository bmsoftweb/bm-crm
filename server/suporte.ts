import crypto from 'node:crypto';
import express, { Router, Request, Response } from 'express';
import { pool } from './db.js';
import { chamarBmdesk } from './bmdesk.js';
import { fecharSecao, gravarMensagem, NR_FILA } from './chamados.js';
import { registrarLead } from './chatbot.js';
import { donoDoTelefone, telefoneWhatsApp } from './whatsapp.js';
import { notificar } from './notificacoes.js';
import { bmhelpLigado, perguntarBmhelp, sistemasBmhelp } from './bmhelp.js';
import { erroCelular } from '../src/utils/formatters.js';

/**
 * Suporte pelo site (widget público, sem login): public/widget.js abre a página /suporte?e=<empresa>,
 * onde o cliente abre um chamado (CNPJ/CPF, nome, WhatsApp, categoria e descrição) e conversa com a
 * equipe. O chamado cai na Fila de Chamados (server/chamados.ts) com canal "web".
 *
 * O CNPJ só serve para ligar o chamado à Pessoa do CRM: ver o chamado e as mensagens exige o token
 * assinado que só o navegador que abriu recebe (quem digita o CNPJ de outra empresa não vê nada dela).
 * O cliente não vê notas internas nem os eventos da equipe; vê a posição na fila e quem atende.
 */

// Sem SESSION_SECRET, um segredo aleatório (os links valem até o servidor reiniciar)
const SEGREDO = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');

function erro(status: number, msg: string) {
  return Object.assign(new Error(msg), { status });
}

/** Token do chamado para o navegador do cliente: "<id>.<assinatura>" */
export function tokenSuporte(chamadoId: number): string {
  const ass = crypto.createHmac('sha256', SEGREDO).update(`suporte:${chamadoId}`).digest('base64url').slice(0, 32);
  return `${chamadoId}.${ass}`;
}

/** Id do chamado do token, ou null se a assinatura não bate */
export function chamadoDoToken(token: string): number | null {
  const [id] = String(token || '').split('.');
  const n = Number(id);
  if (!Number.isInteger(n) || n < 1) return null;
  const esperado = tokenSuporte(n);
  return esperado.length === token.length && crypto.timingSafeEqual(Buffer.from(esperado), Buffer.from(token)) ? n : null;
}

/**
 * Assistente (bm-help, server/bmhelp.ts): enquanto o cliente espera na fila sem técnico, ele escolhe o sistema e
 * a IA responde a dúvida do chamado e as mensagens seguintes. Para sozinho quando um técnico assume.
 * Banco: chamados.bmhelp_sistema_id / bmhelp_sessao e o autor 'assistente' em chamado_mensagens
 * (extras/bmhelp_assistente.sql); só são lidos com o bm-help configurado
 */
const LIMITE_ASSISTENTE = 10;
const assistenteAtivo = (c: any) => bmhelpLigado() && !c.atendente_id && !['encerrado', 'cancelado'].includes(c.status);

/** Pergunta ao bm-help pelo chamado e grava a resposta como mensagem do assistente */
async function responderAssistente(chamadoId: number, pergunta: string) {
  const [[a]] = await pool.query<any[]>(
    `SELECT bmhelp_sistema_id, bmhelp_sessao,
            (SELECT COUNT(*) FROM chamado_mensagens m WHERE m.chamado_id = c.id AND m.autor = 'assistente') AS qtd
       FROM chamados c WHERE c.id = ?`,
    [chamadoId],
  );
  if (!a?.bmhelp_sistema_id) return;
  const qtd = Number(a.qtd);
  // Teto de custo por chamado: avisa uma vez e para
  if (qtd >= LIMITE_ASSISTENTE) {
    if (qtd === LIMITE_ASSISTENTE) {
      await gravarMensagem({ chamado_id: chamadoId, autor: 'assistente', texto: 'Chegamos ao limite de perguntas ao assistente neste atendimento. Um técnico já vai falar com você.' });
    }
    return;
  }
  let resposta: string;
  try {
    const r = await perguntarBmhelp(Number(a.bmhelp_sistema_id), pergunta, a.bmhelp_sessao || null);
    if (r.sessao && r.sessao !== a.bmhelp_sessao) await pool.query('UPDATE chamados SET bmhelp_sessao = ? WHERE id = ?', [r.sessao.slice(0, 100), chamadoId]);
    resposta = r.texto || 'Não encontrei uma resposta para isso. Um técnico já vai falar com você.';
  } catch (err: any) {
    console.error(`Suporte (assistente): ${err.message}`);
    resposta = 'Não consegui consultar agora. Um técnico já vai falar com você.';
  }
  await gravarMensagem({ chamado_id: chamadoId, autor: 'assistente', texto: resposta });
}

const digitos = (v: unknown, max: number) => String(v ?? '').replace(/\D/g, '').slice(0, max);
const texto = (v: unknown, max: number) => String(v ?? '').trim().slice(0, max);

export function createSuporteRouter(): Router {
  const router = Router();
  const rota =
    (fn: (req: Request, res: Response) => Promise<any>) =>
    async (req: Request, res: Response) => {
      try {
        await fn(req, res);
      } catch (err: any) {
        if (!err.status) console.error(`Suporte (site): ${err.message}`);
        res.status(err.status || 500).json({ error: err.status ? err.message : 'Não foi possível concluir agora. Tente de novo em instantes.' });
      }
    };

  /** Chamado do token (e da empresa dele) */
  async function doToken(token: string) {
    const id = chamadoDoToken(token);
    if (!id) throw erro(404, 'Atendimento não encontrado.');
    const [r] = await pool.query<any[]>(
      `SELECT c.id, c.empresa_id, c.numero, c.titulo, c.status, c.pessoa_id, c.atendente_id, c.departamento_id, c.criado_em, c.contato_telefone,
              u.nome AS atendente_nome,
              -- Mesmo número da tela do técnico (Chamados): posição entre os abertos, por ordem de chegada
              ${NR_FILA} AS posicao,
              EXISTS (SELECT 1 FROM chamado_mensagens m WHERE m.chamado_id = c.id AND m.autor = 'sistema' AND m.texto LIKE 'Cliente avaliou%') AS avaliado
         FROM chamados c LEFT JOIN usuarios u ON u.id = c.atendente_id WHERE c.id = ?`,
      [id],
    );
    if (!r[0]) throw erro(404, 'Atendimento não encontrado.');
    return r[0];
  }

  /** Empresa e categorias, para montar o formulário */
  router.get('/api/publico/suporte/:empresa', rota(async (req, res) => {
    const [e] = await pool.query<any[]>('SELECT id, nome, logo FROM empresas WHERE id = ?', [Number(req.params.empresa) || 0]);
    if (!e[0]) throw erro(404, 'Suporte não encontrado.');
    const [cats] = await pool.query<any[]>('SELECT id, nome FROM chamado_categorias WHERE empresa_id = ? AND ativo = 1 ORDER BY nome', [e[0].id]);
    res.json({ empresa: { nome: e[0].nome, logo: e[0].logo }, categorias: cats });
  }));

  /**
   * Visita ao site com o widget (uma por aba do navegador; o widget.js controla). Vem como text/plain
   * para o navegador não fazer a consulta prévia de CORS (o site é de outro endereço)
   */
  const corpoTexto = express.text({ type: 'text/plain', limit: '8kb' });
  const jsonDoTexto = (corpo: unknown): any => {
    if (typeof corpo !== 'string') return corpo || {};
    try {
      return JSON.parse(corpo);
    } catch {
      return {};
    }
  };
  /** Chave da visita gerada pelo widget (UUID ou equivalente) */
  const chaveVisita = (v: unknown) => {
    const s = String(v ?? '');
    return /^[\w-]{8,36}$/.test(s) ? s : null;
  };

  /** Pessoa do CRM com esse CNPJ/CPF (ou null) */
  const pessoaDoDocumento = async (empresaId: number, documento: string): Promise<number | null> => {
    if (!documento) return null;
    const [p] = await pool.query<any[]>('SELECT id FROM pessoas WHERE empresa_id = ? AND cpf = ? ORDER BY id LIMIT 1', [empresaId, documento]);
    return p[0]?.id ?? null;
  };

  router.post('/api/publico/suporte/:empresa/visitas', corpoTexto, rota(async (req, res) => {
    const empresaId = Number(req.params.empresa) || 0;
    const b = jsonDoTexto(req.body);
    const documento = digitos(b.cnpj, 14);
    const ip = String(req.get('x-forwarded-for')?.split(',')[0] || req.socket.remoteAddress || '').trim().slice(0, 45);
    // Empresa inexistente não grava (o SELECT não devolve linha)
    const [visita] = await pool.query<any>(
      `INSERT INTO site_visitas (empresa_id, chave, pagina, titulo, origem, documento, pessoa_id, cliente_nome, navegador, ip)
       SELECT id, ?, ?, ?, ?, ?, ?, ?, ?, ? FROM empresas WHERE id = ?`,
      [chaveVisita(b.chave), texto(b.pagina, 500), texto(b.titulo, 200), texto(b.origem, 500) || null, documento || null,
        await pessoaDoDocumento(empresaId, documento), texto(b.nome, 120) || null, texto(req.get('user-agent'), 300) || null, ip || null, empresaId],
    );
    // Quem acessa Visitas do Site fica sabendo (a campainha do cabeçalho)
    if (visita.insertId) {
      await notificar(empresaId, { tela: 'site_visitas' }, {
        tipo: 'visita_site',
        titulo: texto(b.nome, 120) ? `${texto(b.nome, 120)} entrou no site` : 'Alguém entrou no site',
        texto: texto(b.titulo, 200) || texto(b.pagina, 500),
        link: 'site_visitas',
        registroId: Number(visita.insertId),
      });
    }
    res.status(204).end();
  }));

  /** O cliente se identificou no chat (dados salvos ou chamado aberto): nome e CNPJ/CPF na visita */
  router.post('/api/publico/suporte/:empresa/visitas/cliente', corpoTexto, rota(async (req, res) => {
    const empresaId = Number(req.params.empresa) || 0;
    const b = jsonDoTexto(req.body);
    const chave = chaveVisita(b.chave);
    const documento = digitos(b.cnpj, 14);
    const nome = texto(b.nome, 120);
    if (chave && (nome || documento)) {
      await pool.query(
        `UPDATE site_visitas SET cliente_nome = COALESCE(?, cliente_nome), documento = COALESCE(?, documento), pessoa_id = COALESCE(?, pessoa_id)
          WHERE empresa_id = ? AND chave = ?`,
        [nome || null, documento || null, await pessoaDoDocumento(empresaId, documento), empresaId, chave],
      );
    }
    res.status(204).end();
  }));

  /** Saída do site (sendBeacon do widget ao esconder/fechar a página): a última hora fica valendo */
  router.post('/api/publico/suporte/:empresa/visitas/saida', corpoTexto, rota(async (req, res) => {
    const chave = chaveVisita(jsonDoTexto(req.body).chave);
    if (chave) {
      await pool.query('UPDATE site_visitas SET saida_em = NOW() WHERE empresa_id = ? AND chave = ?', [Number(req.params.empresa) || 0, chave]);
    }
    res.status(204).end();
  }));

  /**
   * Ainda no site (widget, a cada minuto com a página à vista): a saída fica 90 s à frente. Enquanto chegar,
   * a visita aparece como "Visitando..."; se parar (navegador fechado sem aviso), a saída fica perto da última vez
   */
  router.post('/api/publico/suporte/:empresa/visitas/presente', corpoTexto, rota(async (req, res) => {
    const chave = chaveVisita(jsonDoTexto(req.body).chave);
    if (chave) {
      await pool.query('UPDATE site_visitas SET saida_em = NOW() + INTERVAL 90 SECOND WHERE empresa_id = ? AND chave = ?', [Number(req.params.empresa) || 0, chave]);
    }
    res.status(204).end();
  }));

  /**
   * Lead do site (formulário "Agendar Apresentação" da homepage): mesmo caminho do lead do chatbot
   * (pessoa, negócio no funil para o próximo vendedor do revezamento e atividade de contato).
   * Quem já está no CRM pelo WhatsApp ou e-mail ganha o negócio/atividade sem novo cadastro.
   * ponytail: sem limite por IP; o campo-isca "site" barra robôs simples. Captcha se aparecer spam
   */
  router.post('/api/publico/leads/:empresa', rota(async (req, res) => {
    const empresaId = Number(req.params.empresa) || 0;
    const [e] = await pool.query<any[]>('SELECT id FROM empresas WHERE id = ?', [empresaId]);
    if (!e[0]) throw erro(404, 'Empresa não encontrada.');
    const b = req.body || {};
    // Campo escondido no formulário: pessoa não preenche, robô sim. Responde ok e não grava
    if (texto(b.site, 200)) return void res.json({ ok: true });
    const nome = texto(b.nome, 120);
    const empresa = texto(b.empresa, 255);
    const email = texto(b.email, 255);
    const interesse = texto(b.interesse, 200);
    const mensagem = texto(b.mensagem, 2000);
    if (nome.length < 2) throw erro(400, 'Informe o seu nome.');
    if (!interesse) throw erro(400, 'Escolha o sistema de interesse.');
    let telefone: string;
    try {
      telefone = telefoneWhatsApp(b.telefone);
    } catch {
      throw erro(400, 'Informe o seu WhatsApp com DDD.');
    }
    let dono = await donoDoTelefone(empresaId, telefone);
    if (!dono.pessoa_id && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      const [p] = await pool.query<any[]>('SELECT id FROM pessoas WHERE empresa_id = ? AND email = ? ORDER BY id LIMIT 1', [empresaId, email]);
      if (p[0]) dono = { pessoa_id: p[0].id, contato_id: null };
    }
    const r: any = await registrarLead(
      { empresaId, telefone, dono, departamento: null },
      { nome, empresa, email, interesse },
      {
        origem: 'Site',
        assunto: 'Agendar apresentação (site)',
        observacao: [email && `E-mail: ${email}`, mensagem && `Mensagem: ${mensagem}`].filter(Boolean).join('\n') || undefined,
      },
    );
    if (!r.ok) {
      console.error(`Lead do site não registrado: ${r.erro}`);
      throw erro(500, 'Não foi possível registrar agora. Tente de novo em instantes.');
    }
    res.json({ ok: true });
  }));

  /** Abre o chamado; devolve o token que dá acesso a ele */
  router.post('/api/publico/suporte/:empresa/chamados', rota(async (req, res) => {
    const empresaId = Number(req.params.empresa) || 0;
    const [e] = await pool.query<any[]>('SELECT id FROM empresas WHERE id = ?', [empresaId]);
    if (!e[0]) throw erro(404, 'Suporte não encontrado.');
    const b = req.body || {};
    const documento = digitos(b.documento, 14);
    const nome = texto(b.nome, 120);
    const telefone = digitos(b.telefone, 20);
    const descricao = texto(b.descricao, 4000);
    if (documento.length !== 11 && documento.length !== 14) throw erro(400, 'Informe o CNPJ (ou CPF) da empresa.');
    if (nome.length < 2) throw erro(400, 'Informe o seu nome.');
    // Fixo (opcional): com DDD; vai em chamados.contato_fixo e na mensagem de abertura do chamado
    const fixo = digitos(b.fixo, 13);
    if (fixo && fixo.length < 10) throw erro(400, 'Informe o telefone fixo com DDD (ou deixe em branco).');
    // Celular: DDD que existe + 9 + 8 dígitos (com ou sem o 55), sem todos os dígitos iguais
    const motivo = erroCelular(telefone);
    if (motivo) throw erro(400, motivo);
    if (descricao.length < 5) throw erro(400, 'Conte o que está acontecendo.');
    const titulo = texto(b.titulo, 200) || descricao.split('\n')[0].slice(0, 80);
    let categoriaId: number | null = Number(b.categoria_id) || null;
    let slaHoras: number | null = null;
    if (categoriaId) {
      const [cat] = await pool.query<any[]>('SELECT sla_horas FROM chamado_categorias WHERE id = ? AND empresa_id = ? AND ativo = 1', [categoriaId, empresaId]);
      if (!cat[0]) categoriaId = null;
      else slaHoras = Number(cat[0].sla_horas) || null;
    }
    // Cliente do CRM pelo CNPJ/CPF (sem ele, o chamado fica com o nome e o WhatsApp de quem abriu)
    const [p] = await pool.query<any[]>('SELECT id FROM pessoas WHERE empresa_id = ? AND cpf = ? ORDER BY id LIMIT 1', [empresaId, documento]);
    const pessoaId = p[0]?.id ?? null;

    const conn = await pool.getConnection();
    let id: number;
    let numero: number;
    try {
      await conn.beginTransaction();
      const [[{ n }]] = await conn.query<any>('SELECT COALESCE(MAX(numero), 0) + 1 AS n FROM chamados WHERE empresa_id = ? FOR UPDATE', [empresaId]);
      numero = Number(n);
      const [ins] = await conn.query<any>(
        `INSERT INTO chamados (empresa_id, numero, pessoa_id, categoria_id, titulo, descricao, status, prioridade, canal,
                               contato_nome, contato_telefone, contato_fixo, contato_documento, sla_prazo)
         VALUES (?, ?, ?, ?, ?, ?, 'aguardando', 'normal', 'web', ?, ?, ?, ?, IF(? IS NULL, NULL, NOW() + INTERVAL ? HOUR))`,
        [empresaId, numero, pessoaId, categoriaId, titulo, descricao, nome, telefone, fixo || null, documento, slaHoras, slaHoras ?? 0],
      );
      id = Number(ins.insertId);
      await conn.commit();
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
    await gravarMensagem({
      chamado_id: id,
      autor: 'sistema',
      // Aberto pelo BM-ClientChat (programa na máquina do cliente): vem o nome do computador
      texto: `Chamado aberto pelo cliente ${texto(b.pc, 60) ? `no BM-ClientChat, computador "${texto(b.pc, 60)}"` : 'no site'}: ${nome}, WhatsApp ${telefone}${fixo ? `, telefone fixo ${fixo}` : ''}${pessoaId ? '' : ` (CNPJ/CPF ${documento} não está no CRM)`}.`,
    });
    await notificar(empresaId, { tela: 'chamados_fila' }, {
      tipo: 'chamado',
      titulo: `Chamado nº ${numero} na fila`,
      texto: `${nome}: ${titulo}`,
      link: 'chamados_ativos',
      registroId: id,
    });
    res.json({ token: tokenSuporte(id), numero });
  }));

  /** Situação e conversa (sem notas internas nem eventos da equipe) */
  router.get('/api/publico/suporte/chamado/:token', rota(async (req, res) => {
    const c = await doToken(req.params.token);
    const [msgs] = await pool.query<any[]>(
      `SELECT m.id, m.autor, m.texto, m.criado_em, u.nome AS usuario_nome
         FROM chamado_mensagens m LEFT JOIN usuarios u ON u.id = m.usuario_id
        WHERE m.chamado_id = ? AND m.autor IN ('cliente','equipe','assistente') AND m.interna = 0 ORDER BY m.id`,
      [c.id],
    );
    // Assistente: oferecido enquanto ninguém assumiu; sistema = o que o cliente escolheu (null = ainda não escolheu)
    let assistente: { sistema: string | null } | null = null;
    if (assistenteAtivo(c)) {
      const [[a]] = await pool.query<any[]>('SELECT bmhelp_sistema_id FROM chamados WHERE id = ?', [c.id]);
      const id = Number(a?.bmhelp_sistema_id) || null;
      const sistemas = id ? await sistemasBmhelp().catch(() => []) : [];
      assistente = { sistema: id ? (sistemas.find((s) => s.id === id)?.nome ?? 'escolhido') : null };
    }
    res.json({
      numero: c.numero,
      titulo: c.titulo,
      status: c.status,
      atendente: c.atendente_nome ?? null,
      // Só enquanto espera um técnico; assumido ou encerrado: null
      posicao: c.posicao == null ? null : Number(c.posicao),
      avaliado: Boolean(Number(c.avaliado)),
      assistente,
      mensagens: msgs,
    });
  }));

  router.post('/api/publico/suporte/chamado/:token/mensagens', rota(async (req, res) => {
    const c = await doToken(req.params.token);
    if (['encerrado', 'cancelado'].includes(c.status)) throw erro(409, 'Este atendimento foi encerrado. Abra um novo, se precisar.');
    const msg = texto(req.body?.texto, 4000);
    if (!msg) throw erro(400, 'Escreva a mensagem.');
    await gravarMensagem({ chamado_id: c.id, autor: 'cliente', texto: msg });
    // Sem técnico e com o sistema escolhido: o assistente responde (a requisição espera a resposta)
    if (assistenteAtivo(c)) await responderAssistente(c.id, msg);
    res.json({ success: true });
  }));

  /** Sistemas que o assistente conhece (o cliente escolhe sobre qual é a dúvida) */
  router.get('/api/publico/suporte/chamado/:token/assistente/sistemas', rota(async (req, res) => {
    const c = await doToken(req.params.token);
    if (!assistenteAtivo(c)) throw erro(409, 'O assistente não está disponível neste atendimento.');
    res.json(await sistemasBmhelp().catch((e) => {
      console.error(`Suporte (assistente): ${e.message}`);
      throw erro(503, 'O assistente está indisponível agora. Um técnico já vai falar com você.');
    }));
  }));

  /** Cliente escolheu o sistema: o assistente já responde a dúvida que abriu o chamado */
  router.post('/api/publico/suporte/chamado/:token/assistente/sistema', rota(async (req, res) => {
    const c = await doToken(req.params.token);
    if (!assistenteAtivo(c)) throw erro(409, 'O assistente não está disponível neste atendimento.');
    const id = Number(req.body?.sistema_id);
    const sis = (await sistemasBmhelp()).find((s) => s.id === id);
    if (!sis) throw erro(400, 'Escolha um dos sistemas.');
    // Trocar de sistema começa conversa nova no bm-help
    await pool.query('UPDATE chamados SET bmhelp_sistema_id = ?, bmhelp_sessao = NULL WHERE id = ?', [id, c.id]);
    await gravarMensagem({ chamado_id: c.id, autor: 'sistema', texto: `Cliente pediu ajuda ao assistente (bm-help), sistema ${sis.nome}.` });
    const [[d]] = await pool.query<any[]>('SELECT descricao FROM chamados WHERE id = ?', [c.id]);
    await responderAssistente(c.id, String(d?.descricao || c.titulo));
    res.json({ success: true });
  }));

  /**
   * Cliente encerra pelo chat: com atendente, o chamado fica encerrado (e o cliente avalia); sem
   * ninguém ter assumido, fica cancelado (desistiu da fila)
   */
  router.post('/api/publico/suporte/chamado/:token/encerrar', rota(async (req, res) => {
    const c = await doToken(req.params.token);
    if (['encerrado', 'cancelado'].includes(c.status)) throw erro(409, 'Este atendimento já foi encerrado.');
    // Dúvida resolvida pelo assistente: encerrado (e o cliente avalia), não cancelado
    const resolvido = Boolean(req.body?.resolvido) && assistenteAtivo(c);
    const cancelar = !c.atendente_id && !resolvido;
    await pool.query('UPDATE chamados SET status = ?, encerrado_em = NOW() WHERE id = ?', [cancelar ? 'cancelado' : 'encerrado', c.id]);
    await gravarMensagem({
      chamado_id: c.id,
      autor: 'sistema',
      texto: resolvido
        ? 'Chamado encerrado pelo cliente: o assistente (bm-help) resolveu a dúvida, sem precisar de técnico.'
        : cancelar ? 'Chamado cancelado pelo cliente antes do atendimento (saiu da fila).' : 'Chamado encerrado pelo cliente.',
    });
    await fecharSecao(c.id, 'encerrado');
    res.json({ success: true, status: cancelar ? 'cancelado' : 'encerrado' });
  }));

  /**
   * Instalador do BMSoft Suporte (agente do MeshCentral, link de 24 h gerado pelo BMDesk) no cartão
   * "Acesso remoto". O técnico fica sabendo pelo evento no chamado, para vincular o computador no BMDesk.
   * O link passa pelo BMDesk com o chamado e o nome que o cliente deu ao computador: o computador instalado
   * fica em destaque no "Acessar computador" deste chamado e o nome vira o apelido ao vincular
   */
  router.post('/api/publico/suporte/chamado/:token/agente', rota(async (req, res) => {
    const c = await doToken(req.params.token);
    if (['encerrado', 'cancelado'].includes(c.status)) throw erro(409, 'Este atendimento foi encerrado.');
    const nome = texto(req.body?.nome, 60).trim();
    if (!nome) throw erro(400, 'Informe o nome deste computador (ex.: Recepção) para baixar o BMSoft Suporte.');
    const { url } = await chamarBmdesk(`/api/integracao/convite?${new URLSearchParams({ chamado: String(c.id), nome })}`).catch((e) => {
      console.error(`Suporte (site): ${e.message}`);
      throw erro(503, 'O BMSoft Suporte está indisponível agora. Tente de novo em alguns minutos.');
    });
    await gravarMensagem({
      chamado_id: c.id,
      autor: 'sistema',
      texto: `Cliente abriu o instalador do BMSoft Suporte para o computador "${nome}": depois de instalado, use "Acessar computador" e "Vincular e acessar" no computador em destaque.`,
    });
    res.json({ url });
  }));

  /**
   * BM-ClientChat: o cliente abriu a janela do chat depois do cutucão. Fica na linha do tempo
   * do chamado (o técnico sabe que a pessoa está na frente do computador)
   */
  router.post('/api/publico/suporte/chamado/:token/visto', rota(async (req, res) => {
    const c = await doToken(req.params.token);
    await gravarMensagem({ chamado_id: c.id, autor: 'sistema', texto: 'Cliente abriu o BM-ClientChat depois do cutucão.' });
    res.json({ success: true });
  }));

  /** Avaliação de 1 a 5 do atendimento encerrado (entra em Avaliações, como a do WhatsApp) */
  router.post('/api/publico/suporte/chamado/:token/avaliar', rota(async (req, res) => {
    const c = await doToken(req.params.token);
    if (c.status !== 'encerrado') throw erro(409, 'A avaliação é feita depois que o atendimento termina.');
    if (Number(c.avaliado)) throw erro(409, 'Este atendimento já foi avaliado. Obrigado!');
    const nota = Number(req.body?.nota);
    if (!Number.isInteger(nota) || nota < 1 || nota > 5) throw erro(400, 'Escolha uma nota de 1 a 5.');
    const comentario = texto(req.body?.comentario, 2000) || null;
    await pool.query(
      `INSERT INTO avaliacoes (empresa_id, telefone, pessoa_id, atendente_id, departamento_id, chamado_id, origem, nota, comentario, situacao, pedida_em, respondida_em)
       VALUES (?, ?, ?, ?, ?, ?, 'atendente', ?, ?, 'respondida', NOW(), NOW())`,
      [c.empresa_id, c.contato_telefone || '', c.pessoa_id, c.atendente_id, c.departamento_id, c.id, nota, comentario],
    );
    await gravarMensagem({
      chamado_id: c.id,
      autor: 'sistema',
      texto: `Cliente avaliou ${'⭐'.repeat(nota)} (${nota})${comentario ? `: ${comentario}` : ''}`,
    });
    res.json({ success: true });
  }));

  return router;
}
