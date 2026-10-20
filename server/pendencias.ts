import { waitUntil } from '@vercel/functions';
import { pool } from './db.js';
import { aposGravar } from './regras.js';
import { conversarIa, lerChatbot, marcarEvento, temChave } from './chatbot.js';
import { gravarMensagem as mensagemChamado } from './chamados.js';
import { verificarFim } from './atividadeBot.js';
import { notificar } from './notificacoes.js';

/**
 * Pendências de conversa: quando uma conversa com o cliente termina (atendimento do WhatsApp encerrado, chamado
 * encerrado, conversa do Bot de uma atividade), a IA lê a conversa inteira e procura o que ficou para a equipe
 * fazer: pediu para falar com alguém, reclamou, ou pediu algo que não foi resolvido. Cada pendência vira uma
 * tarefa para o usuário identificado; sem ele, para o departamento; sem os dois, para o responsável escolhido em
 * Configurações › Chatbot (sem ninguém: o primeiro administrador). Ligado/desligado em Configurações › Chatbot.
 * Roda em segundo plano (na Vercel, waitUntil mantém a função viva): quem encerrou não espera a IA.
 */

/** Início das linhas de análise na conversa do WhatsApp: a próxima análise começa depois da última */
// A observação das tarefas começa com "Identificada pela análise automática": é por ela que a lista mostra a Origem (server/schema.ts)
const MARCA = 'Análise da conversa';

interface Fonte {
  empresaId: number;
  pessoaId: number | null;
  /** De onde veio, para a tarefa: "atendimento do WhatsApp", "chamado nº 12"... */
  origem: string;
  /** A conversa, uma fala por linha: "Cliente: ...", "Atendente (Luis): ..." */
  conversa: string;
  /** Quem atendeu (candidato natural quando se comprometeu com algo) */
  atendente: string | null;
  /** Conclusão que o técnico escreveu ao encerrar (chamado): o que ele der como resolvido não vira tarefa */
  conclusao?: string | null;
  vinculos: { negocio_id?: number | null; chamado_id?: number | null };
  /** Onde anotar o resultado (linha na conversa do WhatsApp ou no chamado) */
  anotar: (texto: string) => Promise<unknown>;
}

const TIPOS: Record<string, string> = {
  falar_com_alguem: 'Cliente quer falar com alguém',
  reclamacao: 'Reclamação do cliente',
  pedido: 'Pedido do cliente',
};

/** Sem acento e minúsculo, para achar o nome que a IA devolveu */
const normal = (t: unknown) => String(t ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

/** Nome → registro: igual; senão, o único que começa com ele */
function acharPorNome<T extends { nome: string }>(lista: T[], nome: unknown): T | null {
  const n = normal(nome);
  if (!n) return null;
  const igual = lista.find((x) => normal(x.nome) === n);
  if (igual) return igual;
  const comeca = lista.filter((x) => normal(x.nome).startsWith(n));
  return comeca.length === 1 ? comeca[0] : null;
}

/** Dispara a análise sem segurar quem chamou; erro só vai para o log */
function emSegundoPlano(nome: string, fn: () => Promise<Fonte | null>) {
  waitUntil(
    fn()
      .then((f) => (f ? analisar(f) : undefined))
      .catch((err) => console.error(`Pendências (${nome}): ${err.message}`)),
  );
}

export async function analisar(f: Fonte): Promise<number> {
  const cfg = await lerChatbot(f.empresaId);
  if (!temChave(cfg) || cfg.analisar_conversas === false) return 0;
  // Sem nada dito pelo cliente não há o que analisar
  if (!/^Cliente:/m.test(f.conversa)) return 0;

  const [usuarios] = await pool.query<any[]>(
    `SELECT u.id, u.nome, u.cargo, u.tipo, d.nome AS departamento FROM usuarios u LEFT JOIN departamentos d ON d.id = u.departamento_id
      WHERE u.empresa_id = ? AND u.ativo = 1 ORDER BY u.nome`,
    [f.empresaId],
  );
  const [departamentos] = await pool.query<any[]>('SELECT id, nome FROM departamentos WHERE empresa_id = ? ORDER BY nome', [f.empresaId]);
  const [abertas] = f.pessoaId
    ? await pool.query<any[]>('SELECT assunto FROM atividades WHERE empresa_id = ? AND pessoa_id = ? AND concluida = 0 ORDER BY id DESC LIMIT 20', [f.empresaId, f.pessoaId])
    : [[]];
  const [emp] = await pool.query<any[]>('SELECT nome FROM empresas WHERE id = ?', [f.empresaId]);

  const system = `Você analisa conversas de atendimento da empresa ${emp[0]?.nome ?? ''} para não deixar pendências para trás.
Leia a conversa inteira (${f.origem}) e liste só o que ficou para a EQUIPE fazer depois dela:
1. falar_com_alguem: o cliente pediu para falar com alguém (uma pessoa, um setor, "um atendente", "o gerente") e isso não aconteceu na própria conversa;
2. reclamacao: o cliente reclamou de algo e precisa de um retorno;
3. pedido: o cliente pediu algo (ou alguém da empresa prometeu algo) que não foi resolvido na conversa.
Não liste o que já foi resolvido na conversa nem o que já está nas tarefas abertas abaixo. Conversa sem pendência: lista vazia.
${
  f.conclusao
    ? `
CONCLUSÃO DO TÉCNICO ao encerrar (${f.atendente ?? 'equipe'}): "${f.conclusao}"
A conclusão só tira pendências: o que o técnico deu claramente como concluído, resolvido, feito, orientado, enviado ou atendido NÃO é
pendência, mesmo que a conversa pareça deixar algo em aberto; se ela der o atendimento todo como concluído, responda com a lista vazia.
Se a conclusão não disser claramente que algo foi concluído (ex.: só descreve o problema, ou deixa algo para depois), ignore-a e analise
a conversa normalmente, listando as pendências como faria sem ela.
`
    : ''
}
Para cada pendência, quem deve cuidar:
- "usuario": nome exato de um usuário da lista, só se a conversa deixar claro quem (o cliente citou a pessoa, ou quem atendeu se comprometeu a fazer);
- senão "departamento": nome exato de um departamento da lista, se o assunto deixar claro (ex.: cobrança = financeiro, problema no sistema = suporte, compra = comercial);
- senão os dois vazios.

Usuários: ${usuarios.map((u) => `${u.nome} — ${[u.cargo, u.departamento].filter(Boolean).join(', ') || 'sem cargo'}`).join('; ')}
Departamentos: ${departamentos.map((d) => d.nome).join(', ') || '(nenhum)'}
${f.atendente ? `Quem atendeu: ${f.atendente}` : 'Quem atendeu: o assistente virtual (bot)'}
Tarefas abertas deste cliente: ${abertas.map((a: any) => a.assunto).join(' | ') || '(nenhuma)'}

Responda só com JSON, sem texto em volta:
{"pendencias":[{"tipo":"falar_com_alguem|reclamacao|pedido","descricao":"o que a equipe precisa fazer, em uma frase, citando o cliente","usuario":"","departamento":""}]}`;

  const r = await conversarIa(cfg, system, [{ de: 'pessoa', texto: f.conversa }], []);
  let lista: any[] = [];
  try {
    lista = JSON.parse(/\{[\s\S]*\}/.exec(r.texto)?.[0] ?? '{}').pendencias ?? [];
  } catch {
    throw new Error(`a IA não devolveu a lista de pendências: ${r.texto.slice(0, 200)}`);
  }
  if (!Array.isArray(lista) || !lista.length) return 0;

  // O "diretor": o escolhido em Configurações › Chatbot (se ativo); sem ele, o primeiro administrador
  const diretor =
    usuarios.find((u) => u.id === Number(cfg.responsavel_pendencias_id)) ??
    usuarios.find((u) => u.tipo === 'admin') ??
    null;

  const feitas: string[] = [];
  for (const p of lista.slice(0, 5)) {
    const descricao = String(p?.descricao ?? '').trim();
    if (!descricao) continue;
    const usuario = acharPorNome(usuarios, p.usuario);
    const departamento = usuario ? null : acharPorNome(departamentos, p.departamento);
    const executor = usuario ?? (departamento ? null : diretor);
    const rotulo = TIPOS[p.tipo] ?? 'Pendência do cliente';
    const para = usuario ? usuario.nome : departamento ? `departamento ${departamento.nome}` : executor ? `${executor.nome} (sem responsável identificado)` : 'qualquer pessoa';
    const [ins] = await pool.query<any>(
      `INSERT INTO atividades (empresa_id, pessoa_id, negocio_id, chamado_id, assunto, tipo, data_vencimento, hora_vencimento, lembrete_para, executor_id, departamento_id, observacao)
       VALUES (?, ?, ?, ?, ?, 'tarefa', CURDATE(), TIME_FORMAT(CURTIME(), '%H:%i:00'), 'nenhum', ?, ?, ?)`,
      [
        f.empresaId,
        f.pessoaId,
        f.vinculos.negocio_id ?? null,
        f.vinculos.chamado_id ?? null,
        `${rotulo}: ${descricao}`.slice(0, 255),
        executor?.id ?? null,
        departamento?.id ?? null,
        `Identificada pela análise automática da conversa (${f.origem}).\n${descricao}`,
      ],
    );
    await aposGravar('atividades', String(ins.insertId));
    await notificar(f.empresaId, executor ? { usuarios: [executor.id] } : { departamentoId: departamento?.id }, {
      tipo: 'tarefa',
      titulo: `Tarefa para você: ${rotulo.toLowerCase()}`,
      texto: `${descricao} (${f.origem})`,
      link: 'atividades',
      registroId: Number(ins.insertId),
    });
    feitas.push(`${rotulo.toLowerCase()} → tarefa para ${para}`);
  }
  if (feitas.length) await f.anotar(`${MARCA}: ${feitas.join('; ')}`);
  return feitas.length;
}

// ------------------------------------------------------------
// As três fontes
// ------------------------------------------------------------

/**
 * Atendimento do WhatsApp encerrado (botão Encerrar, tempo esgotado, fim da automação, falta de interação): a
 * conversa desde o encerramento anterior (ou da última análise). Conversa de um usuário da empresa fica de fora
 */
export function analisarAtendimentoWhatsApp(empresaId: string | number, telefone: string) {
  emSegundoPlano(`WhatsApp ${telefone}`, async () => {
    const emp = Number(empresaId);
    const [u] = await pool.query<any[]>("SELECT 1 FROM usuarios WHERE empresa_id = ? AND REPLACE(REPLACE(REPLACE(REPLACE(telefone, '(', ''), ')', ''), '-', ''), ' ', '') LIKE ? LIMIT 1", [emp, `%${telefone.slice(-8)}`]);
    if (u.length) return null;
    const [ms] = await pool.query<any[]>(
      `SELECT m.direcao, m.tipo, m.texto, m.origem, m.pessoa_id, x.nome AS usuario FROM whatsapp_mensagens m LEFT JOIN usuarios x ON x.id = m.usuario_id
        WHERE m.empresa_id = ? AND m.telefone = ? AND m.situacao <> 'falhou' AND m.tipo NOT IN ('evento', 'encerramento')
          AND (m.origem IS NULL OR (m.origem NOT LIKE 'pesquisa%' AND m.origem NOT LIKE 'inatividade%'))
          -- Mensagem privada de um departamento não entra no resumo (a pendência pode ser vista por outros)
          AND m.privado_departamento_id IS NULL
          AND m.id > COALESCE((SELECT MAX(e.id) FROM whatsapp_mensagens e WHERE e.empresa_id = m.empresa_id AND e.telefone = m.telefone
                                AND (e.tipo = 'encerramento' OR (e.tipo = 'evento' AND e.texto LIKE ?))
                                AND e.id < (SELECT MAX(z.id) FROM whatsapp_mensagens z WHERE z.empresa_id = m.empresa_id AND z.telefone = m.telefone AND z.tipo = 'encerramento')), 0)
        ORDER BY m.id DESC LIMIT 80`,
      [emp, telefone, `${MARCA}%`],
    );
    ms.reverse();
    const atendentes = [...new Set(ms.map((m) => m.usuario).filter(Boolean))];
    return {
      empresaId: emp,
      pessoaId: ms.map((m) => m.pessoa_id).filter(Boolean).pop() ?? null,
      origem: 'atendimento do WhatsApp',
      conversa: ms
        .map((m) => {
          const texto = m.tipo === 'texto' ? m.texto : `[${m.tipo}]${m.texto ? ` ${m.texto}` : ''}`;
          const quem = m.direcao === 'recebida' ? 'Cliente' : m.usuario ? `Atendente (${m.usuario})` : 'Assistente virtual';
          return `${quem}: ${texto ?? ''}`;
        })
        .join('\n'),
      atendente: atendentes.join(', ') || null,
      vinculos: {},
      anotar: (t) => marcarEvento(emp, telefone, t, null),
    };
  });
}

/** Chamado encerrado: descrição, mensagens (com as notas internas) e a conclusão do técnico */
export function analisarChamado(chamadoId: number) {
  emSegundoPlano(`chamado ${chamadoId}`, async () => {
    const [c] = await pool.query<any[]>(
      'SELECT c.*, u.nome AS atendente FROM chamados c LEFT JOIN usuarios u ON u.id = c.atendente_id WHERE c.id = ?',
      [chamadoId],
    );
    if (!c[0]) return null;
    const [ms] = await pool.query<any[]>(
      `SELECT m.autor, m.texto, m.interna, u.nome AS usuario FROM chamado_mensagens m LEFT JOIN usuarios u ON u.id = m.usuario_id
        WHERE m.chamado_id = ? AND m.autor <> 'sistema' AND m.texto NOT LIKE '[[%' ORDER BY m.id`,
      [chamadoId],
    );
    const linhas = [`Cliente: (abriu o chamado "${c[0].titulo}") ${c[0].descricao ?? ''}`];
    for (const m of ms) {
      linhas.push(m.autor === 'cliente' ? `Cliente: ${m.texto}` : `${m.interna ? 'Nota interna' : 'Atendente'} (${m.usuario ?? 'equipe'}): ${m.texto}`);
    }
    return {
      empresaId: c[0].empresa_id,
      pessoaId: c[0].pessoa_id,
      origem: `chamado nº ${c[0].numero}`,
      conversa: linhas.join('\n'),
      atendente: c[0].atendente,
      conclusao: String(c[0].conclusao ?? '').trim() || null,
      vinculos: { chamado_id: chamadoId },
      anotar: (t) => mensagemChamado({ chamado_id: chamadoId, autor: 'sistema', texto: t }),
    };
  });
}

/**
 * Conversa do Bot de uma atividade que terminou (concluída, sem resposta ou passada para a equipe). A linha de análise
 * vai para a conversa do WhatsApp mesmo sem pendência: a análise do atendimento, depois, não repete estas mensagens.
 * Passada para a equipe e as pendências viraram tarefas: a conversa do Bot conta como resolvida (o acompanhamento é
 * pelas tarefas) e a atividade pode ser concluída
 */
export function analisarConversaBot(conversaId: number) {
  emSegundoPlano(`Bot, conversa ${conversaId}`, async () => {
    const [c] = await pool.query<any[]>(
      `SELECT c.*, a.empresa_id, a.assunto, a.negocio_id, a.chamado_id FROM atividade_conversas c JOIN atividades a ON a.id = c.atividade_id WHERE c.id = ?`,
      [conversaId],
    );
    const conv = c[0];
    if (!conv || conv.canal !== 'whatsapp' || !conv.pessoa_id) return null;
    const [ms] = await pool.query<any[]>('SELECT direcao, texto FROM atividade_mensagens WHERE conversa_id = ? ORDER BY id', [conversaId]);
    const fonte: Fonte = {
      empresaId: conv.empresa_id,
      pessoaId: conv.pessoa_id,
      origem: `conversa do assistente virtual sobre "${conv.assunto}"`,
      conversa: ms.map((m) => `${m.direcao === 'recebida' ? 'Cliente' : 'Assistente virtual'}: ${m.texto}`).join('\n'),
      atendente: null,
      vinculos: { negocio_id: conv.negocio_id, chamado_id: conv.chamado_id },
      anotar: (t) => marcarEvento(conv.empresa_id, conv.destino, t, null),
    };
    const tarefas = await analisar(fonte);
    if (!tarefas) await marcarEvento(conv.empresa_id, conv.destino, `${MARCA}: nenhuma pendência`, null);
    else if (conv.situacao === 'humano') {
      await pool.query(
        "UPDATE atividade_conversas SET situacao = 'concluida', resumo = CONCAT(COALESCE(resumo, ''), ?) WHERE id = ?",
        [` Passada para a equipe; ${tarefas === 1 ? 'a pendência virou tarefa' : `as ${tarefas} pendências viraram tarefas`}.`, conv.id],
      );
      await verificarFim(conv.atividade_id);
    }
    return null;
  });
}
