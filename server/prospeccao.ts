import { Router, Request, Response } from 'express';
import dns from 'dns/promises';
import net from 'net';
import { pool } from './db.js';
import { lerConfig } from './config.js';
import { exigirAcesso } from './permissoes.js';
import { cifrar, decifrar } from './segredo.js';
import { chaveTelefone, telefoneWhatsApp } from './whatsapp.js';

/**
 * Prospecção: busca de empresas na Google Places API (oficial, Text Search) por segmento e
 * região, separação dos celulares, nota de qualificação e inclusão das escolhidas em Pessoas
 * como lead.
 *
 * Só dados públicos de empresas (o cadastro do Google Maps). Nada de raspar a busca do Google,
 * que os termos de uso proíbem. O site da empresa pode ser lido (opção "Ler os sites") para
 * achar o link do WhatsApp (wa.me), o e-mail e o Instagram publicados lá.
 *
 * A chave da API fica em Configurações › Prospecção (config prospeccao.google, cifrada) ou no
 * GOOGLE_PLACES_API_KEY do .env. Cada busca fica guardada em prospeccao_buscas (filtros e as empresas
 * que passaram nos filtros, em JSON), para reabrir depois sem pagar o Google de novo; nada vai para
 * Pessoas até a tela mandar incluir.
 *
 * Chave da inclusão: pessoas.google_place_id (o cod_integracao fica livre para o bmsoft, "CRMWEB-<id>"
 * como os cadastros feitos aqui). Quem já está no CRM (pelo place id ou pelo telefone) aparece
 * marcado na busca e não é incluído de novo.
 */

const ONDE = 'Configurações › Prospecção';
const URL_BUSCA = 'https://places.googleapis.com/v1/places:searchText';
const CAMPOS_GOOGLE = [
  'places.id',
  'places.displayName',
  'places.formattedAddress',
  'places.addressComponents',
  'places.nationalPhoneNumber',
  'places.internationalPhoneNumber',
  'places.websiteUri',
  'places.googleMapsUri',
  'places.rating',
  'places.userRatingCount',
  'places.primaryTypeDisplayName',
  'places.businessStatus',
  'nextPageToken',
].join(',');
/** O Google devolve no máximo 20 por página e 3 páginas por busca */
const MAX_RESULTADOS = 60;
const MAX_INCLUIR = 200;
const TIMEOUT_GOOGLE_MS = 20_000;
const TIMEOUT_SITE_MS = 6_000;
const MAX_HTML = 600_000;

function erro(status: number, msg: string) {
  return Object.assign(new Error(msg), { status });
}

// ==========================================================
// Configuração (chave da Places API)
// ==========================================================
interface ConfigGoogle {
  chave_cifrada?: string;
}

/** Tela → banco: chave nova é cifrada; em branco mantém a gravada; limpar = apagar */
export function prepararConfigProspeccao(valor: any, anterior: ConfigGoogle | null): ConfigGoogle | null {
  if (valor?.limpar) return null;
  const t = String(valor?.chave ?? '').trim();
  if (t.length > 200) throw new Error('Prospecção: chave grande demais.');
  if (t && !/^[\w-]+$/.test(t)) throw new Error('Prospecção: chave da API inválida.');
  const cifrada = t ? cifrar(t) : anterior?.chave_cifrada;
  return cifrada ? { chave_cifrada: cifrada } : null;
}

/** Banco → tela: só se a chave existe */
export function configProspeccaoPublica(cfg: ConfigGoogle | null) {
  return { chave_definida: Boolean(cfg?.chave_cifrada), chave_no_servidor: Boolean(process.env.GOOGLE_PLACES_API_KEY) };
}

async function chaveApi(empresaId: string): Promise<string> {
  const cfg: ConfigGoogle | null = await lerConfig(empresaId, 'prospeccao', 'google');
  if (cfg?.chave_cifrada) return decifrar(cfg.chave_cifrada, ONDE);
  if (process.env.GOOGLE_PLACES_API_KEY) return process.env.GOOGLE_PLACES_API_KEY;
  throw erro(400, `Informe a chave da Google Places API em ${ONDE}.`);
}

// ==========================================================
// Regras (puras, testadas em prospeccao.test.ts)
// ==========================================================

/** Celular brasileiro com DDI (55 + DDD + 9 + 8 dígitos), ou null (fixo, estrangeiro, inválido) */
export function celularBR(bruto: string | null | undefined): string | null {
  try {
    const t = telefoneWhatsApp(bruto);
    return /^55[1-9]{2}9\d{8}$/.test(t) ? t : null;
  } catch {
    return null;
  }
}

/** Número para mostrar: (47) 98848-9722 / (47) 3521-0000 */
export function formatarTelefone(bruto: string | null | undefined): string | null {
  let t = String(bruto ?? '').replace(/\D/g, '');
  if (t.startsWith('55') && t.length >= 12) t = t.slice(2);
  if (t.length === 11) return `(${t.slice(0, 2)}) ${t.slice(2, 7)}-${t.slice(7)}`;
  if (t.length === 10) return `(${t.slice(0, 2)}) ${t.slice(2, 6)}-${t.slice(6)}`;
  return bruto ? String(bruto).trim() || null : null;
}

export interface ContatosSite {
  whatsapp: string | null;
  email: string | null;
  instagram: string | null;
}

const EMAIL_IGNORAR = /\.(png|jpe?g|gif|webp|svg)$|@(example|exemplo|sentry|wixpress|domain)\./i;

/** Do HTML do site: o 1º celular de link do WhatsApp, o 1º e-mail e o 1º perfil do Instagram */
export function extrairContatos(html: string): ContatosSite {
  const h = String(html || '');
  let whatsapp: string | null = null;
  const reWa = /(?:wa\.me\/|api\.whatsapp\.com\/send\/?\?(?:[^"'\s>]*?&(?:amp;)?)?phone=|whatsapp:\/\/send\?phone=)\+?(\d[\d\s().-]{9,18})/gi;
  for (const m of h.matchAll(reWa)) {
    const c = celularBR(m[1].replace(/\D/g, ''));
    if (c) {
      whatsapp = c;
      break;
    }
  }
  let email: string | null = null;
  for (const m of h.matchAll(/(?:mailto:)?([A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9.-]{1,190}\.[A-Za-z]{2,24})/g)) {
    const e = m[1].toLowerCase();
    if (!EMAIL_IGNORAR.test(e)) {
      email = e;
      break;
    }
  }
  let instagram: string | null = null;
  for (const m of h.matchAll(/instagram\.com\/([A-Za-z0-9_.]{2,30})/gi)) {
    if (!/^(p|reel|reels|explore|accounts|stories|tv|share)$/i.test(m[1])) {
      instagram = `https://instagram.com/${m[1].replace(/\.+$/, '')}`;
      break;
    }
  }
  return { whatsapp, email, instagram };
}

export interface Criterios {
  nota_min: number;
  avaliacoes_min: number;
  exigir_site: boolean;
  somente_celular: boolean;
}

/**
 * Nota de 0 a 100 e os motivos. Celular (pelo Google ou pelo WhatsApp do site) pesa mais: é o
 * contato direto. Depois reputação (nota e quantidade de avaliações), site e e-mail.
 */
export function pontuar(l: { celular: string | null; whatsapp_site: string | null; nota: number | null; avaliacoes: number; site: string | null; email: string | null }): { pontos: number; motivos: string[] } {
  let pontos = 0;
  const motivos: string[] = [];
  if (l.whatsapp_site) {
    pontos += 35;
    motivos.push('WhatsApp no site');
  } else if (l.celular) {
    pontos += 30;
    motivos.push('Celular');
  }
  const nota = l.nota ?? 0;
  if (nota >= 4.5) {
    pontos += 20;
    motivos.push(`Nota ${nota.toFixed(1)}`);
  } else if (nota >= 4) {
    pontos += 12;
    motivos.push(`Nota ${nota.toFixed(1)}`);
  } else if (nota >= 3.5) pontos += 5;
  if (l.avaliacoes >= 100) {
    pontos += 20;
    motivos.push(`${l.avaliacoes} avaliações`);
  } else if (l.avaliacoes >= 30) {
    pontos += 12;
    motivos.push(`${l.avaliacoes} avaliações`);
  } else if (l.avaliacoes >= 10) pontos += 6;
  if (l.site) {
    pontos += 15;
    motivos.push('Site');
  }
  if (l.email) {
    pontos += 10;
    motivos.push('E-mail');
  }
  return { pontos: Math.min(100, pontos), motivos };
}

export interface EnderecoGoogle {
  cep: string | null;
  logradouro: string | null;
  numero: string | null;
  bairro: string | null;
  cidade: string | null;
  uf: string | null;
}

/** addressComponents da Places API → colunas de pessoas_enderecos */
export function enderecoDoGoogle(componentes: any[] | undefined): EnderecoGoogle {
  const de = (tipo: string, curto = false) => {
    const c = (componentes || []).find((x: any) => Array.isArray(x?.types) && x.types.includes(tipo));
    const v = String((curto ? c?.shortText : c?.longText) ?? '').trim();
    return v || null;
  };
  const cep = (de('postal_code') || '').replace(/\D/g, '');
  const uf = (de('administrative_area_level_1', true) || '').toUpperCase();
  return {
    cep: cep.length === 8 ? cep : null,
    logradouro: de('route')?.slice(0, 255) ?? null,
    numero: de('street_number')?.slice(0, 20) ?? null,
    bairro: (de('sublocality_level_1') || de('sublocality'))?.slice(0, 100) ?? null,
    cidade: (de('administrative_area_level_2') || de('locality'))?.slice(0, 100) ?? null,
    uf: /^[A-Z]{2}$/.test(uf) ? uf : null,
  };
}

/** Endereço IP de rede interna (loopback, privada, link-local, CGNAT...): o servidor não acessa */
export function ipInterno(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || a >= 224;
  }
  const v = ip.toLowerCase();
  if (v.startsWith('::ffff:')) return ipInterno(v.slice(7));
  return v === '::' || v === '::1' || v.startsWith('fc') || v.startsWith('fd') || v.startsWith('fe80');
}

// ==========================================================
// Google e sites
// ==========================================================

/** Busca de texto na Places API (New), até `maximo` empresas (páginas de 20) */
async function buscarNoGoogle(chave: string, consulta: string, maximo: number): Promise<any[]> {
  const lugares: any[] = [];
  let pageToken: string | undefined;
  do {
    const r = await fetch(URL_BUSCA, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': chave, 'X-Goog-FieldMask': CAMPOS_GOOGLE },
      body: JSON.stringify({ textQuery: consulta, languageCode: 'pt-BR', regionCode: 'BR', pageSize: 20, ...(pageToken ? { pageToken } : {}) }),
      signal: AbortSignal.timeout(TIMEOUT_GOOGLE_MS),
    }).catch((e) => {
      throw erro(502, `Google Places não respondeu: ${e.message}`);
    });
    const dados: any = await r.json().catch(() => ({}));
    if (!r.ok) {
      const msg = dados?.error?.message || `HTTP ${r.status}`;
      throw erro(r.status === 400 || r.status === 403 ? 400 : 502, `Google Places: ${msg}`);
    }
    lugares.push(...(dados.places || []));
    pageToken = dados.nextPageToken;
  } while (pageToken && lugares.length < maximo);
  return lugares.slice(0, maximo);
}

/** Lê a página inicial do site (só http/https em endereço público, com tempo e tamanho limitados) */
async function lerSite(endereco: string): Promise<string | null> {
  let url: URL;
  try {
    url = new URL(endereco);
  } catch {
    return null;
  }
  for (let saltos = 0; saltos < 3; saltos++) {
    if (!/^https?:$/.test(url.protocol) || url.username || url.password) return null;
    if (url.port && !['80', '443'].includes(url.port)) return null;
    const ips = await dns.lookup(url.hostname, { all: true }).catch(() => []);
    if (!ips.length || ips.some((i) => ipInterno(i.address))) return null;
    const r = await fetch(url, {
      redirect: 'manual',
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; crmweb-prospeccao)', Accept: 'text/html' },
      signal: AbortSignal.timeout(TIMEOUT_SITE_MS),
    }).catch(() => null);
    if (!r) return null;
    if (r.status >= 300 && r.status < 400 && r.headers.get('location')) {
      url = new URL(r.headers.get('location')!, url);
      continue;
    }
    if (!r.ok || !/html/i.test(r.headers.get('content-type') || 'text/html') || !r.body) return null;
    // Lê até MAX_HTML e corta (site pesado não segura a busca)
    const leitor = r.body.getReader();
    const partes: Uint8Array[] = [];
    let total = 0;
    while (total < MAX_HTML) {
      const { done, value } = await leitor.read().catch(() => ({ done: true, value: undefined }));
      if (done || !value) break;
      partes.push(value);
      total += value.length;
    }
    leitor.cancel().catch(() => {});
    return Buffer.concat(partes).toString('utf8');
  }
  return null;
}

/** Roda `fn` em `itens` com no máximo `limite` ao mesmo tempo */
async function emParalelo<T, R>(itens: T[], limite: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const saida: R[] = new Array(itens.length);
  let proximo = 0;
  await Promise.all(
    Array.from({ length: Math.min(limite, itens.length) }, async () => {
      while (proximo < itens.length) {
        const i = proximo++;
        saida[i] = await fn(itens[i]);
      }
    }),
  );
  return saida;
}

// ==========================================================
// Busca
// ==========================================================
export interface Lead {
  place_id: string;
  nome: string;
  categoria: string | null;
  endereco: string | null;
  endereco_partes: EnderecoGoogle;
  telefone: string | null;
  celular: string | null;
  whatsapp_site: string | null;
  email: string | null;
  instagram: string | null;
  site: string | null;
  maps: string | null;
  nota: number | null;
  avaliacoes: number;
  pontos: number;
  motivos: string[];
  /** Id da pessoa quando já está no CRM */
  pessoa_id: number | null;
  /** Id do lead quando já está nos Leads (ainda não virou cliente) */
  lead_id?: number | null;
  /** Está no CRM porque foi incluída pela Prospecção (achada pelo google_place_id, não só pelo telefone) */
  pela_prospeccao?: boolean;
}

function numero(v: unknown, padrao: number, min: number, max: number) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : padrao;
}

type Resultado = { leads: Lead[]; encontrados: number; descartados: number };

/** Quem não está no CRM primeiro, e entre eles a maior nota de qualificação */
const noCrm = (l: Lead) => Number(Boolean(l.pessoa_id || l.lead_id));
const ordenar = (leads: Lead[]) => leads.sort((a, b) => noCrm(a) - noCrm(b) || b.pontos - a.pontos);

async function buscar(empresaId: string, usuarioId: number | null, corpo: any): Promise<Resultado & { busca_id: number | null }> {
  const termo = String(corpo?.termo ?? '').trim().slice(0, 150);
  const local = String(corpo?.local ?? '').trim().slice(0, 150);
  if (termo.length < 2) throw erro(400, 'Informe o que procurar (ex.: clínica odontológica).');
  if (local.length < 2) throw erro(400, 'Informe a cidade ou região.');
  const maximo = numero(corpo?.maximo, 20, 1, MAX_RESULTADOS);
  const criterios: Criterios = {
    nota_min: numero(corpo?.nota_min, 0, 0, 5),
    avaliacoes_min: numero(corpo?.avaliacoes_min, 0, 0, 100_000),
    exigir_site: Boolean(corpo?.exigir_site),
    somente_celular: corpo?.somente_celular !== false,
  };
  const lerSites = Boolean(corpo?.ler_sites);

  const lugares = await buscarNoGoogle(await chaveApi(empresaId), `${termo} em ${local}`, maximo);

  // Fechadas de vez ou temporariamente e quem não passa nos critérios do Google saem antes de ler sites
  const candidatos = lugares.filter(
    (p) =>
      (!p.businessStatus || p.businessStatus === 'OPERATIONAL') &&
      (p.rating ?? 0) >= criterios.nota_min &&
      (p.userRatingCount ?? 0) >= criterios.avaliacoes_min &&
      (!criterios.exigir_site || p.websiteUri),
  );
  const sites = lerSites
    ? await emParalelo(candidatos, 8, async (p) => (p.websiteUri ? extrairContatos((await lerSite(p.websiteUri).catch(() => null)) || '') : null))
    : candidatos.map(() => null);

  let leads: Lead[] = candidatos.map((p, i) => {
    const telefone = p.internationalPhoneNumber || p.nationalPhoneNumber || null;
    const s = sites[i];
    const base = {
      celular: celularBR(telefone),
      whatsapp_site: s?.whatsapp ?? null,
      nota: typeof p.rating === 'number' ? p.rating : null,
      avaliacoes: Number(p.userRatingCount) || 0,
      site: p.websiteUri || null,
      email: s?.email ?? null,
    };
    return {
      place_id: String(p.id),
      nome: String(p.displayName?.text || 'Sem nome').slice(0, 255),
      categoria: p.primaryTypeDisplayName?.text || null,
      endereco: p.formattedAddress || null,
      endereco_partes: enderecoDoGoogle(p.addressComponents),
      telefone: formatarTelefone(telefone),
      instagram: s?.instagram ?? null,
      maps: p.googleMapsUri || null,
      pessoa_id: null,
      ...base,
      ...pontuar(base),
    };
  });
  if (criterios.somente_celular) leads = leads.filter((l) => l.celular || l.whatsapp_site);

  // Guarda a busca (sem o "já no CRM", recalculado ao reabrir); se a gravação falhar, a busca paga não se perde
  let buscaId: number | null = null;
  try {
    const [g] = await pool.query<any>(
      'INSERT INTO prospeccao_buscas (empresa_id, usuario_id, termo, local, filtros, encontrados, descartados, leads) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [empresaId, usuarioId, termo, local, JSON.stringify({ maximo, ...criterios, ler_sites: lerSites }), lugares.length, lugares.length - leads.length,
        JSON.stringify(leads.map(({ pessoa_id, lead_id, pela_prospeccao, ...l }) => l))],
    );
    buscaId = g.insertId;
  } catch (err: any) {
    console.error('Prospecção: não gravou a busca:', err.message);
  }

  await marcarQuemJaExiste(empresaId, leads);
  ordenar(leads);
  return { leads, encontrados: lugares.length, descartados: lugares.length - leads.length, busca_id: buscaId };
}

/** Buscas guardadas, da mais recente para a mais antiga */
async function listarBuscas(empresaId: string) {
  const [r] = await pool.query<any[]>(
    `SELECT b.id, b.termo, b.local, b.encontrados, JSON_LENGTH(b.leads) AS qtd, DATE_FORMAT(b.criado_em, '%d/%m/%Y %H:%i') AS quando, u.nome AS usuario
       FROM prospeccao_buscas b LEFT JOIN usuarios u ON u.id = b.usuario_id
      WHERE b.empresa_id = ? ORDER BY b.id DESC LIMIT 100`,
    [empresaId],
  );
  return r.map((b) => ({ ...b, qtd: Number(b.qtd) || 0 }));
}

/** Reabre uma busca guardada, conferindo de novo quem já foi incluído no CRM */
async function abrirBusca(empresaId: string, id: string): Promise<Resultado & { termo: string; local: string; filtros: Record<string, unknown> }> {
  const [r] = await pool.query<any[]>('SELECT termo, local, filtros, encontrados, descartados, leads FROM prospeccao_buscas WHERE id = ? AND empresa_id = ?', [id, empresaId]);
  if (!r[0]) throw erro(404, 'Busca não encontrada.');
  const b = r[0];
  const leads: Lead[] = (JSON.parse(b.leads || '[]') as Lead[]).map((l) => ({ ...l, pessoa_id: null, lead_id: null }));
  await marcarQuemJaExiste(empresaId, leads);
  ordenar(leads);
  return { leads, encontrados: Number(b.encontrados), descartados: Number(b.descartados), termo: b.termo, local: b.local, filtros: JSON.parse(b.filtros || '{}') };
}

/** Quem já está no CRM (em Pessoas ou nos Leads ainda não convertidos): pelo código do Google ou por algum dos telefones */
async function marcarQuemJaExiste(empresaId: string, leads: Lead[]) {
  if (!leads.length) return;
  const chaves = (l: Lead) => [l.whatsapp_site, l.celular, l.telefone].map((t) => chaveTelefone(t)).filter((c): c is string => Boolean(c));
  const todas = [...new Set(leads.flatMap(chaves))];
  const achar = async (tabela: 'pessoas' | 'leads') => {
    const extra = tabela === 'leads' ? ' AND convertido_em IS NULL' : '';
    const [porPlace] = await pool.query<any[]>(`SELECT id, google_place_id FROM ${tabela} WHERE empresa_id = ?${extra} AND google_place_id IN (?)`, [
      empresaId,
      leads.map((l) => l.place_id),
    ]);
    const place = new Map(porPlace.map((r) => [String(r.google_place_id), Number(r.id)]));
    const fone = new Map<string, number>();
    if (todas.length) {
      // Mesma chave do WhatsApp (DDD + 8 últimos dígitos), comparada no banco só pelos 8 últimos
      const [rows] = await pool.query<any[]>(
        `SELECT id, telefone, whatsapp FROM ${tabela}
          WHERE empresa_id = ?${extra} AND (RIGHT(REGEXP_REPLACE(COALESCE(whatsapp, ''), '[^0-9]', ''), 8) IN (?)
                                 OR RIGHT(REGEXP_REPLACE(COALESCE(telefone, ''), '[^0-9]', ''), 8) IN (?))`,
        [empresaId, todas.map((c) => c.slice(-8)), todas.map((c) => c.slice(-8))],
      );
      for (const r of rows) {
        for (const t of [r.whatsapp, r.telefone]) {
          const c = chaveTelefone(t);
          if (c && !fone.has(c)) fone.set(c, Number(r.id));
        }
      }
    }
    return (l: Lead) => ({ id: place.get(l.place_id) ?? chaves(l).map((c) => fone.get(c)).find(Boolean) ?? null, pelaProspeccao: place.has(l.place_id) });
  };
  const [pessoa, lead] = await Promise.all([achar('pessoas'), achar('leads')]);
  for (const l of leads) {
    // Já é cliente vale mais que estar nos Leads
    const p = pessoa(l);
    const ld = p.id ? { id: null, pelaProspeccao: false } : lead(l);
    l.pessoa_id = p.id;
    l.lead_id = ld.id;
    l.pela_prospeccao = p.id ? p.pelaProspeccao : ld.pelaProspeccao;
  }
}

// ==========================================================
// Inclusão nos Leads (viram pessoa só ao converter: server/leads.ts)
// ==========================================================
const txt = (v: unknown, max: number) => {
  const s = String(v ?? '').trim();
  return s ? s.slice(0, max) : null;
};

async function incluir(empresaId: string, corpo: any): Promise<{ incluidos: number; existentes: number }> {
  const lista: any[] = Array.isArray(corpo?.leads) ? corpo.leads : [];
  if (!lista.length) throw erro(400, 'Escolha ao menos uma empresa.');
  if (lista.length > MAX_INCLUIR) throw erro(400, `Inclua no máximo ${MAX_INCLUIR} de cada vez.`);
  const segmentoId = Number(corpo?.segmento_id) || null;
  if (!segmentoId) throw erro(400, 'Escolha o segmento dos leads.');
  const [s] = await pool.query<any[]>('SELECT id FROM segmentos WHERE id = ? AND empresa_id = ?', [segmentoId, empresaId]);
  if (!s.length) throw erro(400, 'Segmento não encontrado.');
  // Busca de onde o lead veio (Pessoas filtra por ela); de outra empresa ou apagada, fica sem
  let buscaId = Number(corpo?.busca_id) || null;
  if (buscaId) {
    const [b] = await pool.query<any[]>('SELECT id FROM prospeccao_buscas WHERE id = ? AND empresa_id = ?', [buscaId, empresaId]);
    if (!b.length) buscaId = null;
  }

  // Os dados vêm da tela (resultado da busca): tudo passa de novo pelas mesmas regras
  const leads: Lead[] = lista.map((l) => {
    const placeId = txt(l?.place_id, 95);
    const nome = txt(l?.nome, 255);
    if (!placeId || !/^[\w-]+$/.test(placeId) || !nome) throw erro(400, 'Empresa da busca inválida: busque de novo.');
    const e = l?.endereco_partes || {};
    const email = txt(l?.email, 255);
    return {
      place_id: placeId,
      nome,
      categoria: txt(l?.categoria, 100),
      endereco: txt(l?.endereco, 300),
      endereco_partes: {
        cep: /^\d{8}$/.test(String(e.cep ?? '')) ? String(e.cep) : null,
        logradouro: txt(e.logradouro, 255),
        numero: txt(e.numero, 20),
        bairro: txt(e.bairro, 100),
        cidade: txt(e.cidade, 100),
        uf: /^[A-Z]{2}$/.test(String(e.uf ?? '')) ? String(e.uf) : null,
      },
      telefone: txt(l?.telefone, 50),
      celular: celularBR(l?.celular),
      whatsapp_site: celularBR(l?.whatsapp_site),
      email: email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null,
      instagram: txt(l?.instagram, 200),
      site: txt(l?.site, 300),
      maps: txt(l?.maps, 300),
      nota: Number.isFinite(Number(l?.nota)) && l?.nota !== null ? Number(l.nota) : null,
      avaliacoes: Number(l?.avaliacoes) || 0,
      pontos: Math.min(100, Math.max(0, Number(l?.pontos) || 0)),
      motivos: [],
      pessoa_id: null,
      lead_id: null,
    };
  });
  await marcarQuemJaExiste(empresaId, leads);

  const conn = await pool.getConnection();
  let incluidos = 0;
  try {
    await conn.beginTransaction();
    for (const l of leads) {
      if (l.pessoa_id || l.lead_id) continue;
      const obs = [
        `Prospecção (Google Maps) em ${new Date().toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' })} — nota de qualificação ${l.pontos}/100`,
        l.categoria && `Categoria: ${l.categoria}`,
        l.nota !== null && `Avaliação no Google: ${l.nota.toFixed(1)} (${l.avaliacoes} avaliações)`,
        l.endereco && `Endereço: ${l.endereco}`,
        l.site && `Site: ${l.site}`,
        l.instagram && `Instagram: ${l.instagram}`,
        l.maps && `Google Maps: ${l.maps}`,
      ]
        .filter(Boolean)
        .join('\n');
      const whatsapp = l.whatsapp_site || l.celular;
      // O endereço completo fica na observação; o lead guarda só cidade e UF
      await conn.query(
        `INSERT INTO leads (empresa_id, origem, google_place_id, prospeccao_busca_id, nome, email, telefone, whatsapp, cidade, uf, obs, segmento_id)
         VALUES (?, 'prospeccao', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [empresaId, l.place_id, buscaId, l.nome, l.email, l.telefone, whatsapp ? whatsapp.slice(2) : null, l.endereco_partes.cidade, l.endereco_partes.uf, obs, segmentoId],
      );
      incluidos++;
    }
    await conn.commit();
  } catch (err) {
    await conn.rollback().catch(() => {});
    throw err;
  } finally {
    conn.release();
  }
  return { incluidos, existentes: leads.length - incluidos };
}

export function createProspeccaoRouter(): Router {
  const router = Router();

  router.post('/prospeccao/buscar', async (req: Request, res: Response) => {
    try {
      exigirAcesso(res, 'prospeccao', 'a Prospecção');
      res.json(await buscar(String(res.locals.empresaId), Number(res.locals.usuarioId) || null, req.body));
    } catch (err: any) {
      res.status(err.status || 500).json({ error: err.message });
    }
  });

  router.get('/prospeccao/buscas', async (_req: Request, res: Response) => {
    try {
      exigirAcesso(res, 'prospeccao', 'a Prospecção');
      res.json(await listarBuscas(String(res.locals.empresaId)));
    } catch (err: any) {
      res.status(err.status || 500).json({ error: err.message });
    }
  });

  router.get('/prospeccao/buscas/:id', async (req: Request, res: Response) => {
    try {
      exigirAcesso(res, 'prospeccao', 'a Prospecção');
      res.json(await abrirBusca(String(res.locals.empresaId), req.params.id));
    } catch (err: any) {
      res.status(err.status || 500).json({ error: err.message });
    }
  });

  router.post('/prospeccao/incluir', async (req: Request, res: Response) => {
    try {
      exigirAcesso(res, 'prospeccao', 'a Prospecção');
      res.json({ success: true, ...(await incluir(String(res.locals.empresaId), req.body)) });
    } catch (err: any) {
      res.status(err.status || 500).json({ error: err.message });
    }
  });

  return router;
}
