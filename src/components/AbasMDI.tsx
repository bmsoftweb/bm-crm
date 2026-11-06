import React, { useState } from 'react';
import { AbasRolagem } from './AbasRolagem';

/**
 * Abas MDI dentro de uma tela: cada aba monta na primeira visita e depois fica montada (escondida),
 * para voltar com filtros, página e rolagem como estavam. onVoltar: a aba já aberta voltou a aparecer.
 */
export const AbasMDI: React.FC<{
  abas: { id: string; titulo: string; conteudo: React.ReactNode }[];
  onVoltar?: (id: string) => void;
}> = ({ abas, onVoltar }) => {
  const [aba, setAba] = useState(abas[0].id);
  const [visitadas, setVisitadas] = useState<string[]>([abas[0].id]);

  const trocar = (id: string) => {
    if (id === aba) return;
    setAba(id);
    if (visitadas.includes(id)) onVoltar?.(id);
    else setVisitadas((v) => [...v, id]);
  };

  return (
    <div className="flex-1 flex flex-col min-h-0 w-full">
      <AbasRolagem className="bg-stone-50 dark:bg-stone-950/60 border-b border-stone-200 dark:border-stone-800 shrink-0">
        {abas.map((a) => (
          <button
            key={a.id}
            onClick={() => trocar(a.id)}
            className={`px-4 py-3 text-xs font-bold shrink-0 border-b-2 transition-all cursor-pointer ${
              aba === a.id
                ? 'border-blue-600 text-blue-600 bg-white dark:bg-stone-900 dark:text-blue-400'
                : 'border-transparent text-stone-500 hover:text-stone-700 dark:hover:text-stone-200'
            }`}
          >
            {a.titulo}
          </button>
        ))}
      </AbasRolagem>
      {abas
        .filter((a) => visitadas.includes(a.id))
        .map((a) => (
          <div key={a.id} className={a.id === aba ? 'flex-1 flex flex-col min-h-0 min-w-0' : 'hidden'}>
            {a.conteudo}
          </div>
        ))}
    </div>
  );
};
