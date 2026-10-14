import React, { useEffect, useState } from 'react';
import { SelectAuto } from './SelectAuto';
import { Plus, Trash2 } from 'lucide-react';
import { OpcaoRef } from '../types';
import { INPUT_CLASS } from '../utils/formStyles';
import { fetchOptions, fetchRegrasCriterio, RegraCriterio } from '../services/api';
import { NumberField } from './NumberField';
import { SelectBusca } from './SelectBusca';
import { Toggle } from './Toggle';
import { ConfirmDialog } from './ConfirmDialog';

interface Criterio {
  regra: string;
  operador: string;
  valor: string | number;
}

interface Props {
  id?: string;
  /** Lista de critérios (ou o JSON dela, como vem do banco); '' numa campanha nova */
  value: unknown;
  onChange: (lista: Criterio[]) => void;
}

const OPERADORES_NUMERO = [
  { value: '=', label: 'igual a' },
  { value: '<>', label: 'diferente de' },
  { value: '>', label: 'maior que' },
  { value: '>=', label: 'maior ou igual a' },
  { value: '<', label: 'menor que' },
  { value: '<=', label: 'menor ou igual a' },
];
const OPERADORES_IGUALDADE = OPERADORES_NUMERO.slice(0, 2);
const OPERADORES_TEXTO = [...OPERADORES_IGUALDADE, { value: 'contem', label: 'que contém' }, { value: 'comeca', label: 'começa com' }];

const TIPOS_PESSOA = [
  { value: 'lead', label: 'Lead' },
  { value: 'cliente', label: 'Cliente' },
];

function lerLista(value: unknown): Criterio[] {
  let v = value;
  if (typeof v === 'string') {
    try {
      v = v ? JSON.parse(v) : [];
    } catch {
      v = [];
    }
  }
  if (v && !Array.isArray(v) && typeof v === 'object') v = [v];
  return Array.isArray(v) ? (v as Criterio[]) : [];
}

const valorInicial = (r?: RegraCriterio): string | number =>
  r?.valor === 'sim_nao' ? 1 : r?.valor === 'numero' ? 0 : r?.valor === 'tipo_pessoa' ? 'cliente' : '';

/** Editor dos critérios do público da campanha: regra, operador e valor por linha (todas precisam valer) */
export const CriteriosSegmento: React.FC<Props> = ({ id, value, onChange }) => {
  const lista = lerLista(value);
  const [regras, setRegras] = useState<RegraCriterio[]>([]);
  const [segmentos, setSegmentos] = useState<OpcaoRef[]>([]);
  const [erro, setErro] = useState<string | null>(null);
  const [removendo, setRemovendo] = useState<number | null>(null);

  useEffect(() => {
    fetchRegrasCriterio().then(setRegras).catch((e) => setErro(e.message));
    fetchOptions('segmentos', 'nome').then(setSegmentos).catch(() => {});
  }, []);

  const regraDe = (nome: string) => regras.find((r) => r.regra === nome);
  const alterar = (i: number, mudanca: Partial<Criterio>) => onChange(lista.map((c, j) => (j === i ? { ...c, ...mudanca } : c)));
  const adicionar = () => {
    const r = regras[0];
    if (r) onChange([...lista, { regra: r.regra, operador: '=', valor: valorInicial(r) }]);
  };

  const campoValor = (c: Criterio, i: number) => {
    const tipo = regraDe(c.regra)?.valor;
    const cls = `${INPUT_CLASS} w-full`;
    if (tipo === 'numero') return <NumberField value={c.valor} onChange={(v) => alterar(i, { valor: v })} scale={0} required className={cls} />;
    if (tipo === 'sim_nao') return <Toggle checked={Boolean(Number(c.valor))} onChange={(v) => alterar(i, { valor: v ? 1 : 0 })} />;
    if (tipo === 'tipo_pessoa')
      return (
        <SelectAuto value={String(c.valor)} onChange={(e) => alterar(i, { valor: e.target.value })} required className={`${cls} cursor-pointer`}>
          {TIPOS_PESSOA.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </SelectAuto>
      );
    if (tipo === 'segmento')
      return <SelectBusca value={c.valor} options={segmentos} onChange={(v) => alterar(i, { valor: v })} required vazioLabel="— Selecione —" className={cls} />;
    return <input type="text" value={String(c.valor ?? '')} onChange={(e) => alterar(i, { valor: e.target.value })} required className={cls} />;
  };

  return (
    <div id={id} className="flex flex-col gap-2">
      {erro && <span className="text-xs text-rose-600">{erro}</span>}
      {lista.map((c, i) => {
        const r = regraDe(c.regra);
        const operadores = r?.valor === 'numero' ? OPERADORES_NUMERO : r?.valor === 'texto' ? OPERADORES_TEXTO : OPERADORES_IGUALDADE;
        return (
          <div key={i} className="grid grid-cols-1 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1.5fr)_auto] gap-2 items-center">
            <SelectAuto
              value={c.regra}
              onChange={(e) => {
                const nova = regraDe(e.target.value);
                alterar(i, { regra: e.target.value, operador: '=', valor: valorInicial(nova) });
              }}
              className={`${INPUT_CLASS} w-full cursor-pointer`}
            >
              {!r && <option value={c.regra}>{c.regra}</option>}
              {regras.map((o) => (
                <option key={o.regra} value={o.regra}>
                  {o.rotulo}
                </option>
              ))}
            </SelectAuto>
            <SelectAuto value={c.operador} onChange={(e) => alterar(i, { operador: e.target.value })} className={`${INPUT_CLASS} w-full cursor-pointer`}>
              {operadores.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </SelectAuto>
            {campoValor(c, i)}
            <button
              type="button"
              onClick={() => setRemovendo(i)}
              title="Remover critério"
              className="h-full min-h-8 px-2 rounded text-stone-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40 cursor-pointer"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
        );
      })}
      <button
        type="button"
        onClick={adicionar}
        disabled={!regras.length}
        className="self-start flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-900 hover:bg-blue-50 dark:hover:bg-blue-950/40 cursor-pointer disabled:opacity-40"
      >
        <Plus className="w-3.5 h-3.5" />
        Adicionar critério
      </button>

      {removendo !== null && (
        <ConfirmDialog
          titulo="Remover o critério?"
          mensagem={`"${regraDe(lista[removendo]?.regra)?.rotulo ?? lista[removendo]?.regra}" sai do público ao salvar.`}
          confirmar="Remover"
          onConfirmar={() => {
            onChange(lista.filter((_, j) => j !== removendo));
            setRemovendo(null);
          }}
          onCancelar={() => setRemovendo(null)}
        />
      )}
    </div>
  );
};
