import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { SelectAuto } from './SelectAuto';
import { TrocarProprietario } from './TrocarProprietario';
import { CalendarPlus, Check, FileText, KanbanSquare, Loader2, Plus, Search, ThumbsDown, ThumbsUp, X } from 'lucide-react';
import { CardNegocio, Funil, Id, OpcaoRef, ResourceDef } from '../types';
import {
  createRecord,
  criarFunilPadrao,
  fetchFunis,
  fetchKanban,
  fetchOptions,
  invalidateOptions,
  moverNegocio,
  mudarStatusNegocio,
  updateRecord,
} from '../services/api';
import { formatMoeda } from '../utils/formatters';
import { INPUT_CLASS, LABEL_CLASS, FIELD_CLASS } from '../utils/formStyles';
import { COR_SEMAFORO, iconeAtividade, quando, semaforoFollowup } from '../utils/crm';
import { AtividadeModal } from './AtividadeModal';
import { SelectBusca } from './SelectBusca';
import { ConfirmDialog } from './ConfirmDialog';
import { DateField } from './DateField';
import { NegocioFicha } from './NegocioFicha';
import { NumberField } from './NumberField';
import { AvisoErro } from './AvisoErro';

interface KanbanProps {
  /** Metadados de negócios (formulário "Editar" da ficha) */
  resourceNegocios?: ResourceDef;
  refreshToken: number;
  onToast: (msg: string) => void;
  /** Ficha do negócio: abre a tela Conversas (atividade WhatsApp ou a pessoa do negócio) */
  onConversar?: (de: { atividadeId?: Id; pessoaId?: Id }) => void;
}

const CHAVE_FUNIL = 'crmweb_funil_atual';
const lerFunilSalvo = () => {
  try {
    return localStorage.getItem(CHAVE_FUNIL);
  } catch {
    return null;
  }
};

export const Kanban: React.FC<KanbanProps> = ({ resourceNegocios, refreshToken, onToast, onConversar }) => {
  const [funis, setFunis] = useState<Funil[] | null>(null);
  const [funilId, setFunilId] = useState<Id | null>(lerFunilSalvo);
  const [cards, setCards] = useState<CardNegocio[]>([]);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [filtro, setFiltro] = useState('');

  const [arrastando, setArrastando] = useState<Id | null>(null);
  /** Etapa (id) ou status ('ganho'/'perdido') sob o card arrastado */
  const [alvo, setAlvo] = useState<Id | null>(null);
  const [fichaId, setFichaId] = useState<Id | null>(null);
  const [novo, setNovo] = useState(false);
  const [perdendo, setPerdendo] = useState<CardNegocio | null>(null);
  const [motivo, setMotivo] = useState('');
  const [agendarPara, setAgendarPara] = useState<CardNegocio | null>(null);

  const funil = funis?.find((f) => String(f.id) === String(funilId)) || funis?.[0] || null;

  const carregarFunis = useCallback(async () => {
    try {
      setFunis(await fetchFunis());
    } catch (err: any) {
      setErro(err.message);
      setFunis([]);
    }
  }, []);

  const carregarCards = useCallback(async () => {
    if (!funil) return;
    setCarregando(true);
    try {
      setCards(await fetchKanban(funil.id));
      setErro(null);
    } catch (err: any) {
      setErro(err.message);
    } finally {
      setCarregando(false);
    }
  }, [funil?.id]);

  useEffect(() => {
    carregarFunis();
  }, [carregarFunis, refreshToken]);

  useEffect(() => {
    carregarCards();
  }, [carregarCards, refreshToken]);


  const escolherFunil = (id: Id) => {
    setFunilId(id);
    try {
      localStorage.setItem(CHAVE_FUNIL, String(id));
    } catch {
      // preferência só desta sessão
    }
  };

  /** Ação que altera o banco: erro vira aviso e o Kanban é relido do servidor */
  const executar = async (fn: () => Promise<unknown>, msg?: string) => {
    try {
      await fn();
      if (msg) onToast(msg);
    } catch (err: any) {
      setErro(err.message || 'Não foi possível concluir a ação.');
    }
    await carregarCards();
  };

  const soltarNaEtapa = (etapaId: Id) => {
    const id = arrastando;
    setArrastando(null);
    setAlvo(null);
    const card = cards.find((c) => c.id === id);
    if (!card || card.etapa_id === etapaId) return;
    // Otimista: o card muda de coluna na hora; a releitura confirma
    setCards((lista) => lista.map((c) => (c.id === id ? { ...c, etapa_id: etapaId } : c)));
    executar(() => moverNegocio(card.id, etapaId));
  };

  const soltarNoStatus = (status: 'ganho' | 'perdido') => {
    const card = cards.find((c) => c.id === arrastando);
    setArrastando(null);
    setAlvo(null);
    if (!card) return;
    if (status === 'perdido') {
      setMotivo('');
      setPerdendo(card);
      return;
    }
    setCards((lista) => lista.filter((c) => c.id !== card.id));
    executar(() => mudarStatusNegocio(card.id, 'ganho'), `"${card.titulo}" marcado como ganho.`);
  };

  const concluirProxima = async (card: CardNegocio) => {
    if (!card.prox_id) return;
    await executar(() => updateRecord('atividades', card.prox_id!, { concluida: 1 }), 'Atividade concluída.');
    // Sem mais nada agendado: já oferece o próximo follow-up, para o negócio não ficar parado
    if (card.pendentes <= 1) setAgendarPara(card);
  };

  const termo = filtro.trim().toLowerCase();
  const visiveis = useMemo(
    () =>
      termo
        ? cards.filter((c) => [c.titulo, c.pessoa_nome, c.proprietario_nome].some((t) => t?.toLowerCase().includes(termo)))
        : cards,
    [cards, termo],
  );
  const totalFunil = visiveis.reduce((s, c) => s + c.valor, 0);

  // ------------------------------------------------------------
  // Sem funil cadastrado
  // ------------------------------------------------------------
  if (funis && !funis.length) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-3 p-10 text-center">
        <KanbanSquare className="w-10 h-10 text-stone-300" />
        <p className="text-sm font-semibold text-stone-700 dark:text-stone-200">Nenhum funil de vendas ativo</p>
        <p className="text-xs text-stone-500 max-w-sm">
          Cadastre um funil e suas etapas em <strong>Cadastros › Funis de Vendas</strong>, ou crie um funil padrão com as
          etapas Prospecção, Qualificação, Proposta Enviada, Negociação e Fechamento.
        </p>
        {erro && <p className="text-xs text-rose-600">{erro}</p>}
        <button
          onClick={async () => {
            try {
              const { id } = await criarFunilPadrao();
              invalidateOptions();
              escolherFunil(id);
              onToast('Funil padrão criado.');
              await carregarFunis();
            } catch (err: any) {
              setErro(err.message);
            }
          }}
          className="flex items-center gap-1.5 px-4 py-2.5 rounded-lg text-xs font-semibold bg-blue-600 hover:bg-blue-700 text-white cursor-pointer"
        >
          <Plus className="w-4 h-4" /> Criar funil padrão
        </button>
      </div>
    );
  }

  // ------------------------------------------------------------
  // Negócio aberto: mesma tela da edição em "Negócios" (aba + ficha na área toda)
  // ------------------------------------------------------------
  if (fichaId) {
    const titulo = cards.find((c) => String(c.id) === String(fichaId))?.titulo || 'Negócio';
    return (
      <div className="flex-1 flex flex-col min-h-0">
        <div className="flex items-stretch bg-stone-100 dark:bg-stone-950 border-b border-stone-200 dark:border-stone-800 overflow-x-auto overflow-y-hidden shrink-0">
          <button
            onClick={() => setFichaId(null)}
            className="flex items-center gap-2 px-4 py-2.5 text-xs font-semibold whitespace-nowrap border-r border-stone-200 dark:border-stone-800 border-b-2 border-b-transparent text-stone-600 dark:text-stone-400 hover:bg-stone-200/60 dark:hover:bg-stone-800/60 transition-colors cursor-pointer"
          >
            <KanbanSquare className="w-3.5 h-3.5" />
            <span>{funil?.nome || 'Funil de Vendas'}</span>
          </button>
          <div className="flex items-center gap-1.5 pl-4 pr-2 border-r border-stone-200 dark:border-stone-800 border-b-2 bg-white dark:bg-stone-900 border-b-blue-600">
            <span className="flex items-center gap-2 py-2.5 text-xs font-semibold whitespace-nowrap text-blue-700 dark:text-blue-400">
              <FileText className="w-3.5 h-3.5" />
              {titulo}
            </span>
            <button
              onClick={() => setFichaId(null)}
              title="Fechar aba"
              className="p-1 rounded text-stone-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:text-rose-400 dark:hover:bg-rose-950/40 transition-colors cursor-pointer shrink-0"
            >
              <X className="w-3 h-3" />
            </button>
          </div>
        </div>
        <div className="flex-1 flex flex-col min-h-0 bg-white dark:bg-stone-900">
          <NegocioFicha
            negocioId={fichaId}
            resource={resourceNegocios}
            onFechar={() => setFichaId(null)}
            onAlterado={carregarCards}
            onToast={onToast}
            onConversar={onConversar}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* Barra de ferramentas */}
      <div className="px-4 py-2.5 border-b border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-900 flex flex-wrap items-center gap-3 shrink-0">
        <SelectAuto
          value={funil?.id || ''}
          onChange={(e) => escolherFunil(e.target.value)}
          title="Funil de vendas"
          className={`${INPUT_CLASS} cursor-pointer font-semibold`}
        >
          {funis?.map((f) => (
            <option key={f.id} value={f.id}>
              {f.nome}
            </option>
          ))}
        </SelectAuto>
        <div className="relative w-56">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-stone-400 pointer-events-none" />
          <input value={filtro} onChange={(e) => setFiltro(e.target.value)} placeholder="Filtrar negócios…" className={`${INPUT_CLASS} w-full pl-9`} />
        </div>
        <span className="text-[11px] text-stone-500 dark:text-stone-400">
          {visiveis.length} negócio(s) • <strong className="font-mono text-stone-700 dark:text-stone-200">{formatMoeda(totalFunil)}</strong>
        </span>
        <div className="hidden md:flex items-center gap-3 text-[11px] text-stone-500 dark:text-stone-400">
          {(['verde', 'vermelho', 'amarelo'] as const).map((s) => (
            <span key={s} className="flex items-center gap-1">
              <span className={`w-2 h-2 rounded-full ${COR_SEMAFORO[s].ponto}`} /> {COR_SEMAFORO[s].rotulo}
            </span>
          ))}
        </div>
        {carregando && <Loader2 className="w-4 h-4 animate-spin text-stone-400" />}
        <button onClick={() => setNovo(true)} className="ml-auto flex items-center gap-1.5 bg-blue-600 hover:bg-blue-700 text-white px-3 py-2 rounded-lg text-xs font-semibold cursor-pointer">
          <Plus className="w-3.5 h-3.5" /> Negócio
        </button>
      </div>

      {erro && (
        <AvisoErro mensagem={erro} onFechar={() => setErro(null)} className="mx-4 mt-3 shrink-0" />
      )}

      {/* Colunas */}
      <div className="flex-1 min-h-0 overflow-x-auto overflow-y-hidden">
        <div className="h-full flex gap-3 p-4 w-max">
          {funil?.etapas.map((etapa) => {
            const daEtapa = visiveis.filter((c) => c.etapa_id === etapa.id);
            const soma = daEtapa.reduce((s, c) => s + c.valor, 0);
            return (
              <section
                key={etapa.id}
                onDragOver={(e) => {
                  if (!arrastando) return;
                  e.preventDefault();
                  if (alvo !== etapa.id) setAlvo(etapa.id);
                }}
                onDragLeave={(e) => {
                  if (!e.currentTarget.contains(e.relatedTarget as Node)) setAlvo(null);
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  soltarNaEtapa(etapa.id);
                }}
                className={`w-72 shrink-0 h-full flex flex-col rounded-xl border transition-colors ${
                  alvo === etapa.id
                    ? 'bg-blue-50 border-blue-300 dark:bg-blue-950/30 dark:border-blue-800'
                    : 'bg-stone-100/80 border-stone-200 dark:bg-stone-900/60 dark:border-stone-800'
                }`}
                style={etapa.cor ? { borderTopColor: etapa.cor, borderTopWidth: 4 } : undefined}
              >
                <header className="px-3 py-2.5 border-b border-stone-200 dark:border-stone-800 shrink-0">
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="text-xs font-bold text-stone-800 dark:text-stone-100 truncate">{etapa.nome}</h3>
                    <span className="text-[10px] text-stone-400 shrink-0" title="Probabilidade de fechamento">{Number(etapa.probabilidade)}%</span>
                  </div>
                  <div className="text-[11px] text-stone-500 dark:text-stone-400">
                    <strong className="font-mono text-stone-700 dark:text-stone-200">{formatMoeda(soma)}</strong> • {daEtapa.length} negócio(s)
                  </div>
                </header>
                <div className="flex-1 overflow-y-auto p-2 space-y-2">
                  {daEtapa.map((c) => (
                    <Card
                      key={c.id}
                      card={c}
                      arrastado={arrastando === c.id}
                      onArrastar={() => setArrastando(c.id)}
                      onSoltar={() => {
                        setArrastando(null);
                        setAlvo(null);
                      }}
                      onAbrir={() => setFichaId(c.id)}
                      onConcluir={() => concluirProxima(c)}
                      onAgendar={() => setAgendarPara(c)}
                      onTrocarProprietario={(id) =>
                        executar(() => updateRecord('negocios', c.id, { proprietario_id: id }), 'Proprietário alterado.')
                      }
                    />
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      </div>

      {/* Zonas de Ganho/Perdido, visíveis enquanto um card é arrastado */}
      {arrastando && (
        <div className="fixed bottom-0 inset-x-0 lg:left-64 z-30 grid grid-cols-2 gap-3 p-3 bg-white/90 dark:bg-stone-900/90 backdrop-blur border-t border-stone-200 dark:border-stone-800">
          {(
            [
              ['perdido', 'Perdido', ThumbsDown, 'border-rose-300 text-rose-700 bg-rose-50 dark:bg-rose-950/40 dark:border-rose-800 dark:text-rose-300'],
              ['ganho', 'Ganho', ThumbsUp, 'border-emerald-300 text-emerald-700 bg-emerald-50 dark:bg-emerald-950/40 dark:border-emerald-800 dark:text-emerald-300'],
            ] as const
          ).map(([status, rotulo, Icone, cor]) => (
            <div
              key={status}
              onDragOver={(e) => {
                e.preventDefault();
                setAlvo(status);
              }}
              onDragLeave={() => setAlvo(null)}
              onDrop={(e) => {
                e.preventDefault();
                soltarNoStatus(status);
              }}
              className={`h-16 rounded-xl border-2 border-dashed flex items-center justify-center gap-2 text-sm font-bold transition-transform ${cor} ${alvo === status ? 'scale-[1.02]' : ''}`}
            >
              <Icone className="w-5 h-5" /> {rotulo}
            </div>
          ))}
        </div>
      )}

      {novo && funil && (
        <NovoNegocioModal
          funil={funil}
          onFechar={() => setNovo(false)}
          onCriado={(id) => {
            setNovo(false);
            onToast('Negócio incluído.');
            invalidateOptions('negocios');
            carregarCards();
            setFichaId(id);
          }}
        />
      )}

      {agendarPara && (
        <AtividadeModal
          negocioId={agendarPara.id}
          pessoaId={agendarPara.pessoa_id}
          contexto={`Próximo follow-up • ${agendarPara.titulo}`}
          onFechar={() => setAgendarPara(null)}
          onGravada={() => {
            setAgendarPara(null);
            onToast('Atividade agendada.');
            carregarCards();
          }}
        />
      )}

      {perdendo && (
        <ConfirmDialog
          titulo="Marcar negócio como perdido?"
          mensagem={<><strong>{perdendo.titulo}</strong> sai do funil. Informe o motivo da perda.</>}
          confirmar="Marcar como perdido"
          onConfirmar={async () => {
            if (!motivo.trim()) throw new Error('Informe o motivo da perda.');
            await mudarStatusNegocio(perdendo.id, 'perdido', motivo.trim());
            onToast(`"${perdendo.titulo}" marcado como perdido.`);
            setPerdendo(null);
            await carregarCards();
          }}
          onCancelar={() => setPerdendo(null)}
        >
          <input autoFocus value={motivo} onChange={(e) => setMotivo(e.target.value)} maxLength={255} placeholder="Ex.: preço, prazo, escolheu concorrente…" className={`${INPUT_CLASS} w-full`} />
        </ConfirmDialog>
      )}
    </div>
  );
};

// ------------------------------------------------------------
// Card do negócio
// ------------------------------------------------------------
const Card: React.FC<{
  card: CardNegocio;
  arrastado: boolean;
  onArrastar: () => void;
  onSoltar: () => void;
  onAbrir: () => void;
  onConcluir: () => void;
  onAgendar: () => void;
  onTrocarProprietario: (usuarioId: string) => Promise<void>;
}> = ({ card: c, arrastado, onArrastar, onSoltar, onAbrir, onConcluir, onAgendar, onTrocarProprietario }) => {
  const semaforo = semaforoFollowup(c.prox_data, c.prox_hora);
  const cor = COR_SEMAFORO[semaforo];
  const Icone = iconeAtividade(c.prox_tipo);
  return (
    <article
      draggable
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', String(c.id));
        onArrastar();
      }}
      onDragEnd={onSoltar}
      onClick={onAbrir}
      className={`group bg-white dark:bg-stone-800 rounded-lg border border-stone-200 dark:border-stone-700 p-2.5 shadow-xs hover:shadow-md hover:border-blue-300 dark:hover:border-blue-700 cursor-pointer transition-all ${
        arrastado ? 'opacity-40' : ''
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <h4 className="text-xs font-semibold text-stone-800 dark:text-stone-100 leading-snug line-clamp-2">{c.titulo}</h4>
        <span className={`mt-1 w-2.5 h-2.5 rounded-full shrink-0 ${cor.ponto}`} title={cor.rotulo} />
      </div>
      {c.pessoa_nome && <p className="text-[11px] text-stone-500 dark:text-stone-400 truncate mt-0.5">{c.pessoa_nome}</p>}
      <div className="flex items-center justify-between gap-2 mt-1">
        <p className="text-xs font-bold font-mono text-stone-700 dark:text-stone-200">{formatMoeda(c.valor, c.moeda)}</p>
        {/* Clique na etiqueta troca o proprietário sem abrir a ficha */}
        <TrocarProprietario
          proprietarioId={c.proprietario_id}
          onEscolher={onTrocarProprietario}
          title={c.proprietario_nome ? `Proprietário: ${c.proprietario_nome} (clique para trocar)` : 'Sem proprietário (clique para escolher)'}
          className="shrink-0 rounded-full cursor-pointer hover:ring-2 hover:ring-blue-300 dark:hover:ring-blue-700"
        >
          {c.proprietario_nome ? (
            // Iniciais do proprietário; o nome completo no título
            <span
              className="shrink-0 w-5 h-5 rounded-full bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-200 text-[9px] font-bold flex items-center justify-center"
            >
              {c.proprietario_nome
                .split(/\s+/)
                .filter(Boolean)
                .slice(0, 2)
                .map((p) => p[0].toUpperCase())
                .join('')}
            </span>
          ) : (
            <span
              className="shrink-0 w-5 h-5 rounded-full border border-dashed border-stone-300 dark:border-stone-600 text-stone-400 text-[9px] font-bold flex items-center justify-center"
            >
              ?
            </span>
          )}
        </TrocarProprietario>
      </div>

      <div className="mt-2 pt-2 border-t border-stone-100 dark:border-stone-700/60 flex items-center gap-1.5 min-w-0">
        {c.prox_id ? (
          <>
            <button
              onClick={(e) => {
                e.stopPropagation();
                onConcluir();
              }}
              title="Concluir esta atividade"
              className="w-4 h-4 rounded-full border-2 border-stone-300 dark:border-stone-600 hover:border-emerald-500 hover:bg-emerald-500 text-transparent hover:text-white flex items-center justify-center shrink-0 cursor-pointer transition-colors"
            >
              <Check className="w-2.5 h-2.5" />
            </button>
            <Icone className={`w-3.5 h-3.5 shrink-0 ${cor.texto}`} />
            <span className={`text-[11px] truncate ${cor.texto}`} title={c.prox_assunto || ''}>
              {quando(c.prox_data, c.prox_hora)} • {c.prox_assunto}
            </span>
            {c.pendentes > 1 && <span className="ml-auto text-[10px] text-stone-400 shrink-0">+{c.pendentes - 1}</span>}
          </>
        ) : (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onAgendar();
            }}
            className={`flex items-center gap-1.5 text-[11px] font-semibold ${cor.texto} hover:underline cursor-pointer`}
          >
            <CalendarPlus className="w-3.5 h-3.5" /> Agendar atividade
          </button>
        )}
      </div>
    </article>
  );
};

// ------------------------------------------------------------
// Inclusão rápida de negócio direto no funil
// ------------------------------------------------------------
const NovoNegocioModal: React.FC<{ funil: Funil; onFechar: () => void; onCriado: (id: Id) => void }> = ({ funil, onFechar, onCriado }) => {
  const [titulo, setTitulo] = useState('');
  const [valor, setValor] = useState('');
  const [etapaId, setEtapaId] = useState(funil.etapas[0]?.id || '');
  const [pessoaId, setPessoaId] = useState('');
  const [fechamento, setFechamento] = useState('');
  const [pessoas, setPessoas] = useState<OpcaoRef[]>([]);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    fetchOptions('pessoas', 'nome').then(setPessoas).catch(() => {});
  }, []);

  const salvar = async (e: React.FormEvent) => {
    e.preventDefault();
    setSalvando(true);
    setErro(null);
    try {
      const r = await createRecord('negocios', {
        titulo,
        valor: valor || 0,
        moeda: 'BRL',
        etapa_id: etapaId,
        pessoa_id: pessoaId || null,
        status: 'aberto',
        data_fechamento_esperada: fechamento || null,
      });
      onCriado(r.id);
    } catch (err: any) {
      setErro(err.message);
      setSalvando(false);
    }
  };

  const campo = `${INPUT_CLASS} w-full`;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="fixed inset-0 bg-stone-950/70 backdrop-blur-xs" onClick={salvando ? undefined : onFechar} aria-hidden="true" />
      <form onSubmit={salvar} role="dialog" aria-modal="true" className="relative w-full max-w-lg bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-800 rounded-2xl shadow-2xl z-10">
        <div className="px-5 py-4 border-b border-stone-200 dark:border-stone-800 flex items-center justify-between">
          <h3 className="text-base font-bold text-stone-900 dark:text-stone-100">Novo negócio • {funil.nome}</h3>
          <button type="button" onClick={onFechar} className="p-1.5 rounded-lg text-stone-400 hover:bg-stone-100 dark:hover:bg-stone-800 cursor-pointer"><X className="w-4 h-4" /></button>
        </div>
        <div className="p-5 grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className={`${FIELD_CLASS} sm:col-span-2`}>
            <label htmlFor="nn-titulo" className={LABEL_CLASS}>Título<span className="text-rose-500 ml-1">*</span></label>
            <input id="nn-titulo" autoFocus required maxLength={255} value={titulo} onChange={(e) => setTitulo(e.target.value)} placeholder="Ex.: 50 licenças — ACME" className={campo} />
          </div>
          <div className={FIELD_CLASS}>
            <label htmlFor="nn-valor" className={LABEL_CLASS}>Valor (R$)</label>
            <NumberField id="nn-valor" value={valor} scale={2} onChange={setValor} className={campo} />
          </div>
          <div className={FIELD_CLASS}>
            <label htmlFor="nn-etapa" className={LABEL_CLASS}>Etapa<span className="text-rose-500 ml-1">*</span></label>
            <SelectAuto id="nn-etapa" required value={etapaId} onChange={(e) => setEtapaId(e.target.value)} className={`${campo} cursor-pointer`}>
              {funil.etapas.map((et) => (
                <option key={et.id} value={et.id}>{et.nome}</option>
              ))}
            </SelectAuto>
          </div>
          <div className={FIELD_CLASS}>
            <label htmlFor="nn-pessoa" className={LABEL_CLASS}>Contato</label>
            <SelectBusca id="nn-pessoa" value={pessoaId} options={pessoas} onChange={setPessoaId} className={campo} />
          </div>
          <div className={FIELD_CLASS}>
            <label htmlFor="nn-fech" className={LABEL_CLASS}>Fechamento esperado</label>
            <DateField id="nn-fech" value={fechamento} onChange={setFechamento} className={campo} />
          </div>
          {erro && <p className="sm:col-span-2 text-xs text-rose-600">{erro}</p>}
        </div>
        <div className="px-5 py-3 border-t border-stone-200 dark:border-stone-800 flex justify-end gap-2.5 bg-stone-50 dark:bg-stone-950/40 rounded-b-2xl">
          <button type="button" onClick={onFechar} disabled={salvando} className="px-4 py-2.5 rounded-lg text-xs font-semibold text-stone-600 dark:text-stone-300 border border-stone-300 dark:border-stone-700 hover:bg-stone-100 dark:hover:bg-stone-800 cursor-pointer">Cancelar</button>
          <button type="submit" disabled={salvando} className="flex items-center gap-2 px-4 py-2.5 rounded-lg text-xs font-semibold bg-blue-600 hover:bg-blue-700 text-white cursor-pointer disabled:opacity-50">
            {salvando && <Loader2 className="w-4 h-4 animate-spin" />} Incluir negócio
          </button>
        </div>
      </form>
    </div>
  );
};
