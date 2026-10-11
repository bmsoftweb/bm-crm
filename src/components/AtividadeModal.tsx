import React, { useEffect, useState } from 'react';
import { SelectAuto } from './SelectAuto';
import { CalendarPlus, Loader2, X } from 'lucide-react';
import { createRecord, criarTarefaChamado, fetchOptions } from '../services/api';
import { Id, OpcaoRef } from '../types';
import { INPUT_CLASS, LABEL_CLASS, FIELD_CLASS, HINT_CLASS } from '../utils/formStyles';
import { hojeIso } from '../utils/formatters';
import { LEMBRETE_PARA, TIPOS_ATIVIDADE } from '../utils/crm';
import { DateField } from './DateField';
import { Toggle } from './Toggle';
import { AvisoErro } from './AvisoErro';
import { ParticipantesNegocio } from './ParticipantesNegocio';

interface AtividadeModalProps {
  /** Vínculos da atividade (normalmente os do negócio) */
  negocioId?: Id | null;
  pessoaId?: Id | null;
  /** Tarefa de um chamado do suporte: grava ligada a ele (o cliente vem do chamado) */
  chamadoId?: number | null;
  /** Usuário que já vem como quem executa (no chamado: o atendente) */
  executorPadraoId?: Id | null;
  /** Título do negócio ou do chamado, só para exibição */
  contexto?: string;
  onFechar: () => void;
  onGravada: () => void;
}

/** Agendamento de follow-up (ligação, reunião, tarefa...) vinculado ao negócio */
export const AtividadeModal: React.FC<AtividadeModalProps> = ({ negocioId, pessoaId, chamadoId, executorPadraoId, contexto, onFechar, onGravada }) => {
  const [tipo, setTipo] = useState(chamadoId ? 'tarefa' : 'ligacao');
  const [assunto, setAssunto] = useState('');
  const [data, setData] = useState(hojeIso());
  const [hora, setHora] = useState('');
  const [duracao, setDuracao] = useState('00:15');
  // Tarefa interna do suporte: o lembrete vai para quem executa, não para o cliente
  const [lembretePara, setLembretePara] = useState(chamadoId ? 'vendedor' : 'cliente');
  /** Quem executa: qualquer pessoa, um usuário ou um departamento */
  const [quem, setQuem] = useState<'qualquer' | 'usuario' | 'departamento' | 'bot'>(executorPadraoId ? 'usuario' : 'qualquer');
  const [executorId, setExecutorId] = useState(executorPadraoId ? String(executorPadraoId) : '');
  /** Outros usuários que acompanham a atividade */
  const [envolvidos, setEnvolvidos] = useState<number[]>([]);
  const [departamentoId, setDepartamentoId] = useState('');
  const [usuarios, setUsuarios] = useState<OpcaoRef[]>([]);
  const [departamentos, setDepartamentos] = useState<OpcaoRef[]>([]);
  useEffect(() => {
    fetchOptions('usuarios', 'nome').then(setUsuarios).catch(() => {});
    fetchOptions('departamentos', 'nome').then(setDepartamentos).catch(() => {});
  }, []);
  const [observacao, setObservacao] = useState('');
  const [concluida, setConcluida] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const salvar = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!data) return setErro('Informe a data de vencimento.');
    if (quem === 'usuario' && !executorId) return setErro('Escolha o usuário que executa a atividade.');
    if (quem === 'departamento' && !departamentoId) return setErro('Escolha o departamento que executa a atividade.');
    if (quem === 'bot' && lembretePara === 'nenhum') return setErro('Com o Bot executando, escolha com quem ele conversa.');
    setSalvando(true);
    setErro(null);
    try {
      const executor = quem === 'usuario' ? executorId : '';
      const dados = {
        tipo,
        assunto: assunto.trim() || TIPOS_ATIVIDADE.find((t) => t.value === tipo)?.label,
        data_vencimento: data,
        hora_vencimento: hora || null,
        duracao: duracao || null,
        lembrete_para: lembretePara,
        executor_id: quem === 'usuario' ? executorId : null,
        departamento_id: quem === 'departamento' ? departamentoId : null,
        executor_bot: quem === 'bot' ? 1 : 0,
        observacao: observacao || null,
        concluida: concluida ? 1 : 0,
        envolvidos: envolvidos.filter((id) => String(id) !== executor) as any,
      };
      if (chamadoId) await criarTarefaChamado(chamadoId, dados);
      else await createRecord('atividades', { ...dados, negocio_id: negocioId || null, pessoa_id: pessoaId || null });
      onGravada();
    } catch (err: any) {
      setErro(err.message || 'Não foi possível agendar a atividade.');
      setSalvando(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[55] flex items-center justify-center p-4">
      <div className="fixed inset-0 bg-stone-950/70 backdrop-blur-xs" onClick={salvando ? undefined : onFechar} aria-hidden="true" />
      <form
        onSubmit={salvar}
        role="dialog"
        aria-modal="true"
        className="relative w-full max-w-lg bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-800 rounded-2xl shadow-2xl z-10"
      >
        <div className="px-5 py-4 border-b border-stone-200 dark:border-stone-800 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <h3 className="text-base font-bold text-stone-900 dark:text-stone-100">{chamadoId ? 'Nova tarefa do chamado' : 'Agendar atividade'}</h3>
            {contexto && <p className="text-[11px] text-stone-500 dark:text-stone-400 truncate">{contexto}</p>}
          </div>
          <button type="button" onClick={onFechar} title="Fechar" className="p-1.5 rounded-lg text-stone-400 hover:text-stone-700 hover:bg-stone-100 dark:hover:bg-stone-800 cursor-pointer">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          {/* Tipo: botões com ícone, como no Pipedrive */}
          <div className="flex flex-wrap gap-1.5">
            {TIPOS_ATIVIDADE.map((t) => (
              <button
                key={t.value}
                type="button"
                onClick={() => setTipo(t.value)}
                aria-pressed={tipo === t.value}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors cursor-pointer ${
                  tipo === t.value
                    ? 'bg-blue-600 border-blue-600 text-white'
                    : 'border-stone-300 dark:border-stone-700 text-stone-600 dark:text-stone-300 hover:bg-stone-100 dark:hover:bg-stone-800'
                }`}
              >
                <t.icon className="w-3.5 h-3.5" />
                {t.label}
              </button>
            ))}
          </div>

          <div className={FIELD_CLASS}>
            <label htmlFor="atv-assunto" className={LABEL_CLASS}>Assunto</label>
            <input
              id="atv-assunto"
              autoFocus
              value={assunto}
              onChange={(e) => setAssunto(e.target.value)}
              maxLength={255}
              placeholder={TIPOS_ATIVIDADE.find((t) => t.value === tipo)?.label}
              className={`${INPUT_CLASS} w-full`}
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className={FIELD_CLASS}>
              <label htmlFor="atv-data" className={LABEL_CLASS}>{chamadoId ? 'Prazo' : 'Data'}<span className="text-rose-500 ml-1">*</span></label>
              <DateField id="atv-data" value={data} onChange={setData} required className={`${INPUT_CLASS} w-full`} />
            </div>
            <div className={FIELD_CLASS}>
              <label htmlFor="atv-hora" className={LABEL_CLASS}>Hora</label>
              <input id="atv-hora" type="time" value={hora} onChange={(e) => setHora(e.target.value)} className={`${INPUT_CLASS} w-full`} />
            </div>
            <div className={FIELD_CLASS}>
              <label htmlFor="atv-duracao" className={LABEL_CLASS}>Duração</label>
              <input id="atv-duracao" type="time" value={duracao} onChange={(e) => setDuracao(e.target.value)} className={`${INPUT_CLASS} w-full`} />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className={FIELD_CLASS}>
              <label htmlFor="atv-quem" className={LABEL_CLASS}>Quem executa</label>
              <SelectAuto id="atv-quem" value={quem} onChange={(e) => setQuem(e.target.value as typeof quem)} className={`${INPUT_CLASS} w-full cursor-pointer`}>
                <option value="qualquer">Qualquer pessoa</option>
                <option value="usuario">Um usuário</option>
                <option value="departamento">Um departamento</option>
                <option value="bot">Bot (a IA conversa no dia e hora)</option>
              </SelectAuto>
            </div>
            {quem === 'usuario' && (
              <div className={FIELD_CLASS}>
                <label htmlFor="atv-executor" className={LABEL_CLASS}>Usuário<span className="text-rose-500 ml-1">*</span></label>
                <SelectAuto id="atv-executor" value={executorId} onChange={(e) => setExecutorId(e.target.value)} required className={`${INPUT_CLASS} w-full cursor-pointer`}>
                  <option value="">Escolha...</option>
                  {usuarios.map((u) => (
                    <option key={u.value} value={u.value}>
                      {u.label}
                    </option>
                  ))}
                </SelectAuto>
              </div>
            )}
            {quem === 'departamento' && (
              <div className={FIELD_CLASS}>
                <label htmlFor="atv-departamento" className={LABEL_CLASS}>Departamento<span className="text-rose-500 ml-1">*</span></label>
                <SelectAuto id="atv-departamento" value={departamentoId} onChange={(e) => setDepartamentoId(e.target.value)} required className={`${INPUT_CLASS} w-full cursor-pointer`}>
                  <option value="">{departamentos.length ? 'Escolha...' : 'Nenhum: cadastre em Cadastros › Departamentos'}</option>
                  {departamentos.map((d) => (
                    <option key={d.value} value={d.value}>
                      {d.label}
                    </option>
                  ))}
                </SelectAuto>
              </div>
            )}
          </div>

          <ParticipantesNegocio
            ids={envolvidos}
            onChange={setEnvolvidos}
            opcoes={usuarios}
            proprietarioId={quem === 'usuario' ? executorId : null}
            oQue="nesta atividade"
          />

          <div className={FIELD_CLASS}>
            <label htmlFor="atv-lembrete" className={LABEL_CLASS}>{quem === 'bot' ? 'O Bot conversa com' : 'Lembrete por WhatsApp para'}</label>
            <SelectAuto id="atv-lembrete" value={lembretePara} onChange={(e) => setLembretePara(e.target.value)} className={`${INPUT_CLASS} w-full sm:w-1/2 cursor-pointer`}>
              {LEMBRETE_PARA.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </SelectAuto>
            {quem === 'bot' && (
              <span className={HINT_CLASS}>
                No dia e hora (sem hora: 8h), a IA conversa pelo WhatsApp seguindo o assunto e a observação, até cumprir a atividade; sem WhatsApp, manda um e-mail.
                Escreva na observação o que o Bot deve fazer.
              </span>
            )}
          </div>

          <div className={FIELD_CLASS}>
            <label htmlFor="atv-obs" className={LABEL_CLASS}>Observação</label>
            <textarea id="atv-obs" rows={3} value={observacao} onChange={(e) => setObservacao(e.target.value)} className={`${INPUT_CLASS} w-full resize-y`} />
          </div>

          <Toggle checked={concluida} onChange={setConcluida} size="sm" label="Marcar como concluída (já foi feita)" />

          {erro && (
            <AvisoErro mensagem={erro} onFechar={() => setErro(null)} />
          )}
        </div>

        <div className="px-5 py-3 border-t border-stone-200 dark:border-stone-800 flex justify-end gap-2.5 bg-stone-50 dark:bg-stone-950/40 rounded-b-2xl">
          <button type="button" onClick={onFechar} disabled={salvando} className="px-4 py-2.5 rounded-lg text-xs font-semibold text-stone-600 dark:text-stone-300 border border-stone-300 dark:border-stone-700 hover:bg-stone-100 dark:hover:bg-stone-800 cursor-pointer disabled:opacity-40">
            Cancelar
          </button>
          <button type="submit" disabled={salvando} className="flex items-center gap-2 px-4 py-2.5 rounded-lg text-xs font-semibold bg-blue-600 hover:bg-blue-700 text-white shadow-xs cursor-pointer disabled:opacity-50">
            {salvando ? <Loader2 className="w-4 h-4 animate-spin" /> : <CalendarPlus className="w-4 h-4" />}
            <span>{concluida ? 'Registrar' : 'Agendar'}</span>
          </button>
        </div>
      </form>
    </div>
  );
};
