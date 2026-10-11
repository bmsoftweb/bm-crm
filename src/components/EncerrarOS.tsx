import React, { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { CheckCircle2, Loader2, Search, Trash2, X } from 'lucide-react';
import { buscarProdutos, encerrarOS, fetchOS, listRecords } from '../services/api';
import { RegistroCrud } from '../types';
import { FIELD_CLASS, HINT_CLASS, INPUT_CLASS, LABEL_CLASS } from '../utils/formStyles';
import { formatMoeda } from '../utils/formatters';
import { BotaoAcao } from './MenuAcoes';
import { AvisoErro } from './AvisoErro';
import { DateField } from './DateField';
import { NumberField } from './NumberField';
import { ConfirmDialog } from './ConfirmDialog';

/** Linha da OS: um serviço ou um produto */
interface Item {
  servico_id: string | null;
  produto_id: string | null;
  nome: string;
  unidade: string;
  /** Preço do cadastro: vale quando o preço da linha fica em branco */
  preco_catalogo: number;
  quantidade: string;
  preco_unitario: string;
  desconto: string;
}

interface Achado {
  tipo: 'servico' | 'produto';
  id: string;
  nome: string;
  codigo: string | null;
  unidade: string;
  preco: number;
}

/**
 * "Encerrar" da lista de Ordens de Serviço: o fechamento quando a OS volta no papel (o que foi feito, início e
 * término, quem assinou e os serviços). No celular o técnico encerra pelo app (/tecnico).
 */
export const AcaoEncerrarOS: React.FC<{ registro: RegistroCrud; onFeito: () => void }> = ({ registro, onFeito }) => {
  const [aberta, setAberta] = useState(false);
  if (registro.status === 'cancelada') return null;
  return (
    <>
      <BotaoAcao
        icone={CheckCircle2}
        titulo={registro.status === 'concluida' ? 'Corrigir fechamento' : 'Encerrar'}
        descricao="O que foi feito, horários, quem assinou e os serviços"
        tom="verde"
        onClick={() => setAberta(true)}
      />
      {aberta &&
        createPortal(
          // O span segura os cliques: no React eles subiriam até a linha da lista mesmo pelo portal
          <span onClick={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}>
            <JanelaEncerrar
              osId={registro.id as string}
              onFechar={() => setAberta(false)}
              onFeito={() => {
                setAberta(false);
                onFeito();
              }}
            />
          </span>,
          document.body,
        )}
    </>
  );
};

const JanelaEncerrar: React.FC<{ osId: string; onFechar: () => void; onFeito: () => void }> = ({ osId, onFechar, onFeito }) => {
  const [os, setOs] = useState<RegistroCrud | null>(null);
  const [catalogo, setCatalogo] = useState<RegistroCrud[]>([]);
  const [feito, setFeito] = useState('');
  const [inicio, setInicio] = useState('');
  const [fim, setFim] = useState('');
  const [assinadoPor, setAssinadoPor] = useState('');
  const [documento, setDocumento] = useState('');
  const [itens, setItens] = useState<Item[]>([]);
  const [remover, setRemover] = useState<number | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([fetchOS(osId), listRecords('servicos', { limit: 1000, sort: 'nome', dir: 'asc' })])
      .then(([o, s]) => {
        setOs(o);
        setCatalogo(s.data);
        setFeito(String(o.servico_executado ?? ''));
        // Início: o registrado ou o agendado; término: o registrado
        const agendado = o.data_agendada && o.hora_inicio ? `${o.data_agendada} ${String(o.hora_inicio).slice(0, 5)}` : '';
        setInicio(String(o.inicio_em ?? agendado));
        setFim(String(o.fim_em ?? ''));
        setAssinadoPor(String(o.assinatura_nome ?? ''));
        setDocumento(String(o.assinatura_documento ?? ''));
        setItens(
          (o.itens || []).map((i: RegistroCrud) => ({
            servico_id: i.servico_id ? String(i.servico_id) : null,
            produto_id: i.produto_id ? String(i.produto_id) : null,
            nome: String(i.item_nome ?? ''),
            unidade: String(i.unidade ?? ''),
            preco_catalogo: Number(i.preco_unitario) || 0,
            quantidade: String(i.quantidade),
            preco_unitario: String(i.preco_unitario),
            desconto: String(i.desconto),
          })),
        );
      })
      .catch((e) => setErro(e.message || 'Não foi possível abrir a OS.'));
  }, [osId]);

  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && !e.defaultPrevented && !salvando && remover === null && onFechar();
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [onFechar, salvando, remover]);

  const preco = (i: Item) => (i.preco_unitario === '' ? i.preco_catalogo : Number(i.preco_unitario));
  const subtotal = (i: Item) => Math.round(((Number(i.quantidade) || 0) * preco(i) - (Number(i.desconto) || 0)) * 100) / 100;
  const total = itens.reduce((t, i) => t + subtotal(i), 0);
  const mudar = (n: number, campo: keyof Item, valor: string) => setItens((l) => l.map((i, k) => (k === n ? { ...i, [campo]: valor } : i)));
  const adicionar = (a: Achado) =>
    setItens((l) => [
      ...l,
      {
        servico_id: a.tipo === 'servico' ? a.id : null,
        produto_id: a.tipo === 'produto' ? a.id : null,
        nome: a.nome,
        unidade: a.unidade,
        preco_catalogo: a.preco,
        quantidade: '1',
        preco_unitario: '',
        desconto: '',
      },
    ]);

  const encerrar = async (e: React.FormEvent) => {
    e.preventDefault();
    setSalvando(true);
    setErro(null);
    try {
      await encerrarOS(osId, {
        servico_executado: feito,
        inicio_em: inicio || null,
        fim_em: fim || null,
        assinatura_nome: assinadoPor,
        assinatura_documento: documento,
        itens: itens.map((i) => ({
          servico_id: i.servico_id,
          produto_id: i.produto_id,
          quantidade: i.quantidade,
          preco_unitario: i.preco_unitario === '' ? null : i.preco_unitario,
          desconto: i.desconto,
        })),
      });
      onFeito();
    } catch (err: any) {
      setErro(err.message || 'Não foi possível encerrar a OS.');
      setSalvando(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <div className="fixed inset-0 bg-stone-950/70 backdrop-blur-xs" onClick={salvando ? undefined : onFechar} aria-hidden="true" />
      <form
        onSubmit={encerrar}
        role="dialog"
        aria-modal="true"
        className="relative w-full max-w-3xl max-h-[92vh] flex flex-col bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-800 rounded-2xl shadow-2xl z-10"
      >
        <div className="px-5 py-4 border-b border-stone-200 dark:border-stone-800 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <h3 className="text-base font-bold text-stone-900 dark:text-stone-100 flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-600" /> Encerrar OS{os ? ` nº ${os.numero}` : ''}
            </h3>
            <p className="text-[11px] text-stone-500 dark:text-stone-400 truncate">{os ? String(os.pessoa_nome ?? '') : 'Carregando…'}</p>
          </div>
          <button type="button" onClick={onFechar} title="Fechar" className="p-1.5 rounded-lg text-stone-400 hover:text-stone-700 hover:bg-stone-100 dark:hover:bg-stone-800 cursor-pointer">
            <X className="w-4 h-4" />
          </button>
        </div>

        {!os ? (
          <div className="p-10 flex justify-center">{erro ? <AvisoErro mensagem={erro} onFechar={onFechar} /> : <Loader2 className="w-5 h-5 animate-spin text-stone-400" />}</div>
        ) : (
          <div className="p-5 space-y-4 overflow-y-auto">
            <div className={FIELD_CLASS}>
              <label htmlFor="os-feito" className={LABEL_CLASS}>O que foi feito</label>
              <textarea
                id="os-feito"
                required
                autoFocus={!feito}
                rows={4}
                value={feito}
                onChange={(e) => setFeito(e.target.value)}
                className={`${INPUT_CLASS} w-full resize-y`}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className={FIELD_CLASS}>
                <label htmlFor="os-inicio" className={LABEL_CLASS}>Início</label>
                <DateField id="os-inicio" value={inicio} onChange={setInicio} withTime className={INPUT_CLASS} />
              </div>
              <div className={FIELD_CLASS}>
                <label htmlFor="os-fim" className={LABEL_CLASS}>Término</label>
                <DateField id="os-fim" value={fim} onChange={setFim} withTime className={INPUT_CLASS} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className={FIELD_CLASS}>
                <label htmlFor="os-assinou" className={LABEL_CLASS}>Assinado por</label>
                <input id="os-assinou" value={assinadoPor} onChange={(e) => setAssinadoPor(e.target.value)} maxLength={120} className={INPUT_CLASS} />
              </div>
              <div className={FIELD_CLASS}>
                <label htmlFor="os-doc" className={LABEL_CLASS}>Documento</label>
                <input id="os-doc" value={documento} onChange={(e) => setDocumento(e.target.value)} maxLength={20} className={INPUT_CLASS} />
              </div>
            </div>
            <span className={HINT_CLASS}>Término em branco = agora. Assinado por: quem assinou a OS no papel.</span>

            <div>
              <span className={`${LABEL_CLASS} block mb-1.5`}>Serviços e produtos</span>
              <BuscaItem servicos={catalogo} onEscolher={adicionar} />
              {itens.length === 0 ? (
                <p className="text-xs text-stone-400 py-2">Nada lançado.</p>
              ) : (
                <div className="space-y-2 mt-2">
                  <div className="grid grid-cols-[1fr_90px_100px_90px_90px_32px] gap-2 text-[10px] font-semibold uppercase text-stone-400">
                    <span>Item</span>
                    <span className="text-right">Qtd.</span>
                    <span className="text-right">Preço unit.</span>
                    <span className="text-right">Desconto</span>
                    <span className="text-right">Subtotal</span>
                    <span />
                  </div>
                  {itens.map((i, n) => (
                    <div key={n} className="grid grid-cols-[1fr_90px_100px_90px_90px_32px] gap-2 items-center">
                      <div className="min-w-0 text-xs">
                        <div className="font-semibold truncate" title={i.nome}>{i.nome}</div>
                        <div className="text-[10px] text-stone-400">
                          {i.produto_id ? 'Produto' : 'Serviço'} • {i.unidade}
                        </div>
                      </div>
                      <NumberField value={i.quantidade} onChange={(v) => mudar(n, 'quantidade', v)} scale={3} required className={`${INPUT_CLASS} text-right`} />
                      <NumberField
                        value={i.preco_unitario}
                        onChange={(v) => mudar(n, 'preco_unitario', v)}
                        scale={2}
                        placeholder={formatMoeda(i.preco_catalogo).replace('R$', '').trim()}
                        className={`${INPUT_CLASS} text-right`}
                      />
                      <NumberField value={i.desconto} onChange={(v) => mudar(n, 'desconto', v)} scale={2} className={`${INPUT_CLASS} text-right`} />
                      <span className="text-right text-xs font-semibold tabular-nums">{formatMoeda(subtotal(i))}</span>
                      <button type="button" title="Tirar a linha" onClick={() => setRemover(n)} className="p-1.5 rounded-lg text-stone-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40 cursor-pointer">
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  ))}
                  <div className="flex justify-end gap-3 pt-2 border-t border-stone-200 dark:border-stone-800 text-sm font-bold">
                    <span>Total</span>
                    <span className="tabular-nums">{formatMoeda(total)}</span>
                  </div>
                  <span className={HINT_CLASS}>Preço em branco: o do cadastro (Serviços ou Produtos).</span>
                </div>
              )}
            </div>
            {erro && <AvisoErro mensagem={erro} onFechar={() => setErro(null)} />}
          </div>
        )}

        <div className="px-5 py-3 border-t border-stone-200 dark:border-stone-800 flex justify-end gap-2.5 bg-stone-50 dark:bg-stone-950/40 rounded-b-2xl">
          <button
            type="button"
            onClick={onFechar}
            disabled={salvando}
            className="px-4 py-2.5 rounded-lg text-xs font-semibold text-stone-600 dark:text-stone-300 border border-stone-300 dark:border-stone-700 hover:bg-stone-100 dark:hover:bg-stone-800 cursor-pointer disabled:opacity-40"
          >
            Cancelar
          </button>
          <button
            type="submit"
            disabled={salvando || !os}
            className="flex items-center gap-2 px-4 py-2.5 rounded-lg text-xs font-semibold bg-emerald-600 hover:bg-emerald-700 text-white shadow-xs cursor-pointer disabled:opacity-50"
          >
            {salvando ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />} Encerrar OS
          </button>
        </div>
      </form>

      {remover !== null && (
        <ConfirmDialog
          titulo="Tirar item"
          mensagem={`Tirar "${remover !== null ? itens[remover]?.nome : ''}" da OS? Só vale depois de Encerrar OS.`}
          confirmar="Tirar"
          onConfirmar={() => {
            setItens((l) => l.filter((_, k) => k !== remover));
            setRemover(null);
          }}
          onCancelar={() => setRemover(null)}
        />
      )}
    </div>
  );
};

/**
 * Busca única para lançar na OS: os serviços (já carregados, filtrados aqui) e os produtos (busca no servidor,
 * como no pedido). Enter escolhe o primeiro; Esc fecha a lista.
 */
const BuscaItem: React.FC<{ servicos: RegistroCrud[]; onEscolher: (a: Achado) => void }> = ({ servicos, onEscolher }) => {
  const [texto, setTexto] = useState('');
  const [produtos, setProdutos] = useState<Achado[]>([]);
  const [aberta, setAberta] = useState(false);

  useEffect(() => {
    const q = texto.trim();
    if (q.length < 2) {
      setProdutos([]);
      return;
    }
    let vivo = true;
    const t = setTimeout(() => {
      buscarProdutos(q)
        .then((l) => {
          if (!vivo) return;
          setProdutos(
            l.map((p) => ({
              tipo: 'produto' as const,
              id: String(p.id),
              nome: p.nome,
              codigo: p.codigo_sku ?? null,
              unidade: p.unidade_medida || 'UN',
              preco: Number(p.preco_tabela) || 0,
            })),
          );
        })
        .catch(() => vivo && setProdutos([]));
    }, 250);
    return () => {
      vivo = false;
      clearTimeout(t);
    };
  }, [texto]);

  const achados = useMemo(() => {
    const q = texto.trim().toLowerCase();
    const doServico: Achado[] = servicos
      .filter((s) => Number(s.ativo) && (!q || `${s.nome} ${s.codigo ?? ''}`.toLowerCase().includes(q)))
      .slice(0, 10)
      .map((s) => ({
        tipo: 'servico' as const,
        id: String(s.id),
        nome: String(s.nome),
        codigo: s.codigo ? String(s.codigo) : null,
        unidade: String(s.unidade),
        preco: Number(s.preco) || 0,
      }));
    return [...doServico, ...produtos];
  }, [texto, servicos, produtos]);

  const escolher = (a: Achado) => {
    onEscolher(a);
    setTexto('');
    setAberta(false);
  };

  return (
    <div className="relative">
      <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-stone-400 pointer-events-none" />
      <input
        value={texto}
        onChange={(e) => {
          setTexto(e.target.value);
          setAberta(true);
        }}
        onFocus={() => setAberta(true)}
        onBlur={() => setTimeout(() => setAberta(false), 150)}
        onKeyDown={(e) => {
          if (e.key === 'Escape' && aberta) {
            // Só fecha a lista (a janela de encerrar confere o defaultPrevented)
            e.preventDefault();
            setAberta(false);
          }
          if (e.key === 'Enter') {
            e.preventDefault();
            if (achados[0]) escolher(achados[0]);
          }
        }}
        placeholder="Adicionar serviço ou produto: digite o nome ou o código"
        className={`${INPUT_CLASS} w-full pl-8`}
      />
      {aberta && achados.length > 0 && (
        <div className="absolute z-20 mt-1 w-full max-h-64 overflow-y-auto rounded-lg border border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-900 shadow-lg">
          {achados.map((a) => (
            <button
              key={`${a.tipo}-${a.id}`}
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => escolher(a)}
              className="w-full flex items-center justify-between gap-3 px-3 py-2 text-left text-xs hover:bg-stone-100 dark:hover:bg-stone-800 cursor-pointer"
            >
              <span className="min-w-0">
                <span className={`mr-2 rounded px-1.5 py-0.5 text-[10px] font-semibold ${a.tipo === 'servico' ? 'bg-blue-100 text-blue-700' : 'bg-amber-100 text-amber-800'}`}>
                  {a.tipo === 'servico' ? 'Serviço' : 'Produto'}
                </span>
                {a.nome}
                {a.codigo ? <span className="text-stone-400"> ({a.codigo})</span> : null}
              </span>
              <span className="shrink-0 tabular-nums text-stone-500">
                {formatMoeda(a.preco)} / {a.unidade}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
};
