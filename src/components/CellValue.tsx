import React from 'react';
import { FieldDef, OpcaoRef, RegistroCrud } from '../types';
import { formatCellValue, STATUS_COLORS } from '../utils/formatters';
import { comPrefixo } from '../utils/crm';

interface CellValueProps {
  field: FieldDef;
  row: RegistroCrud;
  /** Opções já carregadas dos campos de chave estrangeira, por nome de campo */
  refOptions: Record<string, OpcaoRef[]>;
}

/**
 * Renderiza uma célula de grade conforme o tipo do campo: resolve o rótulo das
 * chaves estrangeiras e desenha selos para enumerações e booleanos.
 * Compartilhado pela listagem principal e pelas grades de detalhe.
 */
/** Colunas virtuais (campos personalizados) leem de dentro do JSON do registro */
function valorDoCampo(field: FieldDef, row: RegistroCrud) {
  if (!field.json) return row[field.name];
  const bruto = row[field.json.campo];
  if (!bruto) return undefined;
  try {
    const obj = typeof bruto === 'string' ? JSON.parse(bruto) : bruto;
    return obj?.[field.json.chave];
  } catch {
    return undefined;
  }
}

export const CellValue: React.FC<CellValueProps> = ({ field, row, refOptions }) => {
  const value = comPrefixo(field, row, valorDoCampo(field, row));

  if (field.ref) {
    if (value === null || value === undefined || value === '') {
      return <span className="text-stone-400">—</span>;
    }
    const opt = refOptions[field.name]?.find((o) => o.value === String(value));
    // Fora dos combos (cadastro grande): o nome que a lista já traz do servidor
    const rotulo = row[`${field.name}__rotulo`];
    return <span className="truncate">{opt ? opt.label : rotulo != null ? String(rotulo) : '…'}</span>;
  }

  if (field.type === 'enum' && value) {
    const badge = STATUS_COLORS[String(value)];
    const label = field.options?.find((o) => o.value === String(value))?.label || String(value);
    return (
      <span
        className={`inline-flex text-[10px] font-semibold px-2 py-0.5 rounded-full border whitespace-nowrap ${
          badge ||
          'bg-stone-100 text-stone-700 border-stone-300 dark:bg-stone-800 dark:text-stone-300 dark:border-stone-700'
        }`}
      >
        {label}
      </span>
    );
  }

  if (field.type === 'cor') {
    if (!value) return <span className="text-stone-400">—</span>;
    return <span className="inline-block w-4 h-4 rounded align-middle" style={{ background: String(value) }} title={String(value)} />;
  }

  if (field.type === 'boolean') {
    const on = value === true || Number(value) === 1;
    return (
      <span
        className={`inline-flex text-[10px] font-semibold px-2 py-0.5 rounded-full border ${
          on
            ? 'bg-emerald-50 text-emerald-800 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800'
            : 'bg-stone-100 text-stone-600 border-stone-300 dark:bg-stone-800 dark:text-stone-400 dark:border-stone-700'
        }`}
      >
        {on ? 'Sim' : 'Não'}
      </span>
    );
  }

  // Visitas do Site: quem ainda está no site (server/schema.ts, tempo_site)
  if (field.name === 'tempo_site' && value === 'Visitando...') {
    return (
      <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full border whitespace-nowrap bg-emerald-50 text-emerald-800 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800">
        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
        Visitando...
      </span>
    );
  }

  const isNumeric = field.type === 'decimal' || field.type === 'number' || field.type === 'cnpj';
  return <span className={isNumeric ? 'font-mono' : undefined}>{formatCellValue(field, value)}</span>;
};
