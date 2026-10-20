import { FieldDef } from '../types.js';

export function formatCNPJ(cnpj: string): string {
  const digits = String(cnpj || '').replace(/\D/g, '');
  if (digits.length !== 14) return cnpj || '';
  return digits.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');
}

export function cleanCNPJ(cnpj: string): string {
  return String(cnpj || '').replace(/\D/g, '');
}

/** Aplica a máscara de CNPJ conforme o operador digita */
export function maskCNPJ(value: string): string {
  const raw = String(value || '').replace(/\D/g, '').slice(0, 14);
  if (raw.length > 12) {
    return `${raw.slice(0, 2)}.${raw.slice(2, 5)}.${raw.slice(5, 8)}/${raw.slice(8, 12)}-${raw.slice(12)}`;
  }
  if (raw.length > 8) return `${raw.slice(0, 2)}.${raw.slice(2, 5)}.${raw.slice(5, 8)}/${raw.slice(8)}`;
  if (raw.length > 5) return `${raw.slice(0, 2)}.${raw.slice(2, 5)}.${raw.slice(5)}`;
  if (raw.length > 2) return `${raw.slice(0, 2)}.${raw.slice(2)}`;
  return raw;
}

export function formatCurrencyBRL(value: number): string {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    minimumFractionDigits: 2,
  }).format(Number(value) || 0);
}

export function formatNumberBR(value: number): string {
  return new Intl.NumberFormat('pt-BR').format(Number(value) || 0);
}

export function formatDateBR(dateStr: string): string {
  if (!dateStr) return '—';
  const parts = String(dateStr).split('T')[0].split(' ')[0].split('-');
  if (parts.length === 3) return `${parts[2]}/${parts[1]}/${parts[0]}`;
  return dateStr;
}

export function formatDateTimeBR(dateStr: string): string {
  if (!dateStr) return '—';
  const normalized = String(dateStr).replace(' ', 'T');
  const date = new Date(normalized);
  if (isNaN(date.getTime())) return String(dateStr);
  return date.toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** "AAAA-MM-DD HH:MM:SS" do banco → "14:21" se for hoje, senão "08/10 14:21" (hora em que o cliente chegou) */
export function horaChegada(dateStr: string | null | undefined): string {
  if (!dateStr) return '';
  const [data, hora = ''] = String(dateStr).replace('T', ' ').split(' ');
  const [a, m, d] = data.split('-');
  const hoje = new Date();
  const ehHoje = Number(a) === hoje.getFullYear() && Number(m) === hoje.getMonth() + 1 && Number(d) === hoje.getDate();
  return `${ehHoje ? '' : `${d}/${m} `}${hora.slice(0, 5)}`;
}

/** Converte o valor do MySQL para o formato aceito por <input type="date" | "datetime-local"> */
export function toInputDate(value: any): string {
  if (!value) return '';
  return String(value).replace(' ', 'T').slice(0, 10);
}

export function toInputDateTime(value: any): string {
  if (!value) return '';
  return String(value).replace(' ', 'T').slice(0, 16);
}

/** Renderização de uma célula da grade conforme o tipo do campo */
export function formatCellValue(field: FieldDef, value: any): string {
  if (value === null || value === undefined || value === '') return '—';

  switch (field.type) {
    case 'cnpj':
      return formatCNPJ(String(value));
    case 'boolean':
      return Number(value) === 1 ? 'Sim' : 'Não';
    case 'date':
      return formatDateBR(String(value));
    case 'datetime':
      return formatDateTimeBR(String(value));
    case 'decimal': {
      const n = Number(value);
      if (!Number.isFinite(n)) return String(value);
      return new Intl.NumberFormat('pt-BR', {
        minimumFractionDigits: field.scale ?? 2,
        maximumFractionDigits: field.scale ?? 2,
      }).format(n);
    }
    case 'number':
      return formatNumberBR(Number(value));
    case 'enum': {
      const opt = field.options?.find((o) => o.value === String(value));
      return opt ? opt.label : String(value);
    }
    case 'password':
      return '••••••••';
    case 'time':
      return String(value).slice(0, 5);
    default: {
      const text = String(value);
      return text.length > 80 ? `${text.slice(0, 80)}…` : text;
    }
  }
}

/** Cores de destaque por status, reaproveitadas em grades, cards e painéis */
const VERDE = 'bg-emerald-50 text-emerald-800 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-200 dark:border-emerald-800';
const AMBAR = 'bg-amber-50 text-amber-800 border-amber-200 dark:bg-amber-950/40 dark:text-amber-200 dark:border-amber-800';
const AZUL = 'bg-blue-50 text-blue-800 border-blue-200 dark:bg-blue-950/40 dark:text-blue-200 dark:border-blue-800';
const ROXO = 'bg-purple-50 text-purple-800 border-purple-200 dark:bg-purple-950/40 dark:text-purple-200 dark:border-purple-800';
const ROSA = 'bg-rose-50 text-rose-800 border-rose-200 dark:bg-rose-950/40 dark:text-rose-200 dark:border-rose-800';
const CINZA = 'bg-stone-100 text-stone-700 border-stone-300 dark:bg-stone-800 dark:text-stone-300 dark:border-stone-700';

export const STATUS_COLORS: Record<string, string> = {
  // Negócios
  aberto: AZUL,
  ganho: VERDE,
  perdido: ROSA,
  excluido: CINZA,
  // Propostas
  rascunho: CINZA,
  enviada: AZUL,
  aceita: VERDE,
  recusada: ROSA,
  expirada: AMBAR,
  fechada: CINZA,
  // Pedidos
  aguardando_aprovacao: AMBAR,
  aprovado: VERDE,
  faturado: ROXO,
  cancelado: ROSA,
  // Contratos
  aguardando_assinatura: AMBAR,
  ativo: VERDE,
  suspenso: AMBAR,
  encerrado: CINZA,
  assinado: VERDE,
  em_assinatura: AMBAR,
  nao_assinado: CINZA,
  // Campanhas, mensagens e disparos
  agendada: AZUL,
  em_execucao: VERDE,
  pausada: AMBAR,
  concluida: ROXO,
  cancelada: ROSA,
  aprovada: VERDE,
  falhou: ROSA,
  pendente: AMBAR,
  enviado: AZUL,
  entregue: VERDE,
  lido: ROXO,
  // Origem das atividades
  google: ROXO,
};

export const STATUS_LABELS: Record<string, string> = {
  aberto: 'Aberto',
  ganho: 'Ganho',
  perdido: 'Perdido',
  excluido: 'Excluído',
  rascunho: 'Rascunho',
  enviada: 'Enviada',
  aceita: 'Aceita',
  recusada: 'Recusada',
  expirada: 'Expirada',
  fechada: 'Fechada',
  aguardando_aprovacao: 'Aguardando Aprovação',
  aprovado: 'Aprovado',
  faturado: 'Faturado',
  cancelado: 'Cancelado',
};

export const GROUP_LABELS: Record<string, string> = {
  vendas: 'Vendas',
  marketing: 'Marketing',
  cadastros: 'Cadastros',
  acesso: 'Acesso',
  suporte: 'Suporte',
};

/** Valor em reais (ou na moeda do negócio) */
export function formatMoeda(valor: number | string | null | undefined, moeda = 'BRL'): string {
  try {
    return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: moeda || 'BRL' }).format(Number(valor) || 0);
  } catch {
    return formatCurrencyBRL(Number(valor) || 0);
  }
}

/** Data de hoje no fuso local (Brasília), em ISO "aaaa-mm-dd" — nunca toISOString() */
export function hojeIso(): string {
  const h = new Date();
  return `${h.getFullYear()}-${String(h.getMonth() + 1).padStart(2, '0')}-${String(h.getDate()).padStart(2, '0')}`;
}

/** Data de ontem no fuso local (Brasília), em ISO "aaaa-mm-dd" */
export function ontemIso(): string {
  const o = new Date();
  o.setDate(o.getDate() - 1);
  return `${o.getFullYear()}-${String(o.getMonth() + 1).padStart(2, '0')}-${String(o.getDate()).padStart(2, '0')}`;
}

/** Dia útil anterior a hoje, em ISO "aaaa-mm-dd": ontem, ou a sexta-feira quando hoje é segunda */
export function diaUtilAnteriorIso(): string {
  const o = new Date();
  o.setDate(o.getDate() - (o.getDay() === 1 ? 3 : 1));
  return `${o.getFullYear()}-${String(o.getMonth() + 1).padStart(2, '0')}-${String(o.getDate()).padStart(2, '0')}`;
}

/**
 * Referência da proposta para as pessoas: o controle (ex.: 2026/001-01); sem controle, "nº 1 v1".
 * O número interno (numero_proposta) fica só para o sistema.
 */
export function refProposta(p: { controle?: unknown; numero_proposta?: unknown; versao?: unknown }): string {
  const c = String(p.controle ?? '').trim();
  return c || `nº ${p.numero_proposta ?? '…'} v${p.versao ?? 1}`;
}

/** Referência da proposta usável em nome de arquivo (sem barras) */
export const refPropostaArquivo = (p: { controle?: unknown; numero_proposta?: unknown; versao?: unknown }) =>
  refProposta(p).replace(/^nº /, '').replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, '-');

/** DDDs que existem no Brasil (Anatel) */
const DDDS = new Set([
  11, 12, 13, 14, 15, 16, 17, 18, 19, 21, 22, 24, 27, 28, 31, 32, 33, 34, 35, 37, 38, 41, 42, 43, 44, 45, 46, 47, 48, 49, 51, 53, 54, 55,
  61, 62, 63, 64, 65, 66, 67, 68, 69, 71, 73, 74, 75, 77, 79, 81, 82, 83, 84, 85, 86, 87, 88, 89, 91, 92, 93, 94, 95, 96, 97, 98, 99,
]);

/**
 * Celular brasileiro (WhatsApp) digitado pelo cliente, só os dígitos: DDD que existe + 9 + 8 dígitos (com ou sem 55 na
 * frente), e os 8 dígitos não todos iguais (11999999999). Devolve o motivo da recusa, ou null se está certo
 */
export function erroCelular(digitos: string): string | null {
  const m = /^(?:55)?(\d{2})9(\d{8})$/.exec(digitos);
  if (!m) return 'Informe o seu celular (WhatsApp) com DDD, ex.: 11999999999.';
  if (!DDDS.has(Number(m[1]))) return `O DDD ${m[1]} não existe: confira o celular.`;
  if (/^(\d)\1{7}$/.test(m[2])) return 'Informe um celular de verdade (o número não pode ter todos os dígitos iguais).';
  return null;
}
