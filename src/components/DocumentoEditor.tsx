import React, { useEffect, useMemo, useRef, useState } from 'react';
import { SelectAuto } from './SelectAuto';
import {
  ArrowLeft,
  CheckCircle2,
  Plus,
  CopyPlus,
  Printer,
  Loader2,
  PackageSearch,
  Save,
  Trash2,
  X,
} from 'lucide-react';
import { Id, ItemDocumento, OpcaoRef, ProdutoBusca, RegistroCrud } from '../types';
import {
  TipoDocumento,
  aprovarProposta,
  buscarProdutos,
  createRecord,
  fetchCondicoesPagamento,
  fetchDocumento,
  fetchFunis,
  fetchOptions,
  invalidateOptions,
  novaVersaoProposta,
  salvarDocumento,
} from '../services/api';
import { INPUT_CLASS, LABEL_CLASS, FIELD_CLASS, HINT_CLASS } from '../utils/formStyles';
import { STATUS_COLORS, STATUS_LABELS, formatDateBR, formatDateTimeBR, formatMoeda, hojeIso, refProposta } from '../utils/formatters';
import { FORMAS_PAGAMENTO, gerarParcelas, redistribuir, somaParcelas } from '../utils/parcelas';
import { DateField } from './DateField';
import { AnexosProposta } from './AnexosProposta';
import { htmlDocumento } from '../utils/imprimirDocumento';
import { Toggle } from './Toggle';
import { NumberField } from './NumberField';
import { SelectBusca } from './SelectBusca';
import { ConfirmDialog } from './ConfirmDialog';
import { AvisoErro } from './AvisoErro';

/** Parcela na tela (valor no formato do NumberField) */
interface ParcelaTela {
  chave: string;
  vencimento: string;
  forma_pagamento: string;
  valor: string;
  /** Valor acertado à mão com o cliente: o Recalcular não mexe nele */
  ajustada: boolean;
}

interface DocumentoEditorProps {
  tipo: TipoDocumento;
  /** null = inclusão */
  id: Id | null;
  /** Negócio de origem, para uma inclusão aberta a partir da ficha do negócio */
  negocioId?: Id | null;
  negocioTitulo?: string;
  /** Mostra "Voltar" em vez de "Fechar" */
  rotuloVoltar?: string;
  onFechar: () => void;
  /** Após gravar, versionar ou aprovar (para recarregar listas) */
  onGravado?: () => void;
  /** Abre o pedido gerado pela aprovação da proposta */
  onAbrirPedido?: (pedidoId: Id) => void;
  onToast: (msg: string) => void;
}

const STATUS_PROPOSTA_EDITAVEIS = ['rascunho', 'enviada', 'recusada', 'expirada'];
const STATUS_PEDIDO = ['rascunho', 'aguardando_aprovacao', 'aprovado', 'faturado', 'cancelado'];

const n = (v: string | number | null | undefined) => Number(v) || 0;
const centavos = (v: number) => Math.round(v * 100) / 100;
let seq = 0;
const novaChave = () => `i${++seq}`;

/** Prévia do cálculo feito pelo servidor: quantidade × preço − desconto do item */
function totaisDaTela(itens: ItemDocumento[], descontoAdicional: string) {
  const bruto = centavos(itens.reduce((s, i) => s + centavos(n(i.quantidade) * n(i.preco_unitario)), 0));
  const descItens = centavos(itens.reduce((s, i) => s + n(i.desconto), 0));
  const desconto = centavos(descItens + n(descontoAdicional));
  return { bruto, descItens, desconto, total: centavos(bruto - desconto) };
}

/** CPF 000.000.000-00 / CNPJ 00.000.000/0000-00 */
const formatarDocumento = (d: string) =>
  d.length === 11 ? d.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4') : d.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5');

export const DocumentoEditor: React.FC<DocumentoEditorProps> = ({
  tipo,
  id: idInicial,
  negocioId,
  negocioTitulo,
  rotuloVoltar,
  onFechar,
  onGravado,
  onAbrirPedido,
  onToast,
}) => {
  const ehProposta = tipo === 'propostas';
  const [id, setId] = useState<Id | null>(idInicial);
  /** Incrementado para reler o documento: números e totais oficiais vêm do servidor */
  const [recarga, setRecarga] = useState(0);
  const [doc, setDoc] = useState<RegistroCrud | null>(null);
  const [carregando, setCarregando] = useState(Boolean(idInicial));
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const [cab, setCab] = useState<Record<string, string>>({
    titulo: negocioTitulo ? `Proposta — ${negocioTitulo}` : '',
    negocio_id: negocioId || '',
    pessoa_id: '',
    status: 'rascunho',
    validade_dias: '15',
    condicao: '',
    observacoes: '',
    controle: '',
    impressao_resumida: '0',
  });
  const [itens, setItens] = useState<ItemDocumento[]>([]);
  // Condições do cadastro e as parcelas da proposta (vencimento, forma e valor)
  const [condicoes, setCondicoes] = useState<{ nome: string; prazos: string; forma_pagamento: string }[]>([]);
  const [parcelas, setParcelas] = useState<ParcelaTela[]>([]);
  const [descontoAdicional, setDescontoAdicional] = useState('');
  const [removendo, setRemovendo] = useState<ItemDocumento | null>(null);
  const [confirmando, setConfirmando] = useState<'aprovar' | 'versao' | null>(null);

  const [opcoes, setOpcoes] = useState<Record<string, OpcaoRef[]>>({});
  /** Inclusão rápida de negócio: título e etapa (1ª etapa do 1º funil, como padrão) */
  const [negocioRapido, setNegocioRapido] = useState<{ titulo: string; etapa_id: string } | null>(null);
  const [etapas, setEtapas] = useState<OpcaoRef[]>([]);
  const abrirNegocioRapido = async () => {
    const cliente = (opcoes.pessoas || []).find((o) => String(o.value) === String(cab.pessoa_id))?.label.replace(/ \(inativo\)$/, '');
    let lista = etapas;
    if (!lista.length) {
      try {
        const funis = await fetchFunis();
        lista = funis.flatMap((f) => f.etapas.map((e) => ({ value: String(e.id), label: `${f.nome} › ${e.nome}` })));
        setEtapas(lista);
      } catch (err: any) {
        return setErro(err.message);
      }
    }
    if (!lista.length) return setErro('Cadastre um funil com etapas antes de incluir o negócio.');
    setNegocioRapido({ titulo: [cliente, cab.titulo].filter(Boolean).join(' - ').slice(0, 255), etapa_id: String(lista[0].value) });
  };
  const criarNegocioRapido = async () => {
    if (!negocioRapido) return;
    if (!negocioRapido.titulo.trim()) throw new Error('Informe o título do negócio.');
    const r = await createRecord('negocios', {
      titulo: negocioRapido.titulo.trim(),
      valor: tot.total || 0,
      moeda: 'BRL',
      etapa_id: negocioRapido.etapa_id,
      pessoa_id: cab.pessoa_id || null,
      status: 'aberto',
    });
    invalidateOptions('negocios');
    const negocios = await fetchOptions('negocios', 'titulo');
    setOpcoes((o) => ({ ...o, negocios }));
    campo('negocio_id')(String(r.id));
    setNegocioRapido(null);
    onToast('Negócio incluído e ligado à proposta.');
  };
  useEffect(() => {
    fetchCondicoesPagamento().then(setCondicoes).catch(() => {});
  }, []);
  useEffect(() => {
    Promise.all([fetchOptions('negocios', 'titulo'), fetchOptions('pessoas', 'nome')])
      .then(([negocios, pessoas]) => setOpcoes({ negocios, pessoas }))
      .catch(() => {});
  }, []);

  // Carrega o documento salvo (e recarrega depois de gravar ou versionar)
  useEffect(() => {
    if (!id) return;
    let vivo = true;
    setCarregando(true);
    fetchDocumento(tipo, id)
      .then((d) => {
        if (!vivo) return;
        setDoc(d);
        setCab({
          titulo: d.titulo || '',
          negocio_id: d.negocio_id || '',
          pessoa_id: d.pessoa_id || '',
          status: d.status,
          validade_dias: String(d.validade_dias ?? ''),
          condicao: (ehProposta ? d.condicoes_pagamento : d.condicao_pagamento) || '',
          observacoes: d.observacoes || '',
          controle: d.controle || '',
          impressao_resumida: Number(d.impressao_resumida) ? '1' : '0',
        });
        const lidos: ItemDocumento[] = d.itens.map((i: RegistroCrud) => ({
          chave: novaChave(),
          produto_id: i.produto_id,
          produto_nome: i.produto_nome,
          codigo_sku: i.codigo_sku,
          unidade_medida: i.unidade_medida,
          quantidade: String(i.quantidade),
          preco_unitario: String(i.preco_unitario),
          desconto: n(i.desconto) ? String(i.desconto) : '',
        }));
        setItens(lidos);
        setParcelas(
          (d.parcelas || []).map((x: RegistroCrud) => ({
            chave: novaChave(),
            vencimento: String(x.vencimento),
            forma_pagamento: String(x.forma_pagamento),
            valor: Number(x.valor).toFixed(2),
            ajustada: Boolean(Number(x.ajustada)),
          })),
        );
        // O desconto adicional não tem coluna própria: é o que sobra além dos descontos dos itens
        const adicional = centavos(n(d.valor_desconto) - lidos.reduce((s, i) => s + n(i.desconto), 0));
        setDescontoAdicional(adicional > 0 ? adicional.toFixed(2) : '');
        setErro(null);
      })
      .catch((err) => vivo && setErro(err.message))
      .finally(() => vivo && setCarregando(false));
    return () => {
      vivo = false;
    };
  }, [id, recarga, tipo, ehProposta]);

  const status = doc?.status || cab.status;
  // Proposta aceita (já virou pedido) ou fechada (outra versão foi aceita) e pedido
  // faturado/cancelado não mudam mais
  const negociacaoFechada = ehProposta && (status === 'aceita' || status === 'fechada');
  const bloqueado = ehProposta ? negociacaoFechada : ['faturado', 'cancelado'].includes(doc?.status || '');
  const tot = useMemo(() => totaisDaTela(itens, descontoAdicional), [itens, descontoAdicional]);
  const campo = (nome: string) => (v: string) => setCab((c) => ({ ...c, [nome]: v }));
  const campoCliente = (largura: string) => (
    <div className={`${FIELD_CLASS} ${largura}`}>
      <label htmlFor="doc-pessoa" className={LABEL_CLASS}>Cliente (contato)</label>
      <SelectBusca
        id="doc-pessoa"
        value={cab.pessoa_id}
        options={opcoes.pessoas || []}
        onChange={campo('pessoa_id')}
        vazioLabel={cab.negocio_id ? '— O do negócio —' : '— Nenhum —'}
        className={`${INPUT_CLASS} w-full`}
      />
    </div>
  );
  // Proposta nova: o foco já vem no Cliente (1º campo a preencher)
  useEffect(() => {
    if (ehProposta && !idInicial && !negocioId) document.getElementById('doc-pessoa')?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Condições do cadastro; a gravada no documento entra como opção se não estiver mais nele
  const opcoesCondicao = useMemo(() => {
    const lista = condicoes.map((c) => ({ value: c.nome, label: c.nome }));
    const atual = String(cab.condicao || '').trim();
    return atual && !lista.some((o) => o.value === atual) ? [{ value: atual, label: atual }, ...lista] : lista;
  }, [condicoes, cab.condicao]);

  /** Parcelas da condição escolhida, com o total atual, vencendo a partir de hoje */
  const parcelasDaCondicao = (nome: string): ParcelaTela[] => {
    const c = condicoes.find((x) => x.nome === nome);
    if (!c) return [];
    return gerarParcelas(c.prazos, tot.total, hojeIso(), c.forma_pagamento).map((x) => ({
      chave: novaChave(),
      vencimento: x.vencimento,
      forma_pagamento: x.forma_pagamento,
      valor: x.valor.toFixed(2),
      ajustada: false,
    }));
  };
  const escolherCondicao = (nome: string) => {
    campo('condicao')(nome);
    setParcelas(parcelasDaCondicao(nome));
  };
  /** Recalcular: as ajustadas à mão ficam; o que falta para o total é dividido entre as outras */
  const recalcularParcelas = (lista: ParcelaTela[], total: number) =>
    redistribuir(lista.map((x) => ({ ...x, valor: Number(x.valor) || 0 })), total).map((x) => ({ ...x, valor: x.valor.toFixed(2) }));
  const alterarParcela = (chave: string, dados: Partial<ParcelaTela>) =>
    setParcelas((lista) => lista.map((x) => (x.chave === chave ? { ...x, ...dados } : x)));
  const somaDasParcelas = somaParcelas(parcelas.map((x) => x.valor));
  const diferencaParcelas = centavos(tot.total - somaDasParcelas);

  // Total mudou (item, quantidade, desconto): recalcula as parcelas não ajustadas, mantendo vencimentos e formas
  useEffect(() => {
    if (!parcelas.length || diferencaParcelas === 0 || tot.total <= 0) return;
    setParcelas((lista) => recalcularParcelas(lista, tot.total));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tot.total]);

  const alterarItem = (chave: string, dados: Partial<ItemDocumento>) =>
    setItens((lista) => lista.map((i) => (i.chave === chave ? { ...i, ...dados } : i)));

  const incluirProduto = (p: ProdutoBusca) =>
    setItens((lista) => [
      ...lista,
      {
        chave: novaChave(),
        produto_id: p.id,
        produto_nome: p.nome,
        codigo_sku: p.codigo_sku,
        unidade_medida: p.unidade_medida,
        quantidade: '1.000',
        preco_unitario: p.preco_tabela.toFixed(2),
        desconto: '',
      },
    ]);

  /** Grava e devolve o id; lança o erro para quem chamou */
  const gravar = async (): Promise<string> => {
    const payload = {
      titulo: cab.titulo,
      negocio_id: cab.negocio_id || null,
      pessoa_id: cab.pessoa_id || null,
      status: cab.status,
      validade_dias: cab.validade_dias,
      [ehProposta ? 'condicoes_pagamento' : 'condicao_pagamento']: cab.condicao,
      observacoes: cab.observacoes,
      parcelas: parcelas.map(({ vencimento, forma_pagamento, valor, ajustada }) => ({ vencimento, forma_pagamento, valor, ajustada })),
      ...(ehProposta ? { controle: cab.controle, impressao_resumida: cab.impressao_resumida === '1' } : {}),
      desconto_adicional: descontoAdicional || 0,
      itens: itens.map(({ produto_id, quantidade, preco_unitario, desconto }) => ({ produto_id, quantidade, preco_unitario, desconto: desconto || 0 })),
    };
    const r = await salvarDocumento(tipo, id, payload);
    return r.id;
  };

  const salvar = async (e?: React.FormEvent) => {
    e?.preventDefault();
    setSalvando(true);
    setErro(null);
    try {
      const novoId = await gravar();
      onToast(`${ehProposta ? 'Proposta' : 'Pedido'} salvo com sucesso.`);
      onGravado?.();
      setId(novoId);
      setRecarga((r) => r + 1);
    } catch (err: any) {
      setErro(err.message);
    } finally {
      setSalvando(false);
    }
  };

  const aprovar = async () => {
    // Grava o que está na tela antes: a aprovação clona o que está no banco
    const propostaId = await gravar();
    const r = await aprovarProposta(propostaId);
    onToast(`Proposta aprovada. Pedido #${r.numero_pedido} gerado.`);
    onGravado?.();
    setConfirmando(null);
    if (onAbrirPedido) onAbrirPedido(r.id);
    else {
      setId(propostaId);
      setRecarga((x) => x + 1);
    }
  };

  /** Imprime o documento como está gravado; alterações pendentes são salvas antes */
  const imprimir = async () => {
    // A aba abre ainda no clique: aberta depois de um await, o bloqueador de pop-up a barraria
    const janela = window.open('', '_blank');
    if (!janela) return setErro('O navegador bloqueou a nova aba. Libere pop-ups para este site e tente de novo.');
    janela.document.write(`<p style="font-family:sans-serif">Preparando ${ehProposta ? 'a proposta' : 'o pedido'}…</p>`);
    setSalvando(true);
    setErro(null);
    try {
      const docId = bloqueado ? id! : await gravar();
      const d = await fetchDocumento(tipo, docId);
      janela.document.open();
      janela.document.write(htmlDocumento(d, tipo, ehProposta && Boolean(Number(d.impressao_resumida))));
      janela.document.close();
      if (!bloqueado) {
        onGravado?.();
        setId(docId);
        setRecarga((r) => r + 1);
      }
    } catch (err: any) {
      janela.close();
      setErro(err.message);
    } finally {
      setSalvando(false);
    }
  };

  const gerarVersao = async () => {
    const r = await novaVersaoProposta(id!);
    onToast('Nova versão da proposta criada.');
    onGravado?.();
    setConfirmando(null);
    setId(r.id);
  };

  const titulo = id
    ? ehProposta
      ? `Proposta ${doc ? refProposta(doc) : '…'}`
      : `Pedido #${doc?.numero_pedido ?? '…'}`
    : ehProposta
    ? 'Nova proposta'
    : 'Novo pedido';

  if (carregando && !doc) {
    return (
      <div className="flex-1 flex items-center justify-center gap-2 text-sm text-stone-500">
        <Loader2 className="w-4 h-4 animate-spin" /> Carregando…
      </div>
    );
  }

  return (
    <form onSubmit={salvar} className="flex-1 flex flex-col min-h-0 bg-white dark:bg-stone-900">
      {/* Título */}
      <div className="px-5 py-3 border-b border-stone-200 dark:border-stone-800 flex items-center gap-3 shrink-0">
        {rotuloVoltar && (
          <button type="button" onClick={onFechar} title={rotuloVoltar} className="p-1.5 rounded-lg text-stone-500 hover:text-stone-900 hover:bg-stone-100 dark:hover:bg-stone-800 dark:hover:text-white cursor-pointer">
            <ArrowLeft className="w-4 h-4" />
          </button>
        )}
        <h3 className="text-base font-bold text-stone-900 dark:text-stone-100">{titulo}</h3>
        <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${STATUS_COLORS[status] || ''}`}>{STATUS_LABELS[status] || status}</span>
        {doc && (
          <span className="text-[11px] text-stone-500 dark:text-stone-400 truncate">
            {ehProposta
              ? `Válida até ${formatDateBR(doc.data_validade)}`
              : `Emissão ${formatDateTimeBR(doc.data_emissao)}${doc.proposta_numero ? ` • origem: proposta ${refProposta({ controle: doc.proposta_controle, numero_proposta: doc.proposta_numero, versao: doc.proposta_versao })}` : ''}`}
          </span>
        )}
      </div>

      <div className="flex-1 overflow-y-auto min-h-0">
        <div className="max-w-6xl mx-auto px-5 py-5 space-y-5">
          {erro && (
            <AvisoErro mensagem={erro} onFechar={() => setErro(null)} />
          )}
          {bloqueado && (
            <div className="p-3 rounded-lg bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-900 text-xs text-amber-800 dark:text-amber-300">
              {!ehProposta
                ? 'Pedido faturado ou cancelado: somente o status pode ser alterado.'
                : status === 'fechada'
                  ? 'Proposta fechada: outra versão desta proposta foi aceita pelo cliente. Ela fica só para consulta.'
                  : 'Proposta aceita: a negociação está fechada e não pode mais ser alterada. Para uma nova negociação, use Clonar na lista de propostas.'}
            </div>
          )}

          {/* Resposta do cliente pelo link de aceite (server/aceite.ts) */}
          {ehProposta && doc?.aceite_em && (
            <div
              className={`p-3 rounded-lg border text-xs flex flex-wrap gap-x-6 gap-y-2 items-center ${
                doc.aceite_assinatura
                  ? 'bg-emerald-50 border-emerald-200 text-emerald-900 dark:bg-emerald-950/40 dark:border-emerald-900 dark:text-emerald-200'
                  : 'bg-rose-50 border-rose-200 text-rose-900 dark:bg-rose-950/40 dark:border-rose-900 dark:text-rose-200'
              }`}
            >
              <div className="space-y-0.5">
                <div className="font-bold">{doc.aceite_assinatura ? 'Aprovada e assinada pelo cliente no link' : 'Recusada pelo cliente no link (motivo no histórico do negócio)'}</div>
                <div>
                  {doc.aceite_nome}
                  {doc.aceite_documento ? ` • ${formatarDocumento(String(doc.aceite_documento))}` : ''} • {formatDateTimeBR(doc.aceite_em)} • IP {doc.aceite_ip || '—'}
                </div>
                {doc.aceite_hash && <div className="font-mono text-[10px] opacity-70 break-all">hash {doc.aceite_hash}</div>}
              </div>
              {doc.aceite_assinatura && (
                <img src={String(doc.aceite_assinatura)} alt="Assinatura do cliente" className="h-16 bg-white rounded border border-emerald-200 px-2" />
              )}
            </div>
          )}

          {/* Cabeçalho */}
          <fieldset disabled={bloqueado && ehProposta} className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 border-0 p-0 m-0 min-w-0">
            {ehProposta && campoCliente('sm:col-span-2')}
            {ehProposta && (
              <div className={`${FIELD_CLASS} sm:col-span-2`}>
                <label htmlFor="doc-titulo" className={LABEL_CLASS}>Título<span className="text-rose-500 ml-1">*</span></label>
                <input id="doc-titulo" required maxLength={255} value={cab.titulo} onChange={(e) => campo('titulo')(e.target.value)} className={`${INPUT_CLASS} w-full`} />
              </div>
            )}
            <div className={`${FIELD_CLASS} lg:col-span-3`}>
              <label htmlFor="doc-negocio" className={LABEL_CLASS}>Negócio{ehProposta && <span className="text-rose-500 ml-1">*</span>}</label>
              <div className="flex items-center gap-2">
                <div className="flex-1 min-w-0">
                <SelectBusca
                  id="doc-negocio"
                  required={ehProposta}
                  // A proposta pertence ao negócio para sempre: versões e pedido dependem disso
                  disabled={ehProposta && Boolean(id || negocioId)}
                  value={cab.negocio_id}
                  options={opcoes.negocios || []}
                  onChange={campo('negocio_id')}
                  vazioLabel={ehProposta ? '— Selecione —' : '— Sem negócio —'}
                  className={`${INPUT_CLASS} w-full`}
                />
                </div>
                {/* Inclusão rápida do negócio esquecido: cliente + título da proposta */}
                {ehProposta && !id && !negocioId && (
                  <button
                    type="button"
                    onClick={abrirNegocioRapido}
                    title="Incluir um negócio novo para esta proposta (cliente + título da proposta)"
                    className="shrink-0 h-[38px] w-[38px] flex items-center justify-center rounded-lg border border-stone-300 dark:border-stone-700 text-stone-600 dark:text-stone-300 hover:bg-stone-100 dark:hover:bg-stone-800 hover:text-blue-600 cursor-pointer"
                  >
                    <Plus className="w-4 h-4" />
                  </button>
                )}
              </div>
            </div>
            <div className={FIELD_CLASS}>
              <label htmlFor="doc-status" className={LABEL_CLASS}>Status</label>
              <SelectAuto
                id="doc-status"
                value={cab.status}
                onChange={(e) => campo('status')(e.target.value)}
                disabled={negociacaoFechada}
                className={`${INPUT_CLASS} w-full cursor-pointer`}
              >
                {(ehProposta ? (negociacaoFechada ? [status] : STATUS_PROPOSTA_EDITAVEIS) : STATUS_PEDIDO).map((s) => (
                  <option key={s} value={s}>
                    {STATUS_LABELS[s]}
                  </option>
                ))}
              </SelectAuto>
            </div>
          </fieldset>

          <fieldset disabled={bloqueado} className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 border-0 p-0 mx-0 mt-4 mb-2.5 min-w-0">
            {ehProposta && (
              <div className={FIELD_CLASS}>
                <label htmlFor="doc-controle" className={LABEL_CLASS}>Controle</label>
                <input
                  id="doc-controle"
                  maxLength={30}
                  value={cab.controle}
                  onChange={(e) => campo('controle')(e.target.value)}
                  onFocus={(e) => e.target.select()}
                  placeholder={id ? '' : 'Automático (AAAA/NNN-01)'}
                  title="Controle livre da proposta. Em branco na inclusão: ano/sequência e versão (ex.: 2026/001-01); as versões seguintes ganham -02, -03…"
                  className={`${INPUT_CLASS} w-full`}
                />
              </div>
            )}
            {ehProposta && (
              <div className={FIELD_CLASS}>
                <label htmlFor="doc-validade" className={LABEL_CLASS}>Validade (dias)</label>
                <NumberField id="doc-validade" value={cab.validade_dias} onChange={campo('validade_dias')} className={`${INPUT_CLASS} w-full`} />
              </div>
            )}
            {!ehProposta && campoCliente('lg:col-span-2')}
            <div className={`${FIELD_CLASS} ${ehProposta ? '' : 'lg:col-span-2'}`}>
              <label htmlFor="doc-condicao" className={LABEL_CLASS}>{ehProposta ? 'Condições de Pagamento' : 'Condição de Pagamento'}</label>
              <SelectBusca
                id="doc-condicao"
                value={cab.condicao}
                options={opcoesCondicao}
                onChange={escolherCondicao}
                vazioLabel="— Escolha —"
                className={`${INPUT_CLASS} w-full`}
              />
            </div>
            {ehProposta && (
              <div className={FIELD_CLASS}>
                <span className={LABEL_CLASS}>Impressão resumida</span>
                <Toggle
                  checked={cab.impressao_resumida === '1'}
                  onChange={(v) => campo('impressao_resumida')(v ? '1' : '0')}
                  disabled={bloqueado}
                  title="Imprimir / PDF deste editor sai com os produtos agrupados pelo grupo. O que vai para o cliente (envio e link de aprovação) sai sempre resumido"
                />
              </div>
            )}
          </fieldset>

          {/* Itens */}
          <div className="border border-stone-200 dark:border-stone-800 rounded-xl overflow-hidden">
            <div className="px-4 py-2.5 bg-stone-50 dark:bg-stone-950/60 border-b border-stone-200 dark:border-stone-800 flex items-center justify-between gap-3">
              <span className="text-xs font-bold text-stone-700 dark:text-stone-200">Itens ({itens.length})</span>
              {!bloqueado && <BuscaProduto onEscolher={incluirProduto} />}
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="bg-stone-50/60 dark:bg-stone-950/30 text-stone-500 dark:text-stone-400">
                  <tr>
                    <th className="px-3 py-2 text-left font-semibold">Produto</th>
                    <th className="px-3 py-2 text-right font-semibold w-28">Quantidade</th>
                    <th className="px-3 py-2 text-center font-semibold w-14">Un.</th>
                    <th className="px-3 py-2 text-right font-semibold w-32">Preço Unit.</th>
                    <th className="px-3 py-2 text-right font-semibold w-32">Desconto (R$)</th>
                    <th className="px-3 py-2 text-right font-semibold w-32">Subtotal</th>
                    <th className="w-10" />
                  </tr>
                </thead>
                <tbody>
                  {itens.length === 0 && (
                    <tr>
                      <td colSpan={7} className="px-3 py-10 text-center text-stone-400">
                        <PackageSearch className="w-6 h-6 mx-auto mb-1.5" />
                        Pesquise um produto do catálogo para incluir o primeiro item.
                      </td>
                    </tr>
                  )}
                  {itens.map((i) => {
                    const sub = centavos(n(i.quantidade) * n(i.preco_unitario) - n(i.desconto));
                    return (
                      <tr key={i.chave} className="border-t border-stone-100 dark:border-stone-800/60">
                        <td className="px-3 py-1.5">
                          <div className="font-semibold text-stone-800 dark:text-stone-100">{i.produto_nome}</div>
                          {i.codigo_sku && <div className="text-[10px] font-mono text-stone-400">{i.codigo_sku}</div>}
                        </td>
                        <td className="px-3 py-1.5">
                          <NumberField value={i.quantidade} scale={3} disabled={bloqueado} onChange={(v) => alterarItem(i.chave, { quantidade: v })} className={`${INPUT_CLASS} w-full`} />
                        </td>
                        <td className="px-3 py-1.5 text-center text-stone-500">{i.unidade_medida}</td>
                        <td className="px-3 py-1.5">
                          <NumberField value={i.preco_unitario} scale={2} disabled={bloqueado} onChange={(v) => alterarItem(i.chave, { preco_unitario: v })} className={`${INPUT_CLASS} w-full`} />
                        </td>
                        <td className="px-3 py-1.5">
                          <NumberField value={i.desconto} scale={2} disabled={bloqueado} onChange={(v) => alterarItem(i.chave, { desconto: v })} className={`${INPUT_CLASS} w-full`} />
                        </td>
                        <td className={`px-3 py-1.5 text-right font-mono font-semibold ${sub < 0 ? 'text-rose-600' : 'text-stone-800 dark:text-stone-100'}`}>
                          {formatMoeda(sub)}
                        </td>
                        <td className="px-2 py-1.5 text-center">
                          {!bloqueado && (
                            <button type="button" onClick={() => setRemovendo(i)} title="Remover item" className="p-1 rounded text-stone-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40 cursor-pointer">
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* Parcelas da condição de pagamento (proposta e pedido) */}
          {(parcelas.length > 0 || cab.condicao) && (
            <div className="border border-stone-200 dark:border-stone-800 rounded-xl overflow-hidden">
              <div className="px-4 py-2.5 bg-stone-50 dark:bg-stone-950/60 border-b border-stone-200 dark:border-stone-800 flex items-center justify-between gap-3">
                <span className="text-xs font-bold text-stone-700 dark:text-stone-200">
                  Parcelas ({parcelas.length}){cab.condicao ? ` — ${cab.condicao}` : ''}
                </span>
                {!bloqueado && (
                  <div className="flex items-center gap-2">
                    {parcelas.length > 0 && (
                      <button
                        type="button"
                        onClick={() => setParcelas((lista) => recalcularParcelas(lista, tot.total))}
                        title="As parcelas ajustadas à mão ficam; o que falta para o total é dividido entre as outras"
                        className="px-3 py-1.5 rounded-lg text-xs font-semibold border border-stone-300 dark:border-stone-700 text-stone-700 dark:text-stone-200 hover:bg-stone-100 dark:hover:bg-stone-800 cursor-pointer"
                      >
                        Recalcular
                      </button>
                    )}
                    {condicoes.some((c) => c.nome === cab.condicao) && (
                      <button
                        type="button"
                        onClick={() => setParcelas(parcelasDaCondicao(cab.condicao))}
                        title="Gera de novo as parcelas da condição: valores divididos por igual (desfaz os ajustes) e vencimentos a partir de hoje"
                        className="px-3 py-1.5 rounded-lg text-xs font-semibold border border-stone-300 dark:border-stone-700 text-stone-700 dark:text-stone-200 hover:bg-stone-100 dark:hover:bg-stone-800 cursor-pointer"
                      >
                        Refazer Parcelas
                      </button>
                    )}
                  </div>
                )}
              </div>
              {parcelas.length === 0 ? (
                <p className="px-4 py-4 text-xs text-stone-500 dark:text-stone-400">
                  Esta condição não está no cadastro (Cadastros › Condições de Pagamento): escolha uma condição cadastrada para gerar as parcelas.
                </p>
              ) : (
                <table className="w-full text-xs">
                  <thead className="bg-stone-50/60 dark:bg-stone-950/30 text-stone-500 dark:text-stone-400">
                    <tr>
                      <th className="px-3 py-2 text-center font-semibold w-12">Nº</th>
                      <th className="px-3 py-2 text-center font-semibold w-44">Vencimento</th>
                      <th className="px-3 py-2 text-left font-semibold">Forma de Pagamento</th>
                      <th className="px-3 py-2 text-right font-semibold w-40">Valor</th>
                    </tr>
                  </thead>
                  <tbody>
                    {parcelas.map((x, k) => (
                      <tr key={x.chave} className="border-t border-stone-100 dark:border-stone-800/60">
                        <td className="px-3 py-1.5 text-center text-stone-500">
                          {k + 1}ª
                          {x.ajustada && (
                            <div className="text-[9px] font-semibold text-amber-600 dark:text-amber-400" title="Valor acertado à mão: o Recalcular não mexe nele">
                              ajustada
                            </div>
                          )}
                        </td>
                        <td className="px-3 py-1.5 text-center">
                          {bloqueado ? (
                            formatDateBR(x.vencimento)
                          ) : (
                            <DateField value={x.vencimento} onChange={(v) => alterarParcela(x.chave, { vencimento: v })} className={`${INPUT_CLASS} w-full`} />
                          )}
                        </td>
                        <td className="px-3 py-1.5">
                          <SelectAuto
                            value={x.forma_pagamento}
                            disabled={bloqueado}
                            onChange={(e) => alterarParcela(x.chave, { forma_pagamento: e.target.value })}
                            className={`${INPUT_CLASS} w-full cursor-pointer`}
                          >
                            {(FORMAS_PAGAMENTO.includes(x.forma_pagamento) ? FORMAS_PAGAMENTO : [x.forma_pagamento, ...FORMAS_PAGAMENTO]).map((f) => (
                              <option key={f} value={f}>
                                {f}
                              </option>
                            ))}
                          </SelectAuto>
                        </td>
                        <td className="px-3 py-1.5">
                          <NumberField
                            value={x.valor}
                            scale={2}
                            disabled={bloqueado}
                            onChange={(v) => alterarParcela(x.chave, { valor: v, ajustada: true })}
                            className={`${INPUT_CLASS} w-full`}
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="border-t border-stone-200 dark:border-stone-700">
                      <td colSpan={3} className={`px-3 py-2 text-right ${diferencaParcelas ? 'text-amber-700 dark:text-amber-400 font-semibold' : 'text-stone-500'}`}>
                        {diferencaParcelas
                          ? `A soma das parcelas difere do total em ${formatMoeda(Math.abs(diferencaParcelas))}: use Recalcular, ajuste os valores ou Refazer Parcelas`
                          : 'Soma das parcelas'}
                      </td>
                      <td className="px-3 py-2 text-right font-mono font-semibold text-stone-800 dark:text-stone-100">{formatMoeda(somaDasParcelas)}</td>
                    </tr>
                  </tfoot>
                </table>
              )}
            </div>
          )}

          {/* Anexos (os mesmos em todas as versões da proposta) */}
          {ehProposta && (
            <AnexosProposta id={id} empresaId={doc?.empresa_id ?? null} numero={doc?.numero_proposta ?? null} bloqueado={negociacaoFechada} onToast={onToast} />
          )}

          {/* Observações e totais */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
            <div className={`${FIELD_CLASS} lg:col-span-2`}>
              <label htmlFor="doc-obs" className={LABEL_CLASS}>Observações</label>
              <textarea id="doc-obs" rows={5} disabled={bloqueado} value={cab.observacoes} onChange={(e) => campo('observacoes')(e.target.value)} className={`${INPUT_CLASS} w-full resize-y`} />
            </div>
            <div className="bg-stone-50 dark:bg-stone-800/40 border border-stone-200 dark:border-stone-700/60 rounded-xl p-4 space-y-2 text-xs">
              <Linha rotulo="Subtotal (bruto)" valor={formatMoeda(tot.bruto)} />
              <Linha rotulo="Descontos nos itens" valor={`− ${formatMoeda(tot.descItens)}`} />
              <div className="flex items-center justify-between gap-3">
                <label htmlFor="doc-desc-adic" className="text-stone-500 dark:text-stone-400">Desconto adicional</label>
                <NumberField id="doc-desc-adic" value={descontoAdicional} scale={2} disabled={bloqueado} onChange={setDescontoAdicional} className={`${INPUT_CLASS} w-32`} />
              </div>
              <div className="pt-2 border-t border-stone-200 dark:border-stone-700 flex items-center justify-between">
                <span className="text-sm font-bold text-stone-800 dark:text-stone-100">Total</span>
                <span className={`text-lg font-bold font-mono ${tot.total < 0 ? 'text-rose-600' : 'text-blue-700 dark:text-blue-400'}`}>{formatMoeda(tot.total)}</span>
              </div>
              <p className={HINT_CLASS}>Os totais são recalculados pelo servidor ao salvar.</p>
            </div>
          </div>
        </div>
      </div>

      {/* Ações */}
      <div className="px-5 py-3 border-t border-stone-200 dark:border-stone-800 flex flex-wrap items-center justify-between gap-2.5 bg-stone-50 dark:bg-stone-950/40 shrink-0">
        <div className="flex items-center gap-2">
          <button type="button" onClick={imprimir} disabled={salvando} title="Abre o documento para imprimir ou salvar em PDF (salva as alterações antes)" className="flex items-center gap-1.5 px-3 py-2.5 rounded-lg text-xs font-semibold border border-stone-300 dark:border-stone-700 text-stone-700 dark:text-stone-200 hover:bg-stone-100 dark:hover:bg-stone-800 cursor-pointer disabled:opacity-40">
            <Printer className="w-3.5 h-3.5" /> Imprimir / PDF
          </button>
          {ehProposta && id && !negociacaoFechada && (
            <button type="button" onClick={() => setConfirmando('versao')} disabled={salvando} title="Renegociação: copia esta proposta como a próxima versão" className="flex items-center gap-1.5 px-3 py-2.5 rounded-lg text-xs font-semibold border border-stone-300 dark:border-stone-700 text-stone-700 dark:text-stone-200 hover:bg-stone-100 dark:hover:bg-stone-800 cursor-pointer disabled:opacity-40">
              <CopyPlus className="w-3.5 h-3.5" /> Nova versão
            </button>
          )}
          {ehProposta && id && !negociacaoFechada && (
            <button type="button" onClick={() => setConfirmando('aprovar')} disabled={salvando} className="flex items-center gap-1.5 px-3 py-2.5 rounded-lg text-xs font-semibold bg-emerald-600 hover:bg-emerald-700 text-white shadow-xs cursor-pointer disabled:opacity-40">
              <CheckCircle2 className="w-3.5 h-3.5" /> Aprovar Proposta e Gerar Pedido
            </button>
          )}
        </div>
        <div className="flex items-center gap-2.5">
          <button type="button" onClick={onFechar} disabled={salvando} className="flex items-center gap-1.5 px-4 py-2.5 rounded-lg text-xs font-semibold text-stone-600 dark:text-stone-300 border border-stone-300 dark:border-stone-700 hover:bg-stone-100 dark:hover:bg-stone-800 cursor-pointer disabled:opacity-40">
            <X className="w-3.5 h-3.5" /> {rotuloVoltar ? 'Voltar' : 'Fechar'}
          </button>
          {!(bloqueado && ehProposta) && (
            <button type="submit" disabled={salvando} className="flex items-center gap-2 px-4 py-2.5 rounded-lg text-xs font-semibold bg-blue-600 hover:bg-blue-700 text-white shadow-xs cursor-pointer disabled:opacity-50">
              {salvando ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              <span>{salvando ? 'Salvando…' : 'Salvar'}</span>
            </button>
          )}
        </div>
      </div>

      {negocioRapido && (
        <ConfirmDialog
          titulo="Incluir negócio"
          mensagem="O negócio é criado aberto, com o cliente da proposta, e já fica ligado a ela."
          confirmar="Incluir"
          tom="normal"
          onConfirmar={criarNegocioRapido}
          onCancelar={() => setNegocioRapido(null)}
        >
          <div className="flex flex-col gap-3">
            <div className={FIELD_CLASS}>
              <label htmlFor="neg-rapido-titulo" className={LABEL_CLASS}>Título<span className="text-rose-500 ml-1">*</span></label>
              <input
                id="neg-rapido-titulo"
                autoFocus
                maxLength={255}
                value={negocioRapido.titulo}
                onChange={(e) => setNegocioRapido({ ...negocioRapido, titulo: e.target.value })}
                onFocus={(e) => e.target.select()}
                className={`${INPUT_CLASS} w-full`}
              />
            </div>
            <div className={FIELD_CLASS}>
              <label htmlFor="neg-rapido-etapa" className={LABEL_CLASS}>Funil › Etapa</label>
              <SelectBusca
                id="neg-rapido-etapa"
                value={negocioRapido.etapa_id}
                options={etapas}
                onChange={(v) => setNegocioRapido({ ...negocioRapido, etapa_id: v })}
                className={`${INPUT_CLASS} w-full`}
              />
            </div>
          </div>
        </ConfirmDialog>
      )}
      {removendo && (
        <ConfirmDialog
          titulo="Remover item?"
          mensagem={<><strong>{removendo.produto_nome}</strong> sai da lista. A remoção só vale depois de salvar.</>}
          confirmar="Remover"
          onConfirmar={() => {
            setItens((lista) => lista.filter((i) => i.chave !== removendo.chave));
            setRemovendo(null);
          }}
          onCancelar={() => setRemovendo(null)}
        />
      )}
      {confirmando === 'aprovar' && (
        <ConfirmDialog
          titulo="Aprovar proposta e gerar pedido?"
          mensagem={<>A proposta é salva, marcada como <strong>aceita</strong> e seus itens são copiados para um novo pedido de venda em rascunho. Total: <strong>{formatMoeda(tot.total)}</strong>. As outras versões desta proposta, se houver, ficam como <strong>fechadas</strong>.</>}
          confirmar="Aprovar e gerar pedido"
          tom="normal"
          onConfirmar={aprovar}
          onCancelar={() => setConfirmando(null)}
        />
      )}
      {confirmando === 'versao' && (
        <ConfirmDialog
          titulo="Gerar nova versão?"
          mensagem={<>A proposta salva é copiada como a próxima versão, em rascunho, para renegociação.{status === 'enviada' && ' Esta versão enviada passa a constar como recusada.'} Alterações não salvas nesta tela não vão para a cópia.</>}
          confirmar="Gerar versão"
          tom="normal"
          onConfirmar={gerarVersao}
          onCancelar={() => setConfirmando(null)}
        />
      )}
    </form>
  );
};

const Linha: React.FC<{ rotulo: string; valor: string }> = ({ rotulo, valor }) => (
  <div className="flex items-center justify-between gap-3">
    <span className="text-stone-500 dark:text-stone-400">{rotulo}</span>
    <span className="font-mono font-semibold text-stone-800 dark:text-stone-100">{valor}</span>
  </div>
);

/** Pesquisa no catálogo (nome, SKU ou descrição) com lista suspensa; Enter inclui o primeiro */
const BuscaProduto: React.FC<{ onEscolher: (p: ProdutoBusca) => void }> = ({ onEscolher }) => {
  const [termo, setTermo] = useState('');
  const [resultados, setResultados] = useState<ProdutoBusca[]>([]);
  const [aberto, setAberto] = useState(false);
  const [buscando, setBuscando] = useState(false);
  const ultimo = useRef(0);

  useEffect(() => {
    if (!aberto) return;
    const pedido = ++ultimo.current;
    setBuscando(true);
    const t = setTimeout(() => {
      buscarProdutos(termo)
        .then((r) => pedido === ultimo.current && setResultados(r))
        .catch(() => pedido === ultimo.current && setResultados([]))
        .finally(() => pedido === ultimo.current && setBuscando(false));
    }, 250);
    return () => clearTimeout(t);
  }, [termo, aberto]);

  const escolher = (p: ProdutoBusca) => {
    onEscolher(p);
    setTermo('');
    setAberto(false);
  };

  return (
    <div className="relative w-72 max-w-full">
      <PackageSearch className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-stone-400 pointer-events-none" />
      <input
        value={termo}
        onChange={(e) => {
          setTermo(e.target.value);
          setAberto(true);
        }}
        onFocus={() => setAberto(true)}
        onBlur={() => setTimeout(() => setAberto(false), 150)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            if (resultados[0]) escolher(resultados[0]);
          }
          if (e.key === 'Escape') setAberto(false);
        }}
        placeholder="Incluir produto: nome ou SKU…"
        className={`${INPUT_CLASS} w-full pl-9`}
      />
      {aberto && (
        <div className="absolute right-0 top-full mt-1 z-30 w-96 max-w-[90vw] max-h-72 overflow-y-auto rounded-lg border border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-900 shadow-xl">
          {buscando && resultados.length === 0 && <div className="px-3 py-3 text-xs text-stone-500">Pesquisando…</div>}
          {!buscando && resultados.length === 0 && <div className="px-3 py-3 text-xs text-stone-500">Nenhum produto ativo encontrado.</div>}
          {resultados.map((p) => (
            <button
              key={p.id}
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => escolher(p)}
              className="w-full px-3 py-2 flex items-center justify-between gap-3 text-left hover:bg-blue-50 dark:hover:bg-blue-950/40 cursor-pointer"
            >
              <span className="min-w-0">
                <span className="block text-xs font-semibold text-stone-800 dark:text-stone-100 truncate">{p.nome}</span>
                <span className="block text-[10px] font-mono text-stone-400">{p.codigo_sku || '—'} • {p.unidade_medida}</span>
              </span>
              <span className="text-xs font-mono font-semibold text-stone-700 dark:text-stone-200 shrink-0">{formatMoeda(p.preco_tabela)}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
};
