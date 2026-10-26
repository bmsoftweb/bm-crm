/**
 * bm-help (D:\projetos\autoSuporte): IA que responde dúvidas sobre os sistemas lendo o código deles.
 * O assistente do chat do suporte (server/suporte.ts) pergunta por um usuário de serviço do bm-help
 * (tipo cliente, ligado aos sistemas que o chat oferece e com a chave da Anthropic cadastrada).
 * Env: BMHELP_URL, BMHELP_EMAIL, BMHELP_SENHA. Sem elas, o assistente não aparece.
 */

const base = () => String(process.env.BMHELP_URL || '').replace(/\/+$/, '');

export const bmhelpLigado = () => Boolean(base() && process.env.BMHELP_EMAIL && process.env.BMHELP_SENHA);

// O token do bm-help vale 30 dias: entra uma vez e de novo quando ele recusar
let token: string | null = null;

async function entrar() {
  const r = await fetch(`${base()}/api/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: process.env.BMHELP_EMAIL, senha: process.env.BMHELP_SENHA }),
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok || !d.token) throw new Error(`bm-help: login recusado (${d.error || r.status})`);
  token = d.token as string;
}

async function chamar(caminho: string, init: RequestInit = {}, timeoutMs = 15000): Promise<Response> {
  if (!token) await entrar();
  const ir = () =>
    fetch(`${base()}${caminho}`, {
      ...init,
      headers: { ...(init.headers || {}), Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(timeoutMs),
    });
  let r = await ir();
  if (r.status === 401) {
    await entrar();
    r = await ir();
  }
  if (!r.ok) {
    const d = await r.json().catch(() => ({}));
    throw new Error(`bm-help ${caminho}: ${d.error || r.status}`);
  }
  return r;
}

// ponytail: cache em memória por 5 min (por instância); invalida só pelo tempo
let cacheSistemas: { quando: number; lista: { id: number; nome: string }[] } | null = null;

/** Sistemas que o usuário de serviço pode consultar */
export async function sistemasBmhelp(): Promise<{ id: number; nome: string }[]> {
  if (cacheSistemas && Date.now() - cacheSistemas.quando < 5 * 60 * 1000) return cacheSistemas.lista;
  const lista = ((await (await chamar('/api/sistemas')).json()) as any[]).map((s) => ({ id: Number(s.id), nome: String(s.nome) }));
  cacheSistemas = { quando: Date.now(), lista };
  return lista;
}

/**
 * Pergunta e espera a resposta inteira (o bm-help responde aos poucos; aqui junta tudo).
 * Sem sessão abre conversa nova; com ela, continua a mesma (o bm-help lembra do que já foi falado)
 */
export async function perguntarBmhelp(
  sistemaId: number,
  pergunta: string,
  sessao: string | null,
  imagem: { tipo: string; base64: string } | null = null,
): Promise<{ texto: string; sessao: string }> {
  // A função da Vercel vai até 120 s; a primeira resposta (abre o código do sistema) leva uns 30 a 60 s
  const r = await chamar(
    '/api/perguntar',
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sistemaId, pergunta, sessaoId: sessao || undefined, imagem: imagem || undefined }) },
    105000,
  );
  return { texto: (await r.text()).trim(), sessao: r.headers.get('X-Sessao') || sessao || '' };
}

/**
 * O cliente pediu para falar com uma pessoa ("quero falar com um técnico", "atendente por favor"...): o chat
 * desliga o assistente e o cliente segue na fila. "pessoa" sozinha não conta (pessoa física/jurídica é do sistema).
 * ponytail: lista de frases, não IA; frase fora do padrão passa como dúvida (o botão "Falar com técnico" cobre)
 */
const PEDE_TECNICO = [
  /\b(falar|conversar|ser atendid[oa]|atendimento|chamar|chama|passa|passar|transfer\w*)\b.{0,25}\b(t[eé]cnico|atendente|humano)/i,
  /\b(quero|prefiro|preciso de|cad[eê])\s+(o |a |um |uma )?(t[eé]cnico|atendente|humano)/i,
  /\b(falar|conversar)\s+com\s+(uma |alguma )?(pessoa|algu[eé]m)\b/i,
  /^\W*(o |um |a |uma )?(t[eé]cnico|atendente|humano)s?\W*(por favor|pf|pfv)?\W*$/i,
];
export const pedeTecnico = (texto: string) => PEDE_TECNICO.some((r) => r.test(texto));
