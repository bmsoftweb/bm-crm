import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { SelectAuto } from './SelectAuto';
import { AlignLeft, Code2, FileCode2, FlaskConical, ListFilter, Loader2, Plus, Sparkles, Trash2, X } from 'lucide-react';
import { OpcaoRef } from '../types';
import { INPUT_CLASS } from '../utils/formStyles';
import { formatarSql } from '../utils/formatters';
import { fetchOptions, fetchRegrasCriterio, gerarSelecaoIa, RegraCriterio, SelecaoIa, testarCriterios, TesteCriterios } from '../services/api';
import { NumberField } from './NumberField';
import { SelectBusca } from './SelectBusca';
import { Toggle } from './Toggle';
import { ConfirmDialog } from './ConfirmDialog';

interface Criterio {
  regra: string;
  operador: string;
  valor: string | number;
}

interface Props {
  id?: string;
  /** Lista de critérios ou a seleção com IA (ou o JSON delas, como vem do banco); '' numa campanha nova */
  value: unknown;
  onChange: (valor: Criterio[] | SelecaoIa) => void;
}

const OPERADORES_NUMERO = [
  { value: '=', label: 'igual a' },
  { value: '<>', label: 'diferente de' },
  { value: '>', label: 'maior que' },
  { value: '>=', label: 'maior ou igual a' },
  { value: '<', label: 'menor que' },
  { value: '<=', label: 'menor ou igual a' },
];
const OPERADORES_IGUALDADE = OPERADORES_NUMERO.slice(0, 2);
const OPERADORES_TEXTO = [...OPERADORES_IGUALDADE, { value: 'contem', label: 'que contém' }, { value: 'comeca', label: 'começa com' }];

const TIPOS_PESSOA = [
  { value: 'lead', label: 'Lead' },
  { value: 'cliente', label: 'Cliente' },
];

function lerValor(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  try {
    return value ? JSON.parse(value) : [];
  } catch {
    return [];
  }
}

/** Seleção com IA gravada ({ modo: 'ia', ... }); null = critérios */
function lerIa(value: unknown): SelecaoIa | null {
  const v: any = lerValor(value);
  return v && !Array.isArray(v) && typeof v === 'object' && v.modo === 'ia'
    ? { modo: 'ia', pedido: String(v.pedido ?? ''), sql: String(v.sql ?? ''), explicacao: String(v.explicacao ?? '') }
    : null;
}

function lerLista(value: unknown): Criterio[] {
  let v: any = lerValor(value);
  if (v && !Array.isArray(v) && typeof v === 'object') v = v.modo === 'ia' ? [] : [v];
  return Array.isArray(v) ? (v as Criterio[]) : [];
}

const valorInicial = (r?: RegraCriterio): string | number =>
  r?.valor === 'sim_nao' ? 1 : r?.valor === 'numero' ? 0 : r?.valor === 'tipo_pessoa' ? 'cliente' : '';

/**
 * Público da campanha, em duas abas: "Por critérios" (regra, operador e valor por linha; todas precisam valer) ou
 * "Com IA" (o pedido em português vira um SQL montado pela IA; o SQL fica visível e é conferido no servidor)
 */
export const CriteriosSegmento: React.FC<Props> = ({ id, value, onChange }) => {
  const ia = lerIa(value);
  const lista = lerLista(value);
  const [modo, setModo] = useState<'criterios' | 'ia'>(ia ? 'ia' : 'criterios');
  /** O que estava na outra aba: volta ao trocar de aba de novo */
  const [guardado, setGuardado] = useState<{ criterios: Criterio[]; ia: SelecaoIa }>({
    criterios: lista,
    ia: ia ?? { modo: 'ia', pedido: '', sql: '', explicacao: '' },
  });
  const iaAtual: SelecaoIa = ia ?? guardado.ia;
  const [gerando, setGerando] = useState(false);
  const [totalIa, setTotalIa] = useState<number | null>(null);
  const [verSql, setVerSql] = useState(false);
  /** SQL mexido à mão depois de gerar: a explicação e o total da IA podem não valer mais */
  const [sqlEditado, setSqlEditado] = useState(false);
  /** Pedido mudou depois de gerar: o SQL é do pedido antigo */
  const [pedidoGerado, setPedidoGerado] = useState(iaAtual.pedido);
  const trocarModo = (novo: 'criterios' | 'ia') => {
    if (novo === modo) return;
    setGuardado(modo === 'ia' ? { ...guardado, ia: iaAtual } : { ...guardado, criterios: lista });
    setModo(novo);
    setTeste(null);
    setErro(null);
    onChange(novo === 'ia' ? guardado.ia : guardado.criterios);
  };
  const gerarIa = async () => {
    setGerando(true);
    setErro(null);
    setTeste(null);
    try {
      const r = await gerarSelecaoIa(iaAtual.pedido);
      onChange({ modo: 'ia', pedido: r.pedido, sql: formatarSql(r.sql), explicacao: r.explicacao });
      setSqlEditado(false);
      setTotalIa(r.total);
      setPedidoGerado(r.pedido);
    } catch (e: any) {
      setErro(e.message);
    } finally {
      setGerando(false);
    }
  };
  const [regras, setRegras] = useState<RegraCriterio[]>([]);
  const [segmentos, setSegmentos] = useState<OpcaoRef[]>([]);
  const [erro, setErro] = useState<string | null>(null);
  const [removendo, setRemovendo] = useState<number | null>(null);
  const [testando, setTestando] = useState(false);
  const [teste, setTeste] = useState<TesteCriterios | null>(null);
  /** "Raw": o SQL que rodou no último Testar da seleção com IA */
  const [sqlRaw, setSqlRaw] = useState<string | null>(null);
  const [verRaw, setVerRaw] = useState(false);

  // Esc fecha o resultado do teste
  useEffect(() => {
    if (!teste) return;
    const tecla = (e: KeyboardEvent) => e.key === 'Escape' && setTeste(null);
    document.addEventListener('keydown', tecla);
    return () => document.removeEventListener('keydown', tecla);
  }, [teste]);

  /** "Testar": os critérios como estão na tela (ainda sem gravar) */
  const testar = async () => {
    setTestando(true);
    setErro(null);
    try {
      const r = await testarCriterios(modo === 'ia' ? iaAtual : lista);
      setTeste(r);
      setSqlRaw(r.sqlExecutado ? formatarSql(r.sqlExecutado) : null);
    } catch (e: any) {
      setErro(e.message);
    } finally {
      setTestando(false);
    }
  };

  useEffect(() => {
    fetchRegrasCriterio().then(setRegras).catch((e) => setErro(e.message));
    fetchOptions('segmentos', 'nome').then(setSegmentos).catch(() => {});
  }, []);

  const regraDe = (nome: string) => regras.find((r) => r.regra === nome);
  const alterar = (i: number, mudanca: Partial<Criterio>) => onChange(lista.map((c, j) => (j === i ? { ...c, ...mudanca } : c)));
  const adicionar = () => {
    const r = regras[0];
    if (r) onChange([...lista, { regra: r.regra, operador: '=', valor: valorInicial(r) }]);
  };

  const campoValor = (c: Criterio, i: number) => {
    const tipo = regraDe(c.regra)?.valor;
    const cls = `${INPUT_CLASS} w-full`;
    if (tipo === 'numero') return <NumberField value={c.valor} onChange={(v) => alterar(i, { valor: v })} scale={regraDe(c.regra)?.casas ?? 0} required className={cls} />;
    if (tipo === 'lista')
      return (
        <SelectAuto value={String(c.valor)} onChange={(e) => alterar(i, { valor: e.target.value })} required className={`${cls} cursor-pointer`}>
          <option value="">— Selecione —</option>
          {(regraDe(c.regra)?.opcoes ?? []).map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </SelectAuto>
      );
    if (tipo === 'sim_nao') return <Toggle checked={Boolean(Number(c.valor))} onChange={(v) => alterar(i, { valor: v ? 1 : 0 })} />;
    if (tipo === 'tipo_pessoa')
      return (
        <SelectAuto value={String(c.valor)} onChange={(e) => alterar(i, { valor: e.target.value })} required className={`${cls} cursor-pointer`}>
          {TIPOS_PESSOA.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </SelectAuto>
      );
    if (tipo === 'segmento')
      return <SelectBusca value={c.valor} options={segmentos} onChange={(v) => alterar(i, { valor: v })} required vazioLabel="— Selecione —" className={cls} />;
    return <input type="text" value={String(c.valor ?? '')} onChange={(e) => alterar(i, { valor: e.target.value })} required className={cls} />;
  };

  return (
    <div id={id} className="flex flex-col gap-2">
      <div role="tablist" className="flex gap-1 border-b border-stone-200 dark:border-stone-800">
        {(
          [
            ['criterios', 'Selecionar por critérios', ListFilter],
            ['ia', 'Selecionar com IA', Sparkles],
          ] as const
        ).map(([m, nome, Icone]) => (
          <button
            key={m}
            type="button"
            role="tab"
            aria-selected={modo === m}
            onClick={() => trocarModo(m)}
            className={`flex items-center gap-1.5 px-3 py-2 -mb-px border-b-2 text-xs font-semibold cursor-pointer ${
              modo === m ? 'border-blue-600 text-blue-700 dark:text-blue-300' : 'border-transparent text-stone-500 hover:text-stone-800 dark:text-stone-400 dark:hover:text-stone-200'
            }`}
          >
            <Icone className="w-3.5 h-3.5" />
            {nome}
          </button>
        ))}
      </div>
      {erro && <span className="text-xs text-rose-600">{erro}</span>}
      {modo === 'ia' && (
        <div className="flex flex-col gap-2">
          <textarea
            value={iaAtual.pedido}
            onChange={(e) => onChange({ ...iaAtual, pedido: e.target.value })}
            rows={3}
            maxLength={2000}
            required
            placeholder="Ex.: clientes de Santa Catarina que compraram papel A4 nos últimos 90 dias e não abriram chamado no último mês"
            aria-label="Quem deve receber a campanha"
            className={`${INPUT_CLASS} w-full resize-y`}
          />
          <p className="text-[11px] text-stone-500 dark:text-stone-400">
            Descreva em português quem deve receber. A IA usa pessoas, contatos, endereços, segmentos, negócios, atividades, propostas, pedidos,
            contratos, chamados, WhatsApp, vendas (vendas_produtos), avaliações e campanhas anteriores. Quem pediu para não receber campanhas fica de fora.
          </p>
          {iaAtual.sql && (
            <div className="rounded-lg bg-stone-50 dark:bg-stone-800/60 p-2.5 text-xs text-stone-700 dark:text-stone-200 flex flex-col gap-1.5">
              {iaAtual.explicacao && <p>{iaAtual.explicacao}</p>}
              <p className="text-[11px] text-stone-500 dark:text-stone-400">
                {totalIa !== null && (
                  <>
                    <b className="text-stone-800 dark:text-stone-100">{totalIa.toLocaleString('pt-BR')}</b> pessoa(s) selecionada(s).{' '}
                  </>
                )}
                {sqlEditado && <span className="text-amber-700 dark:text-amber-400">SQL alterado à mão: use Testar para conferir. </span>}
                {iaAtual.pedido.trim() !== pedidoGerado.trim() && (
                  <span className="text-amber-700 dark:text-amber-400">O pedido mudou: gere a seleção de novo. </span>
                )}
                <button type="button" onClick={() => setVerSql(!verSql)} className="inline-flex items-center gap-1 font-semibold text-blue-600 hover:underline cursor-pointer">
                  <Code2 className="w-3 h-3" /> {verSql ? 'Esconder o SQL' : 'Ver / editar o SQL'}
                </button>
              </p>
              {verSql && (
                <>
                  <textarea
                    value={iaAtual.sql}
                    onChange={(e) => {
                      onChange({ ...iaAtual, sql: e.target.value });
                      setSqlEditado(true);
                      setTotalIa(null);
                      setTeste(null);
                    }}
                    rows={18}
                    spellCheck={false}
                    aria-label="SQL da seleção"
                    className={`${INPUT_CLASS} w-full min-h-[22rem] resize-y font-mono text-[11px] leading-relaxed whitespace-pre`}
                  />
                  <div className="flex items-center justify-between gap-2 text-[11px] text-stone-500 dark:text-stone-400">
                    <span>Só SELECT, devolvendo p.id, com :empresa no lugar do número da empresa. O servidor confere ao testar e ao gravar.</span>
                    <button
                      type="button"
                      onClick={() => onChange({ ...iaAtual, sql: formatarSql(iaAtual.sql) })}
                      title="Uma cláusula por linha, com recuo"
                      className="shrink-0 inline-flex items-center gap-1 font-semibold text-blue-600 hover:underline cursor-pointer"
                    >
                      <AlignLeft className="w-3 h-3" /> Formatar
                    </button>
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      )}
      {modo === 'criterios' && lista.map((c, i) => {
        const r = regraDe(c.regra);
        const operadores = r?.valor === 'numero' ? OPERADORES_NUMERO : r?.valor === 'texto' ? OPERADORES_TEXTO : OPERADORES_IGUALDADE;
        return (
          <div key={i} className="grid grid-cols-1 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1.5fr)_auto] gap-2 items-center">
            <SelectAuto
              value={c.regra}
              onChange={(e) => {
                const nova = regraDe(e.target.value);
                alterar(i, { regra: e.target.value, operador: '=', valor: valorInicial(nova) });
              }}
              className={`${INPUT_CLASS} w-full cursor-pointer`}
            >
              {!r && <option value={c.regra}>{c.regra}</option>}
              {regras.map((o) => (
                <option key={o.regra} value={o.regra}>
                  {o.rotulo}
                </option>
              ))}
            </SelectAuto>
            <SelectAuto value={c.operador} onChange={(e) => alterar(i, { operador: e.target.value })} className={`${INPUT_CLASS} w-full cursor-pointer`}>
              {operadores.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </SelectAuto>
            {campoValor(c, i)}
            <button
              type="button"
              onClick={() => setRemovendo(i)}
              title="Remover critério"
              className="h-full min-h-8 px-2 rounded text-stone-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40 cursor-pointer"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
        );
      })}
      <div className="flex flex-wrap gap-2">
        {modo === 'ia' ? (
          <button
            type="button"
            onClick={gerarIa}
            disabled={gerando || !iaAtual.pedido.trim()}
            title="A IA lê o pedido, monta o SQL do público e conta quantas pessoas entram"
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold bg-blue-600 hover:bg-blue-700 text-white cursor-pointer disabled:opacity-40"
          >
            {gerando ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
            {gerando ? 'Montando a seleção…' : iaAtual.sql ? 'Gerar de novo' : 'Gerar seleção com IA'}
          </button>
        ) : (
        <button
          type="button"
          onClick={adicionar}
          disabled={!regras.length}
          className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-900 hover:bg-blue-50 dark:hover:bg-blue-950/40 cursor-pointer disabled:opacity-40"
        >
          <Plus className="w-3.5 h-3.5" />
          Adicionar critério
        </button>
        )}
        <button
          type="button"
          onClick={testar}
          disabled={(modo === 'ia' ? !iaAtual.sql : !lista.length) || testando}
          title="Mostra quantas pessoas entram no público e as 50 primeiras, com os critérios como estão agora (sem gravar)"
          className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold text-stone-700 dark:text-stone-200 border border-stone-300 dark:border-stone-700 hover:bg-stone-100 dark:hover:bg-stone-800 cursor-pointer disabled:opacity-40"
        >
          {testando ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <FlaskConical className="w-3.5 h-3.5" />}
          Testar
        </button>
        {modo === 'ia' && (
          <button
            type="button"
            onClick={() => setVerRaw(!verRaw)}
            disabled={!sqlRaw}
            title={sqlRaw ? 'O SQL que rodou no banco no último Testar' : 'Clique em Testar primeiro'}
            className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold border cursor-pointer disabled:opacity-40 disabled:cursor-default ${
              verRaw && sqlRaw
                ? 'border-blue-300 dark:border-blue-800 bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300'
                : 'text-stone-700 dark:text-stone-200 border-stone-300 dark:border-stone-700 hover:bg-stone-100 dark:hover:bg-stone-800'
            }`}
          >
            <FileCode2 className="w-3.5 h-3.5" />
            Raw
          </button>
        )}
      </div>
      {modo === 'ia' && verRaw && sqlRaw && (
        <pre className="max-h-[28rem] overflow-auto rounded-lg bg-stone-50 dark:bg-stone-900 border border-stone-200 dark:border-stone-700 p-2.5 font-mono text-[11px] leading-relaxed whitespace-pre select-all">
          {sqlRaw}
        </pre>
      )}

      {teste &&
        createPortal(
          <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
            <div className="fixed inset-0 bg-stone-950/70 backdrop-blur-xs" onClick={() => setTeste(null)} aria-hidden="true" />
            <div role="dialog" aria-modal="true" className="relative w-full max-w-4xl max-h-[85vh] flex flex-col bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-800 rounded-2xl shadow-2xl z-10">
              <div className="flex items-center justify-between gap-3 px-5 py-3 border-b border-stone-200 dark:border-stone-800">
                <div>
                  <h3 className="text-base font-bold text-stone-900 dark:text-stone-100">Teste dos critérios</h3>
                  <p className="text-xs text-stone-500 dark:text-stone-400">
                    <strong>{teste.total.toLocaleString('pt-BR')}</strong> pessoa(s) no público
                    {teste.total > teste.pessoas.length ? `; aqui as ${teste.pessoas.length} primeiras, por nome` : ''}. Quem pediu para não receber campanhas fica de fora.
                  </p>
                </div>
                <button type="button" onClick={() => setTeste(null)} title="Fechar" className="p-1 rounded text-stone-400 hover:text-stone-700 cursor-pointer">
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="overflow-auto">
                {!teste.pessoas.length ? (
                  <p className="p-5 text-xs text-stone-500">Ninguém atende aos critérios.</p>
                ) : (
                  <table className="w-full text-xs">
                    <thead className="sticky top-0 bg-stone-50 dark:bg-stone-800 text-stone-500 dark:text-stone-400">
                      <tr>
                        <th className="text-left font-semibold px-3 py-2">Nome</th>
                        <th className="text-left font-semibold px-3 py-2">Cód. integração</th>
                        <th className="text-left font-semibold px-3 py-2">Tipo</th>
                        <th className="text-left font-semibold px-3 py-2">Cidade / UF</th>
                        <th className="text-left font-semibold px-3 py-2">Telefone</th>
                        <th className="text-left font-semibold px-3 py-2">E-mail</th>
                      </tr>
                    </thead>
                    <tbody>
                      {teste.pessoas.map((p) => (
                        <tr key={p.id} className="border-t border-stone-100 dark:border-stone-800 text-stone-700 dark:text-stone-200">
                          <td className="px-3 py-1.5 font-semibold">{p.nome}</td>
                          <td className="px-3 py-1.5 font-mono">{p.cod_integracao || '—'}</td>
                          <td className="px-3 py-1.5">{p.tipo === 'cliente' ? 'Cliente' : p.tipo === 'lead' ? 'Lead' : p.tipo}</td>
                          <td className="px-3 py-1.5">{p.cidade || '—'}</td>
                          <td className="px-3 py-1.5 whitespace-nowrap">{p.telefone || '—'}</td>
                          <td className="px-3 py-1.5">{p.email || '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          </div>,
          document.body,
        )}

      {removendo !== null && (
        <ConfirmDialog
          titulo="Remover o critério?"
          mensagem={`"${regraDe(lista[removendo]?.regra)?.rotulo ?? lista[removendo]?.regra}" sai do público ao salvar.`}
          confirmar="Remover"
          onConfirmar={() => {
            onChange(lista.filter((_, j) => j !== removendo));
            setRemovendo(null);
          }}
          onCancelar={() => setRemovendo(null)}
        />
      )}
    </div>
  );
};
