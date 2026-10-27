import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Loader2, Inbox, X, ExternalLink, ChevronDown, ChevronUp, Plus, Pencil, Trash2, Lock } from 'lucide-react';
import { DetailDef, OpcaoRef, RegistroCrud, ResourceDef } from '../types';
import { formatCurrencyBRL } from '../utils/formatters';
import { listRecords, fetchOptions, createRecord, updateRecord, deleteRecord, invalidateOptions, travaContrato } from '../services/api';
import { CellValue } from './CellValue';
import { AvisoErro } from './AvisoErro';
import { RecordForm } from './RecordForm';

/** Como nas listas: números à direita; datas e sim/não centralizados */
const alinhar = (tipo: string) =>
  tipo === 'number' || tipo === 'decimal' ? 'text-right' : tipo === 'date' || tipo === 'datetime' || tipo === 'boolean' ? 'text-center' : 'text-left';
import { ConfirmDialog } from './ConfirmDialog';

interface DetailPanelProps {
  /** Recurso pai (ex.: pedidos) */
  parent: ResourceDef;
  /** Registro selecionado na grade principal */
  parentRow: RegistroCrud;
  /** Grades filhas declaradas no metadado do pai */
  details: DetailDef[];
  /** Definições completas dos recursos, para resolver o filho pelo nome */
  allResources: ResourceDef[];
  /** Rótulo curto do registro pai, exibido no cabeçalho do painel */
  parentLabel: string;
  refreshToken: number;
  onClose: () => void;
  /** Navega para a tela própria do recurso filho */
  onOpenResource: (resourceName: string) => void;
  /** Botões extras na linha (ex.: WhatsApp do contato); null quando o recurso não tem */
  acoesLinha?: (recurso: string, row: RegistroCrud, ctx: { recarregar: () => void }) => React.ReactNode;
  /** Recolhido controlado pela lista: o painel é recriado a cada registro, e a escolha do usuário continua valendo */
  recolhido?: boolean;
  onRecolhidoChange?: (v: boolean) => void;
}

const DETAIL_LIMIT = 200;

export const DetailPanel: React.FC<DetailPanelProps> = ({
  parent,
  parentRow,
  details,
  allResources,
  parentLabel,
  refreshToken,
  onClose,
  onOpenResource,
  acoesLinha,
  recolhido,
  onRecolhidoChange,
}) => {
  const [activeDetail, setActiveDetail] = useState(0);
  const [recolhidoLocal, setRecolhidoLocal] = useState(false);
  const isCollapsed = recolhido ?? recolhidoLocal;
  const setIsCollapsed = (v: boolean | ((c: boolean) => boolean)) => {
    const novo = typeof v === 'function' ? v(isCollapsed) : v;
    if (onRecolhidoChange) onRecolhidoChange(novo);
    else setRecolhidoLocal(novo);
  };
  const [rows, setRows] = useState<RegistroCrud[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refOptions, setRefOptions] = useState<Record<string, OpcaoRef[]>>({});
  /** Painel editável (detail.editavel): registro no formulário (null = inclusão) e o que está para excluir */
  const [editando, setEditando] = useState<{ record: RegistroCrud | null } | null>(null);
  const [excluindo, setExcluindo] = useState<RegistroCrud | null>(null);

  const detail = details[Math.min(activeDetail, details.length - 1)];
  const childResource = useMemo(
    () => allResources.find((r) => r.name === detail?.resource) || null,
    [allResources, detail?.resource],
  );

  // A PK do pai usada no filtro (mestre-detalhe só se aplica a PK simples)
  const parentId = parent.pk.length === 1 ? String(parentRow[parent.pk[0]] ?? '') : '';

  /** Colunas do filho, omitindo a própria chave estrangeira (redundante aqui) */
  const listedFields = useMemo(
    () =>
      (childResource?.fields || []).filter((f) => f.listed && f.name !== detail?.foreignKey),
    [childResource, detail?.foreignKey],
  );

  // Volta para a primeira aba ao trocar de registro pai
  useEffect(() => {
    setActiveDetail(0);
  }, [parentId]);

  /** Contrato assinado e travado: os itens só mudam por aditivo */
  const [paiTravado, setPaiTravado] = useState(false);
  useEffect(() => {
    setPaiTravado(false);
    if (parent.name !== 'contratos' || !parentId) return;
    let vivo = true;
    travaContrato(parentId)
      .then((t) => vivo && setPaiTravado(t.travado))
      .catch(() => {});
    return () => {
      vivo = false;
    };
  }, [parent.name, parentId, refreshToken]);

  // Combos de chave estrangeira do recurso filho
  useEffect(() => {
    let alive = true;
    const refFields = (childResource?.fields || []).filter((f) => f.ref);
    if (!refFields.length) {
      setRefOptions({});
      return;
    }

    (async () => {
      const map: Record<string, OpcaoRef[]> = {};
      for (const f of refFields) {
        try {
          map[f.name] = await fetchOptions(f.ref!.resource, f.ref!.labelField);
        } catch {
          map[f.name] = [];
        }
      }
      if (alive) setRefOptions(map);
    })();

    return () => {
      alive = false;
    };
  }, [childResource]);

  const load = useCallback(async () => {
    if (!childResource || !detail || !parentId) {
      setRows([]);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setError(null);
    try {
      const data = await listRecords(childResource.name, {
        limit: DETAIL_LIMIT,
        filterField: detail.foreignKey,
        filterValue: parentId,
        sort: detail.editavel ? childResource.defaultSort.field : childResource.pk[0],
        dir: detail.editavel ? childResource.defaultSort.dir : 'asc',
      });
      setRows(data.data);
    } catch (err: any) {
      setError(err.message || 'Falha ao carregar os itens.');
      setRows([]);
    } finally {
      setIsLoading(false);
    }
  }, [childResource, detail, parentId]);

  useEffect(() => {
    load();
  }, [load, refreshToken]);

  const total = useMemo(() => {
    if (!detail?.totalField) return null;
    return rows.reduce((acc, r) => acc + (Number(r[detail.totalField!]) || 0), 0);
  }, [rows, detail?.totalField]);

  /**
   * No formulário a chave do pai já vem preenchida (ex.: o funil da etapa). Chave sem vínculo
   * escolhível (ex.: a pessoa do contato, só um número) nem aparece: vem do pai ao incluir.
   */
  const fkFixa = Boolean(childResource?.fields.find((f) => f.name === detail?.foreignKey && !f.ref));
  const recursoForm = useMemo(
    () =>
      childResource && detail
        ? {
            ...childResource,
            fields: childResource.fields
              .filter((f) => !(fkFixa && f.name === detail.foreignKey))
              .map((f) => (f.name === detail.foreignKey ? { ...f, default: parentId } : f)),
          }
        : null,
    [childResource, detail, parentId, fkFixa],
  );

  if (!childResource || !detail) return null;

  const editavel = Boolean(detail.editavel) && !paiTravado;
  const podeEditar = editavel && childResource.canUpdate;
  const podeExcluir = editavel && childResource.canDelete;
  const pkFilho = (r: RegistroCrud) => r[childResource.pk[0]] as string | number;
  /** O recurso tem botões extras nas linhas (a coluna Ações aparece mesmo sem editar/excluir) */
  const extras = Boolean(rows.length && acoesLinha?.(childResource.name, rows[0], { recarregar: load }));
  const aposAlterar = () => {
    invalidateOptions(childResource.name); // combos que usam o filho (ex.: etapa do negócio)
    load();
  };

  return (
    <div
      className={`shrink-0 border-t-2 border-blue-500/60 dark:border-blue-600/60 bg-white dark:bg-stone-900 flex flex-col ${
        isCollapsed ? '' : 'h-[38%] min-h-[200px]'
      }`}
    >
      {/* Cabeçalho do painel: abas das grades filhas + identificação do pai */}
      <div className="flex items-center justify-between gap-3 px-3 border-b border-stone-200 dark:border-stone-800 bg-stone-50 dark:bg-stone-950/60 shrink-0">
        <div className="flex items-stretch min-w-0 overflow-x-auto overflow-y-hidden">
          {details.map((d, i) => {
            const ativa = i === Math.min(activeDetail, details.length - 1);
            return (
              <button
                key={d.resource}
                onClick={() => {
                  setActiveDetail(i);
                  setIsCollapsed(false);
                }}
                className={`px-3 py-2 text-xs font-semibold whitespace-nowrap transition-colors cursor-pointer border-b-2 ${
                  ativa
                    ? 'text-blue-700 dark:text-blue-400 border-blue-600'
                    : 'text-stone-500 dark:text-stone-400 border-transparent hover:text-stone-800 dark:hover:text-stone-200'
                }`}
              >
                {d.label}
                {ativa && !isLoading && (
                  <span className="ml-1.5 text-[10px] font-mono text-stone-400">{rows.length}</span>
                )}
              </button>
            );
          })}
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {paiTravado && (
            <span
              title="Contrato assinado: os itens só mudam por aditivo (Documentos › Liberar para aditivo)"
              className="flex items-center gap-1 text-[11px] font-semibold text-stone-500 dark:text-stone-400"
            >
              <Lock className="w-3.5 h-3.5" />
              Travado
            </span>
          )}
          {editavel && childResource.canCreate && (
            <button
              onClick={() => setEditando({ record: null })}
              title={`Incluir ${childResource.labelSingular.toLowerCase()} em ${parentLabel}`}
              className="flex items-center gap-1 px-2 py-1 rounded text-[11px] font-semibold text-blue-700 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-950/40 transition-colors cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
              Incluir
            </button>
          )}
          <span className="hidden sm:inline text-[11px] text-stone-500 dark:text-stone-400 truncate max-w-[280px]">
            {parent.labelSingular} <strong className="text-stone-700 dark:text-stone-200">{parentLabel}</strong>
          </span>

          {/* Recurso sem menu próprio (ex.: etapas) é mantido só aqui: não há tela para abrir */}
          {!childResource.oculto && (
            <button
              onClick={() => onOpenResource(childResource.name)}
              title={`Abrir a tela de ${childResource.label}`}
              className="p-1.5 rounded text-stone-400 hover:text-blue-600 hover:bg-blue-50 dark:hover:text-blue-400 dark:hover:bg-blue-950/40 transition-colors cursor-pointer"
            >
              <ExternalLink className="w-3.5 h-3.5" />
            </button>
          )}
          <button
            onClick={() => setIsCollapsed((c) => !c)}
            title={isCollapsed ? 'Expandir painel' : 'Recolher painel'}
            className="p-1.5 rounded text-stone-400 hover:text-stone-700 dark:hover:text-stone-200 hover:bg-stone-200/60 dark:hover:bg-stone-800 transition-colors cursor-pointer"
          >
            {isCollapsed ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
          </button>
          <button
            onClick={onClose}
            title="Fechar painel de detalhe"
            className="p-1.5 rounded text-stone-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:text-rose-400 dark:hover:bg-rose-950/40 transition-colors cursor-pointer"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {!isCollapsed && (
        <>
          <div className="flex-1 overflow-auto min-h-0">
            {error && (
              <AvisoErro mensagem={error} onFechar={() => setError(null)} className="m-3" />
            )}

            {isLoading ? (
              <div className="flex items-center justify-center gap-2 py-10 text-stone-500 dark:text-stone-400 text-xs">
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>Carregando {detail.label.toLowerCase()}…</span>
              </div>
            ) : rows.length === 0 && !error ? (
              <div className="flex flex-col items-center gap-2 py-10 text-stone-400">
                <Inbox className="w-6 h-6" />
                <span className="text-xs text-stone-600 dark:text-stone-300">
                  Este {parent.labelSingular.toLowerCase()} não possui {detail.label.toLowerCase()}.
                </span>
              </div>
            ) : (
              <table className="w-full text-xs border-separate border-spacing-0">
                <thead className="sticky top-0 z-10">
                  <tr className="bg-stone-50 dark:bg-stone-950">
                    {listedFields.map((f) => (
                      <th
                        key={f.name}
                        className={`px-3 py-2 ${alinhar(f.type)} font-semibold text-stone-600 dark:text-stone-300 whitespace-nowrap border-b border-stone-200 dark:border-stone-800`}
                      >
                        {f.label}
                      </th>
                    ))}
                    {/* Mesma condição da coluna nas linhas: botões extras (ex.: enviar disparo) também contam */}
                    {(podeEditar || podeExcluir || extras) && (
                      <th className="w-px px-3 py-2 text-center font-semibold text-stone-600 dark:text-stone-300 border-b border-stone-200 dark:border-stone-800">
                        Ações
                      </th>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr
                      key={childResource.pk.map((c) => row[c]).join('~')}
                      onDoubleClick={podeEditar ? () => setEditando({ record: row }) : undefined}
                      className={`hover:bg-stone-50 dark:hover:bg-stone-800/40 transition-colors ${podeEditar ? 'cursor-pointer' : ''}`}
                    >
                      {listedFields.map((f) => (
                        <td
                          key={f.name}
                          className={`px-3 py-2 ${alinhar(f.type)} text-stone-700 dark:text-stone-300 align-middle max-w-xs truncate border-b border-stone-100 dark:border-stone-800/60`}
                        >
                          <CellValue field={f} row={row} refOptions={refOptions} />
                        </td>
                      ))}
                      {(podeEditar || podeExcluir || extras) && (
                        <td className="px-3 py-1 text-center whitespace-nowrap border-b border-stone-100 dark:border-stone-800/60">
                          <div className="inline-flex items-center gap-1">
                            {acoesLinha?.(childResource.name, row, { recarregar: load })}
                            {podeEditar && (
                              <button
                                onClick={() => setEditando({ record: row })}
                                title="Editar"
                                className="p-1 rounded text-stone-400 hover:text-blue-600 hover:bg-blue-50 dark:hover:text-blue-400 dark:hover:bg-blue-950/40 transition-colors cursor-pointer"
                              >
                                <Pencil className="w-3.5 h-3.5" />
                              </button>
                            )}
                            {podeExcluir && (
                              <button
                                onClick={() => setExcluindo(row)}
                                title="Excluir"
                                className="p-1 rounded text-stone-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:text-rose-400 dark:hover:bg-rose-950/40 transition-colors cursor-pointer"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            )}
                          </div>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {/* Totalizador */}
          {!isLoading && rows.length > 0 && (
            <div className="px-3 py-2 border-t border-stone-200 dark:border-stone-800 bg-stone-50 dark:bg-stone-950/40 flex items-center justify-between gap-3 shrink-0">
              <span className="text-[11px] text-stone-500 dark:text-stone-400">
                {rows.length} registro(s)
                {rows.length === DETAIL_LIMIT && ' (limite exibido)'}
              </span>
              {total !== null && (
                <span className="text-xs font-semibold text-stone-700 dark:text-stone-200">
                  Total:{' '}
                  <span className="font-mono text-blue-700 dark:text-blue-400">
                    {formatCurrencyBRL(total)}
                  </span>
                </span>
              )}
            </div>
          )}
        </>
      )}
      {editando && recursoForm && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
          <div className="fixed inset-0 bg-stone-950/70 backdrop-blur-xs" aria-hidden="true" />
          <div
            role="dialog"
            aria-modal="true"
            aria-label={`${editando.record ? 'Editar' : 'Incluir'} ${childResource.labelSingular}`}
            className="relative z-10 w-full max-w-3xl max-h-[85vh] flex flex-col rounded-2xl overflow-hidden border border-stone-200 dark:border-stone-800 shadow-2xl bg-white dark:bg-stone-900"
          >
            <div className="px-5 py-3 border-b border-stone-200 dark:border-stone-800 text-sm font-bold text-stone-900 dark:text-stone-100 shrink-0">
              {editando.record ? 'Editar' : 'Incluir'} {childResource.labelSingular.toLowerCase()} —{' '}
              <span className="font-semibold text-stone-500 dark:text-stone-400">{parentLabel}</span>
            </div>
            <RecordForm
              resource={recursoForm}
              record={editando.record}
              refOptions={refOptions}
              onCancel={() => setEditando(null)}
              onSave={async (payload) => {
                if (editando.record) await updateRecord(childResource.name, pkFilho(editando.record), payload);
                else await createRecord(childResource.name, fkFixa ? { ...payload, [detail.foreignKey]: parentId } : payload);
                setEditando(null);
                aposAlterar();
              }}
            />
          </div>
        </div>
      )}

      {excluindo && (
        <ConfirmDialog
          titulo={`Excluir ${childResource.labelSingular.toLowerCase()} "${excluindo[childResource.labelField] ?? pkFilho(excluindo)}"?`}
          mensagem={`Sai de ${parentLabel} definitivamente. Registros ligados podem impedir a exclusão.`}
          onConfirmar={async () => {
            await deleteRecord(childResource.name, pkFilho(excluindo));
            setExcluindo(null);
            aposAlterar();
          }}
          onCancelar={() => setExcluindo(null)}
        />
      )}
    </div>
  );
};
