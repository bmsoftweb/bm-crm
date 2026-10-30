import React, { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Bot, Loader2, Mail, MessageCircle, X } from 'lucide-react';
import { ConversaBotAtividade, fetchConversaBot } from '../services/api';
import { Id } from '../types';
import { formatDateTimeBR } from '../utils/formatters';
import { AvisoErro } from './AvisoErro';
import { BotaoAcao } from './MenuAcoes';
import { repetirConsulta } from '../utils/intervalo';

/** Situação de cada conversa do bot: rótulo e cor */
const SITUACAO: Record<string, [string, string]> = {
  conversando: ['Conversando', 'bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950/40 dark:text-blue-300 dark:border-blue-900'],
  concluida: ['Concluída', 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-900'],
  enviado: ['E-mail enviado', 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-900'],
  humano: ['Com a equipe', 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-900'],
  sem_resposta: ['Sem resposta', 'bg-stone-100 text-stone-600 border-stone-200 dark:bg-stone-800 dark:text-stone-300 dark:border-stone-700'],
  falhou: ['Falhou', 'bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-950/40 dark:text-rose-300 dark:border-rose-900'],
};

/**
 * Conversas do Bot de uma atividade (server/atividadeBot.ts): uma aba por pessoa, com as mensagens como chat
 * e o resumo. Enquanto alguma conversa está em andamento, atualiza a cada 10 s
 */
export const ConversaBot: React.FC<{ atividadeId: Id; onFechar: () => void }> = ({ atividadeId, onFechar }) => {
  const [dados, setDados] = useState<ConversaBotAtividade | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [aba, setAba] = useState(0);
  const carregar = useCallback(() => {
    fetchConversaBot(atividadeId)
      .then(setDados)
      .catch((e) => setErro(e.message));
  }, [atividadeId]);
  useEffect(carregar, [carregar]);
  const andamento = dados?.conversas.some((c) => c.situacao === 'conversando');
  useEffect(() => {
    if (!andamento) return;
    return repetirConsulta(carregar, 10_000);
  }, [andamento, carregar]);
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onFechar();
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [onFechar]);

  const conv = dados?.conversas[aba] ?? dados?.conversas[0];

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <div className="fixed inset-0 bg-stone-950/70 backdrop-blur-xs" onClick={onFechar} aria-hidden="true" />
      <div role="dialog" aria-modal="true" className="relative w-full max-w-2xl h-[80vh] flex flex-col bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-800 rounded-2xl shadow-2xl z-10">
        <div className="px-5 py-4 border-b border-stone-200 dark:border-stone-800 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <h3 className="text-base font-bold text-stone-900 dark:text-stone-100 flex items-center gap-2">
              <Bot className="w-4 h-4 text-blue-600" /> Conversa do Bot
            </h3>
            {dados && <p className="text-[11px] text-stone-500 dark:text-stone-400 truncate">{dados.assunto}</p>}
          </div>
          <button type="button" onClick={onFechar} title="Fechar" className="p-1.5 rounded-lg text-stone-400 hover:text-stone-700 hover:bg-stone-100 dark:hover:bg-stone-800 cursor-pointer">
            <X className="w-4 h-4" />
          </button>
        </div>

        {erro && (
          <div className="px-5 pt-3">
            <AvisoErro mensagem={erro} onFechar={() => setErro(null)} />
          </div>
        )}

        {!dados ? (
          !erro && <Loader2 className="w-5 h-5 m-6 animate-spin text-stone-400" />
        ) : !dados.bot_iniciado_em ? (
          <p className="p-6 text-xs text-center text-stone-500 dark:text-stone-400">O Bot ainda não começou: ele entra em contato no dia e hora da atividade.</p>
        ) : (
          <>
            {dados.bot_resumo && (
              <div className="mx-5 mt-3 rounded-xl px-3 py-2 bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-900 text-xs text-stone-800 dark:text-stone-100 whitespace-pre-wrap">
                <div className="text-[10px] font-semibold text-emerald-700 dark:text-emerald-300 mb-0.5">Resumo{dados.concluida ? ' • atividade concluída' : ' • atividade pendente'}</div>
                {dados.bot_resumo}
              </div>
            )}
            {dados.conversas.length > 1 && (
              <div className="px-5 pt-3 flex flex-wrap gap-1.5">
                {dados.conversas.map((c, i) => (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => setAba(i)}
                    aria-pressed={c === conv}
                    className={`px-3 py-1.5 rounded-lg text-xs font-semibold border cursor-pointer ${
                      c === conv ? 'bg-blue-600 border-blue-600 text-white' : 'border-stone-300 dark:border-stone-700 text-stone-600 dark:text-stone-300 hover:bg-stone-100 dark:hover:bg-stone-800'
                    }`}
                  >
                    {c.nome || c.destino}
                  </button>
                ))}
              </div>
            )}
            {conv && (
              <>
                <div className="px-5 pt-3 pb-2 flex flex-wrap items-center gap-2 text-[11px] text-stone-500 dark:text-stone-400">
                  {conv.canal === 'email' ? <Mail className="w-3.5 h-3.5" /> : <MessageCircle className="w-3.5 h-3.5 text-emerald-600" />}
                  <span className="font-semibold text-stone-700 dark:text-stone-200">{conv.nome}</span>
                  <span>{conv.destino || 'sem contato'}</span>
                  <span className={`px-2 py-0.5 rounded-full border text-[10px] font-semibold ${SITUACAO[conv.situacao]?.[1] ?? ''}`}>{SITUACAO[conv.situacao]?.[0] ?? conv.situacao}</span>
                  {conv.resumo && <span className="basis-full text-stone-600 dark:text-stone-300">{conv.resumo}</span>}
                </div>
                <div className="flex-1 min-h-0 overflow-y-auto px-5 py-3 flex flex-col gap-2 bg-stone-50 dark:bg-stone-950/40 border-t border-stone-200 dark:border-stone-800 rounded-b-2xl">
                  {!conv.mensagens.length && <p className="text-xs text-center text-stone-400 py-6">Nenhuma mensagem.</p>}
                  {conv.mensagens.map((m) => (
                    <div
                      key={m.id}
                      className={`max-w-[80%] rounded-xl px-3 py-2 text-xs whitespace-pre-wrap ${
                        m.direcao === 'recebida'
                          ? 'self-start bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-800 text-stone-800 dark:text-stone-100'
                          : 'self-end bg-blue-600 text-white'
                      }`}
                    >
                      <div className={`text-[10px] font-semibold mb-0.5 ${m.direcao === 'recebida' ? 'text-stone-400' : 'text-blue-100'}`}>
                        {m.direcao === 'recebida' ? conv.nome || 'Pessoa' : 'Bot'}
                      </div>
                      {m.texto}
                      <div className={`text-[10px] mt-1 text-right ${m.direcao === 'recebida' ? 'text-stone-400' : 'text-blue-100'}`}>{formatDateTimeBR(m.criado_em)}</div>
                    </div>
                  ))}
                </div>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
};

/** "Conversa do Bot" como ação da coluna Ações (ícone solto ou item do menu "...") */
export const AcaoConversaBot: React.FC<{ atividadeId: Id }> = ({ atividadeId }) => {
  const [aberta, setAberta] = useState(false);
  return (
    <>
      <BotaoAcao icone={Bot} titulo="Conversa do Bot" descricao="O que o Bot falou com cada pessoa e o resumo" onClick={() => setAberta(true)} />
      {aberta && createPortal(<ConversaBot atividadeId={atividadeId} onFechar={() => setAberta(false)} />, document.body)}
    </>
  );
};

/** Ícone que abre a conversa do Bot (ficha do negócio, tarefas do chamado, pesquisa de satisfação) */
export const BotaoConversaBot: React.FC<{ atividadeId: Id; className?: string }> = ({ atividadeId, className }) => {
  const [aberta, setAberta] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setAberta(true);
        }}
        title="Conversa do Bot: o que ele falou com cada pessoa e o resumo"
        className={className ?? 'p-1.5 rounded-lg text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-950/40 cursor-pointer'}
      >
        <Bot className="w-4 h-4" />
      </button>
      {/* No corpo da página: dentro de uma coluna fixa (camada própria), o cabeçalho da tabela ficaria por cima */}
      {aberta && createPortal(<ConversaBot atividadeId={atividadeId} onFechar={() => setAberta(false)} />, document.body)}
    </>
  );
};
