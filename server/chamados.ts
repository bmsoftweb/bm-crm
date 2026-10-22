import { Router, Request, Response } from 'express';
import { pool } from './db.js';
import { chamarBmdesk } from './bmdesk.js';
import { podeAcessar } from './permissoes.js';
import { notificar } from './notificacoes.js';
import { enviarWhatsApp, telefoneWhatsApp } from './whatsapp.js';
import { LEMBRETE_PARA, TIPOS_ATIVIDADE } from './schema.js';
import { gravarEnvolvidosAtividade, normalizarParticipantes } from './participantes.js';

/**
 * Chamados de suporte (Suporte › Fila de Chamados e Chamados Ativos), no modelo do solweb:
 * aberto aguarda na fila, alguém assume, conversa (resposta ao cliente vai pelo WhatsApp da
 * pessoa; nota interna só a equipe vê), transfere e encerra. Tabelas chamados, chamado_mensagens
 * e chamado_categorias (SLA em horas). Assumir, transferir, encerrar e abrir entram na linha do
 * tempo como mensagens "sistema". Número sequencial por empresa.
 */

const ENCERRADOS = "('encerrado','cancelado')";
/** Aviso ao cliente quando o técnico pausa o atendimento */
const PAUSA = 'Seu atendimento foi colocado em pausa. Assim que possível, um técnico continua com você por aqui.';
/** Na fila, sem atendente: os novos e os pausados (qualquer um pode assumir) */
const NA_FILA = "('aguardando','pausado')";

/** Começo do evento de transferência para um usuário: a contagem acha por ele a última transferida para quem consulta */
const TRANSFERIDO_PARA = 'Chamado transferido para ';

/** Texto da mensagem "Tela remota": o chat do site mostra o cartão com o botão que abre o AnyDesk */
export const TELA_REMOTA = '[[anydesk]]';
/** Texto da mensagem "Cutucar": o chat do site toca um som e treme para chamar a atenção do cliente */
export const CUTUCAR = '[[cutucar]]';

function erro(status: number, msg: string) {
  return Object.assign(new Error(msg), { status });
}

/** Fila ou Chamados Ativos: quem acessa uma das duas telas trabalha os chamados */
function exigirSuporte(res: Response) {
  const u = res.locals.usuario;
  if (!podeAcessar(u, 'chamados_fila') && !podeAcessar(u, 'chamados_ativos')) {
    throw erro(403, 'Você não tem permissão para acessar os chamados. Fale com o administrador.');
  }
}

const rota =
  (fn: (req: Request, res: Response) => Promise<any>) =>
  async (req: Request, res: Response) => {
    try {
      exigirSuporte(res);
      await fn(req, res);
    } catch (err: any) {
      if (!err.status) console.error(`Chamados: ${err.message}`);
      res.status(err.status || 400).json({ error: err.message });
    }
  };

/**
 * Número na fila: a posição do chamado entre os abertos (na fila ou em atendimento), por ordem de chegada.
 * Quando um encerra, os de trás sobem. Encerrado/cancelado não tem número (null)
 */
export const NR_FILA = `(CASE WHEN c.status IN ${ENCERRADOS} THEN NULL ELSE (SELECT COUNT(*) + 1 FROM chamados o
    WHERE o.empresa_id = c.empresa_id AND o.status NOT IN ${ENCERRADOS}
      AND (o.criado_em < c.criado_em OR (o.criado_em = c.criado_em AND o.id < c.id))) END)`;

/** Colunas da lista/fila: cliente, categoria, atendente, espera e SLA */
const SELECT = `
  SELECT c.id, c.numero, c.titulo, c.status, c.prioridade, c.canal, c.pessoa_id, c.categoria_id, c.atendente_id, c.departamento_id,
         c.criado_em, c.assumido_em, c.encerrado_em, c.sla_prazo,
         COALESCE(p.nome, c.contato_nome) AS pessoa_nome, c.contato_nome, cat.nome AS categoria_nome, cat.cor AS categoria_cor, u.nome AS atendente_nome, d.nome AS departamento_nome,
         p.tecnico_padrao_id, tp.nome AS tecnico_padrao_nome,
         TIMESTAMPDIFF(MINUTE, c.criado_em, NOW()) AS espera_min,
         (c.sla_prazo IS NOT NULL AND c.sla_prazo < NOW() AND c.status NOT IN ${ENCERRADOS}) AS sla_vencido,
         (SELECT m.texto FROM chamado_mensagens m WHERE m.chamado_id = c.id AND m.autor <> 'sistema' ORDER BY m.id DESC LIMIT 1) AS ultima,
         ${NR_FILA} AS nr_fila
    FROM chamados c
    LEFT JOIN pessoas p ON p.id = c.pessoa_id
    LEFT JOIN chamado_categorias cat ON cat.id = c.categoria_id
    LEFT JOIN usuarios u ON u.id = c.atendente_id
    LEFT JOIN departamentos d ON d.id = c.departamento_id
    LEFT JOIN usuarios tp ON tp.id = p.tecnico_padrao_id`;

const numeros = (r: any) => ({ ...r, espera_min: Number(r.espera_min), sla_vencido: Boolean(Number(r.sla_vencido)), nr_fila: r.nr_fila == null ? null : Number(r.nr_fila) });

// ------------------------------------------------------------
// Seções: cada vez que alguém pega o chamado (assumir, abrir já atendendo, receber por transferência) abre uma
// seção com o atendente e o início; pausa, transferência e encerramento a fecham (fim + motivo). Um chamado
// pausado e terminado por outro técnico fica com duas seções. As mensagens gravam a seção aberta (na fila: nenhuma).
// ------------------------------------------------------------

const SECAO_ABERTA = '(SELECT s.id FROM chamado_secoes s WHERE s.chamado_id = ? AND s.fim IS NULL ORDER BY s.id DESC LIMIT 1)';

/** Mensagem na linha do tempo do chamado, ligada à seção aberta */
export function gravarMensagem(m: {
  chamado_id: number;
  autor: 'equipe' | 'cliente' | 'sistema';
  texto: string;
  usuario_id?: number | null;
  interna?: boolean;
  whatsapp_id?: number | null;
}) {
  return pool.query(
    `INSERT INTO chamado_mensagens (chamado_id, secao_id, usuario_id, autor, texto, interna, whatsapp_id) VALUES (?, ${SECAO_ABERTA}, ?, ?, ?, ?, ?)`,
    [m.chamado_id, m.chamado_id, m.usuario_id ?? null, m.autor, m.texto, m.interna ? 1 : 0, m.whatsapp_id ?? null],
  );
}

export function fecharSecao(chamadoId: number, motivo: 'pausa' | 'transferencia' | 'encerrado') {
  return pool.query('UPDATE chamado_secoes SET fim = NOW(), motivo_fim = ? WHERE chamado_id = ? AND fim IS NULL', [motivo, chamadoId]);
}

/** Nova seção para quem pegou o chamado (a anterior, se ficou aberta, fecha como transferência) */
async function abrirSecao(chamadoId: number, atendenteId: number) {
  await fecharSecao(chamadoId, 'transferencia');
  await pool.query('INSERT INTO chamado_secoes (chamado_id, atendente_id, inicio) VALUES (?, ?, NOW())', [chamadoId, atendenteId]);
}

/** Linha "de sistema" na linha do tempo do chamado */
const evento = (chamadoId: number, usuarioId: number | null, texto: string) => gravarMensagem({ chamado_id: chamadoId, usuario_id: usuarioId, autor: 'sistema', texto });

async function chamadoDaEmpresa(id: string | number, emp: string) {
  const [r] = await pool.query<any[]>('SELECT * FROM chamados WHERE id = ? AND empresa_id = ?', [id, emp]);
  if (!r[0]) throw erro(404, 'Chamado não encontrado.');
  return r[0];
}

/** Só quem atende o chamado (ou o administrador) mexe nele; chamado sem atendente, qualquer um */
/** Em atendimento com outro técnico: quem não é o atendente (administrador também) só vê o chamado */
function soOAtendente(c: any, res: Response) {
  if (c.atendente_id && Number(c.atendente_id) !== Number(res.locals.usuarioId)) {
    throw erro(403, 'Este chamado está em atendimento com outro técnico: você só pode ver.');
  }
}

function conferirDono(c: any, res: Response) {
  soOAtendente(c, res);
  if (['encerrado', 'cancelado'].includes(c.status)) throw erro(400, 'Chamado encerrado: não pode mais ser alterado.');
}

/**
 * Outros chamados do mesmo cliente (sobre o alias "c"): mesma pessoa cadastrada ou, no chamado do site sem cadastro,
 * o mesmo CNPJ/CPF informado. Parâmetros em doMesmoCliente
 */
const DO_MESMO_CLIENTE = `c.empresa_id = ? AND c.id <> ?
  AND ((? IS NOT NULL AND c.pessoa_id = ?) OR (? <> '' AND c.contato_documento = ?))`;
const doMesmoCliente = (empresaId: string | number, c: { id: number; pessoa_id: number | null; contato_documento?: string | null }) => {
  const doc = String(c.contato_documento ?? '');
  return [empresaId, c.id, c.pessoa_id ?? null, c.pessoa_id ?? null, doc, doc];
};

export function createChamadosRouter(): Router {
  const router = Router();
  const emp = (res: Response) => String(res.locals.empresaId);
  const eu = (res: Response) => Number(res.locals.usuarioId);

  /** Fila: aguardando ou pausado, sem atendente, na ordem de chegada */
  router.get('/chamados/fila', rota(async (_req, res) => {
    const [r] = await pool.query<any[]>(
      `${SELECT} WHERE c.empresa_id = ? AND c.status IN ${NA_FILA} AND c.atendente_id IS NULL ORDER BY c.criado_em, c.id`,
      [emp(res)],
    );
    res.json(r.map((x, i) => ({ ...numeros(x), posicao: i + 1 })));
  }));

  /** Chamados Ativos: filtro rápido (meus, todos, aguardando, andamento, encerrados) e busca; na ordem de chegada (Encerrados: o último encerrado primeiro) */
  /**
   * Técnicos e quantos atendimentos fazem agora: chamados com ele (abertos) e conversas do WhatsApp em atendimento.
   * Entram os usuários ativos que atendem agora ou atenderam chamado nos últimos 30 dias
   */
  router.get('/chamados/tecnicos', rota(async (_req, res) => {
    const [r] = await pool.query<any[]>(
      `SELECT u.id, u.nome,
              (SELECT COUNT(*) FROM chamados c WHERE c.empresa_id = u.empresa_id AND c.atendente_id = u.id AND c.status NOT IN ${ENCERRADOS}) AS chamados,
              (SELECT COUNT(*) FROM whatsapp_conversas w WHERE w.empresa_id = u.empresa_id AND w.atendente_id = u.id) AS whatsapp
         FROM usuarios u
        WHERE u.empresa_id = ? AND u.ativo = 1
          AND (EXISTS (SELECT 1 FROM chamados c WHERE c.empresa_id = u.empresa_id AND c.atendente_id = u.id
                        AND (c.status NOT IN ${ENCERRADOS} OR c.assumido_em >= NOW() - INTERVAL 30 DAY))
               OR EXISTS (SELECT 1 FROM whatsapp_conversas w WHERE w.empresa_id = u.empresa_id AND w.atendente_id = u.id))
        ORDER BY u.nome`,
      [emp(res)],
    );
    // Na fila agora: chamados aguardando (ou pausados) sem atendente e conversas do WhatsApp aguardando atendente
    const [[f]] = await pool.query<any>(
      `SELECT (SELECT COUNT(*) FROM chamados c WHERE c.empresa_id = ? AND c.status IN ${NA_FILA} AND c.atendente_id IS NULL) AS chamados,
              (SELECT COUNT(*) FROM whatsapp_conversas w WHERE w.empresa_id = ? AND w.atendimento = 'humano' AND w.atendente_id IS NULL) AS whatsapp,
              (SELECT COUNT(*) FROM chamados c WHERE c.empresa_id = ? AND c.criado_em >= CURDATE()) AS chamados_hoje,
              (SELECT COUNT(*) FROM whatsapp_atendimentos a WHERE a.empresa_id = ? AND a.inicio >= CURDATE()) AS whatsapp_hoje`,
      [emp(res), emp(res), emp(res), emp(res)],
    );
    res.json({
      tecnicos: r.map((t) => ({ id: t.id, nome: t.nome, chamados: Number(t.chamados), whatsapp: Number(t.whatsapp) })),
      fila: { chamados: Number(f.chamados), whatsapp: Number(f.whatsapp) },
      // Atendimentos hoje: chamados abertos e atendimentos do WhatsApp iniciados hoje
      hoje: { chamados: Number(f.chamados_hoje), whatsapp: Number(f.whatsapp_hoje) },
    });
  }));

  router.get('/chamados', rota(async (req, res) => {
    const filtro = String(req.query.filtro || 'meus');
    const onde: string[] = ['c.empresa_id = ?'];
    const params: any[] = [emp(res)];
    if (filtro === 'meus') {
      onde.push(`c.atendente_id = ? AND c.status NOT IN ${ENCERRADOS}`);
      params.push(eu(res));
    } else if (filtro === 'aguardando') onde.push(`c.status IN ${NA_FILA}`);
    else if (filtro === 'andamento') onde.push("c.status IN ('em_andamento','pendente_cliente')");
    else if (filtro === 'encerrados') onde.push(`c.status IN ${ENCERRADOS}`);
    else onde.push(`c.status NOT IN ${ENCERRADOS}`);
    const q = String(req.query.q || '').trim();
    if (q) {
      onde.push('(c.titulo LIKE ? OR p.nome LIKE ? OR c.contato_nome LIKE ? OR c.numero = ?)');
      params.push(`%${q}%`, `%${q}%`, `%${q}%`, Number(q) || 0);
    }
    // Encerrados: do encerrado por último para o mais antigo. Os demais: os 200 mais recentes, na ordem de chegada
    const encerrados = filtro === 'encerrados';
    const [r] = await pool.query<any[]>(
      `${SELECT} WHERE ${onde.join(' AND ')}
        ORDER BY ${encerrados ? 'COALESCE(c.encerrado_em, c.atualizado_em) DESC,' : ''} c.criado_em DESC, c.id DESC LIMIT 200`,
      params,
    );
    res.json((encerrados ? r : r.reverse()).map(numeros));
  }));

  /** Quantos na fila (etiqueta do menu) */
  /**
   * Quantos na fila (etiqueta do menu) e a última mensagem de cliente nos chamados abertos que o
   * usuário atende (a tela toca o aviso quando ela muda)
   */
  router.get('/chamados/contagem', rota(async (_req, res) => {
    const [r] = await pool.query<any[]>(
      `SELECT COUNT(*) n, MAX(c.id) ultimo, c2.numero, COALESCE(p.nome, c2.contato_nome) AS nome,
              (SELECT d.nome FROM usuarios u JOIN departamentos d ON d.id = u.departamento_id WHERE u.id = ?) AS departamento
         FROM chamados c
         LEFT JOIN chamados c2 ON c2.id = (SELECT MAX(id) FROM chamados WHERE empresa_id = ? AND status = 'aguardando' AND atendente_id IS NULL)
         LEFT JOIN pessoas p ON p.id = c2.pessoa_id
        WHERE c.empresa_id = ? AND c.status IN ${NA_FILA} AND c.atendente_id IS NULL`,
      [eu(res), emp(res), emp(res)],
    );
    const [m] = await pool.query<any[]>(
      `SELECT m.id, c.id AS chamado_id, c.numero, COALESCE(p.nome, c.contato_nome) AS nome
         FROM chamado_mensagens m
         JOIN chamados c ON c.id = m.chamado_id
         LEFT JOIN pessoas p ON p.id = c.pessoa_id
        WHERE c.empresa_id = ? AND c.atendente_id = ? AND c.status NOT IN ${ENCERRADOS} AND m.autor = 'cliente'
          AND m.criado_em >= COALESCE(c.assumido_em, c.criado_em)
        ORDER BY m.id DESC LIMIT 1`,
      [emp(res), eu(res)],
    );
    // Último chamado transferido para mim (evento de outro usuário num chamado aberto que agora é meu): campainha
    const [t] = await pool.query<any[]>(
      `SELECT m.id, c.id AS chamado_id, c.numero, COALESCE(p.nome, c.contato_nome) AS nome, u.nome AS de
         FROM chamado_mensagens m
         JOIN chamados c ON c.id = m.chamado_id
         LEFT JOIN pessoas p ON p.id = c.pessoa_id
         LEFT JOIN usuarios u ON u.id = m.usuario_id
        WHERE c.empresa_id = ? AND c.atendente_id = ? AND c.status NOT IN ${ENCERRADOS}
          AND m.autor = 'sistema' AND m.usuario_id <> ? AND m.texto LIKE ?
        ORDER BY m.id DESC LIMIT 1`,
      [emp(res), eu(res), eu(res), `${TRANSFERIDO_PARA}%`],
    );
    // Último chamado transferido para o meu departamento por outra pessoa (voltou para a fila, sem atendente): campainha
    const [td] = await pool.query<any[]>(
      `SELECT m.id, c.id AS chamado_id, c.numero, COALESCE(p.nome, c.contato_nome) AS nome, u.nome AS de, d.nome AS departamento
         FROM chamado_mensagens m
         JOIN chamados c ON c.id = m.chamado_id
         JOIN departamentos d ON d.id = c.departamento_id
         LEFT JOIN pessoas p ON p.id = c.pessoa_id
         LEFT JOIN usuarios u ON u.id = m.usuario_id
        WHERE c.empresa_id = ? AND c.atendente_id IS NULL AND c.status IN ${NA_FILA}
          AND c.departamento_id = (SELECT x.departamento_id FROM usuarios x WHERE x.id = ?)
          AND m.autor = 'sistema' AND m.usuario_id <> ? AND m.texto LIKE ?
        ORDER BY m.id DESC LIMIT 1`,
      [emp(res), eu(res), eu(res), `${TRANSFERIDO_PARA}o departamento %`],
    );
    // Chamado esperando na fila há mais de 10 minutos (o mais antigo): a tela toca a buzina para o Suporte
    const [a] = await pool.query<any[]>(
      `SELECT c.id, c.numero, COALESCE(p.nome, c.contato_nome) AS nome, TIMESTAMPDIFF(MINUTE, c.criado_em, NOW()) AS espera_min
         FROM chamados c
         LEFT JOIN pessoas p ON p.id = c.pessoa_id
        WHERE c.empresa_id = ? AND c.status IN ${NA_FILA} AND c.atendente_id IS NULL
          AND c.criado_em < NOW() - INTERVAL 10 MINUTE
        ORDER BY c.criado_em, c.id LIMIT 1`,
      [emp(res)],
    );
    res.json({
      fila: Number(r[0].n),
      atrasado: a[0] ? { ...a[0], espera_min: Number(a[0].espera_min) } : null,
      transferido: t[0] ?? null,
      transferido_departamento: td[0] ?? null,
      // Último chamado da fila: quem é do departamento Suporte ouve o aviso de chamado novo
      novo: r[0].ultimo ? { id: Number(r[0].ultimo), numero: r[0].numero, nome: r[0].nome } : null,
      suporte: /^suporte/i.test(String(r[0].departamento || '').trim()),
      mensagem: m[0] ?? null,
    });
  }));

  /** Busca de cliente para o Novo chamado (a lista de pessoas passa do limite dos combos) */
  router.get('/chamados/pessoas', rota(async (req, res) => {
    const q = String(req.query.q || '').trim();
    if (q.length < 2) return res.json([]);
    const dig = q.replace(/\D/g, '');
    const [r] = await pool.query<any[]>(
      `SELECT id, nome, COALESCE(NULLIF(whatsapp, ''), telefone) AS telefone FROM pessoas
        WHERE empresa_id = ? AND (nome LIKE ? ${dig.length >= 4 ? 'OR cpf LIKE ? OR whatsapp LIKE ? OR telefone LIKE ?' : ''})
        ORDER BY nome LIMIT 20`,
      [emp(res), `%${q}%`, ...(dig.length >= 4 ? [`%${dig}%`, `%${dig}%`, `%${dig}%`] : [])],
    );
    res.json(r);
  }));

  /** Chamado aberto: dados, linha do tempo e o que o usuário pode fazer */
  router.get('/chamados/:id', rota(async (req, res) => {
    const [r] = await pool.query<any[]>(`${SELECT} WHERE c.id = ? AND c.empresa_id = ?`, [req.params.id, emp(res)]);
    if (!r[0]) throw erro(404, 'Chamado não encontrado.');
    const [extra] = await pool.query<any[]>(
      // AnyDesk: o do cadastro da pessoa; sem ele (ou sem pessoa), o último que o mesmo cliente mandou em qualquer chamado
      // (mesma pessoa ou mesmo CNPJ/CPF informado no site). '[[anydesk-id:' tem 13 caracteres e termina em ']]'
      `SELECT c.descricao, c.conclusao, a.nome AS aberto_por_nome,
              COALESCE(NULLIF(p.anydesk_id, ''),
                       (SELECT SUBSTRING(m.texto, 14, CHAR_LENGTH(m.texto) - 15)
                          FROM chamado_mensagens m JOIN chamados o ON o.id = m.chamado_id
                         WHERE o.empresa_id = c.empresa_id AND m.autor = 'cliente' AND m.texto LIKE '[[anydesk-id:%'
                           AND ((c.pessoa_id IS NOT NULL AND o.pessoa_id = c.pessoa_id)
                                OR (c.contato_documento IS NOT NULL AND c.contato_documento <> '' AND o.contato_documento = c.contato_documento))
                         ORDER BY m.id DESC LIMIT 1)) AS anydesk_id,
              COALESCE(NULLIF(p.whatsapp, ''), p.telefone, c.contato_telefone) AS pessoa_telefone,
              c.contato_nome, c.contato_telefone, c.contato_fixo, c.contato_documento
         FROM chamados c LEFT JOIN usuarios a ON a.id = c.aberto_por LEFT JOIN pessoas p ON p.id = c.pessoa_id WHERE c.id = ?`,
      [req.params.id],
    );
    const [mensagens] = await pool.query<any[]>(
      `SELECT m.id, m.autor, m.texto, m.interna, m.criado_em, m.usuario_id, u.nome AS usuario_nome
         FROM chamado_mensagens m LEFT JOIN usuarios u ON u.id = m.usuario_id WHERE m.chamado_id = ? ORDER BY m.id`,
      [req.params.id],
    );
    // Tarefas do chamado: atividades ligadas a ele (quem executa e os envolvidos)
    const [tarefas] = await pool.query<any[]>(
      `SELECT a.id, a.assunto, a.tipo, a.data_vencimento, a.hora_vencimento, a.concluida, a.concluida_em, a.observacao, a.executor_bot, a.bot_resumo,
              IF(a.executor_bot = 1, 'Bot', COALESCE(u.nome, d.nome, 'Qualquer pessoa')) AS quem_executa,
              (SELECT GROUP_CONCAT(x.nome ORDER BY x.nome SEPARATOR ', ') FROM atividade_envolvidos e JOIN usuarios x ON x.id = e.usuario_id
                WHERE e.atividade_id = a.id) AS envolvidos
         FROM atividades a LEFT JOIN usuarios u ON u.id = a.executor_id LEFT JOIN departamentos d ON d.id = a.departamento_id
        WHERE a.chamado_id = ? AND a.empresa_id = ?
        ORDER BY a.concluida, a.data_vencimento, COALESCE(a.hora_vencimento, '00:00:00'), a.id`,
      [req.params.id, emp(res)],
    );
    const [[{ qtd }]] = await pool.query<any>(`SELECT COUNT(*) AS qtd FROM chamados c WHERE ${DO_MESMO_CLIENTE}`, doMesmoCliente(emp(res), { ...r[0], contato_documento: extra[0]?.contato_documento }));
    const u = res.locals.usuario;
    res.json({
      ...numeros(r[0]),
      ...extra[0],
      historico_qtd: Number(qtd),
      tarefas: tarefas.map((t) => ({ ...t, concluida: Boolean(t.concluida) })),
      eu_atendo: Number(r[0].atendente_id) === Number(res.locals.usuarioId),
      sou_admin: u.tipo === 'admin',
      mensagens: mensagens.map((m) => ({ ...m, interna: Boolean(m.interna) })),
    });
  }));

  /** Histórico do cliente: os outros chamados dele (qualquer status), do mais novo para o mais antigo, com a conclusão */
  router.get('/chamados/:id/historico', rota(async (req, res) => {
    const c = await chamadoDaEmpresa(req.params.id, emp(res));
    const [r] = await pool.query<any[]>(
      `SELECT c.id, c.numero, c.titulo, c.status, c.canal, c.criado_em, c.encerrado_em, c.conclusao, u.nome AS atendente_nome, cat.nome AS categoria_nome,
              (SELECT av.nota FROM avaliacoes av WHERE av.chamado_id = c.id AND av.nota IS NOT NULL ORDER BY av.id DESC LIMIT 1) AS nota
         FROM chamados c
         LEFT JOIN usuarios u ON u.id = c.atendente_id
         LEFT JOIN chamado_categorias cat ON cat.id = c.categoria_id
        WHERE ${DO_MESMO_CLIENTE}
        ORDER BY c.criado_em DESC, c.id DESC LIMIT 50`,
      doMesmoCliente(emp(res), c),
    );
    res.json(r);
  }));

  /** Novo chamado (equipe): entra na fila, ou já fica com quem abriu */
  router.post('/chamados', rota(async (req, res) => {
    const b = req.body || {};
    const titulo = String(b.titulo ?? '').trim().slice(0, 200);
    if (!titulo) throw erro(400, 'Informe o título do chamado.');
    const prioridade = ['baixa', 'normal', 'alta', 'urgente'].includes(b.prioridade) ? b.prioridade : 'normal';
    const canal = ['interno', 'whatsapp', 'telefone', 'email', 'web'].includes(b.canal) ? b.canal : 'interno';
    const pessoaId = Number(b.pessoa_id) || null;
    const categoriaId = Number(b.categoria_id) || null;
    const atender = Boolean(b.atender);
    const conn = await pool.getConnection();
    let id: number;
    let numero: number;
    try {
      await conn.beginTransaction();
      if (pessoaId) {
        const [p] = await conn.query<any[]>('SELECT 1 FROM pessoas WHERE id = ? AND empresa_id = ?', [pessoaId, emp(res)]);
        if (!p.length) throw erro(400, 'Cliente não encontrado nesta empresa.');
      }
      let slaHoras: number | null = null;
      if (categoriaId) {
        const [cat] = await conn.query<any[]>('SELECT sla_horas FROM chamado_categorias WHERE id = ? AND empresa_id = ? AND ativo = 1', [categoriaId, emp(res)]);
        if (!cat.length) throw erro(400, 'Categoria não encontrada ou inativa.');
        slaHoras = Number(cat[0].sla_horas) || null;
      }
      const [[{ n }]] = await conn.query<any>('SELECT COALESCE(MAX(numero), 0) + 1 AS n FROM chamados WHERE empresa_id = ? FOR UPDATE', [emp(res)]);
      numero = Number(n);
      const [ins] = await conn.query<any>(
        `INSERT INTO chamados (empresa_id, numero, pessoa_id, categoria_id, titulo, descricao, status, prioridade, canal, atendente_id, aberto_por, sla_prazo, assumido_em)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, IF(? IS NULL, NULL, NOW() + INTERVAL ? HOUR), IF(?, NOW(), NULL))`,
        [emp(res), numero, pessoaId, categoriaId, titulo, String(b.descricao ?? '').trim() || null, atender ? 'em_andamento' : 'aguardando', prioridade, canal,
          atender ? eu(res) : null, eu(res), slaHoras, slaHoras ?? 0, atender],
      );
      id = Number(ins.insertId);
      await conn.commit();
    } catch (e) {
      await conn.rollback();
      throw e;
    } finally {
      conn.release();
    }
    const nome = res.locals.usuario.nome;
    if (atender) await abrirSecao(id, eu(res));
    await evento(id, eu(res), atender ? `Chamado aberto e assumido por ${nome}.` : `Chamado aberto por ${nome}. Aguardando na fila.`);
    if (!atender) {
      await notificar(emp(res), { tela: 'chamados_fila', exceto: eu(res) }, {
        tipo: 'chamado',
        titulo: `Chamado nº ${numero} na fila`,
        texto: `${titulo} (aberto por ${nome})`,
        link: 'chamados_ativos',
        registroId: id,
      });
    }
    res.json({ id, numero });
  }));

  /** Assumir: só chamado sem atendente (dois ao mesmo tempo: só um consegue). assumido_em = a última vez que alguém
   *  pegou o chamado: o aviso de mensagem do cliente (contagem) só conta as que chegaram depois */
  router.post('/chamados/:id/assumir', rota(async (req, res) => {
    const c = await chamadoDaEmpresa(req.params.id, emp(res));
    if (['encerrado', 'cancelado'].includes(c.status)) throw erro(400, 'Chamado encerrado.');
    const [r] = await pool.query<any>(
      "UPDATE chamados SET atendente_id = ?, status = 'em_andamento', assumido_em = NOW() WHERE id = ? AND atendente_id IS NULL",
      [eu(res), c.id],
    );
    if (!r.affectedRows) throw erro(409, 'Outro atendente já assumiu este chamado.');
    await abrirSecao(c.id, eu(res));
    await evento(c.id, eu(res), `${res.locals.usuario.nome} assumiu o chamado.`);
    res.json({ success: true });
  }));

  /** Transferir para um usuário (fica com ele) ou para um departamento (volta para a fila) */
  router.post('/chamados/:id/transferir', rota(async (req, res) => {
    const c = await chamadoDaEmpresa(req.params.id, emp(res));
    conferirDono(c, res);
    const obs = String(req.body?.observacao ?? '').trim().slice(0, 500);
    const usuarioId = Number(req.body?.usuario_id) || null;
    const departamentoId = Number(req.body?.departamento_id) || null;
    let texto: string;
    if (usuarioId) {
      const [u] = await pool.query<any[]>('SELECT nome FROM usuarios WHERE id = ? AND empresa_id = ? AND ativo = 1', [usuarioId, emp(res)]);
      if (!u[0]) throw erro(400, 'Usuário de destino não encontrado ou inativo.');
      await pool.query("UPDATE chamados SET atendente_id = ?, status = 'em_andamento', assumido_em = NOW() WHERE id = ?", [usuarioId, c.id]);
      texto = `${TRANSFERIDO_PARA}${u[0].nome} por ${res.locals.usuario.nome}.`;
    } else if (departamentoId) {
      const [d] = await pool.query<any[]>('SELECT nome FROM departamentos WHERE id = ? AND empresa_id = ?', [departamentoId, emp(res)]);
      if (!d[0]) throw erro(400, 'Departamento não encontrado.');
      await pool.query("UPDATE chamados SET atendente_id = NULL, departamento_id = ?, status = 'aguardando' WHERE id = ?", [departamentoId, c.id]);
      texto = `${TRANSFERIDO_PARA}o departamento ${d[0].nome} por ${res.locals.usuario.nome}. Voltou para a fila.`;
    } else throw erro(400, 'Escolha o usuário ou o departamento de destino.');
    // O aviso fica na seção de quem transferiu; depois ela fecha (e abre a do destino, se for um usuário)
    await evento(c.id, eu(res), obs ? `${texto} Obs.: ${obs}` : texto);
    await notificar(emp(res), usuarioId ? { usuarios: [usuarioId], exceto: eu(res) } : { departamentoId, exceto: eu(res) }, {
      tipo: 'transferencia',
      titulo: usuarioId ? `Chamado nº ${c.numero} transferido para você` : `Chamado nº ${c.numero} transferido para o seu departamento`,
      texto: `${c.titulo} — por ${res.locals.usuario.nome}${obs ? `. Obs.: ${obs}` : ''}`,
      link: 'chamados_ativos',
      registroId: c.id,
    });
    if (usuarioId) await abrirSecao(c.id, usuarioId);
    else await fecharSecao(c.id, 'transferencia');
    res.json({ success: true });
  }));

  /** Encerrar: o técnico escreve a conclusão (o que foi feito, a solução); obrigatória */
  router.post('/chamados/:id/encerrar', rota(async (req, res) => {
    const c = await chamadoDaEmpresa(req.params.id, emp(res));
    conferirDono(c, res);
    const conclusao = String(req.body?.conclusao ?? '').trim().slice(0, 4000);
    if (!conclusao) throw erro(400, 'Escreva a conclusão do atendimento: o que foi feito, a solução.');
    await pool.query("UPDATE chamados SET status = 'encerrado', encerrado_em = NOW(), conclusao = ? WHERE id = ?", [conclusao, c.id]);
    await evento(c.id, eu(res), `Chamado encerrado por ${res.locals.usuario.nome}.`);
    await fecharSecao(c.id, 'encerrado');
    // A IA lê o chamado e cria tarefas para o que ficou pendente (em segundo plano; import dinâmico: pendencias.ts usa este módulo)
    (await import('./pendencias.js')).analisarChamado(c.id);
    res.json({ success: true });
  }));

  /**
   * Mensagem da equipe no chamado. Chamado do site: o cliente lê no chat do site; dos outros canais: vai pelo WhatsApp da
   * pessoa, se tiver. Devolve um aviso quando não deu para mandar ao cliente.
   */
  async function mensagemEquipe(c: any, res: Response, texto: string, interna = false): Promise<string | null> {
    let whatsappId: number | null = null;
    let aviso: string | null = null;
    if (!interna && c.canal !== 'web') {
      const [p] = c.pessoa_id
        ? await pool.query<any[]>("SELECT COALESCE(NULLIF(whatsapp, ''), telefone) AS tel FROM pessoas WHERE id = ?", [c.pessoa_id])
        : [[]];
      const tel = p[0]?.tel;
      if (!tel) aviso = 'O cliente não tem WhatsApp no cadastro: a resposta ficou só no chamado.';
      else {
        const numero = telefoneWhatsApp(tel);
        await enviarWhatsApp(emp(res), numero, texto, { pessoa_id: c.pessoa_id, usuario_id: eu(res) }, res.locals.usuario.nome);
        const [w] = await pool.query<any[]>(
          "SELECT MAX(id) id FROM whatsapp_mensagens WHERE empresa_id = ? AND telefone = ? AND direcao = 'enviada' AND usuario_id = ?",
          [emp(res), numero, eu(res)],
        );
        whatsappId = w[0]?.id ?? null;
      }
    }
    await gravarMensagem({ chamado_id: c.id, usuario_id: eu(res), autor: 'equipe', texto, interna, whatsapp_id: whatsappId });
    return aviso;
  }

  /** Pausar: o chamado volta para a fila sem atendente, marcado como pausado (qualquer um assume; o cliente vê no chat) */
  router.post('/chamados/:id/pausar', rota(async (req, res) => {
    const c = await chamadoDaEmpresa(req.params.id, emp(res));
    conferirDono(c, res);
    if (!c.atendente_id) throw erro(400, 'Assuma o chamado antes de pausar.');
    await pool.query("UPDATE chamados SET status = 'pausado', atendente_id = NULL WHERE id = ?", [c.id]);
    await evento(c.id, eu(res), `Atendimento pausado por ${res.locals.usuario.nome}: voltou para a fila.`);
    // O cliente fica sabendo (chat do site ou WhatsApp); falha no envio não desfaz a pausa
    const aviso = await mensagemEquipe(c, res, PAUSA).catch((e) => `O aviso de pausa não chegou ao cliente: ${e.message}`);
    await fecharSecao(c.id, 'pausa');
    res.json({ success: true, aviso });
  }));

  /** Tela remota: mostra ao cliente, no chat do site, o cartão para baixar o BMSoft Suporte */
  router.post('/chamados/:id/tela-remota', rota(async (req, res) => {
    const c = await chamadoDaEmpresa(req.params.id, emp(res));
    conferirDono(c, res);
    if (!c.atendente_id) throw erro(400, 'Assuma o chamado antes de pedir a tela remota.');
    if (c.canal !== 'web') throw erro(400, 'A tela remota abre no chat do site: este chamado não veio pelo site.');
    await gravarMensagem({ chamado_id: c.id, usuario_id: eu(res), autor: 'equipe', texto: TELA_REMOTA });
    res.json({ success: true });
  }));

  /**
   * Computadores no BMDesk: os do cliente do chamado e os online ainda sem cliente (o que o cliente
   * acabou de instalar pelo widget aparece ali, para o técnico vincular sem sair do chamado)
   */
  router.get('/chamados/:id/computadores', rota(async (req, res) => {
    const c = await chamadoDaEmpresa(req.params.id, emp(res));
    // Com o chamado, o BMDesk destaca o computador instalado pelo cliente dele (pelo link do chat)
    const semVinculo = `/api/integracao/sem-vinculo?chamado=${c.id}`;
    // Chamado sem cliente no cadastro: só os sem cliente (o técnico escolhe e acessa, sem vincular)
    if (!c.pessoa_id) return res.json({ doCliente: [], semCliente: await chamarBmdesk(semVinculo) });
    const [doCliente, semCliente] = await Promise.all([
      chamarBmdesk(`/api/integracao/computadores?pessoa=${c.pessoa_id}`),
      chamarBmdesk(semVinculo),
    ]);
    res.json({ doCliente, semCliente });
  }));

  /** Apelido do computador ("Recepção", "Caixa 1"): fica no BMDesk, só nos computadores do cliente do chamado */
  router.post('/chamados/:id/apelido-computador', rota(async (req, res) => {
    const c = await chamadoDaEmpresa(req.params.id, emp(res));
    soOAtendente(c, res);
    const r = await chamarBmdesk('/api/integracao/apelido', {
      pessoa: c.pessoa_id ?? null,
      id: String(req.body?.computador || ''),
      apelido: String(req.body?.apelido ?? ''),
    });
    res.json(r);
  }));

  /** Vincula ao cliente do chamado um computador ainda sem cliente; fica registrado como evento do chamado */
  router.post('/chamados/:id/vincular-computador', rota(async (req, res) => {
    const c = await chamadoDaEmpresa(req.params.id, emp(res));
    soOAtendente(c, res);
    if (!c.pessoa_id) throw erro(400, 'Chamado sem cliente: ligue o chamado a uma pessoa para vincular o computador.');
    // apelido: o nome que o cliente deu ao computador no chat (o BMDesk só aplica se o computador não tem apelido)
    await chamarBmdesk('/api/integracao/vincular', {
      pessoa: c.pessoa_id,
      id: String(req.body?.computador || ''),
      apelido: String(req.body?.apelido || '').trim().slice(0, 60),
    });
    const nome = String(req.body?.nome || '').trim().slice(0, 120);
    await evento(c.id, eu(res), `${res.locals.usuario.nome} vinculou o computador ${nome || 'novo'} ao cliente no BMDesk.`);
    res.json({ success: true });
  }));

  /**
   * Tela remota direto no computador do cliente, pela conta de serviço do BMDesk. No MeshCentral o
   * acesso aparece como essa conta: quem acessou fica registrado aqui, como evento do chamado
   */
  router.post('/chamados/:id/acessar-computador', rota(async (req, res) => {
    const c = await chamadoDaEmpresa(req.params.id, emp(res));
    soOAtendente(c, res);
    const quem = res.locals.usuario.nome;
    const params = new URLSearchParams({ id: String(req.body?.computador || ''), modo: 'desktop', usuario: quem });
    // Sem cliente no cadastro: só computador ainda sem cliente (o BMDesk confere)
    if (c.pessoa_id) params.set('pessoa', String(c.pessoa_id));
    const { url } = await chamarBmdesk(`/api/integracao/${c.pessoa_id ? 'acesso' : 'acesso-sem-cliente'}?${params}`);
    const nome = String(req.body?.nome || '').trim().slice(0, 120);
    await evento(c.id, eu(res), `${quem} acessou o computador ${nome || 'do cliente'}${c.pessoa_id ? '' : ' (sem cliente no cadastro)'} pelo BMDesk.`);
    res.json({ url });
  }));

  /** Cutucar: chama a atenção do cliente no chat do site (som e tremida); no máximo um a cada 10 s */
  router.post('/chamados/:id/cutucar', rota(async (req, res) => {
    const c = await chamadoDaEmpresa(req.params.id, emp(res));
    conferirDono(c, res);
    if (!c.atendente_id) throw erro(400, 'Assuma o chamado antes de cutucar o cliente.');
    if (c.canal !== 'web') throw erro(400, 'O cutucão toca no chat do site: este chamado não veio pelo site.');
    const [r] = await pool.query<any[]>(
      'SELECT 1 FROM chamado_mensagens WHERE chamado_id = ? AND texto = ? AND criado_em > NOW() - INTERVAL 10 SECOND LIMIT 1',
      [c.id, CUTUCAR],
    );
    if (r.length) throw erro(429, 'Aguarde uns segundos antes de cutucar de novo.');
    await gravarMensagem({ chamado_id: c.id, usuario_id: eu(res), autor: 'equipe', texto: CUTUCAR });
    // Computador do cliente com o BMSoft Suporte: o agente maximiza e traz para frente a janela do chat (o widget
    // pisca o título no cutucão e o BMDesk procura por ele). Sem BMDesk ou fora do ar, o cutucão fica só no chat
    let computadores = 0;
    if (c.pessoa_id && process.env.BMDESK_URL) {
      const r = await chamarBmdesk('/api/integracao/trazer-chat', { pessoa: c.pessoa_id }).catch(() => null);
      computadores = Number(r?.computadores) || 0;
    }
    res.json({ success: true, computadores });
  }));

  /** Resposta ao cliente (vai pelo WhatsApp da pessoa, se tiver) ou nota interna (só a equipe vê) */
  router.post('/chamados/:id/mensagens', rota(async (req, res) => {
    const c = await chamadoDaEmpresa(req.params.id, emp(res));
    conferirDono(c, res);
    if (!c.atendente_id) throw erro(400, 'Assuma o chamado antes de responder.');
    const texto = String(req.body?.texto ?? '').trim().slice(0, 4000);
    if (!texto) throw erro(400, 'Escreva a mensagem.');
    const interna = Boolean(req.body?.interna);
    const aviso = await mensagemEquipe(c, res, texto, interna);
    res.json({ success: true, aviso });
  }));

  /**
   * Tarefa do chamado (ex.: desenvolver um relatório pedido no atendimento): uma atividade comum, com o cliente
   * do chamado, ligada a ele por chamado_id, e os usuários envolvidos. Entra na linha do tempo.
   */
  router.post('/chamados/:id/tarefas', rota(async (req, res) => {
    const c = await chamadoDaEmpresa(req.params.id, emp(res));
    soOAtendente(c, res);
    const b = req.body || {};
    const assunto = String(b.assunto ?? '').trim().slice(0, 255);
    if (!assunto) throw erro(400, 'Informe o assunto da tarefa.');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(b.data_vencimento ?? ''))) throw erro(400, 'Informe o prazo da tarefa.');
    const tipo = TIPOS_ATIVIDADE.some((t) => t.value === b.tipo) ? b.tipo : 'tarefa';
    const lembrete = LEMBRETE_PARA.some((t) => t.value === b.lembrete_para) ? b.lembrete_para : 'vendedor';
    const hora = /^\d{2}:\d{2}/.test(String(b.hora_vencimento ?? '')) ? b.hora_vencimento : null;
    const duracao = /^\d{2}:\d{2}/.test(String(b.duracao ?? '')) ? b.duracao : null;
    const executorId = Number(b.executor_id) || null;
    const departamentoId = Number(b.departamento_id) || null;
    const bot = Number(b.executor_bot) ? 1 : 0;
    if ([executorId, departamentoId, bot].filter(Boolean).length > 1) throw erro(400, 'Quem executa: escolha um usuário, um departamento ou o Bot, só um deles.');
    if (bot && lembrete === 'nenhum') throw erro(400, 'Com o Bot executando, escolha com quem ele conversa.');
    if (executorId) {
      const [x] = await pool.query<any[]>('SELECT 1 FROM usuarios WHERE id = ? AND empresa_id = ?', [executorId, emp(res)]);
      if (!x.length) throw erro(400, 'Usuário que executa não encontrado nesta empresa.');
    }
    if (departamentoId) {
      const [x] = await pool.query<any[]>('SELECT 1 FROM departamentos WHERE id = ? AND empresa_id = ?', [departamentoId, emp(res)]);
      if (!x.length) throw erro(400, 'Departamento não encontrado nesta empresa.');
    }
    const envolvidos = await normalizarParticipantes(b.envolvidos ?? [], emp(res));
    const concluida = Boolean(b.concluida);
    const [ins] = await pool.query<any>(
      `INSERT INTO atividades (empresa_id, pessoa_id, chamado_id, assunto, tipo, data_vencimento, hora_vencimento, duracao, lembrete_para,
                               executor_id, departamento_id, executor_bot, observacao, concluida, concluida_em, concluida_por)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, IF(?, NOW(), NULL), IF(?, ?, NULL))`,
      [emp(res), c.pessoa_id, c.id, assunto, tipo, b.data_vencimento, hora, duracao, lembrete, executorId, departamentoId, bot,
        String(b.observacao ?? '').trim() || null, concluida ? 1 : 0, concluida, concluida, eu(res)],
    );
    await gravarEnvolvidosAtividade(ins.insertId, envolvidos);
    const prazo = String(b.data_vencimento).split('-').reverse().join('/');
    await evento(c.id, eu(res), `Tarefa ${concluida ? 'registrada' : 'criada'} por ${res.locals.usuario.nome}: ${assunto} (prazo ${prazo}).`);
    res.json({ id: Number(ins.insertId) });
  }));

  return router;
}
