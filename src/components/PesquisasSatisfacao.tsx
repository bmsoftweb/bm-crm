import React, { useCallback, useEffect, useState } from 'react';
import { SelectAuto } from './SelectAuto';
import { CircleCheck, Dices, Eye, Loader2, Mail, MessageCircle, Phone, Play, Plus, Save, Trash2, X } from 'lucide-react';
import {
  buscarPessoasPesquisa,
  CanalPesquisa,
  criarPesquisa,
  DadosPesquisa,
  concluirPesquisa, excluirPesquisa,
  executarPesquisa,
  fetchItemDaAtividade,
  fetchOptions,
  fetchPesquisa,
  fetchPesquisas,
  FiltroPesquisa,
  ItemPesquisa,
  marcarItemPesquisa,
  Pesquisa,
  PesquisaResumo,
  previaPesquisa,
  registrarRetornoPesquisa,
  salvarPesquisa,
  sortearPesquisa,
} from '../services/api';
import { Id, OpcaoRef } from '../types';
import { diaUtilAnteriorIso, formatDateBR, formatDateTimeBR } from '../utils/formatters';
import { INPUT_CLASS, LABEL_CLASS, FIELD_CLASS, HINT_CLASS } from '../utils/formStyles';
import { DateField } from './DateField';
import { NumberField } from './NumberField';
import { SelectBusca } from './SelectBusca';
import { Toggle } from './Toggle';
import { ConfirmDialog } from './ConfirmDialog';
import { AvisoErro } from './AvisoErro';
import { BotaoConversaBot } from './ConversaBot';
import { BotaoAcao } from './MenuAcoes';
import { createPortal } from 'react-dom';

/**
 * Suporte › Pesquisa de Satisfação (server/pesquisasSatisfacao.ts). Abas: Pesquisas (a lista), Filtro (descrição,
 * objetivo, tipo de contato, filtro dos atendimentos e quantos sortear) e Atendimentos Selecionados (o sorteio,
 * marcar/desmarcar, Executar, Sortear +x e o retorno de cada cliente).
 */

const CANAIS: { value: CanalPesquisa; label: string }[] = [
  { value: 'whatsapp', label: 'WhatsApp (conversa com a IA)' },
  { value: 'email', label: 'E-mail' },
  { value: 'ligacao', label: 'Ligação' },
];
const rotuloCanal = (c: string) => ({ whatsapp: 'WhatsApp', email: 'E-mail', ligacao: 'Ligação' })[c] ?? c;

const SITUACAO_PESQUISA: Record<string, [string, string]> = {
  rascunho: ['Rascunho', 'bg-stone-100 text-stone-600 dark:bg-stone-800 dark:text-stone-300'],
  em_andamento: ['Em andamento', 'bg-blue-50 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300'],
  concluida: ['Concluída', 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300'],
  cancelada: ['Cancelada', 'bg-rose-50 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300'],
};
const SITUACAO_ITEM: Record<string, [string, string]> = {
  sorteado: ['Sorteado', 'bg-stone-100 text-stone-600 dark:bg-stone-800 dark:text-stone-300'],
  enviado: ['Contatado', 'bg-blue-50 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300'],
  em_conversa: ['Em conversa', 'bg-blue-50 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300'],
  respondido: ['Respondido', 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300'],
  sem_resposta: ['Sem resposta', 'bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300'],
  falhou: ['Falhou', 'bg-rose-50 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300'],
};
const Etiqueta: React.FC<{ par?: [string, string] }> = ({ par }) =>
  par ? <span className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-semibold ${par[1]}`}>{par[0]}</span> : null;

/** Objetivo sugerido na pesquisa nova (pode ser alterado) */
const OBJETIVO_PADRAO =
  'Saber se o problema do cliente foi resolvido, como ele avalia o tempo de resposta e a cordialidade de quem atendeu, e se ficou alguma pendência.';

/** Descrição sugerida, pela data inicial dos atendimentos */
const descricaoSugerida = (dataDe: string | null | undefined) => (dataDe ? `Pesquisa dos atendimentos do dia ${formatDateBR(dataDe)}` : '');

/**
 * Pesquisa nova: atendimentos do dia útil anterior (ontem; na segunda, a sexta), pelo WhatsApp das campanhas.
 * Calculado na hora: a tela pode ficar aberta de um dia para o outro
 */
const vazia = (): DadosPesquisa => ({
  descricao: descricaoSugerida(diaUtilAnteriorIso()),
  objetivo: OBJETIVO_PADRAO,
  canal: 'whatsapp',
  conta: 'campanhas',
  filtro: { data_de: diaUtilAnteriorIso(), data_ate: diaUtilAnteriorIso(), origens: [], notas: [], excluir_dias: 30 },
  quantidade: 20,
  responsavel_id: null,
});

const botao = 'inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold cursor-pointer disabled:opacity-50';
const botaoSecundario = `${botao} border border-stone-300 dark:border-stone-700 text-stone-700 dark:text-stone-200 hover:bg-stone-100 dark:hover:bg-stone-800`;
const botaoPrimario = `${botao} bg-blue-600 hover:bg-blue-700 text-white`;

/**
 * Para onde vai o contato: depois de contatado, o destino usado; antes, o do cadastro pelo tipo de contato
 * (WhatsApp/ligação = celular, e-mail = e-mail). Faltando, aviso em âmbar (desmarque ou corrija o cadastro)
 */
const Contato: React.FC<{ canal: CanalPesquisa; item: ItemPesquisa }> = ({ canal, item }) => {
  const valor = item.destino || (canal === 'email' ? item.pessoa_email : item.pessoa_telefone);
  const Icone = canal === 'email' ? Mail : canal === 'ligacao' ? Phone : MessageCircle;
  return valor ? (
    <div className="flex items-center gap-1 text-[11px] text-stone-500 dark:text-stone-400">
      <Icone className="w-3 h-3 shrink-0" /> {valor}
    </div>
  ) : (
    <div className="text-[11px] font-semibold text-amber-700 dark:text-amber-300">{canal === 'email' ? 'Sem e-mail no cadastro' : 'Sem celular no cadastro'}</div>
  );
};

/** Vários ids de uma lista: chips removíveis + combo para acrescentar */
const Multipla: React.FC<{ rotulo: string; opcoes: OpcaoRef[]; valor?: number[]; onChange: (ids: number[]) => void; vazio: string }> = ({ rotulo, opcoes, valor = [], onChange, vazio }) => {
  const nome = (id: number) => opcoes.find((o) => o.value === String(id))?.label ?? `#${id}`;
  return (
    <div className={FIELD_CLASS}>
      <span className={LABEL_CLASS}>{rotulo}</span>
      <SelectBusca value="" options={opcoes.filter((o) => !valor.includes(Number(o.value)))} onChange={(v) => v && onChange([...valor, Number(v)])} vazioLabel={vazio} className={`${INPUT_CLASS} w-full`} />
      {valor.length > 0 && (
        <div className="flex flex-wrap gap-1.5 pt-1">
          {valor.map((id) => (
            <span key={id} className="inline-flex items-center gap-1 pl-2 pr-1 py-0.5 rounded-full text-[11px] font-semibold bg-blue-50 text-blue-800 dark:bg-blue-950/40 dark:text-blue-200">
              {nome(id)}
              <button type="button" onClick={() => onChange(valor.filter((x) => x !== id))} title={`Tirar ${nome(id)}`} className="p-0.5 rounded-full hover:bg-blue-100 dark:hover:bg-blue-900 cursor-pointer">
                <X className="w-3 h-3" />
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
};

/** Clientes do filtro: busca por nome (a lista de pessoas é grande demais para um combo) */
const Clientes: React.FC<{ valor?: number[]; nomes: Record<number, string>; onChange: (ids: number[], nomes: Record<number, string>) => void }> = ({ valor = [], nomes, onChange }) => {
  const [q, setQ] = useState('');
  const [achadas, setAchadas] = useState<{ id: number; nome: string }[]>([]);
  useEffect(() => {
    const t = setTimeout(() => {
      if (q.trim().length < 2) return setAchadas([]);
      buscarPessoasPesquisa(q.trim()).then(setAchadas).catch(() => setAchadas([]));
    }, 300);
    return () => clearTimeout(t);
  }, [q]);
  return (
    <div className={`${FIELD_CLASS} relative`}>
      <label htmlFor="ps-cliente" className={LABEL_CLASS}>Clientes</label>
      <input id="ps-cliente" value={q} onChange={(e) => setQ(e.target.value)} onFocus={(e) => e.target.select()} placeholder="Buscar pelo nome (vazio = todos)" className={`${INPUT_CLASS} w-full`} />
      {achadas.length > 0 && (
        <div className="absolute z-20 top-full left-0 right-0 mt-1 max-h-56 overflow-y-auto rounded-lg border border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-900 shadow-lg">
          {achadas
            .filter((a) => !valor.includes(a.id))
            .map((a) => (
              <button
                key={a.id}
                type="button"
                onClick={() => {
                  onChange([...valor, a.id], { ...nomes, [a.id]: a.nome });
                  setQ('');
                }}
                className="block w-full text-left px-3 py-1.5 text-xs hover:bg-stone-100 dark:hover:bg-stone-800 cursor-pointer"
              >
                {a.nome}
              </button>
            ))}
        </div>
      )}
      {valor.length > 0 && (
        <div className="flex flex-wrap gap-1.5 pt-1">
          {valor.map((id) => (
            <span key={id} className="inline-flex items-center gap-1 pl-2 pr-1 py-0.5 rounded-full text-[11px] font-semibold bg-blue-50 text-blue-800 dark:bg-blue-950/40 dark:text-blue-200">
              {nomes[id] ?? `Cliente #${id}`}
              <button type="button" onClick={() => onChange(valor.filter((x) => x !== id), nomes)} title="Tirar" className="p-0.5 rounded-full hover:bg-blue-100 dark:hover:bg-blue-900 cursor-pointer">
                <X className="w-3 h-3" />
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
};

/**
 * Retorno de uma ligação da pesquisa (quem ligou registra o que o cliente disse). Aberto na aba Atendimentos
 * Selecionados e na lista de Atividades/Tarefas (atividade de ligação da pesquisa)
 */
export const RetornoLigacao: React.FC<{ itemId?: number; atividadeId?: Id; onFechar: () => void; onGravado: () => void }> = ({ itemId, atividadeId, onFechar, onGravado }) => {
  const [info, setInfo] = useState<Awaited<ReturnType<typeof fetchItemDaAtividade>> | null>(null);
  const [naoAtendeu, setNaoAtendeu] = useState(false);
  const [nota, setNota] = useState<number | null>(null);
  const [comentario, setComentario] = useState('');
  const [precisa, setPrecisa] = useState(false);
  const [motivo, setMotivo] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);
  useEffect(() => {
    if (atividadeId) fetchItemDaAtividade(atividadeId).then(setInfo).catch((e) => setErro(e.message));
  }, [atividadeId]);
  const id = itemId ?? info?.id;

  const salvar = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!id) return;
    if (!naoAtendeu && !nota) return setErro('Escolha a nota de 1 a 5 que o cliente deu.');
    if (precisa && !motivo.trim()) return setErro('Diga o que a empresa precisa fazer (vira a tarefa do técnico).');
    setSalvando(true);
    setErro(null);
    try {
      await registrarRetornoPesquisa(id, naoAtendeu ? { nao_atendeu: true } : { nota: nota!, comentario, resumo: comentario, precisa_retorno: precisa, motivo_retorno: motivo });
      onGravado();
    } catch (err: any) {
      setErro(err.message);
      setSalvando(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <div className="fixed inset-0 bg-stone-950/70 backdrop-blur-xs" onClick={salvando ? undefined : onFechar} aria-hidden="true" />
      <form onSubmit={salvar} role="dialog" aria-modal="true" className="relative w-full max-w-lg bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-800 rounded-2xl shadow-2xl z-10">
        <div className="px-5 py-4 border-b border-stone-200 dark:border-stone-800 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <h3 className="text-base font-bold text-stone-900 dark:text-stone-100 flex items-center gap-2">
              <Phone className="w-4 h-4 text-blue-600" /> Retorno da ligação
            </h3>
            {info && (
              <p className="text-[11px] text-stone-500 dark:text-stone-400 truncate">
                {info.pessoa_nome} {info.pessoa_telefone ? `• ${info.pessoa_telefone}` : ''} • {info.pesquisa_descricao}
              </p>
            )}
          </div>
          <button type="button" onClick={onFechar} title="Fechar" className="p-1.5 rounded-lg text-stone-400 hover:text-stone-700 hover:bg-stone-100 dark:hover:bg-stone-800 cursor-pointer">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="p-5 space-y-4">
          {info && (
            <p className="text-xs text-stone-600 dark:text-stone-300">
              Atendimento avaliado: <strong>{info.assunto}</strong> em {info.data_br}
              {info.atendente_nome ? `, atendido por ${info.atendente_nome}` : ''}.{info.objetivo ? ` Objetivo: ${info.objetivo}` : ''}
            </p>
          )}
          <Toggle checked={naoAtendeu} onChange={setNaoAtendeu} size="sm" label="Cliente não atendeu" />
          {!naoAtendeu && (
            <>
              <div className={FIELD_CLASS}>
                <span className={LABEL_CLASS}>Nota do cliente<span className="text-rose-500 ml-1">*</span></span>
                <div className="flex gap-1.5">
                  {[1, 2, 3, 4, 5].map((n) => (
                    <button
                      key={n}
                      type="button"
                      onClick={() => setNota(n)}
                      aria-pressed={nota === n}
                      className={`px-3 py-1.5 rounded-lg text-xs font-semibold border cursor-pointer ${
                        nota === n ? 'bg-blue-600 border-blue-600 text-white' : 'border-stone-300 dark:border-stone-700 text-stone-600 dark:text-stone-300 hover:bg-stone-100 dark:hover:bg-stone-800'
                      }`}
                    >
                      {n} {'⭐'.repeat(n)}
                    </button>
                  ))}
                </div>
              </div>
              <div className={FIELD_CLASS}>
                <label htmlFor="ps-comentario" className={LABEL_CLASS}>O que o cliente disse</label>
                <textarea id="ps-comentario" rows={3} value={comentario} onChange={(e) => setComentario(e.target.value)} maxLength={4000} className={`${INPUT_CLASS} w-full resize-y`} />
              </div>
              <Toggle checked={precisa} onChange={setPrecisa} size="sm" label="A empresa precisa retornar (ficou algo pendente)" />
              {precisa && (
                <div className={FIELD_CLASS}>
                  <label htmlFor="ps-motivo" className={LABEL_CLASS}>O que fazer<span className="text-rose-500 ml-1">*</span></label>
                  <input id="ps-motivo" value={motivo} onChange={(e) => setMotivo(e.target.value)} onFocus={(e) => e.target.select()} maxLength={200} className={`${INPUT_CLASS} w-full`} />
                  <span className={HINT_CLASS}>Vira uma tarefa para o técnico que atendeu</span>
                </div>
              )}
            </>
          )}
          {erro && <AvisoErro mensagem={erro} onFechar={() => setErro(null)} />}
        </div>
        <div className="px-5 py-3 border-t border-stone-200 dark:border-stone-800 flex justify-end gap-2.5 bg-stone-50 dark:bg-stone-950/40 rounded-b-2xl">
          <button type="button" onClick={onFechar} disabled={salvando} className={botaoSecundario}>
            Cancelar
          </button>
          <button type="submit" disabled={salvando || !id} className={botaoPrimario}>
            {salvando ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} Registrar
          </button>
        </div>
      </form>
    </div>
  );
};

/** Ação da lista de Atividades/Tarefas (menu "..."): ligação de pesquisa pendente abre o modal de retorno */
export const AcaoRetornoLigacao: React.FC<{ atividadeId: Id; onGravado: () => void }> = ({ atividadeId, onGravado }) => {
  const [aberto, setAberto] = useState(false);
  return (
    <>
      <BotaoAcao icone={Phone} titulo="Registrar retorno" descricao="O que o cliente disse na ligação da pesquisa de satisfação" onClick={() => setAberto(true)} />
      {aberto &&
        createPortal(
          <RetornoLigacao
            atividadeId={atividadeId}
            onFechar={() => setAberto(false)}
            onGravado={() => {
              setAberto(false);
              onGravado();
            }}
          />,
          document.body,
        )}
    </>
  );
};

export const PesquisasSatisfacao: React.FC<{ refreshToken: number; onToast: (msg: string) => void }> = ({ refreshToken, onToast }) => {
  const [aba, setAba] = useState<'pesquisas' | 'filtro' | 'selecionados'>('pesquisas');
  const [lista, setLista] = useState<PesquisaResumo[] | null>(null);
  const [atual, setAtual] = useState<Pesquisa | null>(null);
  const [v, setV] = useState<DadosPesquisa>(vazia);
  const [nomesClientes, setNomesClientes] = useState<Record<number, string>>({});
  const [previa, setPrevia] = useState<number | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [excluindo, setExcluindo] = useState<PesquisaResumo | null>(null);
  const [concluindo, setConcluindo] = useState<PesquisaResumo | null>(null);
  const [executando, setExecutando] = useState(false);
  const [mais, setMais] = useState('10');
  const [retorno, setRetorno] = useState<number | null>(null);
  const [opcoes, setOpcoes] = useState<{ segmentos: OpcaoRef[]; usuarios: OpcaoRef[]; departamentos: OpcaoRef[]; categorias: OpcaoRef[] }>({ segmentos: [], usuarios: [], departamentos: [], categorias: [] });

  useEffect(() => {
    Promise.all([fetchOptions('segmentos', 'nome'), fetchOptions('usuarios', 'nome'), fetchOptions('departamentos', 'nome'), fetchOptions('chamado_categorias', 'nome')])
      .then(([segmentos, usuarios, departamentos, categorias]) => setOpcoes({ segmentos, usuarios, departamentos, categorias }))
      .catch(() => {});
  }, []);

  const carregarLista = useCallback(() => {
    fetchPesquisas().then(setLista).catch((e) => setErro(e.message));
  }, []);
  useEffect(carregarLista, [carregarLista, refreshToken]);

  const abrir = async (id: number, irPara: typeof aba = 'filtro') => {
    try {
      const p = await fetchPesquisa(id);
      setAtual(p);
      setV({ descricao: p.descricao, objetivo: p.objetivo ?? '', canal: p.canal, conta: p.conta, filtro: p.filtro, quantidade: p.quantidade, responsavel_id: p.responsavel_id });
      // A prévia é do momento (o que ainda não foi sorteado): só aparece depois de "Ver quantos"
      setPrevia(null);
      setAba(irPara);
    } catch (e: any) {
      setErro(e.message);
    }
  };
  const recarregarAtual = () => atual && abrir(atual.id, aba);

  const nova = () => {
    setAtual(null);
    setV(vazia());
    setPrevia(null);
    setNomesClientes({});
    setAba('filtro');
  };

  const f = v.filtro;
  const setFiltro = (m: Partial<FiltroPesquisa>) => {
    // Descrição ainda a sugerida: acompanha a data inicial
    const descricao = 'data_de' in m && v.descricao === descricaoSugerida(f.data_de) ? descricaoSugerida(m.data_de) || v.descricao : v.descricao;
    setV({ ...v, descricao, filtro: { ...f, ...m } });
    setPrevia(null);
  };
  const alternar = <T,>(lista: T[] | undefined, x: T) => ((lista ?? []).includes(x) ? (lista ?? []).filter((y) => y !== x) : [...(lista ?? []), x]);

  const acao = async (nome: string, fn: () => Promise<void>) => {
    setOcupado(nome);
    setErro(null);
    try {
      await fn();
    } catch (e: any) {
      setErro(e.message);
    } finally {
      setOcupado(null);
    }
  };

  /** Grava a pesquisa (nova ou alterada) e devolve o id */
  const gravar = async (): Promise<number> => {
    if (!v.descricao.trim()) throw new Error('Informe a descrição da pesquisa.');
    if (atual) {
      await salvarPesquisa(atual.id, v);
      return atual.id;
    }
    return (await criarPesquisa(v)).id;
  };

  const itens = atual?.itens ?? [];
  const aguardando = itens.filter((i) => i.selecionado && i.situacao === 'sorteado').length;
  const podeSortear = !atual || atual.situacao === 'rascunho' || atual.situacao === 'em_andamento';
  /** Já sorteada: o filtro fica como no primeiro sorteio (mais atendimentos, só pelo "Sortear +x") */
  const filtroTravado = itens.length > 0;

  return (
    <div className="flex-1 min-h-0 flex flex-col bg-white dark:bg-stone-900">
      {/* Abas */}
      <div className="px-4 pt-3 border-b border-stone-200 dark:border-stone-800 flex items-end gap-1 shrink-0">
        {(
          [
            ['pesquisas', 'Pesquisas'],
            ['filtro', atual ? `Filtro — ${atual.descricao}` : 'Filtro (nova pesquisa)'],
            ['selecionados', `Atendimentos Selecionados${atual ? ` (${itens.filter((i) => i.selecionado).length})` : ''}`],
          ] as const
        ).map(([id, rotulo]) => (
          <button
            key={id}
            type="button"
            disabled={id === 'selecionados' && !atual}
            onClick={() => setAba(id)}
            className={`px-3 py-2 text-xs font-semibold border-b-2 -mb-px cursor-pointer disabled:opacity-40 disabled:cursor-default truncate max-w-[40ch] ${
              aba === id ? 'border-blue-600 text-blue-700 dark:text-blue-300' : 'border-transparent text-stone-500 hover:text-stone-800 dark:hover:text-stone-200'
            }`}
          >
            {rotulo}
          </button>
        ))}
      </div>

      {erro && (
        <div className="px-4 pt-3">
          <AvisoErro mensagem={erro} onFechar={() => setErro(null)} />
        </div>
      )}

      <div className="flex-1 min-h-0 overflow-y-auto p-4">
        {/* ---------------- Pesquisas ---------------- */}
        {aba === 'pesquisas' && (
          <div className="space-y-3">
            <button type="button" onClick={nova} className={botaoPrimario}>
              <Plus className="w-4 h-4" /> Nova pesquisa
            </button>
            {lista === null ? (
              <Loader2 className="w-4 h-4 animate-spin text-stone-400" />
            ) : !lista.length ? (
              <p className="text-xs text-stone-500 py-6 text-center">Nenhuma pesquisa ainda. Crie a primeira em "Nova pesquisa".</p>
            ) : (
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-left text-[11px] text-stone-500 border-b border-stone-200 dark:border-stone-800">
                    <th className="py-2 px-2 text-center">Criada em</th>
                    <th className="py-2 px-2">Descrição</th>
                    <th className="py-2 px-2">Contato</th>
                    <th className="py-2 px-2">Situação</th>
                    <th className="py-2 px-2 text-right">Filtrados</th>
                    <th className="py-2 px-2 text-right">Selecionados</th>
                    <th className="py-2 px-2 text-right">Respondidos</th>
                    <th className="py-2 px-2 text-right">Nota média</th>
                    <th className="py-2 px-2 text-right">Ações</th>
                  </tr>
                </thead>
                <tbody>
                  {lista.map((p) => (
                    <tr key={p.id} onClick={() => abrir(p.id, p.selecionados ? 'selecionados' : 'filtro')} className="border-b border-stone-100 dark:border-stone-800/70 hover:bg-stone-50 dark:hover:bg-stone-800/40 cursor-pointer">
                      <td className="py-2 px-2 text-center">{formatDateBR(p.criado_em)}</td>
                      <td className="py-2 px-2 font-semibold">{p.descricao}</td>
                      <td className="py-2 px-2">{rotuloCanal(p.canal)}</td>
                      <td className="py-2 px-2"><Etiqueta par={SITUACAO_PESQUISA[p.situacao]} /></td>
                      <td className="py-2 px-2 text-right">{p.total_filtrados ?? '—'}</td>
                      <td className="py-2 px-2 text-right">{p.selecionados}</td>
                      <td className="py-2 px-2 text-right">{p.respondidos}</td>
                      <td className="py-2 px-2 text-right">{p.media == null ? '—' : p.media.toLocaleString('pt-BR')}</td>
                      <td className="py-2 px-2 text-right" onClick={(e) => e.stopPropagation()}>
                        <button type="button" onClick={() => abrir(p.id)} title="Abrir o filtro" className="p-1.5 rounded-lg text-stone-500 hover:bg-stone-100 dark:hover:bg-stone-800 cursor-pointer">
                          <Eye className="w-4 h-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => setConcluindo(p)}
                          disabled={p.situacao === 'concluida' || p.situacao === 'cancelada'}
                          title={p.situacao === 'concluida' || p.situacao === 'cancelada' ? 'A pesquisa já está encerrada' : 'Concluir: encerra a pesquisa mesmo com gente sem responder'}
                          className="p-1.5 rounded-lg text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-950/40 cursor-pointer disabled:opacity-30 disabled:cursor-default disabled:hover:bg-transparent"
                        >
                          <CircleCheck className="w-4 h-4" />
                        </button>
                        <button type="button" onClick={() => setExcluindo(p)} title="Excluir a pesquisa" className="p-1.5 rounded-lg text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40 cursor-pointer">
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}

        {/* ---------------- Filtro ---------------- */}
        {aba === 'filtro' && (
          <div className="max-w-4xl space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className={`${FIELD_CLASS} sm:col-span-2`}>
                <label htmlFor="ps-descricao" className={LABEL_CLASS}>Descrição<span className="text-rose-500 ml-1">*</span></label>
                <input id="ps-descricao" autoFocus={!atual} value={v.descricao} onChange={(e) => setV({ ...v, descricao: e.target.value })} onFocus={(e) => e.target.select()} maxLength={150} required className={`${INPUT_CLASS} w-full`} />
              </div>
              <div className={FIELD_CLASS}>
                <label htmlFor="ps-canal" className={LABEL_CLASS}>Tipo de contato</label>
                <SelectAuto id="ps-canal" value={v.canal} disabled={Boolean(atual && atual.situacao !== 'rascunho')} onChange={(e) => setV({ ...v, canal: e.target.value as CanalPesquisa })} className={`${INPUT_CLASS} w-full cursor-pointer`}>
                  {CANAIS.map((c) => (
                    <option key={c.value} value={c.value}>{c.label}</option>
                  ))}
                </SelectAuto>
              </div>
              <div className={`${FIELD_CLASS} sm:col-span-3`}>
                <label htmlFor="ps-objetivo" className={LABEL_CLASS}>Objetivo</label>
                <textarea id="ps-objetivo" rows={2} value={v.objetivo ?? ''} onChange={(e) => setV({ ...v, objetivo: e.target.value })} maxLength={4000} placeholder="O que a pesquisa quer descobrir (ex.: se o problema foi resolvido e como foi o tempo de resposta)" className={`${INPUT_CLASS} w-full resize-y`} />
                <span className={HINT_CLASS}>Vai para a IA (WhatsApp e e-mail) e para o roteiro de quem liga. A nota é sempre de 1 a 5.</span>
              </div>
              {v.canal === 'whatsapp' && (
                <div className={FIELD_CLASS}>
                  <label htmlFor="ps-conta" className={LABEL_CLASS}>Sai pelo</label>
                  <SelectAuto id="ps-conta" value={v.conta} disabled={Boolean(atual && atual.situacao !== 'rascunho')} onChange={(e) => setV({ ...v, conta: e.target.value as DadosPesquisa['conta'] })} className={`${INPUT_CLASS} w-full cursor-pointer`}>
                    <option value="campanhas">WhatsApp das campanhas</option>
                    <option value="provedor">WhatsApp principal</option>
                  </SelectAuto>
                  <span className={HINT_CLASS}>Sem o WhatsApp das campanhas configurado, sai pelo principal</span>
                </div>
              )}
              {v.canal === 'ligacao' && (
                <div className={FIELD_CLASS}>
                  <label htmlFor="ps-responsavel" className={LABEL_CLASS}>Quem liga</label>
                  <SelectAuto id="ps-responsavel" value={v.responsavel_id ?? ''} onChange={(e) => setV({ ...v, responsavel_id: Number(e.target.value) || null })} className={`${INPUT_CLASS} w-full cursor-pointer`}>
                    <option value="">O técnico de cada atendimento</option>
                    {opcoes.usuarios.filter((u) => !u.label.endsWith('(inativo)')).map((u) => (
                      <option key={u.value} value={u.value}>{u.label}</option>
                    ))}
                  </SelectAuto>
                </div>
              )}
            </div>

            {filtroTravado && (
              <p className="text-xs text-amber-800 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/40 rounded-lg px-3 py-2">
                A pesquisa já foi sorteada: o filtro não muda mais. Para sortear mais atendimentos com ele, use "Sortear +x" em Atendimentos Selecionados; para outro filtro, crie outra pesquisa.
              </p>
            )}
            <fieldset disabled={filtroTravado} className={`min-w-0 border-0 p-0 m-0 pt-3 border-t border-stone-200 dark:border-stone-800 grid grid-cols-1 sm:grid-cols-4 gap-4 ${filtroTravado ? 'opacity-60' : ''}`}>
              <div className={FIELD_CLASS}>
                <label htmlFor="ps-de" className={LABEL_CLASS}>Atendidos de</label>
                <DateField id="ps-de" value={f.data_de ?? ''} onChange={(d) => setFiltro({ data_de: d || null })} className={`${INPUT_CLASS} w-full`} />
              </div>
              <div className={FIELD_CLASS}>
                <label htmlFor="ps-ate" className={LABEL_CLASS}>Até</label>
                <DateField id="ps-ate" value={f.data_ate ?? ''} onChange={(d) => setFiltro({ data_ate: d || null })} className={`${INPUT_CLASS} w-full`} />
              </div>
              <div className={`${FIELD_CLASS} sm:col-span-2`}>
                <span className={LABEL_CLASS}>Atendimentos</span>
                <div className="flex flex-wrap gap-4 pt-1.5">
                  <Toggle size="sm" checked={!f.origens?.length || f.origens.includes('chamado')} onChange={() => setFiltro({ origens: alternar(f.origens?.length ? f.origens : ['chamado', 'whatsapp'], 'chamado') })} label="Chamados" />
                  <Toggle size="sm" checked={!f.origens?.length || f.origens.includes('whatsapp')} onChange={() => setFiltro({ origens: alternar(f.origens?.length ? f.origens : ['chamado', 'whatsapp'], 'whatsapp') })} label="WhatsApp" />
                </div>
              </div>
              <div className={`${FIELD_CLASS} sm:col-span-4`}>
                <span className={LABEL_CLASS}>Nota da avaliação do atendimento</span>
                <div className="flex flex-wrap items-center gap-1.5">
                  {[1, 2, 3, 4, 5].map((n) => (
                    <button
                      key={n}
                      type="button"
                      onClick={() => setFiltro({ notas: alternar(f.notas, n) })}
                      aria-pressed={f.notas?.includes(n)}
                      className={`px-3 py-1.5 rounded-lg text-xs font-semibold border cursor-pointer ${
                        f.notas?.includes(n) ? 'bg-blue-600 border-blue-600 text-white' : 'border-stone-300 dark:border-stone-700 text-stone-600 dark:text-stone-300 hover:bg-stone-100 dark:hover:bg-stone-800'
                      }`}
                    >
                      {n} {'⭐'.repeat(n)}
                    </button>
                  ))}
                  {Boolean(f.notas?.length) && <Toggle size="sm" checked={Boolean(f.sem_nota)} onChange={(x) => setFiltro({ sem_nota: x })} label="e os sem avaliação" />}
                </div>
                <span className={HINT_CLASS}>Nenhuma marcada = qualquer nota, com ou sem avaliação</span>
              </div>
              <div className="sm:col-span-2">
                <Multipla rotulo="Segmentos do cliente" opcoes={opcoes.segmentos} valor={f.segmentos} onChange={(x) => setFiltro({ segmentos: x })} vazio="Todos — acrescentar segmento" />
              </div>
              <div className="sm:col-span-2">
                <Clientes valor={f.pessoas} nomes={nomesClientes} onChange={(x, nomes) => (setNomesClientes(nomes), setFiltro({ pessoas: x }))} />
              </div>
              <div className="sm:col-span-2">
                <Multipla rotulo="Técnicos" opcoes={opcoes.usuarios} valor={f.atendentes} onChange={(x) => setFiltro({ atendentes: x })} vazio="Todos — acrescentar técnico" />
              </div>
              <div className="sm:col-span-2">
                <Multipla rotulo="Departamentos" opcoes={opcoes.departamentos} valor={f.departamentos} onChange={(x) => setFiltro({ departamentos: x })} vazio="Todos — acrescentar departamento" />
              </div>
              <div className="sm:col-span-2">
                <Multipla rotulo="Categorias de chamado" opcoes={opcoes.categorias} valor={f.categorias} onChange={(x) => setFiltro({ categorias: x })} vazio="Todas — acrescentar categoria" />
              </div>
              <div className={FIELD_CLASS}>
                <label htmlFor="ps-excluir" className={LABEL_CLASS}>Não repetir cliente (dias)</label>
                <NumberField id="ps-excluir" value={String(f.excluir_dias ?? 0)} onChange={(t) => setFiltro({ excluir_dias: Number(t) || 0 })} scale={0} className={`${INPUT_CLASS} w-full`} />
                <span className={HINT_CLASS}>Pesquisado há menos que isso fica de fora. 0 = pode repetir</span>
              </div>
              <div className={FIELD_CLASS}>
                <label htmlFor="ps-qtd" className={LABEL_CLASS}>Quantos sortear</label>
                <NumberField id="ps-qtd" value={String(v.quantidade)} onChange={(t) => setV({ ...v, quantidade: Number(t) || 0 })} scale={0} className={`${INPUT_CLASS} w-full`} />
              </div>
            </fieldset>

            <div className="flex flex-wrap items-center gap-2 pt-2">
              <button type="button" disabled={ocupado !== null} onClick={() => acao('previa', async () => setPrevia((await previaPesquisa(f, atual?.id)).filtrados))} className={botaoSecundario}>
                {ocupado === 'previa' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Eye className="w-4 h-4" />} Ver quantos o filtro acha
              </button>
              <button
                type="button"
                disabled={ocupado !== null}
                onClick={() =>
                  acao('salvar', async () => {
                    const id = await gravar();
                    onToast('Pesquisa gravada.');
                    carregarLista();
                    await abrir(id, 'filtro');
                  })
                }
                className={botaoSecundario}
              >
                {ocupado === 'salvar' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} Salvar
              </button>
              {podeSortear && !filtroTravado && (
                <button
                  type="button"
                  disabled={ocupado !== null}
                  onClick={() =>
                    acao('sortear', async () => {
                      const id = await gravar();
                      const r = await sortearPesquisa(id);
                      onToast(`${r.sorteados} de ${r.filtrados} atendimento(s) sorteado(s).`);
                      carregarLista();
                      await abrir(id, 'selecionados');
                    })
                  }
                  className={botaoPrimario}
                >
                  {ocupado === 'sortear' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Dices className="w-4 h-4" />} Salvar e sortear {v.quantidade || ''}
                </button>
              )}
              {previa !== null && <span className="text-xs text-stone-600 dark:text-stone-300">O filtro acha <strong>{previa}</strong> atendimento(s) ainda não sorteado(s) nesta pesquisa.</span>}
            </div>
          </div>
        )}

        {/* ---------------- Atendimentos Selecionados ---------------- */}
        {aba === 'selecionados' && atual && (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <Etiqueta par={SITUACAO_PESQUISA[atual.situacao]} />
              <span className="text-xs text-stone-500">
                {rotuloCanal(atual.canal)} • {itens.filter((i) => i.selecionado).length} selecionado(s) • {aguardando} aguardando contato • {itens.filter((i) => i.situacao === 'respondido').length} respondido(s)
              </span>
              <div className="flex-1" />
              {podeSortear && (
                <div className="flex items-stretch gap-1.5">
                  <NumberField value={mais} onChange={setMais} scale={0} className={`${INPUT_CLASS} w-20 text-right`} />
                  <button
                    type="button"
                    disabled={ocupado !== null}
                    onClick={() =>
                      acao('mais', async () => {
                        const r = await sortearPesquisa(atual.id, Number(mais) || 0);
                        onToast(`+${r.sorteados} atendimento(s) sorteado(s) (o filtro ainda achava ${r.filtrados}).`);
                        carregarLista();
                        await recarregarAtual();
                      })
                    }
                    className={botaoSecundario}
                  >
                    {ocupado === 'mais' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Dices className="w-4 h-4" />} Sortear +{Number(mais) || 0}
                  </button>
                </div>
              )}
              <button type="button" disabled={ocupado !== null || !aguardando} onClick={() => setExecutando(true)} className={botaoPrimario}>
                {ocupado === 'executar' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />} Executar ({aguardando})
              </button>
            </div>

            {!itens.length ? (
              <p className="text-xs text-stone-500 py-6 text-center">Nenhum atendimento sorteado. Volte ao Filtro e clique em "Salvar e sortear".</p>
            ) : (
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-left text-[11px] text-stone-500 border-b border-stone-200 dark:border-stone-800">
                    <th className="py-2 px-2">Selecionado</th>
                    <th className="py-2 px-2 text-right">Lote</th>
                    <th className="py-2 px-2 text-center">Atendido em</th>
                    <th className="py-2 px-2">Atendimento</th>
                    <th className="py-2 px-2">Cliente</th>
                    <th className="py-2 px-2">Técnico</th>
                    <th className="py-2 px-2">Situação</th>
                    <th className="py-2 px-2 text-right">Nota</th>
                    <th className="py-2 px-2">Retorno do cliente</th>
                    <th className="py-2 px-2 text-right">Ações</th>
                  </tr>
                </thead>
                <tbody>
                  {itens.map((i: ItemPesquisa) => (
                    <tr key={i.id} className={`border-b border-stone-100 dark:border-stone-800/70 align-top ${i.selecionado ? '' : 'opacity-50'}`}>
                      <td className="py-2 px-2">
                        <Toggle
                          size="sm"
                          checked={i.selecionado}
                          disabled={i.situacao !== 'sorteado'}
                          title={i.situacao !== 'sorteado' ? 'Já contatado' : i.selecionado ? 'Não contatar este' : 'Contatar este'}
                          onChange={(x) => acao('marcar', async () => (await marcarItemPesquisa(i.id, x), await recarregarAtual()))}
                        />
                      </td>
                      <td className="py-2 px-2 text-right">{i.lote}</td>
                      <td className="py-2 px-2 text-center whitespace-nowrap">{i.data_atendimento ? formatDateTimeBR(i.data_atendimento) : '—'}</td>
                      <td className="py-2 px-2">{i.assunto}</td>
                      <td className="py-2 px-2">
                        {i.pessoa_nome ?? '—'}
                        <Contato canal={atual.canal} item={i} />
                      </td>
                      <td className="py-2 px-2">{i.atendente_nome ?? 'Bot'}</td>
                      <td className="py-2 px-2 whitespace-nowrap">
                        <Etiqueta par={SITUACAO_ITEM[i.situacao]} />
                        {i.precisa_retorno && <div className="text-[10px] font-semibold text-amber-700 dark:text-amber-300 mt-0.5">Tarefa de retorno criada</div>}
                      </td>
                      <td className="py-2 px-2 text-right whitespace-nowrap">{i.nota ? `${i.nota} ${'⭐'.repeat(i.nota)}` : '—'}</td>
                      <td className="py-2 px-2 max-w-[40ch]">
                        {i.resumo && <div className="text-stone-700 dark:text-stone-200">{i.resumo}</div>}
                        {i.comentario && i.comentario !== i.resumo && <div className="text-[11px] text-stone-500 italic">"{i.comentario}"</div>}
                        {i.registrado_por_nome && <div className="text-[10px] text-stone-400">registrado por {i.registrado_por_nome}</div>}
                      </td>
                      <td className="py-2 px-2 text-right whitespace-nowrap">
                        {i.atividade_id && Number(i.executor_bot) === 1 && <BotaoConversaBot atividadeId={i.atividade_id} />}
                        {atual.canal === 'ligacao' && i.situacao === 'enviado' && (
                          <button type="button" onClick={() => setRetorno(i.id)} title="Registrar o retorno da ligação" className="p-1.5 rounded-lg text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-950/40 cursor-pointer">
                            <Phone className="w-4 h-4" />
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}
      </div>

      {concluindo && (
        <ConfirmDialog
          titulo="Concluir a pesquisa?"
          mensagem={`"${concluindo.descricao}" fica concluída e ninguém mais é contatado. Quem já foi contatado e responder depois ainda tem a resposta gravada.`}
          confirmar="Concluir"
          tom="normal"
          onConfirmar={async () => {
            await concluirPesquisa(concluindo.id);
            setConcluindo(null);
            onToast('Pesquisa concluída.');
            carregarLista();
          }}
          onCancelar={() => setConcluindo(null)}
        />
      )}
      {excluindo && (
        <ConfirmDialog
          titulo="Excluir a pesquisa?"
          mensagem={`"${excluindo.descricao}" e os atendimentos sorteados dela saem de vez (as atividades e tarefas já criadas continuam).`}
          confirmar="Excluir"
          onConfirmar={async () => {
            await excluirPesquisa(excluindo.id);
            if (atual?.id === excluindo.id) nova();
            setExcluindo(null);
            setAba('pesquisas');
            onToast('Pesquisa excluída.');
            carregarLista();
          }}
          onCancelar={() => setExcluindo(null)}
        />
      )}
      {executando && atual && (
        <ConfirmDialog
          titulo={`Executar a pesquisa "${atual.descricao}"?`}
          mensagem={
            atual.canal === 'ligacao'
              ? `Cria ${aguardando} atividade(s) de ligação para quem vai ligar.`
              : atual.canal === 'whatsapp'
                ? `O Bot vai conversar pelo WhatsApp com ${aguardando} cliente(s) (a primeira mensagem sai em até 1 minuto).`
                : `Envia ${aguardando} e-mail(s) agora; as respostas são lidas da caixa de entrada.`
          }
          confirmar="Executar"
          tom="normal"
          onConfirmar={async () => {
            setOcupado('executar');
            try {
              const r = await executarPesquisa(atual.id);
              setExecutando(false);
              onToast(r.falhas ? `${r.executados} contatado(s); ${r.falhas} com falha: ${r.erro}` : `${r.executados} atendimento(s) contatado(s).`);
              carregarLista();
              await recarregarAtual();
            } finally {
              setOcupado(null);
            }
          }}
          onCancelar={() => setExecutando(false)}
        />
      )}
      {retorno !== null && (
        <RetornoLigacao
          itemId={retorno}
          onFechar={() => setRetorno(null)}
          onGravado={() => {
            setRetorno(null);
            onToast('Retorno registrado.');
            carregarLista();
            recarregarAtual();
          }}
        />
      )}
    </div>
  );
};

