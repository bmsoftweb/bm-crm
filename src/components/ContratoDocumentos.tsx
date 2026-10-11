import React, { useCallback, useEffect, useRef, useState } from 'react';
import { SelectAuto } from './SelectAuto';
import { createPortal } from 'react-dom';
import { Ban, Download, FilePlus2, FileSignature, Loader2, Lock, LockOpen, Paperclip, RefreshCw, Send, Trash2, Upload, X } from 'lucide-react';
import { RegistroCrud } from '../types';
import {
  DocumentoContrato,
  TravaContrato,
  anexarDocumentoContrato,
  atualizarAssinaturaContrato,
  baixarDocumentoContrato,
  cancelarAssinaturaContrato,
  enviarAssinaturaContrato,
  excluirDocumentoContrato,
  gerarMinutaContrato,
  getRecord,
  listarDocumentosContrato,
  liberarAditivoContrato,
  listarModelosContrato,
  reenviarAssinaturaContrato,
  travaContrato,
  travarContrato,
} from '../services/api';
import { INPUT_CLASS, LABEL_CLASS, FIELD_CLASS, HINT_CLASS } from '../utils/formStyles';
import { formatDateTimeBR } from '../utils/formatters';
import { lerSessao } from '../utils/session';
import { ConfirmDialog } from './ConfirmDialog';
import { AvisoErro } from './AvisoErro';

const TIPOS = [
  { value: 'minuta', label: 'Minuta' },
  { value: 'assinado', label: 'Assinado' },
  { value: 'aditivo', label: 'Aditivo' },
  { value: 'distrato', label: 'Distrato' },
  { value: 'outro', label: 'Outro' },
];

const SITUACAO: Record<DocumentoContrato['assinatura_situacao'], { rotulo: string; cor: string }> = {
  nao_enviado: { rotulo: '—', cor: 'text-stone-400' },
  enviado: { rotulo: 'Aguardando assinaturas', cor: 'text-amber-700 dark:text-amber-300' },
  visualizado: { rotulo: 'Assinatura em andamento', cor: 'text-amber-700 dark:text-amber-300' },
  assinado: { rotulo: 'Assinado', cor: 'text-emerald-700 dark:text-emerald-400' },
  recusado: { rotulo: 'Recusado', cor: 'text-rose-700 dark:text-rose-400' },
  expirado: { rotulo: 'Expirado', cor: 'text-rose-700 dark:text-rose-400' },
  cancelado: { rotulo: 'Cancelado', cor: 'text-rose-700 dark:text-rose-400' },
};

const tamanho = (b: number) => (b >= 1048576 ? `${(b / 1048576).toFixed(1).replace('.', ',')} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);
const MAX_MB = 15;

/** Lê o arquivo escolhido como base64 (sem o prefixo "data:...;base64,") */
const lerBase64 = (f: File) =>
  new Promise<string>((ok, falha) => {
    const r = new FileReader();
    r.onload = () => ok(String(r.result).split(',')[1] || '');
    r.onerror = () => falha(new Error('Não foi possível ler o arquivo.'));
    r.readAsDataURL(f);
  });

const BOTAO_ICONE = 'p-1 rounded text-stone-400 transition-colors cursor-pointer disabled:cursor-wait';

interface Props {
  registro: RegistroCrud;
  onRecarregar: () => void;
  onToast: (msg: string) => void;
}

/** Ação "Documentos" da lista de contratos: anexos em PDF e assinatura eletrônica (D4Sign) */
export const ContratoDocumentos: React.FC<Props> = ({ registro, onRecarregar, onToast }) => {
  const [aberto, setAberto] = useState(false);
  return (
    <>
      <button
        onClick={(e) => {
          e.stopPropagation();
          setAberto(true);
        }}
        title="Documentos e assinatura"
        className={`${BOTAO_ICONE} hover:text-blue-600 hover:bg-blue-50 dark:hover:text-blue-400 dark:hover:bg-blue-950/40`}
      >
        <Paperclip className="w-3.5 h-3.5" />
      </button>
      {aberto &&
        // No body: dentro da célula fixa da coluna Ações a janela ficaria sob o cabeçalho da grade.
        // O span segura os cliques, que no React sobem até a linha mesmo pelo portal.
        createPortal(
          <span onClick={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}>
            <JanelaDocumentos
              registro={registro}
              onFechar={(alterou) => {
                setAberto(false);
                if (alterou) onRecarregar();
              }}
              onToast={onToast}
            />
          </span>,
          document.body,
        )}
    </>
  );
};

const JanelaDocumentos: React.FC<{ registro: RegistroCrud; onFechar: (alterou: boolean) => void; onToast: (m: string) => void }> = ({
  registro,
  onFechar,
  onToast,
}) => {
  const id = registro.id as number;
  const [docs, setDocs] = useState<DocumentoContrato[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState<number | 'anexar' | 'gerar' | null>(null);
  const [tipo, setTipo] = useState('minuta');
  const [modelos, setModelos] = useState<{ id: number; descricao: string }[] | null>(null);
  const [modeloId, setModeloId] = useState('');
  const [trava, setTrava] = useState<TravaContrato | null>(null);
  const [liberando, setLiberando] = useState<{ motivo: string } | null>(null);
  const admin = lerSessao()?.usuario?.tipo === 'admin';
  const [arquivo, setArquivo] = useState<File | null>(null);
  const inputArquivo = useRef<HTMLInputElement>(null);
  const [excluindo, setExcluindo] = useState<DocumentoContrato | null>(null);
  const [cancelando, setCancelando] = useState<{ doc: DocumentoContrato; motivo: string } | null>(null);
  const [assinando, setAssinando] = useState<{ doc: DocumentoContrato; emails: string; mensagem: string } | null>(null);
  /** O contrato muda (situação) ao enviar ou concluir a assinatura: a lista é recarregada ao fechar */
  const alterou = useRef(false);

  const carregar = useCallback(() => {
    listarDocumentosContrato(id)
      .then(setDocs)
      .catch((e) => setErro(e.message));
    // A trava muda ao anexar ou concluir uma via assinada
    travaContrato(id)
      .then(setTrava)
      .catch(() => setTrava(null));
  }, [id]);
  const travadoAgora = Boolean(trava?.assinado && !trava.liberado_em);
  useEffect(carregar, [carregar]);
  useEffect(() => {
    listarModelosContrato()
      .then((l) => {
        setModelos(l);
        if (l.length) setModeloId(String(l[0].id));
      })
      .catch(() => setModelos([]));
  }, []);

  const executar = async (chave: number | 'anexar' | 'gerar', fn: () => Promise<void>) => {
    setOcupado(chave);
    setErro(null);
    try {
      await fn();
    } catch (e: any) {
      setErro(e.message || 'Não foi possível concluir a ação.');
    } finally {
      setOcupado(null);
    }
  };

  const anexar = () =>
    executar('anexar', async () => {
      if (!arquivo) throw new Error('Escolha o arquivo.');
      if (arquivo.size > MAX_MB * 1048576) throw new Error(`Arquivo grande demais (máximo ${MAX_MB} MB).`);
      await anexarDocumentoContrato(id, {
        tipo,
        nome_arquivo: arquivo.name,
        mime_type: arquivo.type || 'application/octet-stream',
        conteudo_base64: await lerBase64(arquivo),
      });
      setArquivo(null);
      if (inputArquivo.current) inputArquivo.current.value = '';
      onToast('Documento anexado.');
      carregar();
    });

  const gerarMinuta = () =>
    executar('gerar', async () => {
      const r = await gerarMinutaContrato(id, modeloId);
      onToast(`"${r.nome}" gerado e guardado como minuta.`);
      carregar();
    });

  const baixar = (d: DocumentoContrato) =>
    executar(d.id, async () => {
      const url = URL.createObjectURL(await baixarDocumentoContrato(d.id));
      const a = document.createElement('a');
      a.href = url;
      a.download = d.nome_arquivo;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    });

  const atualizar = (d: DocumentoContrato) =>
    executar(d.id, async () => {
      const r = await atualizarAssinaturaContrato(d.id);
      alterou.current = true;
      onToast(r.situacao === 'assinado' ? 'Assinatura concluída: a via assinada foi guardada.' : `Situação na D4Sign: ${r.situacao}.`);
      carregar();
    });

  const reenviar = (d: DocumentoContrato, email: string) =>
    executar(d.id, async () => {
      await reenviarAssinaturaContrato(d.id, email);
      onToast(`Link de assinatura reenviado para ${email}.`);
    });

  /** Abre o envio para assinatura com o e-mail do cliente já preenchido */
  const prepararAssinatura = (d: DocumentoContrato) =>
    executar(d.id, async () => {
      const cliente = registro.pessoa_id ? await getRecord('pessoas', registro.pessoa_id as number).catch(() => null) : null;
      setAssinando({
        doc: d,
        emails: String(cliente?.email || ''),
        mensagem: `Segue o contrato nº ${registro.numero} (${registro.titulo}) para assinatura.`,
      });
    });

  const emAssinatura = (d: DocumentoContrato) => d.assinatura_situacao === 'enviado' || d.assinatura_situacao === 'visualizado';

  const podeAssinar = (d: DocumentoContrato) =>
    d.mime_type === 'application/pdf' && !['enviado', 'visualizado', 'assinado'].includes(d.assinatura_situacao) && d.tipo !== 'assinado';

  const th = 'px-3 py-2 font-semibold text-stone-600 dark:text-stone-300 border-b border-stone-200 dark:border-stone-800 whitespace-nowrap';
  const td = 'px-3 py-2 border-b border-stone-100 dark:border-stone-800/60 align-middle';

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <div className="fixed inset-0 bg-stone-950/70 backdrop-blur-xs" onClick={() => onFechar(alterou.current)} aria-hidden="true" />
      <div role="dialog" aria-modal="true" className="relative z-10 w-full max-w-4xl max-h-[85vh] flex flex-col rounded-2xl overflow-hidden border border-stone-200 dark:border-stone-800 shadow-2xl bg-white dark:bg-stone-900">
        <div className="flex items-center justify-between px-5 py-3 border-b border-stone-200 dark:border-stone-800 shrink-0">
          <h3 className="text-sm font-bold text-stone-900 dark:text-stone-100">
            Documentos do contrato nº {registro.numero} — <span className="font-semibold text-stone-500 dark:text-stone-400">{registro.titulo}</span>
          </h3>
          <button onClick={() => onFechar(alterou.current)} title="Fechar" className="p-1 rounded text-stone-400 hover:text-stone-700 dark:hover:text-stone-200 cursor-pointer">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto min-h-0 p-5 flex flex-col gap-4">
          {erro && <AvisoErro mensagem={erro} onFechar={() => setErro(null)} />}

          {/* Trava do contrato assinado */}
          {trava?.assinado && (
            <div
              className={`flex flex-wrap items-center justify-between gap-3 p-3 rounded-lg border text-xs ${
                travadoAgora
                  ? 'bg-stone-50 dark:bg-stone-950/60 border-stone-300 dark:border-stone-700 text-stone-700 dark:text-stone-300'
                  : 'bg-amber-50 dark:bg-amber-950/30 border-amber-300 dark:border-amber-800 text-amber-900 dark:text-amber-200'
              }`}
            >
              <span className="flex items-start gap-2 flex-1 min-w-56">
                {travadoAgora ? <Lock className="w-4 h-4 shrink-0" /> : <LockOpen className="w-4 h-4 shrink-0" />}
                <span>
                  {travadoAgora ? (
                    <>
                      <b>Contrato assinado: travado.</b> Cliente, datas, valores, itens e demais cláusulas só mudam por aditivo. Situação,
                      responsável e observações continuam livres.
                      {!trava.pode_liberar && ' (Para liberar, rode antes extras/contratos_liberar_aditivo.sql no banco.)'}
                    </>
                  ) : (
                    <>
                      <b>Liberado para aditivo</b> em {formatDateTimeBR(trava.liberado_em)}
                      {trava.liberado_por ? ` por ${trava.liberado_por}` : ''}. Trava de novo sozinho quando a via assinada do aditivo entrar
                      aqui.
                    </>
                  )}
                </span>
              </span>
              {admin && travadoAgora && trava.pode_liberar && (
                <button
                  onClick={() => setLiberando({ motivo: '' })}
                  disabled={ocupado !== null}
                  className="flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-semibold text-stone-700 dark:text-stone-200 border border-stone-300 dark:border-stone-700 hover:bg-stone-100 dark:hover:bg-stone-800 cursor-pointer disabled:opacity-50 shrink-0"
                >
                  <LockOpen className="w-4 h-4" />
                  Liberar para aditivo
                </button>
              )}
              {admin && !travadoAgora && (
                <button
                  onClick={() =>
                    executar('gerar', async () => {
                      await travarContrato(id);
                      onToast('Contrato travado de novo.');
                      carregar();
                    })
                  }
                  disabled={ocupado !== null}
                  className="flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-semibold text-amber-900 dark:text-amber-200 border border-amber-400 dark:border-amber-700 hover:bg-amber-100 dark:hover:bg-amber-900/40 cursor-pointer disabled:opacity-50 shrink-0"
                >
                  <Lock className="w-4 h-4" />
                  Travar de novo
                </button>
              )}
            </div>
          )}

          {/* Gerar pelo modelo de contrato */}
          <div className="flex flex-wrap items-center justify-between gap-3 p-3 rounded-lg bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-900">
            <span className="text-xs text-emerald-900 dark:text-emerald-200 flex-1 min-w-56">
              {modelos && !modelos.length ? (
                <>Nenhum modelo de contrato cadastrado: crie um em <b>Configurações › Modelos de contrato</b>.</>
              ) : (
                <>Gere o PDF a partir de um <b>modelo de contrato</b>, com os dados deste contrato preenchidos.</>
              )}
            </span>
            {modelos && modelos.length > 1 && (
              <SelectAuto
                aria-label="Modelo de contrato"
                value={modeloId}
                onChange={(e) => setModeloId(e.target.value)}
                className={`${INPUT_CLASS} w-56 cursor-pointer`}
              >
                {modelos.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.descricao}
                  </option>
                ))}
              </SelectAuto>
            )}
            <button
              onClick={gerarMinuta}
              disabled={ocupado !== null || !modelos?.length}
              title={modelos?.length === 1 ? `Modelo: ${modelos[0].descricao}` : undefined}
              className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2 rounded-lg text-xs font-semibold shadow-xs cursor-pointer disabled:opacity-50 shrink-0"
            >
              {ocupado === 'gerar' ? <Loader2 className="w-4 h-4 animate-spin" /> : <FilePlus2 className="w-4 h-4" />}
              Gerar PDF do contrato
            </button>
          </div>

          {/* Anexar */}
          <div className="flex flex-wrap items-end gap-3">
            <div className={FIELD_CLASS}>
              <label htmlFor="doc-tipo" className={LABEL_CLASS}>Tipo</label>
              <SelectAuto id="doc-tipo" value={tipo} onChange={(e) => setTipo(e.target.value)} className={`${INPUT_CLASS} cursor-pointer`}>
                {TIPOS.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </SelectAuto>
            </div>
            <div className={`${FIELD_CLASS} flex-1 min-w-56`}>
              <label htmlFor="doc-arquivo" className={LABEL_CLASS}>Arquivo (PDF para assinatura; até {MAX_MB} MB)</label>
              <input
                id="doc-arquivo"
                ref={inputArquivo}
                type="file"
                accept="application/pdf,.pdf,image/*,.doc,.docx"
                onChange={(e) => setArquivo(e.target.files?.[0] ?? null)}
                className="text-xs text-stone-600 dark:text-stone-300 file:mr-3 file:px-3 file:py-2 file:rounded-lg file:border-0 file:bg-stone-100 dark:file:bg-stone-800 file:text-xs file:font-semibold file:cursor-pointer"
              />
            </div>
            <button
              onClick={anexar}
              disabled={!arquivo || ocupado !== null}
              className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-xs font-semibold shadow-xs cursor-pointer disabled:opacity-50"
            >
              {ocupado === 'anexar' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
              Anexar
            </button>
          </div>

          {/* Lista */}
          {!docs ? (
            <Loader2 className="w-4 h-4 animate-spin text-stone-400" />
          ) : !docs.length ? (
            <p className="text-xs text-stone-500 py-6 text-center">Nenhum documento anexado a este contrato.</p>
          ) : (
            <table className="w-full text-xs border-separate border-spacing-0">
              <thead>
                <tr className="bg-stone-50 dark:bg-stone-950">
                  <th className={`${th} text-left`}>Tipo</th>
                  <th className={`${th} text-left`}>Arquivo</th>
                  <th className={`${th} text-right`}>Tamanho</th>
                  <th className={`${th} text-center`}>Anexado em</th>
                  <th className={`${th} text-left`}>Assinatura</th>
                  <th className={`${th} text-center w-px`}>Ações</th>
                </tr>
              </thead>
              <tbody>
                {docs.map((d) => (
                  <tr key={d.id}>
                    <td className={td}>{TIPOS.find((t) => t.value === d.tipo)?.label ?? d.tipo}</td>
                    <td className={`${td} max-w-64 truncate`} title={d.nome_arquivo}>{d.nome_arquivo}</td>
                    <td className={`${td} text-right font-mono`}>{tamanho(d.tamanho)}</td>
                    <td className={`${td} text-center`}>{formatDateTimeBR(d.criado_em)}</td>
                    <td className={td}>
                      <div className={`font-semibold ${SITUACAO[d.assinatura_situacao].cor}`}>{SITUACAO[d.assinatura_situacao].rotulo}</div>
                      {d.signatarios?.length ? (
                        <div className="text-[10px] text-stone-500 dark:text-stone-400">
                          {d.signatarios.map((s, i) => (
                            <span key={s.email} className="inline-flex items-center gap-0.5">
                              {i > 0 && ' · '}
                              {s.email}
                              {s.assinado ? (
                                ' ✓'
                              ) : emAssinatura(d) ? (
                                <button
                                  onClick={() => reenviar(d, s.email)}
                                  disabled={ocupado !== null}
                                  title={`Reenviar o link de assinatura para ${s.email}`}
                                  className="p-0.5 rounded text-stone-400 hover:text-blue-600 cursor-pointer disabled:cursor-wait"
                                >
                                  <Send className="w-2.5 h-2.5" />
                                </button>
                              ) : null}
                            </span>
                          ))}
                        </div>
                      ) : null}
                    </td>
                    <td className={`${td} text-center whitespace-nowrap`}>
                      <div className="inline-flex items-center gap-1">
                        {ocupado === d.id ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin text-stone-400" />
                        ) : (
                          <>
                            <button onClick={() => baixar(d)} title="Baixar" className={`${BOTAO_ICONE} hover:text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-950/40`}>
                              <Download className="w-3.5 h-3.5" />
                            </button>
                            {podeAssinar(d) && (
                              <button onClick={() => prepararAssinatura(d)} title="Enviar para assinatura (D4Sign)" className={`${BOTAO_ICONE} hover:text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-950/40`}>
                                <FileSignature className="w-3.5 h-3.5" />
                              </button>
                            )}
                            {emAssinatura(d) && (
                              <button onClick={() => atualizar(d)} title="Consultar a situação na D4Sign agora" className={`${BOTAO_ICONE} hover:text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-950/40`}>
                                <RefreshCw className="w-3.5 h-3.5" />
                              </button>
                            )}
                            {emAssinatura(d) && (
                              <button onClick={() => setCancelando({ doc: d, motivo: '' })} title="Cancelar a assinatura na D4Sign" className={`${BOTAO_ICONE} hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40`}>
                                <Ban className="w-3.5 h-3.5" />
                              </button>
                            )}
                            {!(travadoAgora && (d.tipo === 'assinado' || d.assinatura_situacao === 'assinado')) && (
                              <button onClick={() => setExcluindo(d)} title="Excluir" className={`${BOTAO_ICONE} hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40`}>
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            )}
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <p className={HINT_CLASS}>
            Documentos em assinatura são consultados na D4Sign a cada hora; ao concluir, a via assinada é guardada aqui e o contrato passa a Ativo.
          </p>
        </div>
      </div>

      {excluindo && (
        <ConfirmDialog
          titulo={`Excluir "${excluindo.nome_arquivo}"?`}
          mensagem="O arquivo sai do contrato definitivamente."
          onConfirmar={async () => {
            await excluirDocumentoContrato(excluindo.id);
            setExcluindo(null);
            onToast('Documento excluído.');
            carregar();
          }}
          onCancelar={() => setExcluindo(null)}
        />
      )}

      {liberando && (
        <ConfirmDialog
          titulo={`Liberar o contrato nº ${registro.numero} para aditivo?`}
          mensagem="Cliente, datas, valores e itens voltam a poder ser alterados. A liberação fica no histórico do contrato e ele trava de novo quando a via assinada do aditivo entrar nos documentos (ou pelo botão Travar de novo)."
          confirmar="Liberar para aditivo"
          tom="normal"
          onConfirmar={async () => {
            await liberarAditivoContrato(id, liberando.motivo);
            setLiberando(null);
            alterou.current = true;
            onToast('Contrato liberado para aditivo.');
            carregar();
          }}
          onCancelar={() => setLiberando(null)}
        >
          <div className={FIELD_CLASS}>
            <label htmlFor="lib-motivo" className={LABEL_CLASS}>Motivo (vai para o histórico)</label>
            <textarea
              id="lib-motivo"
              value={liberando.motivo}
              onChange={(e) => setLiberando({ motivo: e.target.value })}
              rows={2}
              maxLength={300}
              placeholder="Ex.: reajuste anual, inclusão de módulo…"
              className={`${INPUT_CLASS} w-full resize-y`}
            />
          </div>
        </ConfirmDialog>
      )}

      {cancelando && (
        <ConfirmDialog
          titulo={`Cancelar a assinatura de "${cancelando.doc.nome_arquivo}"?`}
          mensagem="Os links enviados aos signatários deixam de valer na D4Sign e o contrato volta a Rascunho. Para assinar depois, envie o documento de novo."
          confirmar="Cancelar assinatura"
          onConfirmar={async () => {
            await cancelarAssinaturaContrato(cancelando.doc.id, cancelando.motivo);
            setCancelando(null);
            alterou.current = true;
            onToast('Assinatura cancelada na D4Sign.');
            carregar();
          }}
          onCancelar={() => setCancelando(null)}
        >
          <div className={FIELD_CLASS}>
            <label htmlFor="canc-motivo" className={LABEL_CLASS}>Motivo (fica registrado na D4Sign)</label>
            <textarea
              id="canc-motivo"
              value={cancelando.motivo}
              onChange={(e) => setCancelando({ ...cancelando, motivo: e.target.value })}
              rows={2}
              maxLength={500}
              className={`${INPUT_CLASS} w-full resize-y`}
            />
          </div>
        </ConfirmDialog>
      )}

      {assinando && (
        <ConfirmDialog
          titulo={`Enviar "${assinando.doc.nome_arquivo}" para assinatura?`}
          mensagem="A D4Sign manda o link de assinatura por e-mail a cada signatário. O contrato em rascunho passa a Aguardando assinatura."
          confirmar="Enviar para assinatura"
          tom="normal"
          onConfirmar={async () => {
            await enviarAssinaturaContrato(assinando.doc.id, {
              emails: assinando.emails.split(/[\s,;]+/).filter(Boolean),
              mensagem: assinando.mensagem,
            });
            setAssinando(null);
            alterou.current = true;
            onToast('Documento enviado para assinatura na D4Sign.');
            carregar();
          }}
          onCancelar={() => setAssinando(null)}
        >
          <div className="flex flex-col gap-3">
            <div className={FIELD_CLASS}>
              <label htmlFor="ass-emails" className={LABEL_CLASS}>E-mails dos signatários (um por linha)</label>
              <textarea
                id="ass-emails"
                value={assinando.emails}
                onChange={(e) => setAssinando({ ...assinando, emails: e.target.value })}
                rows={3}
                required
                placeholder="cliente@empresa.com.br"
                className={`${INPUT_CLASS} w-full resize-y`}
              />
              <span className={HINT_CLASS}>Inclua também quem assina pela sua empresa.</span>
            </div>
            <div className={FIELD_CLASS}>
              <label htmlFor="ass-msg" className={LABEL_CLASS}>Mensagem</label>
              <textarea
                id="ass-msg"
                value={assinando.mensagem}
                onChange={(e) => setAssinando({ ...assinando, mensagem: e.target.value })}
                rows={3}
                className={`${INPUT_CLASS} w-full resize-y`}
              />
            </div>
          </div>
        </ConfirmDialog>
      )}
    </div>
  );
};
