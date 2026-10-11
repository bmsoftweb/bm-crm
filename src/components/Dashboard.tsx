import React, { useState } from 'react';
import { SelectAuto } from './SelectAuto';
import { AlertCircle, CalendarClock, CalendarX2, Handshake, Loader2, Star, ThumbsDown, ThumbsUp, TriangleAlert } from 'lucide-react';
import { DashboardData } from '../types';
import { STATUS_COLORS, STATUS_LABELS, formatMoeda } from '../utils/formatters';
import { iconeAtividade, quando, semaforoFollowup, COR_SEMAFORO } from '../utils/crm';

interface DashboardProps {
  data: DashboardData | null;
  isLoading: boolean;
  error: string | null;
  onNavigate: (tab: string) => void;
}

const CARD = 'bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-800 rounded-2xl';

const Indicador: React.FC<{ titulo: string; valor: string; detalhe?: string; icone: React.ElementType; cor: string; onClick?: () => void }> = ({
  titulo,
  valor,
  detalhe,
  icone: Icone,
  cor,
  onClick,
}) => (
  <button onClick={onClick} className={`${CARD} p-4 text-left hover:border-blue-300 dark:hover:border-blue-800 transition-colors cursor-pointer`}>
    <div className="flex items-center justify-between">
      <span className="text-[11px] font-semibold uppercase tracking-wider text-stone-500 dark:text-stone-400">{titulo}</span>
      <Icone className={`w-4 h-4 ${cor}`} />
    </div>
    <div className="mt-2 text-xl font-bold text-stone-900 dark:text-stone-100 tabular-nums">{valor}</div>
    {detalhe && <div className="text-[11px] text-stone-500 dark:text-stone-400 mt-0.5">{detalhe}</div>}
  </button>
);

/** Colchete de medida (|———|) com o texto embaixo ou em cima, como nos gráficos de funil */
const Colchete: React.FC<{ largura: number; texto: string; embaixo?: boolean }> = ({ largura, texto, embaixo }) => (
  <div className="mx-auto flex flex-col items-center" style={{ width: `${largura}%`, minWidth: 40 }}>
    {embaixo && <div className="w-full h-1.5 border-x border-b border-stone-300 dark:border-stone-600" />}
    <span className="text-[11px] text-stone-500 dark:text-stone-400 tabular-nums py-0.5">{texto}</span>
    {!embaixo && <div className="w-full h-1.5 border-x border-t border-stone-300 dark:border-stone-600" />}
  </div>
);

/**
 * Funil de vendas: uma barra por etapa, centralizada, com largura proporcional ao nº
 * de negócios abertos (a maior etapa = 100%). Embaixo, quanto a última etapa
 * representa da primeira.
 */
const GraficoFunil: React.FC<{ etapas: DashboardData['porEtapa']; onClick: () => void }> = ({ etapas, onClick }) => {
  const funis = Array.from(new Set(etapas.map((e) => e.funil)));
  const [funil, setFunil] = useState(funis[0] ?? '');
  const lista = etapas.filter((e) => e.funil === (funis.includes(funil) ? funil : funis[0]));
  const maior = Math.max(1, ...lista.map((e) => e.qtd));
  const pct = (q: number) => (q / maior) * 100;
  const primeira = lista[0]?.qtd ?? 0;
  const ultima = lista[lista.length - 1]?.qtd ?? 0;
  const conversao = primeira ? `${((ultima / primeira) * 100).toLocaleString('pt-BR', { maximumFractionDigits: 2 })} %` : '—';

  return (
    <section className={`${CARD} p-5 xl:col-span-2`}>
      <div className="flex items-center justify-between gap-3 mb-3">
        <h3 className="text-sm font-bold text-stone-900 dark:text-stone-100">Funil de vendas</h3>
        {funis.length > 1 && (
          <SelectAuto
            value={funil}
            onChange={(e) => setFunil(e.target.value)}
            aria-label="Funil"
            className="bg-stone-50 dark:bg-stone-800/80 px-2 py-1 text-xs font-medium text-stone-700 dark:text-stone-200 cursor-pointer"
          >
            {funis.map((f) => (
              <option key={f} value={f}>{f}</option>
            ))}
          </SelectAuto>
        )}
      </div>
      {lista.length === 0 ? (
        <p className="text-xs text-stone-400 py-6 text-center">Nenhum funil ativo cadastrado.</p>
      ) : (
        <div className="grid grid-cols-[minmax(5rem,9rem)_1fr] gap-x-3 items-center">
          <span />
          <Colchete largura={100} texto="100 %" />
          {lista.map((e, i) => (
            <React.Fragment key={i}>
              <span className="text-xs text-stone-700 dark:text-stone-200 truncate py-1" title={e.etapa}>
                {e.etapa}
              </span>
              <button
                type="button"
                onClick={onClick}
                title={`${e.etapa}: ${e.qtd} negócio(s) • ${formatMoeda(e.valor)}`}
                className="relative h-7 my-0.5 flex items-center justify-center cursor-pointer group"
              >
                <div
                  className="h-full bg-sky-500 group-hover:bg-sky-600 dark:bg-sky-600 dark:group-hover:bg-sky-500 transition-colors"
                  style={{ width: `${pct(e.qtd)}%`, minWidth: 3 }}
                />
                {/* Quantidade dentro da barra; barra estreita demais, ao lado dela */}
                <span
                  className={`absolute text-xs font-semibold tabular-nums ${
                    pct(e.qtd) >= 12 ? 'text-white' : 'text-stone-700 dark:text-stone-200'
                  }`}
                  style={pct(e.qtd) >= 12 ? undefined : { left: `calc(50% + ${pct(e.qtd) / 2}% + 6px)` }}
                >
                  {e.qtd}
                </span>
              </button>
            </React.Fragment>
          ))}
          <span />
          <Colchete largura={pct(ultima)} texto={conversao} embaixo />
        </div>
      )}
    </section>
  );
};

export const Dashboard: React.FC<DashboardProps> = ({ data, isLoading, error, onNavigate }) => {
  if (error) {
    return (
      <div className="p-4 rounded-xl bg-rose-50 dark:bg-rose-950/50 border border-rose-200 dark:border-rose-900 flex items-start gap-2.5 text-sm text-rose-700 dark:text-rose-300">
        <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" /> {error}
      </div>
    );
  }
  if (!data) {
    return (
      <div className="py-24 flex items-center justify-center gap-2 text-sm text-stone-500">
        <Loader2 className="w-4 h-4 animate-spin" /> Carregando indicadores…
      </div>
    );
  }

  const { abertos, mes, atividades } = data;
  const maiorEtapa = Math.max(1, ...data.porEtapa.map((e) => e.valor));

  return (
    <div className={`space-y-5 ${isLoading ? 'opacity-70' : ''}`}>
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        <Indicador titulo="Em aberto" valor={formatMoeda(abertos.valor)} detalhe={`${abertos.qtd} negócio(s) • ponderado ${formatMoeda(abertos.ponderado)}`} icone={Handshake} cor="text-blue-600" onClick={() => onNavigate('kanban')} />
        <Indicador titulo="Ganhos no mês" valor={formatMoeda(mes.ganhos_valor)} detalhe={`${mes.ganhos_qtd} negócio(s)`} icone={ThumbsUp} cor="text-emerald-600" onClick={() => onNavigate('negocios')} />
        <Indicador titulo="Perdidos no mês" valor={formatMoeda(mes.perdidos_valor)} detalhe={`${mes.perdidos_qtd} negócio(s)`} icone={ThumbsDown} cor="text-rose-600" onClick={() => onNavigate('negocios')} />
        <Indicador titulo="Atividades" valor={`${atividades.atrasadas} atrasada(s)`} detalhe={`${atividades.hoje} para hoje`} icone={CalendarX2} cor="text-rose-600" onClick={() => onNavigate('atividades')} />
        <Indicador titulo="Sem follow-up" valor={String(atividades.negocios_sem_atividade)} detalhe="negócio(s) sem atividade agendada" icone={TriangleAlert} cor="text-amber-500" onClick={() => onNavigate('kanban')} />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-5">
        <GraficoFunil etapas={data.porEtapa} onClick={() => onNavigate('kanban')} />

        {/* Próximas atividades */}
        <section className={`${CARD} p-5`}>
          <h3 className="text-sm font-bold text-stone-900 dark:text-stone-100 mb-3 flex items-center gap-2">
            <CalendarClock className="w-4 h-4 text-blue-600" /> Próximas atividades
          </h3>
          {data.proximas.length === 0 ? (
            <p className="text-xs text-stone-400 py-6 text-center">Nenhuma atividade pendente.</p>
          ) : (
            <ul className="space-y-2">
              {data.proximas.map((a) => {
                const Icone = iconeAtividade(a.tipo);
                const cor = COR_SEMAFORO[semaforoFollowup(a.data_vencimento, a.hora_vencimento)].texto;
                return (
                  <li key={a.id} className="flex items-start gap-2.5">
                    <Icone className={`w-4 h-4 mt-0.5 shrink-0 ${cor}`} />
                    <div className="min-w-0">
                      <div className="text-xs font-semibold text-stone-800 dark:text-stone-100 truncate">{a.assunto}</div>
                      <div className="text-[11px] text-stone-500 truncate">
                        <span className={cor}>{quando(a.data_vencimento, a.hora_vencimento)}</span>
                        {a.negocio_titulo && ` • ${a.negocio_titulo}`}
                        {a.chamado_numero && ` • Chamado nº ${a.chamado_numero}`}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        {/* Negócios por etapa (quantidade e valor) */}
        <section className={`${CARD} p-5 xl:col-span-3`}>
          <h3 className="text-sm font-bold text-stone-900 dark:text-stone-100 mb-3">Negócios abertos por etapa</h3>
          {data.porEtapa.length === 0 ? (
            <p className="text-xs text-stone-400 py-6 text-center">Nenhum funil ativo cadastrado.</p>
          ) : (
            <table className="w-full text-xs">
              <thead className="text-stone-500">
                <tr>
                  <th className="text-left font-semibold py-1.5">Etapa</th>
                  <th className="text-right font-semibold py-1.5 w-20">Negócios</th>
                  <th className="text-right font-semibold py-1.5 w-32">Valor</th>
                  <th className="w-1/3" />
                </tr>
              </thead>
              <tbody>
                {data.porEtapa.map((e, i) => (
                  <tr key={i} className="border-t border-stone-100 dark:border-stone-800">
                    <td className="py-1.5 text-stone-700 dark:text-stone-200">
                      <span className="text-stone-400">{e.funil} › </span>
                      {e.etapa}
                    </td>
                    <td className="py-1.5 text-right tabular-nums">{e.qtd}</td>
                    <td className="py-1.5 text-right tabular-nums">{formatMoeda(e.valor)}</td>
                    <td className="py-1.5 pl-3">
                      <div className="h-2 rounded-full bg-blue-500/80" style={{ width: `${(e.valor / maiorEtapa) * 100}%` }} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {(
          [
            ['Propostas por status', data.propostas, 'propostas'],
            ['Pedidos por status', data.pedidos, 'pedidos'],
          ] as const
        ).map(([titulo, linhas, destino]) => (
          <section key={titulo} className={`${CARD} p-5`}>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-bold text-stone-900 dark:text-stone-100">{titulo}</h3>
              <button onClick={() => onNavigate(destino)} className="text-[11px] font-semibold text-blue-600 hover:underline cursor-pointer">Ver todos</button>
            </div>
            {linhas.length === 0 ? (
              <p className="text-xs text-stone-400 py-4 text-center">Nenhum registro.</p>
            ) : (
              <table className="w-full text-xs">
                <tbody>
                  {linhas.map((l) => (
                    <tr key={l.status} className="border-t border-stone-100 dark:border-stone-800 first:border-t-0">
                      <td className="py-1.5">
                        <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${STATUS_COLORS[l.status] || ''}`}>{STATUS_LABELS[l.status] || l.status}</span>
                      </td>
                      <td className="py-1.5 text-right tabular-nums w-16">{l.qtd}</td>
                      <td className="py-1.5 text-right tabular-nums w-36">{formatMoeda(l.valor)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
        ))}
      </div>

      {/* Pesquisa de satisfação do WhatsApp (mês atual) */}
      {data.satisfacao && (
        <section className={`${CARD} p-5`}>
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-bold text-stone-900 dark:text-stone-100 flex items-center gap-2">
              <Star className="w-4 h-4 text-amber-500" />
              Satisfação no mês
            </h3>
            <button onClick={() => onNavigate('avaliacoes')} className="text-[11px] font-semibold text-blue-600 hover:underline cursor-pointer">Ver avaliações</button>
          </div>
          {data.satisfacao.qtd === 0 ? (
            <p className="text-xs text-stone-400 py-4 text-center">Nenhuma avaliação respondida neste mês.</p>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-[12rem_1fr] gap-5 items-start">
              <div className="text-center">
                <div className="text-4xl font-black text-stone-900 dark:text-stone-100 tabular-nums">{data.satisfacao.media?.toFixed(1).replace('.', ',')}</div>
                <div className="flex justify-center gap-0.5 my-1">
                  {[1, 2, 3, 4, 5].map((i) => (
                    <Star key={i} className={`w-4 h-4 ${i <= Math.round(data.satisfacao!.media ?? 0) ? 'fill-amber-400 text-amber-400' : 'text-stone-300 dark:text-stone-700'}`} />
                  ))}
                </div>
                <div className="text-[11px] text-stone-500 dark:text-stone-400">{data.satisfacao.qtd} avaliação(ões)</div>
              </div>
              <table className="w-full text-xs">
                <tbody>
                  {data.satisfacao.porAtendente.map((a) => (
                    <tr key={a.nome} className="border-t border-stone-100 dark:border-stone-800 first:border-t-0">
                      <td className="py-1.5">{a.nome}</td>
                      <td className="py-1.5 text-right tabular-nums w-16 font-semibold">{a.media.toFixed(1).replace('.', ',')} ⭐</td>
                      <td className="py-1.5 text-right tabular-nums w-24 text-stone-500">{a.qtd} avaliação(ões)</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}
    </div>
  );
};
