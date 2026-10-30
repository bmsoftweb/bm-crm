import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Bell, CheckCheck, Circle, Globe, Headset, ArrowRightLeft, ClipboardList, Star } from 'lucide-react';
import { fetchNotificacoes, marcarNotificacaoLida, marcarTodasLidas, Notificacao } from '../services/api';
import { formatDateTimeBR } from '../utils/formatters';
import { repetirConsulta } from '../utils/intervalo';

const ICONES: Record<string, React.ElementType> = {
  visita_site: Globe,
  chamado: Headset,
  transferencia: ArrowRightLeft,
  tarefa: ClipboardList,
  avaliacao: Star,
};

interface Props {
  /** Clique numa notificação: abre a tela do link (App.tsx) */
  onAbrir: (n: Notificacao) => void;
}

/** Campainha do cabeçalho: notificações do usuário (server/notificacoes.ts), com o número de não lidas */
export const NotificacoesSino: React.FC<Props> = ({ onAbrir }) => {
  const [aberto, setAberto] = useState(false);
  const [itens, setItens] = useState<Notificacao[]>([]);
  const [naoLidas, setNaoLidas] = useState(0);
  const [soNaoLidas, setSoNaoLidas] = useState(false);
  const caixa = useRef<HTMLDivElement>(null);

  const atualizar = useCallback(
    () =>
      fetchNotificacoes(soNaoLidas)
        .then((r) => {
          setItens(r.itens);
          setNaoLidas(r.naoLidas);
        })
        .catch(() => {}), // sem conexão: fica como estava
    [soNaoLidas],
  );

  useEffect(() => {
    atualizar();
    return repetirConsulta(atualizar, 15_000);
  }, [atualizar]);

  // Fecha ao clicar fora ou com Esc
  useEffect(() => {
    if (!aberto) return;
    const fora = (e: MouseEvent) => !caixa.current?.contains(e.target as Node) && setAberto(false);
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setAberto(false);
    document.addEventListener('mousedown', fora);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('mousedown', fora);
      document.removeEventListener('keydown', esc);
    };
  }, [aberto]);

  const abrir = async (n: Notificacao) => {
    setAberto(false);
    if (!n.lida_em) await marcarNotificacaoLida(n.id).catch(() => {});
    onAbrir(n);
    atualizar();
  };

  const alternarLida = async (n: Notificacao) => {
    await marcarNotificacaoLida(n.id, !n.lida_em).catch(() => {});
    atualizar();
  };

  return (
    <div ref={caixa} className="relative">
      <button
        id="btn-notificacoes"
        onClick={() => {
          setAberto(!aberto);
          if (!aberto) atualizar();
        }}
        title={naoLidas ? `${naoLidas} notificação(ões) não lida(s)` : 'Notificações'}
        className={`relative p-2 rounded-xl border transition-colors cursor-pointer ${
          naoLidas
            ? 'border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400'
            : 'border-stone-200 dark:border-stone-700 text-stone-600 dark:text-stone-300 hover:bg-stone-100 dark:hover:bg-stone-800'
        }`}
      >
        <Bell className="w-4 h-4" />
        {naoLidas > 0 && (
          <span className="absolute -top-1.5 -right-1.5 min-w-[18px] h-[18px] px-1 rounded-full bg-rose-500 text-white text-[10px] font-bold flex items-center justify-center">
            {naoLidas > 99 ? '99+' : naoLidas}
          </span>
        )}
      </button>

      {aberto && (
        <div className="absolute right-0 mt-2 w-[min(380px,calc(100vw-2rem))] max-h-[70vh] flex flex-col rounded-xl border border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-900 shadow-xl z-50">
          <div className="flex items-center justify-between gap-2 px-3 py-2 border-b border-stone-200 dark:border-stone-800">
            <span className="text-sm font-bold text-stone-800 dark:text-stone-100">Notificações</span>
            <div className="flex items-center gap-3 text-[11px]">
              <button
                onClick={() => setSoNaoLidas(!soNaoLidas)}
                className="flex items-center gap-1.5 text-stone-600 dark:text-stone-300 cursor-pointer"
                role="switch"
                aria-checked={soNaoLidas}
              >
                <span className={`w-7 h-4 rounded-full relative transition-colors ${soNaoLidas ? 'bg-blue-600' : 'bg-stone-300 dark:bg-stone-600'}`}>
                  <span className={`absolute top-0.5 w-3 h-3 rounded-full bg-white transition-all ${soNaoLidas ? 'left-3.5' : 'left-0.5'}`} />
                </span>
                Só não lidas
              </button>
              <button
                onClick={() => marcarTodasLidas().then(atualizar, () => {})}
                disabled={!naoLidas}
                title="Marcar todas como lidas"
                className="flex items-center gap-1 font-semibold text-blue-600 hover:underline cursor-pointer disabled:opacity-40 disabled:no-underline"
              >
                <CheckCheck className="w-3.5 h-3.5" /> Todas lidas
              </button>
            </div>
          </div>
          <div className="overflow-y-auto">
            {!itens.length && <p className="p-6 text-center text-xs text-stone-500">Nenhuma notificação.</p>}
            {itens.map((n) => {
              const Icone = ICONES[n.tipo] ?? Bell;
              return (
                <div
                  key={n.id}
                  className={`flex gap-2.5 px-3 py-2.5 border-b border-stone-100 dark:border-stone-800 last:border-0 hover:bg-stone-50 dark:hover:bg-stone-800/60 ${
                    n.lida_em ? 'opacity-60' : ''
                  }`}
                >
                  <Icone className="w-4 h-4 mt-0.5 shrink-0 text-blue-600 dark:text-blue-400" />
                  <button onClick={() => abrir(n)} className="flex-1 min-w-0 text-left cursor-pointer">
                    <p className={`text-xs text-stone-800 dark:text-stone-100 ${n.lida_em ? '' : 'font-semibold'}`}>{n.titulo}</p>
                    {n.texto && <p className="text-[11px] text-stone-500 dark:text-stone-400 line-clamp-2">{n.texto}</p>}
                    <p className="text-[10px] text-stone-400 mt-0.5">{formatDateTimeBR(n.criada_em)}</p>
                  </button>
                  <button
                    onClick={() => alternarLida(n)}
                    title={n.lida_em ? 'Marcar como não lida' : 'Marcar como lida'}
                    className="self-start p-1 cursor-pointer text-blue-600"
                  >
                    <Circle className={`w-2.5 h-2.5 ${n.lida_em ? '' : 'fill-current'}`} />
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};
