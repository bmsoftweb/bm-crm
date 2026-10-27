import React, { useEffect, useMemo, useState } from 'react';
import { SelectAuto } from './SelectAuto';
import { Check, ExternalLink, Globe, Instagram, Loader2, MapPin, MessageCircle, Plus, Search, Star, UserPlus, X } from 'lucide-react';
import {
  abrirBuscaProspeccao,
  buscarProspeccao,
  BuscaProspeccao,
  createRecord,
  fetchBuscasProspeccao,
  fetchOptions,
  FiltroProspeccao,
  incluirProspeccao,
  LeadProspeccao,
} from '../services/api';
import { OpcaoRef } from '../types';
import { FIELD_CLASS, HINT_CLASS, INPUT_CLASS, LABEL_CLASS } from '../utils/formStyles';
import { SelectBusca } from './SelectBusca';
import { Toggle } from './Toggle';
import { AvisoErro } from './AvisoErro';

/**
 * Marketing › Prospecção (server/prospeccao.ts): busca empresas no Google Maps (Places API) por
 * segmento e região, mostra as com celular ordenadas pela nota de qualificação e inclui as
 * escolhidas nos Leads (Marketing › Leads). Cada busca é cobrada pelo Google e fica guardada: "Buscas anteriores"
 * reabre o resultado sem chamar o Google de novo.
 */

const FILTRO_INICIAL: FiltroProspeccao = {
  termo: '',
  local: '',
  maximo: 20,
  nota_min: 0,
  avaliacoes_min: 0,
  exigir_site: false,
  somente_celular: true,
  ler_sites: true,
};

const botao = 'inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed';
const botaoPrimario = `${botao} bg-blue-600 hover:bg-blue-700 text-white`;

/** Celular sem DDI, com máscara: 5547988489722 → (47) 98848-9722 */
const mascara = (c: string) => `(${c.slice(2, 4)}) ${c.slice(4, 9)}-${c.slice(9)}`;

const corPontos = (p: number) =>
  p >= 70
    ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300'
    : p >= 45
      ? 'bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300'
      : 'bg-stone-100 text-stone-600 dark:bg-stone-800 dark:text-stone-300';

const Link: React.FC<{ href: string | null; titulo: string; children: React.ReactNode }> = ({ href, titulo, children }) =>
  href ? (
    <a href={href} target="_blank" rel="noopener noreferrer" title={titulo} className="p-1 rounded text-stone-500 hover:text-blue-600 hover:bg-stone-100 dark:hover:bg-stone-800">
      {children}
    </a>
  ) : null;

interface Props {
  onToast: (msg: string) => void;
  /** Abre Pessoas com os leads incluídos pela busca */
  onVerLeads?: (buscaId: string) => void;
}

export const Prospeccao: React.FC<Props> = ({ onToast, onVerLeads }) => {
  const [filtro, setFiltro] = useState<FiltroProspeccao>(FILTRO_INICIAL);
  const [buscando, setBuscando] = useState(false);
  const [resultado, setResultado] = useState<{ leads: LeadProspeccao[]; encontrados: number; descartados: number } | null>(null);
  const [marcados, setMarcados] = useState<Set<string>>(new Set());
  /** Incluídos nesta tela (não precisa buscar de novo para marcar) */
  const [incluidos, setIncluidos] = useState<Set<string>>(new Set());
  const [segmentos, setSegmentos] = useState<OpcaoRef[]>([]);
  const [segmento, setSegmento] = useState('');
  /** Nome do segmento sendo criado ali mesmo (null = mostra o combo) */
  const [novoSegmento, setNovoSegmento] = useState<string | null>(null);
  const [incluindo, setIncluindo] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [buscas, setBuscas] = useState<BuscaProspeccao[]>([]);
  /** Busca guardada que está na tela ('' = nenhuma) */
  const [buscaAberta, setBuscaAberta] = useState('');

  const carregarBuscas = () => fetchBuscasProspeccao().then(setBuscas).catch(() => {});
  useEffect(() => {
    fetchOptions('segmentos', 'nome').then(setSegmentos).catch(() => {});
    carregarBuscas();
  }, []);

  const mostrar = (r: { leads: LeadProspeccao[]; encontrados: number; descartados: number }) => {
    setResultado(r);
    setIncluidos(new Set());
    // Já vem marcado quem tem nota boa e não está no CRM
    setMarcados(new Set(r.leads.filter((l) => !l.pessoa_id && !l.lead_id && l.pontos >= 45).map((l) => l.place_id)));
  };

  /** Reabre uma busca guardada (sem chamar o Google), com os filtros que ela usou */
  const reabrir = async (id: string) => {
    setBuscaAberta(id);
    if (!id) return;
    setBuscando(true);
    setErro(null);
    try {
      const r = await abrirBuscaProspeccao(Number(id));
      setFiltro({ ...FILTRO_INICIAL, ...r.filtros, termo: r.termo, local: r.local });
      mostrar(r);
    } catch (err: any) {
      setErro(err.message);
    } finally {
      setBuscando(false);
    }
  };

  const mudar = <K extends keyof FiltroProspeccao>(campo: K, valor: FiltroProspeccao[K]) => setFiltro((f) => ({ ...f, [campo]: valor }));
  const disponivel = (l: LeadProspeccao) => !l.pessoa_id && !l.lead_id && !incluidos.has(l.place_id);
  const disponiveis = useMemo(() => (resultado?.leads || []).filter(disponivel), [resultado, incluidos]);

  const buscar = async (e: React.FormEvent) => {
    e.preventDefault();
    setBuscando(true);
    setErro(null);
    try {
      const r = await buscarProspeccao(filtro);
      mostrar(r);
      await carregarBuscas();
      setBuscaAberta(r.busca_id ? String(r.busca_id) : '');
    } catch (err: any) {
      setErro(err.message);
    } finally {
      setBuscando(false);
    }
  };

  const incluir = async () => {
    const escolhidos = disponiveis.filter((l) => marcados.has(l.place_id));
    if (!escolhidos.length) return;
    if (!segmento) {
      setErro('Escolha o segmento dos leads (ou crie um no +) antes de incluir.');
      document.getElementById('pr-segmento')?.focus();
      return;
    }
    setIncluindo(true);
    setErro(null);
    try {
      const r = await incluirProspeccao(escolhidos, segmento, buscaAberta || null);
      setIncluidos((s) => new Set([...s, ...escolhidos.map((l) => l.place_id)]));
      setMarcados(new Set());
      onToast(`${r.incluidos} lead(s) incluído(s) nos Leads${r.existentes ? `; ${r.existentes} já estava(m) no CRM` : ''}.`);
    } catch (err: any) {
      setErro(err.message);
    } finally {
      setIncluindo(false);
    }
  };

  const criarSegmento = async () => {
    const nome = novoSegmento?.trim();
    if (!nome) return;
    setErro(null);
    try {
      const { id } = await createRecord('segmentos', { nome, ativo: true });
      setSegmentos(await fetchOptions('segmentos', 'nome'));
      setSegmento(String(id));
      setNovoSegmento(null);
    } catch (err: any) {
      setErro(err.message);
    }
  };

  const alternar = (id: string) =>
    setMarcados((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  const todosMarcados = disponiveis.length > 0 && disponiveis.every((l) => marcados.has(l.place_id));
  const qtdMarcados = disponiveis.filter((l) => marcados.has(l.place_id)).length;

  return (
    <div className="flex flex-col flex-1 min-h-0 bg-white dark:bg-stone-900">
      <form onSubmit={buscar} className="shrink-0 border-b border-stone-200 dark:border-stone-800 px-4 py-4 flex flex-col gap-3">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-3">
          <div className={`${FIELD_CLASS} lg:col-span-2`}>
            <label htmlFor="pr-termo" className={LABEL_CLASS}>O que procurar</label>
            <input id="pr-termo" required value={filtro.termo} onChange={(e) => mudar('termo', e.target.value)} placeholder="Ex.: clínica odontológica" className={`${INPUT_CLASS} w-full`} />
          </div>
          <div className={`${FIELD_CLASS} lg:col-span-2`}>
            <label htmlFor="pr-local" className={LABEL_CLASS}>Cidade ou região</label>
            <input id="pr-local" required value={filtro.local} onChange={(e) => mudar('local', e.target.value)} placeholder="Ex.: Blumenau SC, ou bairro + cidade" className={`${INPUT_CLASS} w-full`} />
          </div>
          <div className={FIELD_CLASS}>
            <label htmlFor="pr-nota" className={LABEL_CLASS}>Nota mínima</label>
            <SelectAuto id="pr-nota" value={filtro.nota_min} onChange={(e) => mudar('nota_min', Number(e.target.value))} className={`${INPUT_CLASS} w-full`}>
              <option value={0}>Qualquer</option>
              <option value={3.5}>3,5 ou mais</option>
              <option value={4}>4,0 ou mais</option>
              <option value={4.5}>4,5 ou mais</option>
            </SelectAuto>
          </div>
          <div className={FIELD_CLASS}>
            <label htmlFor="pr-avaliacoes" className={LABEL_CLASS}>Avaliações mínimas</label>
            <input
              id="pr-avaliacoes"
              type="number"
              min={0}
              value={filtro.avaliacoes_min}
              onChange={(e) => mudar('avaliacoes_min', Math.max(0, Number(e.target.value) || 0))}
              className={`${INPUT_CLASS} w-full`}
            />
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
          <div className="flex items-center gap-2">
            <label htmlFor="pr-maximo" className={LABEL_CLASS}>Buscar até</label>
            <SelectAuto id="pr-maximo" value={filtro.maximo} onChange={(e) => mudar('maximo', Number(e.target.value))} className={INPUT_CLASS}>
              <option value={20}>20 empresas</option>
              <option value={40}>40 empresas</option>
              <option value={60}>60 empresas</option>
            </SelectAuto>
          </div>
          <Toggle id="pr-celular" size="sm" checked={filtro.somente_celular} onChange={(v) => mudar('somente_celular', v)} label={<span className="text-xs font-semibold text-stone-700 dark:text-stone-200">Só com celular</span>} />
          <Toggle id="pr-site" size="sm" checked={filtro.exigir_site} onChange={(v) => mudar('exigir_site', v)} label={<span className="text-xs font-semibold text-stone-700 dark:text-stone-200">Só com site</span>} />
          <Toggle
            id="pr-ler-sites"
            size="sm"
            checked={filtro.ler_sites}
            onChange={(v) => mudar('ler_sites', v)}
            title="Procura no site de cada empresa o link do WhatsApp, o e-mail e o Instagram (a busca fica mais lenta)"
            label={<span className="text-xs font-semibold text-stone-700 dark:text-stone-200">Ler os sites (WhatsApp, e-mail, Instagram)</span>}
          />
          <div className="flex items-center gap-2 ml-auto">
            <label htmlFor="pr-anteriores" className={LABEL_CLASS}>Buscas anteriores</label>
            <SelectAuto
              id="pr-anteriores"
              value={buscaAberta}
              onChange={(e) => reabrir(e.target.value)}
              disabled={buscando || !buscas.length}
              title="Reabre o resultado de uma busca já feita, sem chamar o Google de novo (sem custo)"
              className={`${INPUT_CLASS} w-64 cursor-pointer`}
            >
              <option value="">{buscas.length ? `— ${buscas.length} guardada(s) —` : '— Nenhuma ainda —'}</option>
              {buscas.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.quando} • {b.termo} em {b.local} ({b.qtd})
                </option>
              ))}
            </SelectAuto>
            {buscaAberta && onVerLeads && (
              <button
                type="button"
                onClick={() => onVerLeads(buscaAberta)}
                title="Abre os Leads que esta busca incluiu"
                className={`${botao} border border-stone-200 dark:border-stone-700 text-stone-600 dark:text-stone-300 hover:bg-stone-100 dark:hover:bg-stone-800`}
              >
                Ver leads
              </button>
            )}
          </div>
          <button type="submit" disabled={buscando} className={botaoPrimario}>
            {buscando ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Search className="w-3.5 h-3.5" />}
            {buscando ? 'Buscando...' : 'Buscar'}
          </button>
        </div>
        <span className={HINT_CLASS}>
          Empresas do Google Maps (Google Places API). Cada busca é cobrada pelo Google na conta da chave de Configurações › Prospecção e fica
          guardada em Buscas anteriores, para reabrir sem custo. Faça o primeiro contato por template aprovado e respeite quem pedir para sair.
        </span>
      </form>

      {erro && <AvisoErro mensagem={erro} onFechar={() => setErro(null)} className="mx-4 mt-3" />}

      <div className="flex-1 overflow-auto min-h-0">
        {!resultado ? (
          <div className="p-8 text-center text-xs text-stone-400">Informe o segmento e a região e clique em Buscar.</div>
        ) : !resultado.leads.length ? (
          <div className="p-8 text-center text-xs text-stone-400">
            Nenhuma empresa passou nos filtros ({resultado.encontrados} encontrada(s) no Google). Afrouxe os critérios ou tente outra região.
          </div>
        ) : (
          <table className="w-full text-xs">
            <thead className="sticky top-0 z-10 bg-stone-50 dark:bg-stone-950 text-stone-500 dark:text-stone-400">
              <tr className="text-left">
                <th className="px-3 py-2 w-8">
                  <input
                    type="checkbox"
                    aria-label="Marcar todas"
                    checked={todosMarcados}
                    onChange={() => setMarcados(todosMarcados ? new Set() : new Set(disponiveis.map((l) => l.place_id)))}
                  />
                </th>
                <th className="px-3 py-2 w-16 text-center">Nota</th>
                <th className="px-3 py-2">Empresa</th>
                <th className="px-3 py-2">Celular / WhatsApp</th>
                <th className="px-3 py-2">Telefone</th>
                <th className="px-3 py-2">Google</th>
                <th className="px-3 py-2">Links</th>
              </tr>
            </thead>
            <tbody>
              {resultado.leads.map((l) => {
                const livre = disponivel(l);
                const zap = l.whatsapp_site || l.celular;
                return (
                  <tr key={l.place_id} className={`border-t border-stone-100 dark:border-stone-800 align-top ${livre ? '' : 'opacity-60'}`}>
                    <td className="px-3 py-2">
                      {livre && <input type="checkbox" aria-label={`Marcar ${l.nome}`} checked={marcados.has(l.place_id)} onChange={() => alternar(l.place_id)} />}
                    </td>
                    <td className="px-3 py-2 text-center">
                      <span title={l.motivos.join(' · ') || 'Sem pontos'} className={`inline-block min-w-9 px-2 py-0.5 rounded-full text-[11px] font-bold ${corPontos(l.pontos)}`}>
                        {l.pontos}
                      </span>
                    </td>
                    <td className="px-3 py-2">
                      <div className="font-semibold text-stone-800 dark:text-stone-100 flex items-center gap-2">
                        {l.nome}
                        {l.lead_id ? (
                          <span
                            title={l.pela_prospeccao ? 'Incluída nos Leads por uma busca da Prospecção' : 'Já está nos Leads: achado pelo telefone'}
                            className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300"
                          >
                            Nos Leads
                          </span>
                        ) : l.pessoa_id && l.pela_prospeccao ? (
                          <span
                            title="Incluída pela Prospecção e já convertida em cliente"
                            className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300"
                          >
                            Incluído pela Prospecção
                          </span>
                        ) : l.pessoa_id ? (
                          <span
                            title="Já estava em Pessoas (cadastrado à mão, importado do bmsoft...): achado pelo telefone"
                            className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-stone-100 text-stone-600 dark:bg-stone-800 dark:text-stone-300"
                          >
                            Já no CRM
                          </span>
                        ) : incluidos.has(l.place_id) ? (
                          <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">Incluído</span>
                        ) : null}
                      </div>
                      {l.categoria && <div className="text-[11px] text-stone-500">{l.categoria}</div>}
                      {l.endereco && <div className="text-[11px] text-stone-400">{l.endereco}</div>}
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      {zap ? (
                        <a href={`https://wa.me/${zap}`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-semibold text-emerald-700 dark:text-emerald-400 hover:underline">
                          <MessageCircle className="w-3 h-3" /> {mascara(zap)}
                        </a>
                      ) : (
                        <span className="text-stone-400">—</span>
                      )}
                      {l.whatsapp_site && <div className="text-[10px] text-stone-400">do site</div>}
                      {l.email && <div className="text-[11px] text-stone-500 truncate max-w-48" title={l.email}>{l.email}</div>}
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap text-stone-600 dark:text-stone-300">{l.telefone || '—'}</td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      {l.nota !== null ? (
                        <span className="inline-flex items-center gap-1 text-stone-600 dark:text-stone-300">
                          <Star className="w-3 h-3 text-amber-500 fill-amber-500" /> {l.nota.toFixed(1)} <span className="text-stone-400">({l.avaliacoes})</span>
                        </span>
                      ) : (
                        <span className="text-stone-400">Sem avaliação</span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex items-center">
                        <Link href={l.maps} titulo="Abrir no Google Maps"><MapPin className="w-3.5 h-3.5" /></Link>
                        <Link href={l.site} titulo={l.site || ''}><Globe className="w-3.5 h-3.5" /></Link>
                        <Link href={l.instagram} titulo={l.instagram || ''}><Instagram className="w-3.5 h-3.5" /></Link>
                        {l.pessoa_id && <span title="Já cadastrado em Pessoas"><ExternalLink className="w-3.5 h-3.5 text-stone-300 ml-1" /></span>}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {resultado && resultado.leads.length > 0 && (
        <div className="shrink-0 border-t border-stone-200 dark:border-stone-800 px-4 py-3 flex flex-wrap items-center gap-3">
          <span className="text-xs text-stone-500 dark:text-stone-400">
            {resultado.leads.length} empresa(s) de {resultado.encontrados} encontrada(s)
            {resultado.descartados ? ` · ${resultado.descartados} fora dos filtros` : ''} · {qtdMarcados} marcada(s)
          </span>
          <div className="ml-auto flex items-center gap-2">
            <label htmlFor="pr-segmento" className={LABEL_CLASS}>Segmento</label>
            {novoSegmento === null ? (
              <>
                <SelectBusca id="pr-segmento" value={segmento} options={segmentos} onChange={setSegmento} vazioLabel="Escolha o segmento" required className={`${INPUT_CLASS} w-56`} />
                <button type="button" onClick={() => setNovoSegmento('')} title="Novo segmento" className={`${botao} border border-stone-200 dark:border-stone-700 text-stone-600 dark:text-stone-300 hover:bg-stone-100 dark:hover:bg-stone-800`}>
                  <Plus className="w-3.5 h-3.5" />
                </button>
              </>
            ) : (
              <>
                <input
                  id="pr-segmento"
                  autoFocus
                  maxLength={100}
                  required
                  placeholder="Nome do novo segmento"
                  value={novoSegmento}
                  onChange={(e) => setNovoSegmento(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') criarSegmento();
                    if (e.key === 'Escape') setNovoSegmento(null);
                  }}
                  className={`${INPUT_CLASS} w-56`}
                />
                <button type="button" onClick={criarSegmento} disabled={!novoSegmento.trim()} title="Gravar o segmento" className={`${botao} bg-emerald-600 hover:bg-emerald-700 text-white`}>
                  <Check className="w-3.5 h-3.5" />
                </button>
                <button type="button" onClick={() => setNovoSegmento(null)} title="Cancelar" className={`${botao} border border-stone-200 dark:border-stone-700 text-stone-600 dark:text-stone-300 hover:bg-stone-100 dark:hover:bg-stone-800`}>
                  <X className="w-3.5 h-3.5" />
                </button>
              </>
            )}
            <button type="button" onClick={incluir} disabled={!qtdMarcados || incluindo} className={botaoPrimario}>
              {incluindo ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <UserPlus className="w-3.5 h-3.5" />}
              Incluir {qtdMarcados || ''} como lead
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
