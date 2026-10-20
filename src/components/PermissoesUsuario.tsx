import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Loader2, Save, ShieldCheck, X } from 'lucide-react';
import { fetchNotificacoesDesligadas, salvarNotificacoesDesligadas, salvarPermissoes } from '../services/api';
import { RegistroCrud, ResourceDef } from '../types';
import { gruposDoMenu } from '../utils/menu';
import { Toggle } from './Toggle';
import { AvisoErro } from './AvisoErro';

interface Props {
  usuario: RegistroCrud;
  resources: ResourceDef[];
  onFechar: () => void;
  onGravado: () => void;
  onToast: (msg: string) => void;
}

/** Notificações da campainha que o usuário pode desligar (server/notificacoes.ts › NOTIFICACOES_OPCIONAIS) */
const NOTIFICACOES = [
  { tipo: 'visita_site', label: 'Alguém entrou no site', hint: 'Só para quem acessa Visitas do Site' },
  { tipo: 'chamado', label: 'Chamado novo na fila', hint: 'Só para quem acessa a Fila de Chamados' },
];

/** Permissões gravadas (JSON do banco) → ids; null = acessa tudo */
const lerLista = (v: unknown): string[] | null => {
  if (v == null) return null;
  try {
    const l = typeof v === 'string' ? JSON.parse(v) : v;
    return Array.isArray(l) ? l.map(String) : null;
  } catch {
    return null;
  }
};

/**
 * Usuários › Permissões: as opções do menu (mesma lista da barra lateral) que o usuário acessa.
 * Sem nada gravado, acessa tudo; administrador acessa tudo sempre.
 */
export const PermissoesUsuario: React.FC<Props> = ({ usuario, resources, onFechar, onGravado, onToast }) => {
  // Opções só de administrador (Configurações) não entram nas permissões
  const grupos = gruposDoMenu(resources)
    .map((g) => ({ ...g, itens: g.itens.filter((i) => !i.somenteAdmin) }))
    .filter((g) => g.itens.length);
  const todos = grupos.flatMap((g) => g.itens.map((i) => i.id));
  const [marcados, setMarcados] = useState<Set<string>>(() => new Set(lerLista(usuario.permissoes) ?? todos));
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const admin = usuario.tipo === 'admin';
  /** Tipos de notificação desligados; null = ainda carregando */
  const [desligadas, setDesligadas] = useState<Set<string> | null>(null);
  useEffect(() => {
    fetchNotificacoesDesligadas(usuario.id as number)
      .then((r) => setDesligadas(new Set(r.desligadas)))
      .catch((e) => setErro(e.message));
  }, [usuario.id]);

  const marcar = (ids: string[], sim: boolean) =>
    setMarcados((m) => {
      const n = new Set(m);
      ids.forEach((id) => (sim ? n.add(id) : n.delete(id)));
      return n;
    });

  const salvar = async () => {
    setSalvando(true);
    setErro(null);
    try {
      // Tudo marcado grava "sem restrição": opções novas do menu já nascem liberadas para ele
      const lista = todos.every((id) => marcados.has(id)) ? null : todos.filter((id) => marcados.has(id));
      await salvarPermissoes(usuario.id as number, lista);
      if (desligadas) await salvarNotificacoesDesligadas(usuario.id as number, [...desligadas]);
      onToast(`Permissões de ${usuario.nome} gravadas. Valem no próximo acesso dele (ou ao recarregar a página).`);
      onGravado();
    } catch (err: any) {
      setErro(err.message);
      setSalvando(false);
    }
  };

  return (
    // O clique não sobe para a linha da lista de Usuários (o modal é aberto de dentro dela)
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4" onClick={(e) => e.stopPropagation()}>
      <div className="fixed inset-0 bg-stone-950/70 backdrop-blur-xs" onClick={salvando ? undefined : onFechar} aria-hidden="true" />
      <div role="dialog" aria-modal="true" className="relative z-10 w-full max-w-lg max-h-[90vh] flex flex-col bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-800 rounded-2xl shadow-2xl">
        <div className="px-5 py-4 border-b border-stone-200 dark:border-stone-800 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <h3 className="text-base font-bold text-stone-900 dark:text-stone-100 flex items-center gap-2">
              <ShieldCheck className="w-5 h-5 text-blue-600" />
              Permissões
            </h3>
            <p className="text-[11px] text-stone-500 dark:text-stone-400 truncate">{usuario.nome} — opções do menu que pode acessar</p>
          </div>
          <button type="button" onClick={onFechar} title="Fechar" className="p-1.5 rounded-lg text-stone-400 hover:text-stone-700 hover:bg-stone-100 dark:hover:bg-stone-800 cursor-pointer">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 flex flex-col gap-4">
          {admin && (
            <div className="p-3 rounded-lg bg-amber-50 dark:bg-amber-950/40 text-xs text-amber-800 dark:text-amber-300">
              {usuario.nome} é administrador: acessa tudo, independente do que estiver marcado aqui.
            </div>
          )}
          {erro && <AvisoErro mensagem={erro} onFechar={() => setErro(null)} />}
          {grupos.map((g) => {
            const ids = g.itens.map((i) => i.id);
            const todosDoGrupo = ids.every((id) => marcados.has(id));
            return (
              <div key={g.titulo}>
                <div className="flex items-center justify-between pb-1.5 mb-1 px-2 -mx-2 border-b border-stone-100 dark:border-stone-800">
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-stone-400">{g.titulo}</span>
                  <Toggle size="sm" checked={todosDoGrupo} onChange={(sim) => marcar(ids, sim)} label={<span className="text-[11px] text-stone-500">Marcar todos</span>} />
                </div>
                {g.itens.map((it) => (
                  // Linha sob o mouse (ou com o foco do teclado) destacada, para não errar o liga/desliga
                  <div
                    key={it.id}
                    className="flex items-center justify-between gap-3 py-1.5 px-2 -mx-2 rounded-lg transition-colors hover:bg-blue-50 focus-within:bg-blue-50 dark:hover:bg-blue-950/40 dark:focus-within:bg-blue-950/40"
                  >
                    <span className="flex items-center gap-2.5 min-w-0 text-xs text-stone-700 dark:text-stone-200">
                      <it.icone className="w-4 h-4 shrink-0 text-stone-400" />
                      <span className="truncate">{it.label}</span>
                    </span>
                    <Toggle size="sm" checked={marcados.has(it.id)} onChange={(sim) => marcar([it.id], sim)} />
                  </div>
                ))}
              </div>
            );
          })}
          <div>
            <div className="pb-1.5 mb-1 px-2 -mx-2 border-b border-stone-100 dark:border-stone-800">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-stone-400">Notificações</span>
            </div>
            {NOTIFICACOES.map((n) => (
              <div
                key={n.tipo}
                title={n.hint}
                className="flex items-center justify-between gap-3 py-1.5 px-2 -mx-2 rounded-lg transition-colors hover:bg-blue-50 focus-within:bg-blue-50 dark:hover:bg-blue-950/40 dark:focus-within:bg-blue-950/40"
              >
                <span className="text-xs text-stone-700 dark:text-stone-200">{n.label}</span>
                {desligadas ? (
                  <Toggle
                    size="sm"
                    checked={!desligadas.has(n.tipo)}
                    onChange={(sim) =>
                      setDesligadas((d) => {
                        const nova = new Set(d);
                        if (sim) nova.delete(n.tipo);
                        else nova.add(n.tipo);
                        return nova;
                      })
                    }
                  />
                ) : (
                  <Loader2 className="w-4 h-4 animate-spin text-stone-400" />
                )}
              </div>
            ))}
            <p className="mt-1 text-[11px] text-stone-500 dark:text-stone-400">
              Sempre recebe (não dá para desligar): chamado ou conversa do WhatsApp transferido para ele, tarefa criada para ele e cliente que respondeu a pesquisa
              com nota baixa.
            </p>
          </div>
          <p className="text-[11px] text-stone-500 dark:text-stone-400">
            Desmarcado: a opção some do menu e o servidor recusa abrir aqueles dados. As listas de escolha dos formulários (ex.: responsável do negócio) continuam
            funcionando.
          </p>
        </div>

        <div className="px-5 py-3 border-t border-stone-200 dark:border-stone-800 flex justify-end gap-2.5 bg-stone-50 dark:bg-stone-950/40 rounded-b-2xl">
          <button type="button" onClick={onFechar} disabled={salvando} className="px-4 py-2.5 rounded-lg text-xs font-semibold text-stone-600 dark:text-stone-300 border border-stone-300 dark:border-stone-700 hover:bg-stone-100 dark:hover:bg-stone-800 cursor-pointer disabled:opacity-40">
            Cancelar
          </button>
          <button type="button" onClick={salvar} disabled={salvando} className="flex items-center gap-2 px-4 py-2.5 rounded-lg text-xs font-semibold bg-blue-600 hover:bg-blue-700 text-white shadow-xs cursor-pointer disabled:opacity-50">
            {salvando ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            Salvar permissões
          </button>
        </div>
      </div>
    </div>
  );
};

/** Ícone da coluna Ações da lista de Usuários */
export const BotaoPermissoes: React.FC<{ usuario: RegistroCrud; resources: ResourceDef[]; onRecarregar: () => void; onToast: (msg: string) => void }> = ({
  usuario,
  resources,
  onRecarregar,
  onToast,
}) => {
  const [aberto, setAberto] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setAberto(true);
        }}
        title="Permissões: opções do menu que este usuário acessa"
        className="p-1.5 rounded-lg text-stone-400 hover:text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-950/40 cursor-pointer"
      >
        <ShieldCheck className="w-4 h-4" />
      </button>
      {/* Portal: fora da célula da tabela (senão o cabeçalho fixo da lista fica por cima e o texto não quebra linha) */}
      {aberto &&
        createPortal(
        <PermissoesUsuario
          usuario={usuario}
          resources={resources}
          onFechar={() => setAberto(false)}
          onGravado={() => {
            setAberto(false);
            onRecarregar();
          }}
          onToast={onToast}
        />,
          document.body,
        )}
    </>
  );
};
