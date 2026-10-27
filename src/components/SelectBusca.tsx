import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, RefreshCw, X } from 'lucide-react';
import { OpcaoRef } from '../types';

interface SelectBuscaProps {
  id?: string;
  /** Valor escolhido (id do registro) ou '' */
  value: string | number | null | undefined;
  options: OpcaoRef[];
  onChange: (value: string) => void;
  /** Texto da opção vazia, ex.: "— Nenhum —" */
  vazioLabel?: string;
  required?: boolean;
  disabled?: boolean;
  className?: string;
  /** Busca a lista de novo no servidor (ex.: registro criado em outra tela); sem ela, não há o botão */
  onAtualizar?: () => Promise<void>;
}

/** Quantas opções a lista desenha de uma vez (a busca é que acha o resto) */
const MOSTRAR = 50;

/**
 * Combo digitável: mostra o rótulo escolhido e, ao digitar, filtra a lista.
 * Usado nos campos de chave estrangeira (cliente, negócio, produto...), onde a
 * lista é grande demais para um <select> comum.
 */
export const SelectBusca: React.FC<SelectBuscaProps> = ({
  id,
  value,
  options,
  onChange,
  vazioLabel = '— Nenhum —',
  required,
  disabled,
  className = '',
  onAtualizar,
}) => {
  const [aberto, setAberto] = useState(false);
  const [atualizando, setAtualizando] = useState(false);
  const atualizar = async () => {
    if (!onAtualizar || atualizando) return;
    setAtualizando(true);
    try {
      await onAtualizar();
    } catch {
      // Falhou: fica a lista que já estava
    } finally {
      setAtualizando(false);
    }
  };
  const [busca, setBusca] = useState('');
  const [destaque, setDestaque] = useState(0);
  /** Sem espaço embaixo (perto do pé da tela) e mais espaço em cima: a lista abre para cima */
  const [paraCima, setParaCima] = useState(false);
  const caixa = useRef<HTMLDivElement>(null);
  const lista = useRef<HTMLUListElement>(null);

  const texto = String(value ?? '');
  const escolhida = options.find((o) => String(o.value) === texto);

  const filtradas = useMemo(() => {
    const t = busca.trim().toLowerCase();
    const achadas = t ? options.filter((o) => o.label.toLowerCase().includes(t)) : options;
    return { itens: achadas.slice(0, MOSTRAR), total: achadas.length };
  }, [options, busca]);

  // Clique fora fecha e devolve o rótulo escolhido ao campo
  useEffect(() => {
    if (!aberto) return;
    const fora = (e: MouseEvent) => {
      if (!caixa.current?.contains(e.target as Node)) {
        setAberto(false);
        setBusca('');
      }
    };
    document.addEventListener('mousedown', fora);
    return () => document.removeEventListener('mousedown', fora);
  }, [aberto]);

  // Mantém a opção em destaque visível na rolagem
  useEffect(() => {
    lista.current?.children[destaque]?.scrollIntoView({ block: 'nearest' });
  }, [destaque, aberto]);

  const escolher = (opcao: OpcaoRef | null) => {
    onChange(opcao ? String(opcao.value) : '');

    setAberto(false);
    setBusca('');
  };

  const abrir = () => {
    if (disabled) return;
    const r = caixa.current?.getBoundingClientRect();
    // 248 = altura máxima da lista (max-h-60) + a margem
    if (r) setParaCima(window.innerHeight - r.bottom < 248 && r.top > window.innerHeight - r.bottom);
    setAberto(true);
    // Busca vazia ao abrir: a lista mostra tudo, como no combo de cliente
    setBusca('');
    setDestaque(0);
  };

  const teclado = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!aberto) return abrir();
      setDestaque((d) => Math.min(filtradas.itens.length - 1, Math.max(0, d + (e.key === 'ArrowDown' ? 1 : -1))));
      return;
    }
    if (e.key === 'Enter' && aberto) {
      // Enter escolhe a opção em destaque; não pode enviar o formulário
      e.preventDefault();
      const opcao = filtradas.itens[destaque];
      if (opcao) escolher(opcao);
      return;
    }
    if (e.key === 'Escape' && aberto) {
      e.preventDefault();
      setAberto(false);
      setBusca('');
    }
  };

  return (
    <div ref={caixa} className="relative">
      <input
        id={id}
        type="text"
        role="combobox"
        aria-expanded={aberto}
        autoComplete="off"
        disabled={disabled}
        // Só o campo vazio de um campo obrigatório precisa barrar o envio
        required={required && !escolhida}
        // Ao digitar, o rótulo escolhido vira marca-d'água: dá para ver o que estava lá
        placeholder={(aberto && escolhida?.label) || vazioLabel}
        value={aberto ? busca : escolhida?.label ?? ''}
        // Padrão do projeto: ao focar, o conteúdo já vem selecionado
        onFocus={(e) => {
          abrir();
          e.currentTarget.select();
        }}
        onClick={abrir}
        onChange={(e) => {
          setBusca(e.target.value);
          setDestaque(0);
          setAberto(true);
        }}
        onKeyDown={teclado}
        className={`${className} ${onAtualizar ? 'pr-20' : 'pr-14'} text-ellipsis`}
      />

      <div className="absolute inset-y-0 right-2 flex items-center gap-0.5">
        {escolhida && !required && !disabled && (
          <button
            type="button"
            title="Limpar"
            onClick={() => escolher(null)}
            className="p-0.5 rounded text-stone-400 hover:text-rose-600 cursor-pointer"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        )}
        {onAtualizar && !disabled && (
          <button
            type="button"
            title="Atualizar a lista (traz o que foi cadastrado em outra tela)"
            aria-label="Atualizar a lista"
            onMouseDown={(e) => e.preventDefault()}
            onClick={atualizar}
            className="p-0.5 rounded text-stone-400 hover:text-blue-600 cursor-pointer"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${atualizando ? 'animate-spin' : ''}`} />
          </button>
        )}
        <ChevronDown className={`w-3.5 h-3.5 text-stone-400 transition-transform ${aberto ? 'rotate-180' : ''}`} />
      </div>

      {aberto && (
        <ul
          ref={lista}
          role="listbox"
          className={`absolute z-[60] ${paraCima ? 'bottom-full mb-1' : 'mt-1'} w-full max-h-60 overflow-y-auto rounded-lg border border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-800 shadow-lg py-1`}
        >
          {!required && (
            <li>
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => escolher(null)}
                className="w-full text-left px-3 py-1.5 text-xs text-stone-400 hover:bg-stone-100 dark:hover:bg-stone-700 cursor-pointer"
              >
                {vazioLabel}
              </button>
            </li>
          )}
          {filtradas.itens.map((o, i) => (
            <li key={o.value}>
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onMouseEnter={() => setDestaque(i)}
                onClick={() => escolher(o)}
                aria-selected={String(o.value) === String(value ?? '')}
                className={`w-full text-left px-3 py-1.5 text-xs font-medium truncate cursor-pointer ${
                  i === destaque ? 'bg-blue-600 text-white' : 'text-stone-700 dark:text-stone-200'
                }`}
              >
                {o.label}
              </button>
            </li>
          ))}
          {!filtradas.total && <li className="px-3 py-2 text-xs text-stone-400">Nada encontrado.</li>}
          {filtradas.total > MOSTRAR && (
            <li className="px-3 py-1.5 text-[11px] text-stone-400 border-t border-stone-100 dark:border-stone-700">
              Mostrando {MOSTRAR} de {filtradas.total}. Digite para refinar.
            </li>
          )}
        </ul>
      )}
    </div>
  );
};
