import React, { useState } from 'react';
import { SelectAuto } from './SelectAuto';
import { Loader2, MapPin, Plus, Search, Trash2 } from 'lucide-react';
import { Endereco } from '../types';
import { INPUT_CLASS, LABEL_CLASS, FIELD_CLASS, HINT_CLASS } from '../utils/formStyles';
import { Toggle } from './Toggle';
import { ConfirmDialog } from './ConfirmDialog';

const TIPOS = [
  { value: 'comercial', label: 'Comercial' },
  { value: 'residencial', label: 'Residencial' },
  { value: 'entrega', label: 'Entrega' },
  { value: 'cobranca', label: 'Cobrança' },
  { value: 'outro', label: 'Outro' },
];

const UFS = 'AC AL AM AP BA CE DF ES GO MA MG MS MT PA PB PE PI PR RJ RN RO RR RS SC SE SP TO'.split(' ');

export const enderecoVazio = (principal: boolean): Endereco => ({
  id: null,
  tipo: 'comercial',
  principal: principal ? 1 : 0,
  cep: '',
  logradouro: '',
  numero: '',
  complemento: '',
  bairro: '',
  cidade: '',
  uf: '',
  codigo_ibge: '',
  pais: 'Brasil',
  obs: '',
});

const mascaraCep = (v: string) => {
  const d = v.replace(/\D/g, '').slice(0, 8);
  return d.length > 5 ? `${d.slice(0, 5)}-${d.slice(5)}` : d;
};

const selecionar = (e: React.FocusEvent<HTMLInputElement>) => e.target.select();

interface Props {
  enderecos: Endereco[];
  onChange: (lista: Endereco[]) => void;
  carregando?: boolean;
}

/**
 * Endereços no cadastro da pessoa: uma pessoa pode ter vários, um deles principal.
 * A lista é gravada junto com a pessoa, no Salvar do formulário.
 */
export const EnderecosPessoa: React.FC<Props> = ({ enderecos, onChange, carregando }) => {
  const [removendo, setRemovendo] = useState<number | null>(null);
  const [buscandoCep, setBuscandoCep] = useState<number | null>(null);
  const [avisoCep, setAvisoCep] = useState<Record<number, string>>({});

  const alterar = (i: number, campos: Partial<Endereco>) =>
    onChange(enderecos.map((e, j) => (j === i ? { ...e, ...campos } : e)));

  const marcarPrincipal = (i: number) => onChange(enderecos.map((e, j) => ({ ...e, principal: j === i ? 1 : 0 })));

  /** Preenche logradouro, bairro, cidade, UF e IBGE pelo CEP (ViaCEP) */
  const buscarCep = async (i: number, cep: string) => {
    const d = cep.replace(/\D/g, '');
    if (d.length !== 8) return;
    setBuscandoCep(i);
    setAvisoCep((a) => ({ ...a, [i]: '' }));
    try {
      const r = await fetch(`https://viacep.com.br/ws/${d}/json/`, { signal: AbortSignal.timeout(8000) });
      const j = await r.json();
      if (j.erro) throw new Error('CEP não encontrado.');
      onChange(
        enderecos.map((e, k) =>
          k === i
            ? {
                ...e,
                cep: d,
                logradouro: j.logradouro || e.logradouro,
                bairro: j.bairro || e.bairro,
                cidade: j.localidade || e.cidade,
                uf: j.uf || e.uf,
                codigo_ibge: j.ibge || e.codigo_ibge,
              }
            : e,
        ),
      );
    } catch (err: any) {
      setAvisoCep((a) => ({ ...a, [i]: err?.message === 'CEP não encontrado.' ? err.message : 'Não foi possível consultar o CEP.' }));
    } finally {
      setBuscandoCep(null);
    }
  };

  const texto = (i: number, campo: keyof Endereco, rotulo: string, extra: Partial<React.InputHTMLAttributes<HTMLInputElement>> = {}) => (
    <div className={FIELD_CLASS}>
      <label htmlFor={`end-${i}-${campo}`} className={LABEL_CLASS}>{rotulo}</label>
      <input
        id={`end-${i}-${campo}`}
        value={String(enderecos[i][campo] ?? '')}
        onChange={(e) => alterar(i, { [campo]: e.target.value })}
        onFocus={selecionar}
        className={`${INPUT_CLASS} w-full`}
        {...extra}
      />
    </div>
  );

  return (
    <div className="pt-3 border-t border-stone-200 dark:border-stone-800">
      <div className="flex items-center justify-between gap-3 mb-3">
        <div className="flex items-center gap-2 text-xs font-bold text-stone-700 dark:text-stone-200">
          <MapPin className="w-4 h-4 text-stone-400" />
          Endereços
          {carregando && <Loader2 className="w-3.5 h-3.5 animate-spin text-stone-400" />}
        </div>
        <button
          type="button"
          onClick={() => onChange([...enderecos, enderecoVazio(enderecos.length === 0)])}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border border-stone-300 dark:border-stone-700 text-stone-700 dark:text-stone-200 hover:bg-stone-100 dark:hover:bg-stone-800 cursor-pointer"
        >
          <Plus className="w-3.5 h-3.5" />
          Adicionar endereço
        </button>
      </div>

      {!carregando && enderecos.length === 0 && <p className={HINT_CLASS}>Nenhum endereço cadastrado.</p>}

      <div className="space-y-3">
        {enderecos.map((e, i) => (
          <div key={e.id ?? `novo-${i}`} className="p-3 rounded-lg bg-stone-50/60 dark:bg-stone-800/30 border border-stone-200 dark:border-stone-800">
            <div className="flex items-center gap-3 mb-3">
              <SelectAuto
                aria-label="Tipo do endereço"
                value={e.tipo}
                onChange={(ev) => alterar(i, { tipo: ev.target.value })}
                className={`${INPUT_CLASS} w-40 cursor-pointer`}
              >
                {TIPOS.map((t) => (
                  <option key={t.value} value={t.value}>{t.label}</option>
                ))}
              </SelectAuto>
              <Toggle
                checked={Boolean(Number(e.principal))}
                onChange={(v) => v && marcarPrincipal(i)}
                size="sm"
                label="Principal"
                title="Endereço principal da pessoa (só um pode ser o principal)"
              />
              <button
                type="button"
                onClick={() => setRemovendo(i)}
                title="Remover este endereço"
                className="ml-auto p-1.5 rounded-lg text-stone-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40 cursor-pointer"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              <div className={FIELD_CLASS}>
                <label htmlFor={`end-${i}-cep`} className={LABEL_CLASS}>CEP</label>
                <div className="relative">
                  <input
                    id={`end-${i}-cep`}
                    value={mascaraCep(String(e.cep ?? ''))}
                    onChange={(ev) => {
                      const d = ev.target.value.replace(/\D/g, '').slice(0, 8);
                      alterar(i, { cep: d });
                      if (d.length === 8 && d !== String(e.cep ?? '')) buscarCep(i, d);
                    }}
                    onFocus={selecionar}
                    inputMode="numeric"
                    placeholder="00000-000"
                    className={`${INPUT_CLASS} w-full pr-8`}
                  />
                  <button
                    type="button"
                    onClick={() => buscarCep(i, String(e.cep ?? ''))}
                    title="Buscar o endereço pelo CEP"
                    tabIndex={-1}
                    className="absolute inset-y-0 right-0 px-2 flex items-center text-stone-400 hover:text-blue-600 cursor-pointer"
                  >
                    {buscandoCep === i ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Search className="w-3.5 h-3.5" />}
                  </button>
                </div>
                {avisoCep[i] && <p className="text-[11px] font-medium text-rose-600 dark:text-rose-400">{avisoCep[i]}</p>}
              </div>
              <div className="lg:col-span-3">{texto(i, 'logradouro', 'Logradouro', { maxLength: 255 })}</div>
              {texto(i, 'numero', 'Número', { maxLength: 20 })}
              {texto(i, 'complemento', 'Complemento', { maxLength: 100 })}
              <div className="lg:col-span-2">{texto(i, 'bairro', 'Bairro', { maxLength: 100 })}</div>
              <div className="lg:col-span-2">{texto(i, 'cidade', 'Cidade', { maxLength: 100 })}</div>
              <div className={FIELD_CLASS}>
                <label htmlFor={`end-${i}-uf`} className={LABEL_CLASS}>UF</label>
                <SelectAuto
                  id={`end-${i}-uf`}
                  value={String(e.uf ?? '')}
                  onChange={(ev) => alterar(i, { uf: ev.target.value })}
                  className={`${INPUT_CLASS} w-full cursor-pointer`}
                >
                  <option value="">—</option>
                  {UFS.map((u) => (
                    <option key={u} value={u}>{u}</option>
                  ))}
                </SelectAuto>
              </div>
              {texto(i, 'obs', 'Observação', { maxLength: 255 })}
            </div>
          </div>
        ))}
      </div>

      {removendo !== null && (
        <ConfirmDialog
          titulo="Remover este endereço?"
          mensagem="O endereço sai da lista agora e é apagado de vez ao salvar a pessoa."
          confirmar="Remover"
          onConfirmar={() => {
            const resto = enderecos.filter((_, j) => j !== removendo);
            // Removido o principal, o primeiro que sobrou assume
            if (resto.length && !resto.some((x) => Number(x.principal))) resto[0] = { ...resto[0], principal: 1 };
            onChange(resto);
            setRemovendo(null);
          }}
          onCancelar={() => setRemovendo(null)}
        />
      )}
    </div>
  );
};
