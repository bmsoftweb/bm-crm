import React, { useEffect, useState } from 'react';
import { SelectAuto } from './SelectAuto';
import { Loader2, Save } from 'lucide-react';
import { fetchConfig, fetchOptions, listRecords, salvarConfig } from '../services/api';
import { OpcaoRef } from '../types';
import { INPUT_CLASS, LABEL_CLASS, FIELD_CLASS, HINT_CLASS } from '../utils/formStyles';
import { NumberField } from './NumberField';
import { AvisoErro } from './AvisoErro';
import { Toggle } from './Toggle';

interface Chatbot {
  nome: string;
  minutos_devolver: number;
  /** Cliente sem responder: aviso e encerramento depois de X minutos (0 = desligado) */
  minutos_inatividade: number;
  /** Conversa encerrada: a IA procura pendências e cria tarefas (server/pendencias.ts) */
  analisar_conversas: boolean;
  /** Quem recebe a pendência sem usuário nem departamento identificado; vazio = o primeiro administrador */
  responsavel_pendencias_id: number | null;
}

interface Props {
  somenteLeitura: boolean;
  onToast: (msg: string) => void;
}

/**
 * Configurações › Chatbot: o nome do assistente, os tempos do atendimento, o revezamento de leads, a análise das conversas e
 * a pesquisa de satisfação. A IA (Gemini, Claude ou DeepSeek, chave e modelo) fica em Configurações › IA (ConfigIA.tsx),
 * gravada na mesma config: ao salvar, cada aba muda só o que é dela.
 * O atendimento em si (ligar, texto-base, menus) fica em Configurações › Automação.
 */
export const ConfigChatbot: React.FC<Props> = ({ somenteLeitura, onToast }) => {
  const [v, setV] = useState<Chatbot | null>(null);
  const [usuarios, setUsuarios] = useState<OpcaoRef[]>([]);
  /** Todos os usuários ativos: combo do responsável pelas pendências sem dono */
  const [todos, setTodos] = useState<OpcaoRef[]>([]);
  const [ocupado, setOcupado] = useState<'salvar' | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    fetchConfig<any>('whatsapp', 'chatbot')
      .then(({ valor }) => {
        setV(valor);
      })
      .catch((e) => setErro(e.message));
    // Quem está no revezamento (ligado no cadastro de Usuários), só para mostrar
    listRecords('usuarios', { limit: 200, filters: [{ field: 'revezamento', op: 'eq', value: '1' }, { field: 'ativo', op: 'eq', value: '1' }] })
      .then((r) => setUsuarios(r.data.map((u) => ({ value: String(u.id), label: String(u.nome) }))))
      .catch(() => {});
    fetchOptions('usuarios', 'nome')
      .then((l) => setTodos(l.filter((o) => !o.label.endsWith('(inativo)'))))
      .catch(() => {});
  }, []);

  if (!v) return erro ? <AvisoErro mensagem={erro} onFechar={() => setErro(null)} /> : <Loader2 className="w-4 h-4 animate-spin text-stone-400" />;

  const alterar = (m: Partial<Chatbot>) => {
    setV({ ...v, ...m });
    setErro(null);
  };
  const campo = `${INPUT_CLASS} w-full`;

  const salvar = async (e: React.FormEvent) => {
    e.preventDefault();
    setOcupado('salvar');
    try {
      // Relê o gravado e muda só o que é desta aba: a IA (aba IA) fica como está no banco
      const { valor: gravado } = await fetchConfig<any>('whatsapp', 'chatbot');
      const { ias: _ias, chaves: _chaves, ...resto } = gravado ?? {};
      await salvarConfig('whatsapp', 'chatbot', {
        ...resto,
        nome: v.nome,
        minutos_devolver: v.minutos_devolver,
        minutos_inatividade: v.minutos_inatividade,
        analisar_conversas: v.analisar_conversas,
        responsavel_pendencias_id: v.responsavel_pendencias_id,
        chave: '',
      });
      onToast('Configuração do chatbot gravada.');
    } catch (err: any) {
      setErro(err.message);
    } finally {
      setOcupado(null);
    }
  };

  return (
    <form onSubmit={salvar} className="max-w-3xl flex flex-col gap-4">
      {erro && <AvisoErro mensagem={erro} onFechar={() => setErro(null)} />}

      <p className="text-xs text-stone-600 dark:text-stone-300">
        O assistente que responde pela Automação, com uma espera de 1 a 30 segundos e "digitando..." antes de responder. A IA usada (Gemini, Claude ou
        DeepSeek, chave e modelo) fica em Configurações › IA. Ligar o atendimento, o texto-base e os menus ficam em Configurações › Automação.
      </p>

      <fieldset disabled={somenteLeitura} className="flex flex-col gap-4">

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className={FIELD_CLASS}>
            <label htmlFor="bot-nome" className={LABEL_CLASS}>Nome do assistente</label>
            <input id="bot-nome" value={v.nome} onChange={(e) => alterar({ nome: e.target.value })} onFocus={(e) => e.target.select()} maxLength={60} required className={campo} />
            <span className={HINT_CLASS}>Como o assistente se apresenta ao cliente no WhatsApp</span>
          </div>
          <div className={FIELD_CLASS}>
            <label htmlFor="bot-minutos" className={LABEL_CLASS}>Liberar o atendente depois de (minutos)</label>
            <NumberField id="bot-minutos" value={String(v.minutos_devolver)} onChange={(t) => alterar({ minutos_devolver: Number(t) || 0 })} scale={0} className={campo} />
            <span className={HINT_CLASS}>Atendente que assumiu e ficou esse tempo sem responder: a conversa volta para a fila (aguardando). Aguardando não volta ao bot sozinha: um técnico atende ou encerra</span>
          </div>
          <div className={FIELD_CLASS}>
            <label htmlFor="bot-inatividade" className={LABEL_CLASS}>Passar para aguardando sem interação após (minutos)</label>
            <NumberField id="bot-inatividade" value={String(v.minutos_inatividade)} onChange={(t) => alterar({ minutos_inatividade: Number(t) || 0 })} scale={0} className={campo} />
            <span className={HINT_CLASS}>Cliente sem responder ao bot ou ao técnico: a conversa vai para aguardando, sem mensagem ao cliente. O app nunca encerra sozinho: só alguém da equipe, pelo Encerrar. 0 = desligado</span>
          </div>
        </div>

        <div className={FIELD_CLASS}>
          <span className={LABEL_CLASS}>Revezamento de leads</span>
          {usuarios.length ? (
            <div className="flex flex-wrap gap-1.5 pt-1">
              {usuarios.map((u) => (
                <span key={u.value} className="text-xs font-semibold px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300">
                  {u.label}
                </span>
              ))}
            </div>
          ) : (
            <div className="p-3 rounded-lg bg-amber-50 dark:bg-amber-950/40 text-xs text-amber-800 dark:text-amber-300">
              Ninguém no revezamento: os leads novos ficam sem responsável até alguém assumir.
            </div>
          )}
          <span className={HINT_CLASS}>Cada lead novo vai para o próximo da lista. Para incluir ou tirar alguém: Usuários › "Entra no revezamento de leads".</span>
        </div>

        <div className="flex flex-col gap-3 pt-3 border-t border-stone-200 dark:border-stone-800">
          <Toggle
            checked={v.analisar_conversas !== false}
            onChange={(ligado) => alterar({ analisar_conversas: ligado })}
            label="Analisar as conversas encerradas e criar tarefas para as pendências"
          />
          <span className={HINT_CLASS}>
            Quando um atendimento do WhatsApp, um chamado ou uma conversa do Bot das atividades termina, a IA lê a conversa inteira. Se o cliente pediu para falar com
            alguém, reclamou ou pediu algo que não foi resolvido, vira uma tarefa: para o usuário citado ou que se comprometeu; sem ele, para o departamento do assunto;
            sem os dois, para o responsável abaixo.
          </span>
          {v.analisar_conversas !== false && (
            <div className={`${FIELD_CLASS} sm:w-1/2`}>
              <label htmlFor="bot-diretor" className={LABEL_CLASS}>Responsável pelas pendências sem dono</label>
              <SelectAuto
                id="bot-diretor"
                value={v.responsavel_pendencias_id ? String(v.responsavel_pendencias_id) : ''}
                onChange={(e) => alterar({ responsavel_pendencias_id: Number(e.target.value) || null })}
                className={`${campo} cursor-pointer`}
              >
                <option value="">O primeiro administrador</option>
                {todos.map((u) => (
                  <option key={u.value} value={u.value}>
                    {u.label}
                  </option>
                ))}
              </SelectAuto>
              <span className={HINT_CLASS}>Recebe a tarefa quando não dá para saber o usuário nem o departamento (por exemplo, o diretor)</span>
            </div>
          )}
        </div>

      </fieldset>

      {!somenteLeitura && (
        <div className="flex items-center gap-2">
          <button
            type="submit"
            disabled={ocupado !== null}
            className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2.5 rounded-lg text-xs font-semibold shadow-xs cursor-pointer disabled:opacity-50"
          >
            {ocupado === 'salvar' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            Salvar configuração
          </button>
        </div>
      )}
    </form>
  );
};
