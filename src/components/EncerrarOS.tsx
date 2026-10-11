import React, { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { CheckCircle2, Loader2, Plus, Trash2, X } from 'lucide-react';
import { encerrarOS, fetchOS, listRecords } from '../services/api';
import { RegistroCrud } from '../types';
import { FIELD_CLASS, HINT_CLASS, INPUT_CLASS, LABEL_CLASS } from '../utils/formStyles';
import { formatMoeda } from '../utils/formatters';
import { BotaoAcao } from './MenuAcoes';
import { AvisoErro } from './AvisoErro';
import { DateField } from './DateField';
import { NumberField } from './NumberField';
import { SelectBusca } from './SelectBusca';
import { ConfirmDialog } from './ConfirmDialog';

interface Item {
  servico_id: string;
  quantidade: string;
  preco_unitario: string;
  desconto: string;
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
            servico_id: String(i.servico_id),
            quantidade: String(i.quantidade),
            preco_unitario: String(i.preco_unitario),
            desconto: String(i.desconto),
          })),
        );
      })
      .catch((e) => setErro(e.message || 'Não foi possível abrir a OS.'));
  }, [osId]);

  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && !salvando && remover === null && onFechar();
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [onFechar, salvando, remover]);

  // Ativos no combo; inativo só aparece se já estiver na OS
  const opcoes = useMemo(
    () =>
      catalogo
        .filter((s) => Number(s.ativo) || itens.some((i) => i.servico_id === String(s.id)))
        .map((s) => ({ value: String(s.id), label: `${s.nome}${Number(s.ativo) ? '' : ' (inativo)'}` })),
    [catalogo, itens],
  );
  const doCatalogo = (id: string) => catalogo.find((s) => String(s.id) === id);
  const preco = (i: Item) => (i.preco_unitario === '' ? Number(doCatalogo(i.servico_id)?.preco) || 0 : Number(i.preco_unitario));
  const subtotal = (i: Item) => Math.round(((Number(i.quantidade) || 0) * preco(i) - (Number(i.desconto) || 0)) * 100) / 100;
  const total = itens.reduce((t, i) => t + (i.servico_id ? subtotal(i) : 0), 0);
  const mudar = (n: number, campo: keyof Item, valor: string) => setItens((l) => l.map((i, k) => (k === n ? { ...i, [campo]: valor } : i)));

  const encerrar = async (e: React.FormEvent) => {
    e.preventDefault();
    if (itens.some((i) => !i.servico_id)) return setErro('Escolha o serviço de cada linha (ou tire a linha vazia).');
    setSalvando(true);
    setErro(null);
    try {
      await encerrarOS(osId, {
        servico_executado: feito,
        inicio_em: inicio || null,
        fim_em: fim || null,
        assinatura_nome: assinadoPor,
        assinatura_documento: documento,
        itens: itens.map((i) => ({ ...i, preco_unitario: i.preco_unitario === '' ? null : i.preco_unitario })),
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
              <div className="flex items-center justify-between mb-1.5">
                <span className={LABEL_CLASS}>Serviços</span>
                <button
                  type="button"
                  onClick={() => setItens((l) => [...l, { servico_id: '', quantidade: '1', preco_unitario: '', desconto: '' }])}
                  className="flex items-center gap-1 text-xs font-semibold text-blue-600 hover:text-blue-700 cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5" /> Adicionar serviço
                </button>
              </div>
              {itens.length === 0 ? (
                <p className="text-xs text-stone-400 py-2">Nenhum serviço lançado.</p>
              ) : (
                <div className="space-y-2">
                  <div className="grid grid-cols-[1fr_90px_100px_90px_90px_32px] gap-2 text-[10px] font-semibold uppercase text-stone-400">
                    <span>Serviço</span>
                    <span className="text-right">Qtd.</span>
                    <span className="text-right">Preço unit.</span>
                    <span className="text-right">Desconto</span>
                    <span className="text-right">Subtotal</span>
                    <span />
                  </div>
                  {itens.map((i, n) => (
                    <div key={n} className="grid grid-cols-[1fr_90px_100px_90px_90px_32px] gap-2 items-center">
                      <SelectBusca value={i.servico_id} options={opcoes} onChange={(v) => mudar(n, 'servico_id', v)} required vazioLabel="— Escolha —" />
                      <NumberField value={i.quantidade} onChange={(v) => mudar(n, 'quantidade', v)} scale={3} required className={`${INPUT_CLASS} text-right`} />
                      <NumberField
                        value={i.preco_unitario}
                        onChange={(v) => mudar(n, 'preco_unitario', v)}
                        scale={2}
                        placeholder={i.servico_id ? formatMoeda(doCatalogo(i.servico_id)?.preco).replace('R$', '').trim() : ''}
                        className={`${INPUT_CLASS} text-right`}
                      />
                      <NumberField value={i.desconto} onChange={(v) => mudar(n, 'desconto', v)} scale={2} className={`${INPUT_CLASS} text-right`} />
                      <span className="text-right text-xs font-semibold tabular-nums">{i.servico_id ? formatMoeda(subtotal(i)) : '—'}</span>
                      <button type="button" title="Tirar a linha" onClick={() => setRemover(n)} className="p-1.5 rounded-lg text-stone-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40 cursor-pointer">
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  ))}
                  <div className="flex justify-end gap-3 pt-2 border-t border-stone-200 dark:border-stone-800 text-sm font-bold">
                    <span>Total</span>
                    <span className="tabular-nums">{formatMoeda(total)}</span>
                  </div>
                  <span className={HINT_CLASS}>Preço em branco: o do cadastro de Serviços.</span>
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
          titulo="Tirar serviço"
          mensagem="Tirar esta linha de serviço da OS? Só vale depois de Encerrar OS."
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
