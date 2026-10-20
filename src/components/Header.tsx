import React from 'react';
import { Menu, RefreshCw } from 'lucide-react';
import type { ItemMenu } from '../utils/menu';

interface HeaderProps {
  /** Empresa logada (tenant) */
  empresaNome: string;
  title: string;
  subtitle: string;
  onOpenMobileSidebar: () => void;
  onRefresh?: () => void;
  /** Campainha das notificações (NotificacoesSino): sempre o 1º botão */
  sino?: React.ReactNode;
  /** Opções favoritas do menu: só o ícone, depois do sino */
  favoritos?: ItemMenu[];
  onAbrirFavorito?: (id: string) => void;
  activeTab?: string;
}

export const Header: React.FC<HeaderProps> = ({
  empresaNome,
  title,
  subtitle,
  onOpenMobileSidebar,
  onRefresh,
  sino,
  favoritos = [],
  onAbrirFavorito,
  activeTab,
}) => {
  return (
    <header className="h-[var(--altura-topo)] shrink-0 z-20 bg-white dark:bg-stone-900 border-b border-stone-200 dark:border-stone-800">
      <div className="h-full px-4 sm:px-6 lg:px-8 flex items-center justify-between gap-3">
        {/* Título da tela */}
        <div className="flex items-center gap-3 min-w-0">
          <button
            onClick={onOpenMobileSidebar}
            id="btn-open-sidebar-mobile"
            title="Abrir menu de navegação"
            className="lg:hidden p-2 rounded-xl text-stone-600 dark:text-stone-300 hover:bg-stone-100 dark:hover:bg-stone-800 border border-stone-200 dark:border-stone-700 transition-colors cursor-pointer shrink-0"
          >
            <Menu className="w-5 h-5" />
          </button>

          <div className="min-w-0">
            <div className="min-w-0">
              <h2 className="text-base sm:text-lg font-bold text-stone-900 dark:text-stone-100 leading-tight truncate">
                <span className="text-[11px] font-semibold text-blue-600 dark:text-blue-400 uppercase tracking-wider mr-2 hidden sm:inline">
                  {empresaNome} •
                </span>
                {title}
              </h2>
              <p className="text-[11px] text-stone-500 dark:text-stone-400 truncate hidden sm:block">{subtitle}</p>
            </div>
          </div>
        </div>

        {/* Ações à direita */}
        <div className="flex items-center gap-2.5 sm:gap-3 shrink-0">
          {sino}

          {favoritos.map(({ id, label, icone: Icone }) => (
            <button
              key={id}
              id={`btn-favorito-${id}`}
              onClick={() => onAbrirFavorito?.(id)}
              title={label}
              className={`p-2 rounded-xl border transition-colors cursor-pointer ${
                activeTab === id
                  ? 'border-blue-300 dark:border-blue-800 bg-blue-50 dark:bg-blue-950/40 text-blue-600 dark:text-blue-300'
                  : 'border-stone-200 dark:border-stone-700 text-stone-600 dark:text-stone-300 hover:bg-stone-100 dark:hover:bg-stone-800'
              }`}
            >
              <Icone className="w-4 h-4" />
            </button>
          ))}


          {onRefresh && (
            <button
              id="btn-atualizar"
              onClick={onRefresh}
              title="Recarregar os dados desta tela"
              className="p-2 rounded-xl border border-stone-200 dark:border-stone-700 text-stone-600 dark:text-stone-300 hover:bg-stone-100 dark:hover:bg-stone-800 transition-colors cursor-pointer"
            >
              <RefreshCw className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>
    </header>
  );
};
