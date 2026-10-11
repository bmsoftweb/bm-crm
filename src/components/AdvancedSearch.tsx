import React, { useMemo, useState } from 'react';
import { SelectAuto } from './SelectAuto';
import { SelectBusca } from './SelectBusca';
import { SlidersHorizontal, X, Search, Eraser } from 'lucide-react';
import { FieldDef, FiltroAvancado, OpcaoRef, ResourceDef } from '../types';
import { INPUT_CLASS, LABEL_CLASS, FIELD_CLASS } from '../utils/formStyles';
import { DateField } from './DateField';
import { NumberField } from './NumberField';
import { Toggle } from './Toggle';

interface AdvancedSearchProps {
  resource: ResourceDef;
  /** Combos de chave estrangeira já carregados pela listagem */
  refOptions: Record<string, OpcaoRef[]>;
  /** Filtros atualmente aplicados, para reidratar o painel ao reabrir */
  aplicados: FiltroAvancado[];
  /** fechar: veio do botão Aplicar (o painel fecha); Limpar mantém aberto para montar outro filtro */
  onAplicar: (filtros: FiltroAvancado[], fechar: boolean) => void;
  onFechar: () => void;
  /** Campos exibidos no painel (escolhidos no formulário de edição) */
  camposVisiveis: string[];
  /** Campos personalizados (valor no JSON do registro): entram quando estão em camposVisiveis */
  camposExtras?: FieldDef[];
}

/** Sufixos usados nas chaves do formulário para os campos de faixa */
const MIN = '__min';
const MAX = '__max';

/** Campos numéricos e de data viram faixa "de / até" */
function isRange(f: FieldDef): boolean {
  return f.type === 'number' || f.type === 'decimal' || f.type === 'date' || f.type === 'datetime';
}

/** Campos de seleção: um combo com a opção "Todos" */
function isSelect(f: FieldDef): boolean {
  return f.type === 'enum' || f.type === 'boolean' || Boolean(f.ref);
}

/** Converte os filtros aplicados de volta para os valores do formulário */
function paraFormulario(filtros: FiltroAvancado[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const f of filtros) {
    if (f.op === 'gte') out[`${f.field}${MIN}`] = f.value;
    else if (f.op === 'lte') out[`${f.field}${MAX}`] = f.value;
    // Sim/Não de campo personalizado vai como true/false: o combo usa 1/0
    else if (f.value === 'true' || f.value === 'false') out[f.field] = f.value === 'true' ? '1' : '0';
    else out[f.field] = f.value;
  }
  return out;
}

export const AdvancedSearch: React.FC<AdvancedSearchProps> = ({
  resource,
  refOptions,
  aplicados,
  onAplicar,
  onFechar,
  camposVisiveis,
  camposExtras = [],
}) => {
  /** Com a coluna "ativo", o interruptor decide se os desativados entram (no lugar do combo do campo) */
  const temAtivo = resource.fields.some((f) => f.name === 'ativo' && f.type === 'boolean');
  const campos = useMemo(
    () => [...resource.fields, ...camposExtras].filter((f) => camposVisiveis.includes(f.name) && !(temAtivo && f.name === 'ativo')),
    [resource, camposExtras, camposVisiveis, temAtivo],
  );
  const [valores, setValores] = useState<Record<string, string>>(() => paraFormulario(aplicados));
  const [comDesativados, setComDesativados] = useState(() => !aplicados.some((f) => f.field === 'ativo' && f.value === '1'));

  const setValor = (chave: string, valor: string) => {
    setValores((prev) => ({ ...prev, [chave]: valor }));
  };

  /** Traduz o formulário para a lista de filtros enviada ao backend */
  const montarFiltros = (): FiltroAvancado[] => {
    const filtros: FiltroAvancado[] = [];

    for (const f of campos) {
      if (isRange(f)) {
        const min = (valores[`${f.name}${MIN}`] || '').trim();
        const max = (valores[`${f.name}${MAX}`] || '').trim();
        if (min) filtros.push({ field: f.name, op: 'gte', value: min });
        if (max) filtros.push({ field: f.name, op: 'lte', value: max });
        continue;
      }

      const v = (valores[f.name] || '').trim();
      if (!v) continue;

      // Sim/Não de campo personalizado é gravado no JSON como true/false
      const valor = f.json && f.type === 'boolean' ? (v === '1' ? 'true' : 'false') : v;
      // Texto busca por parte do conteúdo; seleções são igualdade exata
      filtros.push({ field: f.name, op: isSelect(f) ? 'eq' : 'contains', value: valor });
    }

    if (temAtivo && !comDesativados) filtros.push({ field: 'ativo', op: 'eq', value: '1' });
    return filtros;
  };

  const handleAplicar = (e: React.FormEvent) => {
    e.preventDefault();
    onAplicar(montarFiltros(), true);
  };

  // Limpar volta ao padrão da tela: só os ativos
  const handleLimpar = () => {
    setValores({});
    setComDesativados(false);
    onAplicar(temAtivo ? [{ field: 'ativo', op: 'eq', value: '1' }] : [], false);
  };

  const inputClass = `${INPUT_CLASS} w-full`;

  const renderCampo = (f: FieldDef) => {
    // Faixa: de / até
    if (isRange(f)) {
      const ehData = f.type === 'date' || f.type === 'datetime';

      if (ehData) {
        return (
          <div className="flex items-center gap-1.5">
            <DateField
              value={valores[`${f.name}${MIN}`] || ''}
              onChange={(v) => setValor(`${f.name}${MIN}`, v)}
              className={inputClass}
            />
            <span className="text-stone-400 text-[11px] shrink-0">até</span>
            <DateField
              value={valores[`${f.name}${MAX}`] || ''}
              onChange={(v) => setValor(`${f.name}${MAX}`, v)}
              className={inputClass}
            />
          </div>
        );
      }

      const escala = f.type === 'decimal' ? f.scale ?? 2 : 0;
      return (
        <div className="flex items-center gap-1.5">
          <NumberField
            value={valores[`${f.name}${MIN}`] || ''}
            onChange={(v) => setValor(`${f.name}${MIN}`, v)}
            scale={escala}
            allowNegative={f.allowNegative}
            placeholder="de"
            className={inputClass}
          />
          <span className="text-stone-400 text-[11px] shrink-0">até</span>
          <NumberField
            value={valores[`${f.name}${MAX}`] || ''}
            onChange={(v) => setValor(`${f.name}${MAX}`, v)}
            scale={escala}
            allowNegative={f.allowNegative}
            placeholder="até"
            className={inputClass}
          />
        </div>
      );
    }

    // Booleano: Todos / Sim / Não
    if (f.type === 'boolean') {
      return (
        <SelectAuto
          value={valores[f.name] || ''}
          onChange={(e) => setValor(f.name, e.target.value)}
          className={`${inputClass} cursor-pointer`}
        >
          <option value="">Todos</option>
          <option value="1">Somente {f.label.toLowerCase()} = Sim</option>
          <option value="0">Somente {f.label.toLowerCase()} = Não</option>
        </SelectAuto>
      );
    }

    // Enumeração
    if (f.type === 'enum') {
      return (
        <SelectAuto
          value={valores[f.name] || ''}
          onChange={(e) => setValor(f.name, e.target.value)}
          className={`${inputClass} cursor-pointer`}
        >
          <option value="">Todos</option>
          {f.options?.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </SelectAuto>
      );
    }

    // Chave estrangeira
    if (f.ref) {
      return (
        <SelectBusca
          value={valores[f.name] || ''}
          options={refOptions[f.name] || []}
          onChange={(v) => setValor(f.name, v)}
          vazioLabel="Todos"
          className={inputClass}
        />
      );
    }

    // Texto: busca por parte do conteúdo
    return (
      <input
        type="text"
        value={valores[f.name] || ''}
        onChange={(e) => setValor(f.name, e.target.value)}
        placeholder={`Parte de ${f.label.toLowerCase()}…`}
        className={inputClass}
      />
    );
  };

  return (
    <form
      onSubmit={handleAplicar}
      className="border-b border-stone-200 dark:border-stone-800 bg-stone-50 dark:bg-stone-950/50 shrink-0"
    >
      <div className="px-4 py-3">
        <div className="flex items-center justify-between gap-3 mb-3">
          <div className="flex items-center gap-2">
            <SlidersHorizontal className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
            <span className="text-xs font-bold text-stone-800 dark:text-stone-200">
              Busca Avançada
            </span>
            <span className="text-[11px] text-stone-500 dark:text-stone-400">
              Campos em branco são ignorados
            </span>
          </div>
          <button
            type="button"
            onClick={onFechar}
            title="Fechar busca avançada"
            className="p-1 rounded text-stone-400 hover:text-stone-700 dark:hover:text-stone-200 hover:bg-stone-200/60 dark:hover:bg-stone-800 transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
          {campos.map((f) => (
            <div key={f.name} className={FIELD_CLASS}>
              <label className={LABEL_CLASS}>{f.label}</label>
              {renderCampo(f)}
            </div>
          ))}
        </div>

        <div className="flex items-center justify-end gap-2.5 mt-3">
          {temAtivo && (
            <div className="mr-auto">
              <Toggle id="busca-com-desativados" checked={comDesativados} onChange={setComDesativados} label="Listar também os desativados" />
            </div>
          )}
          <button
            type="button"
            onClick={handleLimpar}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold text-stone-600 dark:text-stone-300 border border-stone-300 dark:border-stone-700 hover:bg-stone-100 dark:hover:bg-stone-800 transition-colors cursor-pointer"
          >
            <Eraser className="w-3.5 h-3.5" />
            <span>Limpar filtros</span>
          </button>
          <button
            type="submit"
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white shadow-xs transition-all cursor-pointer"
          >
            <Search className="w-3.5 h-3.5" />
            <span>Aplicar filtros</span>
          </button>
        </div>
      </div>
    </form>
  );
};
