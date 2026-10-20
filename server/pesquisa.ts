import { pool } from './db.js';
import { lerConfig } from './config.js';
import { textoConfig } from './segredo.js';
import { contaDaConversa, enviarReservada, PESSOA_RECENTE, reservarEnvio, type MensagemNova } from './whatsapp.js';
import { marcarEvento } from './chatbot.js';
import { notificar } from './notificacoes.js';

/**
 * Pesquisa de satisfação do WhatsApp (Configurações › Chatbot › Pesquisa de satisfação; tabela
 * avaliacoes). Sai ao Encerrar pela equipe e no fim da jornada: nota de 1 a 5 (número ou estrelas);
 * nota de 1 a 3 pede um comentário. A resposta do cliente é tratada aqui, antes do bot/jornada; o que
 * não for uma nota descarta a pesquisa e segue o atendimento normal. Cortesia logo depois do fim ("de nada",
 * "obrigado", "👍") é ignorada: não abre conversa nova.
 */

export interface ConfigPesquisa {
  ativo: boolean;
  /** Pergunta; {{atendente}} = quem atendeu (ou o nome do bot). As opções de 1 a 5 vão embaixo */
  pergunta: string;
  /** Pedido de comentário para nota de 1 a 3 */
  comentario: string;
  agradecimento: string;
  /** Pesquisa sem resposta vence depois disso (minutos) */
  minutos: number;
}

const PADRAO: ConfigPesquisa = {
  ativo: false,
  pergunta: 'Como você avalia o atendimento de {{atendente}}? Responda com um número de 1 a 5:',
  comentario: 'Sentimos muito. O que podemos melhorar?',
  agradecimento: 'Obrigado pela sua avaliação!',
  minutos: 1440,
};

/** Opções embaixo da pergunta (fixas: é por elas que a resposta é entendida) */
export const OPCOES_NOTA = '1 ⭐ Péssimo\n2 ⭐⭐ Ruim\n3 ⭐⭐⭐ Regular\n4 ⭐⭐⭐⭐ Bom\n5 ⭐⭐⭐⭐⭐ Ótimo';

export function prepararPesquisa(valor: any): ConfigPesquisa {
  const cfg: ConfigPesquisa = {
    ativo: Boolean(valor?.ativo),
    pergunta: textoConfig(valor?.pergunta, 1000, 'Pesquisa: pergunta') || PADRAO.pergunta,
    comentario: textoConfig(valor?.comentario, 1000, 'Pesquisa: pedido de comentário') || PADRAO.comentario,
    agradecimento: textoConfig(valor?.agradecimento, 1000, 'Pesquisa: agradecimento') || PADRAO.agradecimento,
    minutos: Number(valor?.minutos ?? PADRAO.minutos),
  };
  if (!Number.isInteger(cfg.minutos) || cfg.minutos < 1 || cfg.minutos > 43_200) throw new Error('Pesquisa: a validade deve ser de 1 a 43.200 minutos (30 dias).');
  return cfg;
}

export const pesquisaPublica = (cfg: ConfigPesquisa | null) => ({ ...PADRAO, ...(cfg ?? {}), opcoes: OPCOES_NOTA });

const lerPesquisa = async (empresaId: string | number): Promise<ConfigPesquisa> => ({ ...PADRAO, ...((await lerConfig(String(empresaId), 'whatsapp', 'pesquisa')) ?? {}) });

/** "4", " 4 ", "4 estrelas", "⭐⭐⭐⭐", "****" → 4; o que não for uma nota → null */
export function lerNota(texto: string): number | null {
  const t = texto.trim();
  const n = /^([1-5])(\s*(estrelas?|⭐+))?[.!]?$/i.exec(t);
  if (n) return Number(n[1]);
  const estrelas = [...t].filter((c) => c === '⭐' || c === '🌟' || c === '*').length;
  const resto = t.replace(/[⭐🌟*\s️]/gu, '');
  return !resto && estrelas >= 1 && estrelas <= 5 ? estrelas : null;
}

/** Texto da mensagem da equipe/bot, reservado antes (aviso repetido da Evolution não duplica) */
async function mandar(empresaId: number, telefone: string, origem: string, texto: string) {
  const id = await reservarEnvio(empresaId, origem, { pessoa_id: null, contato_id: null }, telefone, texto);
  // Parte da conversa: sai pelo número por onde o cliente escreveu
  if (id) await enviarReservada(empresaId, id, origem, telefone, texto, undefined, undefined, await contaDaConversa(empresaId, telefone));
}

/** Intervalo mínimo entre duas pesquisas para o mesmo cliente (pós-atendimento e as da tela Pesquisas de satisfação) */
const DIAS_ENTRE_PESQUISAS = 7;

/**
 * Envia a pesquisa (se ligada), no máximo uma a cada DIAS_ENTRE_PESQUISAS por cliente. Pesquisa anterior do mesmo
 * número ainda sem resposta é descartada. atendente null = atendimento do bot/jornada (a pergunta usa o nome do bot);
 * do atendente, só sai se alguém da equipe escreveu, e a pergunta usa o último que escreveu.
 */
export async function enviarPesquisa(
  empresaId: string | number,
  telefone: string,
  origem: 'atendente' | 'jornada',
  atendente: { id: number; nome: string } | null,
  departamentoId: number | null,
): Promise<void> {
  const cfg = await lerPesquisa(empresaId);
  if (!cfg.ativo) return;
  const emp = Number(empresaId);
  if (origem === 'atendente') {
    // Quem atendeu é o último da equipe que escreveu no atendimento (entre o encerramento anterior e este); só
    // assumir e encerrar, sem escrever, não é atendimento para avaliar
    const [e] = await pool.query<any[]>(
      "SELECT id FROM whatsapp_mensagens WHERE empresa_id = ? AND telefone = ? AND tipo = 'encerramento' ORDER BY id DESC LIMIT 2",
      [emp, telefone],
    );
    const [u] = await pool.query<any[]>(
      `SELECT u.id, u.nome FROM whatsapp_mensagens m JOIN usuarios u ON u.id = m.usuario_id
        WHERE m.empresa_id = ? AND m.telefone = ? AND m.id > ? AND m.direcao = 'enviada' AND m.tipo NOT IN ('evento', 'encerramento')
        ORDER BY m.id DESC LIMIT 1`,
      [emp, telefone, e[1]?.id ?? 0],
    );
    if (!u[0]) return;
    atendente = { id: u[0].id, nome: u[0].nome };
  }
  const [p] = await pool.query<any[]>(`SELECT ${PESSOA_RECENTE()} AS pessoa_id FROM whatsapp_mensagens WHERE empresa_id = ? AND telefone = ?`, [emp, telefone]);
  // Uma pesquisa a cada DIAS_ENTRE_PESQUISAS por cliente, contando as da tela Pesquisas de satisfação
  const [rec] = await pool.query<any[]>(
    `SELECT 1 FROM avaliacoes WHERE empresa_id = ? AND telefone = ? AND pedida_em >= NOW() - INTERVAL ? DAY
     UNION ALL
     SELECT 1 FROM pesquisas_satisfacao_itens i JOIN pesquisas_satisfacao ps ON ps.id = i.pesquisa_id
      WHERE ps.empresa_id = ? AND i.pessoa_id = ? AND i.enviado_em >= NOW() - INTERVAL ? DAY
     LIMIT 1`,
    [emp, telefone, DIAS_ENTRE_PESQUISAS, emp, p[0]?.pessoa_id ?? 0, DIAS_ENTRE_PESQUISAS],
  );
  if (rec.length) return;
  await pool.query(
    "UPDATE avaliacoes SET situacao = 'expirada' WHERE empresa_id = ? AND telefone = ? AND situacao IN ('aguardando_nota', 'aguardando_comentario')",
    [emp, telefone],
  );
  const [a] = await pool.query<any>(
    `INSERT INTO avaliacoes (empresa_id, telefone, pessoa_id, atendente_id, departamento_id, origem, situacao, pedida_em)
     VALUES (?, ?, ?, ?, ?, ?, 'aguardando_nota', NOW())`,
    [emp, telefone, p[0]?.pessoa_id ?? null, atendente?.id ?? null, departamentoId, origem],
  );
  // O atendimento que acabou de encerrar fica com esta avaliação (filtro por nota na pesquisa de satisfação)
  await (await import('./pesquisasSatisfacao.js')).ligarAvaliacao(emp, telefone, a.insertId).catch(() => {});
  const bot: any = await lerConfig(String(emp), 'whatsapp', 'chatbot');
  const quem = atendente?.nome || bot?.nome || 'nossa equipe';
  const texto = `${cfg.pergunta.replace(/\{\{\s*atendente\s*\}\}/g, quem)}\n${OPCOES_NOTA}`;
  try {
    await mandar(emp, telefone, `pesquisa:${a.insertId}`, texto);
  } catch (err: any) {
    await pool.query("UPDATE avaliacoes SET situacao = 'expirada' WHERE id = ?", [a.insertId]);
    console.error(`Pesquisa: não enviada para ${telefone}: ${err.message}`);
  }
}

const estrelas = (n: number) => '⭐'.repeat(n);

/** Palavras de uma despedida/cortesia (sem acento e sem letra repetida: "obrigadoo" → "obrigado") */
const CORTESIA = new Set(
  (
    'obrigado obrigada obrigadao obg brigado brigada valeu vlw de nada disponha por ok okay oks blz beleza certo certinho ' +
    'show top perfeito otimo otima tmj abraco abracos abs igualmente grato grata agradeco muito mto mt eu que voce vc voces ' +
    'tambem tb tbm nos pra pela pelo avaliacao atencao ajuda ta tah bom legal joia e a o amem sim entendi combinado tchau ' +
    'ate mais logo fique fica com deus'
  ).split(' '),
);

/**
 * Mensagem que é só cortesia: "de nada", "obrigado!", "valeu 👍", "ok", "🙏". Tem de ser tudo cortesia (até 8
 * palavras): "obrigado, mas ainda trava" ou "bom dia" (pode ser outro assunto) não são
 */
export function ehCortesia(texto: string): boolean {
  const t = String(texto ?? '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
  const palavras = t.replace(/[^a-z\s]/g, ' ').split(/\s+/).filter(Boolean).map((p) => p.replace(/(.)\1+/g, '$1'));
  if (!palavras.length) return /\p{Extended_Pictographic}/u.test(texto) && texto.trim().length <= 16;
  return palavras.length <= 8 && palavras.every((p) => CORTESIA.has(p));
}

/**
 * Mensagem da equipe/bot que fecha a conversa sem pedir resposta: "Resolvido! Qualquer coisa estamos à disposição".
 * Pergunta ("?") ou promessa ("vou verificar e te retorno") espera resposta de alguém: não fecha
 */
export function ehDespedida(texto: string): boolean {
  const t = String(texto ?? '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
  if (t.includes('?') || /\b(vou|vamos|verific|retorn|aguard|moment|instante|ja ja|daqui a pouco)/.test(t)) return false;
  return /resolvid|disposicao|disponive|qualquer (coisa|duvida)|\bate (mais|logo|breve)|tenha um|\bbo(m|a) (dia|tarde|noite|semana|fim)|obrigad|agradec|tchau|abraco/.test(t);
}

/** Minutos depois do agradecimento da pesquisa (ou do encerramento) em que a cortesia é ignorada */
const MINUTOS_CORTESIA = 30;

/**
 * Cortesia logo depois do fim ("Obrigado pela sua avaliação!" → "de nada"; "Atendimento encerrado" → "valeu"): não é
 * conversa nova. Fica na conversa como lida, com origem de pesquisa (fora do histórico da IA e da análise de
 * pendências), e o bot/automação não responde. Devolve true quando tratou
 */
async function tratarCortesia(nova: MensagemNova): Promise<boolean> {
  const [m] = await pool.query<any[]>('SELECT tipo, texto FROM whatsapp_mensagens WHERE id = ?', [nova.id]);
  if (m[0]?.tipo !== 'texto' || !ehCortesia(m[0].texto)) return false;
  const [ant] = await pool.query<any[]>(
    `SELECT tipo, origem, TIMESTAMPDIFF(MINUTE, data_hora, NOW()) AS minutos FROM whatsapp_mensagens
      WHERE empresa_id = ? AND telefone = ? AND id < ? AND tipo <> 'evento' ORDER BY id DESC LIMIT 1`,
    [nova.empresaId, nova.telefone, nova.id],
  );
  const a = ant[0];
  const depoisDoFim = a && (a.tipo === 'encerramento' || String(a.origem ?? '').startsWith('pesquisa-obrigado:'));
  if (!depoisDoFim || Number(a.minutos) > MINUTOS_CORTESIA) return false;
  await pool.query('UPDATE whatsapp_mensagens SET origem = ?, vista = 1 WHERE id = ? AND origem IS NULL', [`pesquisa-cortesia:${nova.id}`, nova.id]);
  return true;
}

/**
 * Mensagem recebida: se o número tem pesquisa esperando resposta, trata aqui (nota ou comentário) e
 * devolve true (o bot/jornada não respondem). O que não for nota descarta a pesquisa (false: segue).
 */
/**
 * Nota baixa (1 a 3): avisa quem atendeu e o responsável pelas pendências (Configurações › Chatbot; sem ele, os
 * administradores), para alguém procurar o cliente
 */
async function avisarNotaBaixa(empresaId: number, avaliacaoId: number, nota: number) {
  const [[a]] = await pool.query<any>(
    `SELECT av.atendente_id, COALESCE(p.nome, av.telefone) AS cliente, u.nome AS atendente FROM avaliacoes av
       LEFT JOIN pessoas p ON p.id = av.pessoa_id LEFT JOIN usuarios u ON u.id = av.atendente_id WHERE av.id = ?`,
    [avaliacaoId],
  );
  const cfg: any = await lerConfig(String(empresaId), 'whatsapp', 'chatbot');
  const [admins] = cfg?.responsavel_pendencias_id
    ? [[{ id: cfg.responsavel_pendencias_id }]]
    : await pool.query<any[]>("SELECT id FROM usuarios WHERE empresa_id = ? AND ativo = 1 AND tipo = 'admin'", [empresaId]);
  await notificar(empresaId, { usuarios: [a?.atendente_id, ...admins.map((x: any) => x.id)] }, {
    tipo: 'avaliacao',
    titulo: `Avaliação baixa: ${'★'.repeat(nota)} (${nota})`,
    texto: `${a?.cliente ?? 'Cliente'}${a?.atendente ? ` — atendido por ${a.atendente}` : ''}`,
    link: 'avaliacoes',
    registroId: avaliacaoId,
  });
}

export async function tratarRespostaPesquisa(nova: MensagemNova): Promise<boolean> {
  const cfg = await lerPesquisa(nova.empresaId);
  const [pend] = await pool.query<any[]>(
    `SELECT id, situacao FROM avaliacoes
      WHERE empresa_id = ? AND telefone = ? AND situacao IN ('aguardando_nota', 'aguardando_comentario') AND pedida_em > NOW() - INTERVAL ? MINUTE
      ORDER BY id DESC LIMIT 1`,
    [nova.empresaId, nova.telefone, cfg.minutos],
  );
  const av = pend[0];
  // Sem pesquisa esperando: "de nada"/"obrigado" logo depois do fim não abre conversa nova
  if (!av) return tratarCortesia(nova);
  const [m] = await pool.query<any[]>('SELECT tipo, texto FROM whatsapp_mensagens WHERE id = ?', [nova.id]);
  const texto = m[0]?.tipo === 'texto' ? String(m[0].texto ?? '') : `[${m[0]?.tipo ?? 'mensagem'}]`;
  // A resposta da pesquisa não entra no histórico da IA nem conta como atendimento
  const marcarResposta = () =>
    pool.query('UPDATE whatsapp_mensagens SET origem = ? WHERE id = ? AND origem IS NULL', [`pesquisa-resposta:${av.id}:${nova.id}`, nova.id]);
  // Pausa curta de gente antes de responder (1 a 4 s)
  const pausa = () => new Promise((ok) => setTimeout(ok, 1000 + Math.random() * 3000));

  if (av.situacao === 'aguardando_nota') {
    const nota = lerNota(texto);
    if (nota === null) {
      // Não respondeu a pesquisa: segue o atendimento normal
      await pool.query("UPDATE avaliacoes SET situacao = 'expirada' WHERE id = ?", [av.id]);
      return false;
    }
    const pedeComentario = nota <= 3;
    await pool.query('UPDATE avaliacoes SET nota = ?, situacao = ?, respondida_em = NOW() WHERE id = ?', [nota, pedeComentario ? 'aguardando_comentario' : 'respondida', av.id]);
    await marcarResposta();
    await marcarEvento(nova.empresaId, nova.telefone, `Cliente avaliou ${estrelas(nota)} (${nota})`, null);
    if (nota <= 3) await avisarNotaBaixa(nova.empresaId, av.id, nota);
    await pausa();
    await mandar(nova.empresaId, nova.telefone, `pesquisa-${pedeComentario ? 'comentario' : 'obrigado'}:${av.id}`, pedeComentario ? cfg.comentario : cfg.agradecimento);
    return true;
  }

  // Comentário da nota baixa
  await pool.query("UPDATE avaliacoes SET comentario = ?, situacao = 'respondida' WHERE id = ?", [texto.slice(0, 2000), av.id]);
  await marcarResposta();
  await marcarEvento(nova.empresaId, nova.telefone, `Comentário da avaliação: ${texto.slice(0, 200)}`, null);
  await pausa();
  await mandar(nova.empresaId, nova.telefone, `pesquisa-obrigado:${av.id}`, cfg.agradecimento);
  return true;
}
