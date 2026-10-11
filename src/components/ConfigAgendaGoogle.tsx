import React, { useCallback, useEffect, useState } from 'react';
import { SelectAuto } from './SelectAuto';
import { CalendarCheck, Loader2, RefreshCw, Save, Unplug } from 'lucide-react';
import {
  conectarAgendaGoogle,
  desconectarAgendaGoogle,
  salvarDestinoAgendaGoogle,
  sincronizarAgendaGoogle,
  situacaoAgendaGoogle,
  SituacaoAgendaGoogle,
} from '../services/api';
import { FIELD_CLASS, HINT_CLASS, INPUT_CLASS, LABEL_CLASS } from '../utils/formStyles';
import { AvisoErro } from './AvisoErro';
import { ConfirmDialog } from './ConfirmDialog';

interface Props {
  somenteLeitura: boolean;
  onToast: (msg: string) => void;
}

const dataHora = (iso: string | null) => (iso ? new Date(iso).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }) : '—');

/**
 * Configurações › Google Agenda: conta Google da empresa que recebe as atividades (server/agendaGoogle.ts).
 * A autorização abre numa janela do Google; ao voltar para esta tela, a situação é relida.
 */
export const ConfigAgendaGoogle: React.FC<Props> = ({ somenteLeitura, onToast }) => {
  const [s, setS] = useState<SituacaoAgendaGoogle | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [confirmar, setConfirmar] = useState(false);
  const [destino, setDestino] = useState<string | null>(null);
  const [acao, setAcao] = useState<'salvar' | 'sincronizar' | null>(null);

  const carregar = useCallback(() => {
    situacaoAgendaGoogle()
      .then(setS)
      .catch((e) => setErro(e.message));
  }, []);

  useEffect(() => {
    carregar();
    // Voltou da janela do Google
    window.addEventListener('focus', carregar);
    return () => window.removeEventListener('focus', carregar);
  }, [carregar]);

  if (!s) return erro ? <AvisoErro mensagem={erro} onFechar={() => setErro(null)} /> : <Loader2 className="w-4 h-4 animate-spin text-stone-400" />;

  const conectar = async () => {
    setOcupado(true);
    try {
      const { url } = await conectarAgendaGoogle(window.location.origin);
      window.open(url, 'google-agenda', 'width=520,height=680');
    } catch (e: any) {
      setErro(e.message);
    } finally {
      setOcupado(false);
    }
  };

  /** Escolha feita no select, ainda não gravada (null = a gravada) */
  const destinoEscolhido = destino ?? s.destino;
  const destinoMudou = destino !== null && destino !== s.destino;

  const salvarDestino = async () => {
    if (!destino) return;
    setAcao('salvar');
    try {
      await salvarDestinoAgendaGoogle(destino);
      setS({ ...s, destino });
      setDestino(null);
      onToast('Agenda de destino gravada.');
    } catch (e: any) {
      setErro(e.message);
    } finally {
      setAcao(null);
    }
  };

  const sincronizar = async () => {
    setAcao('sincronizar');
    try {
      const r = await sincronizarAgendaGoogle();
      onToast(`Sincronizado: ${r.recebidos} vindo(s) do Google, ${r.enviados} enviado(s) ao Google${r.limpos ? `, ${r.limpos} removido(s)` : ''}.`);
      carregar();
    } catch (e: any) {
      setErro(e.message);
    } finally {
      setAcao(null);
    }
  };

  const desconectar = async () => {
    await desconectarAgendaGoogle();
    setConfirmar(false);
    onToast('Google Agenda desconectada.');
    carregar();
  };

  const botao =
    'flex items-center gap-2 px-4 py-2.5 rounded-lg text-xs font-semibold cursor-pointer disabled:opacity-50 disabled:cursor-default';

  return (
    <div className="max-w-3xl flex flex-col gap-4 text-xs text-stone-600 dark:text-stone-300">
      {erro && <AvisoErro mensagem={erro} onFechar={() => setErro(null)} />}

      {!s.disponivel ? (
        <div className="p-3 bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-900 text-amber-800 dark:text-amber-300">
          O servidor ainda não tem as credenciais do Google (GOOGLE_CLIENT_ID e GOOGLE_CLIENT_SECRET).
        </div>
      ) : (
        <div className="p-3 rounded-lg bg-stone-50 dark:bg-stone-950/60 border border-stone-200 dark:border-stone-800 flex flex-col gap-1">
          <div className={`font-semibold ${s.conectado && !s.erro ? 'text-emerald-700 dark:text-emerald-400' : 'text-stone-500'}`}>
            {s.conectado ? `Conectada: ${s.conta || 'conta Google'}` : 'Não conectada'}
          </div>
          {s.conectado && (
            <>
              <div>Conectada em {dataHora(s.conectado_em)} · última sincronização {dataHora(s.ultima_sinc)}</div>
              {s.erro && <div className="font-semibold text-rose-600 dark:text-rose-400">{s.erro}</div>}
              {s.reconectar && (
                <div className="font-semibold text-amber-700 dark:text-amber-400">
                  Só a agenda principal está sendo lida: clique em “Conectar outra conta” e autorize de novo para o CRM ler todas as agendas.
                </div>
              )}
            </>
          )}
        </div>
      )}

      {s.conectado && s.agendas.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className={FIELD_CLASS}>
            <span className={LABEL_CLASS}>Agendas lidas</span>
            <ul className="flex flex-col gap-0.5">
              {s.agendas.map((a) => (
                <li key={a.id}>
                  {a.nome}
                  {a.principal && <span className="text-stone-400"> (principal)</span>}
                </li>
              ))}
            </ul>
          </div>
          <div className={FIELD_CLASS}>
            <label htmlFor="agenda-destino" className={LABEL_CLASS}>
              Visitas e reuniões do CRM vão para
            </label>
            <div className="flex items-stretch gap-2">
              <SelectAuto
                id="agenda-destino"
                value={destinoEscolhido ?? ''}
                disabled={somenteLeitura}
                onChange={(ev) => setDestino(ev.target.value)}
                className={`${INPUT_CLASS} flex-1 min-w-0 cursor-pointer`}
              >
                {s.agendas.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.nome}
                  </option>
                ))}
              </SelectAuto>
              {!somenteLeitura && (
                <button
                  type="button"
                  onClick={salvarDestino}
                  disabled={!destinoMudou || acao !== null}
                  title={destinoMudou ? 'Grava a agenda de destino' : 'Escolha outra agenda para salvar'}
                  className="flex items-center gap-1.5 px-3 rounded-lg text-xs font-semibold bg-blue-600 hover:bg-blue-700 text-white cursor-pointer disabled:opacity-50 disabled:cursor-default shrink-0"
                >
                  {acao === 'salvar' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                  Salvar
                </button>
              )}
            </div>
            <span className={HINT_CLASS}>Vale para os eventos novos; os já criados continuam na agenda em que estão.</span>
          </div>
        </div>
      )}

      <p>
        A cada minuto:
        <br />
        <b>Google → CRM (todos os eventos das agendas lidas):</b> evento novo (de hoje em diante) vira atividade, sem lembrete por WhatsApp e sem
        executor. O tipo vem do ícone no começo do título (🚗 Reunião Externa, 🏠 Interna, 💻 Virtual) ou, sem ícone, do texto: reunião com
        videochamada ou “online” = Virtual; reunião na BM (“Reunião na BMsoft”) = Interna; outra reunião = Externa; o resto = Tarefa. As
        reuniões ganham o ícone no assunto; mudar assunto, data, hora, duração ou descrição no Google altera a atividade; excluir o evento exclui a
        atividade. Eventos recorrentes viram uma atividade por ocorrência, até um ano à frente.
        <br />
        <b>CRM → Google (só Visita e Reunião Interna, Externa e Virtual):</b> a atividade vira evento na agenda escolhida acima, com o executor e os envolvidos como
        convidados; alterações vão para o evento, concluída fica cinza e excluída sai da agenda. Os outros tipos ficam só no CRM.
      </p>

      {!somenteLeitura && s.disponivel && (
        <div className="flex items-center gap-2">
          <button type="button" onClick={conectar} disabled={ocupado} className={`${botao} bg-blue-600 hover:bg-blue-700 text-white shadow-xs`}>
            {ocupado ? <Loader2 className="w-4 h-4 animate-spin" /> : <CalendarCheck className="w-4 h-4" />}
            {s.conectado ? 'Conectar outra conta' : 'Conectar Google Agenda'}
          </button>
          {s.conectado && !s.erro && (
            <button
              type="button"
              onClick={sincronizar}
              disabled={acao !== null}
              title="Traz agora o que mudou no Google e envia o que mudou no CRM (sem esperar o minuto)"
              className={`${botao} text-stone-700 dark:text-stone-200 border border-stone-300 dark:border-stone-700 hover:bg-stone-100 dark:hover:bg-stone-800`}
            >
              {acao === 'sincronizar' ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
              Sincronizar agora
            </button>
          )}
          {s.conectado && (
            <button
              type="button"
              onClick={() => setConfirmar(true)}
              className={`${botao} text-rose-600 dark:text-rose-400 border border-stone-300 dark:border-stone-700 hover:bg-rose-50 dark:hover:bg-rose-950/40`}
            >
              <Unplug className="w-4 h-4" />
              Desconectar
            </button>
          )}
        </div>
      )}

      {confirmar && (
        <ConfirmDialog
          titulo="Desconectar a Google Agenda?"
          mensagem="Os eventos do Google param de virar atividades. As atividades já criadas continuam no CRM."
          onConfirmar={desconectar}
          onCancelar={() => setConfirmar(false)}
        />
      )}
    </div>
  );
};
