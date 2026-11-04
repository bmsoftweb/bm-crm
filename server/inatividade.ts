import { pool } from './db.js';
import { marcarEvento, minutosInatividade, mudarAtendimento, type ConfigChatbot } from './chatbot.js';

/**
 * Falta de interação no WhatsApp: o app nunca encerra um atendimento sozinho (só alguém da equipe, pelo Encerrar).
 * X minutos (Configurações › Chatbot) depois da última mensagem do bot, com o cliente tendo escrito neste
 * atendimento e sem responder, a conversa vai para "aguardando", sem mandar nada ao cliente.
 * Conversa com técnico (assumida ou transferida) nunca entra: fica com ele até encerrar, pausar ou transferir.
 * Do cliente esperando o técnico: nada aqui; a tela do técnico toca a campainha (/whatsapp/nao-vistas).
 * Não entram: conversa já aguardando, parada num Esperar da Automação e mensagens de campanha/automáticas.
 * Roda no cron do WhatsApp (Vercel) e no setInterval local, com trava no MySQL (os dois usam o mesmo banco).
 */

/** Linhas de encerramentos antigos (antes de o app deixar de encerrar sozinho): a Automação das campanhas ainda as reconhece */
export const TEXTO_ENCERRAMENTO = 'Atendimento encerrado por falta de interação do cliente';
/** Mensagem mais velha que o prazo + esta janela não entra (servidor parado, conversa antiga) */
const JANELA_MIN = 60;

/** Conversas do bot paradas há X minutos: última mensagem do bot (já entregue), sem resposta do cliente */
async function candidatas(empresaId: number, minutos: number) {
  const [rows] = await pool.query<any[]>(
    `SELECT c.telefone
       FROM whatsapp_conversas c
       JOIN whatsapp_mensagens m ON m.id = (SELECT MAX(z.id) FROM whatsapp_mensagens z
                                             WHERE z.empresa_id = c.empresa_id AND z.telefone = c.telefone AND z.tipo <> 'evento')
      WHERE c.empresa_id = ? AND c.retomar_em IS NULL
        AND c.atendimento <> 'humano' AND c.atendente_id IS NULL
        AND m.tipo <> 'encerramento'
        AND m.direcao = 'enviada' AND m.situacao <> 'pendente' AND (m.origem IS NULL OR m.origem LIKE 'bot:%')
        AND m.data_hora <= NOW() - INTERVAL ? MINUTE
        AND m.data_hora > NOW() - INTERVAL ? MINUTE
        AND EXISTS (SELECT 1 FROM whatsapp_mensagens r
                     WHERE r.empresa_id = c.empresa_id AND r.telefone = c.telefone AND r.direcao = 'recebida'
                       AND r.id > COALESCE((SELECT MAX(e.id) FROM whatsapp_mensagens e
                                             WHERE e.empresa_id = c.empresa_id AND e.telefone = c.telefone AND e.tipo = 'encerramento'), 0))`,
    [empresaId, minutos, minutos + JANELA_MIN],
  );
  return rows;
}

/** Um ciclo (cron a cada minuto): em cada empresa com o tempo ligado, as conversas paradas vão para aguardando */
export async function verificarInatividade(): Promise<{ aguardando: number }> {
  let aguardando = 0;
  const conn = await pool.getConnection();
  try {
    const [trava] = await conn.query<any[]>("SELECT GET_LOCK('crmweb_inatividade', 0) AS ok");
    if (!trava[0]?.ok) return { aguardando };
    try {
      const [cfgs] = await pool.query<any[]>("SELECT empresa_id, valor FROM config WHERE grupo = 'whatsapp' AND chave = 'chatbot'");
      for (const r of cfgs) {
        const minutos = minutosInatividade(JSON.parse(r.valor || 'null') as ConfigChatbot | null);
        if (minutos <= 0) continue;
        for (const c of await candidatas(Number(r.empresa_id), minutos)) {
          try {
            await mudarAtendimento(r.empresa_id, c.telefone, 'humano');
            await marcarEvento(r.empresa_id, c.telefone, `Aguardando: cliente não respondeu há ${minutos} min`, null);
            aguardando++;
          } catch (err: any) {
            console.error(`Inatividade (${c.telefone}): ${err.message}`);
          }
        }
      }
    } finally {
      await conn.query("SELECT RELEASE_LOCK('crmweb_inatividade')");
    }
  } finally {
    conn.release();
  }
  return { aguardando };
}

/** Fora da Vercel: um ciclo a cada minuto (na Vercel é o cron de /api/cron/whatsapp) */
export function iniciarInatividade() {
  let rodando = false;
  setInterval(async () => {
    if (rodando) return;
    rodando = true;
    try {
      const r = await verificarInatividade();
      if (r.aguardando) console.log(`Inatividade: ${r.aguardando} conversa(s) para aguardando.`);
    } catch (err: any) {
      console.error('Inatividade: falha no ciclo:', err.message);
    } finally {
      rodando = false;
    }
  }, 60_000);
}
