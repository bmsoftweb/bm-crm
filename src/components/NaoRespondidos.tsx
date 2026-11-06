import React, { useEffect, useState } from 'react';
import { MessageCircleWarning } from 'lucide-react';
import { RegistroCrud } from '../types';
import { listRecords } from '../services/api';
import { formatDateTimeBR } from '../utils/formatters';
import { BotaoWhatsApp } from './BotaoWhatsApp';

/**
 * Disparos que a pessoa respondeu e ninguém da equipe respondeu ainda (todas as campanhas), em cima da lista
 * de Campanhas; sem nenhum, não aparece. Recarrega com o refreshToken (Atualizar e volta à tela).
 */
export const NaoRespondidos: React.FC<{ refreshToken: number; onConversa: (telefone: string) => void }> = ({ refreshToken, onConversa }) => {
  const [linhas, setLinhas] = useState<RegistroCrud[]>([]);
  const [total, setTotal] = useState(0);

  useEffect(() => {
    let vivo = true;
    listRecords('campanha_disparos', {
      filters: [{ field: 'situacao', op: 'eq', value: 'nao_respondido' }],
      sort: 'respondido_em',
      dir: 'asc',
      limit: 100,
    })
      .then((r) => {
        if (!vivo) return;
        setLinhas(r.data);
        setTotal(r.total);
      })
      .catch(() => {}); // a lista de campanhas abaixo já mostra o erro do servidor
    return () => {
      vivo = false;
    };
  }, [refreshToken]);

  if (!linhas.length) return null;

  return (
    <div className="shrink-0 border-b-2 border-rose-200 dark:border-rose-900 bg-rose-50/40 dark:bg-rose-950/20">
      <div className="px-4 py-2 flex items-center gap-2 text-xs font-bold text-rose-800 dark:text-rose-200">
        <MessageCircleWarning className="w-4 h-4" />
        Não respondidos ({total}) — a pessoa respondeu à campanha e ninguém da equipe respondeu ainda
      </div>
      <div className="max-h-56 overflow-y-auto">
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-rose-50 dark:bg-stone-900 text-stone-500 dark:text-stone-400">
            <tr>
              <th className="text-left font-semibold px-4 py-1.5">Campanha</th>
              <th className="text-left font-semibold px-2 py-1.5">Cliente</th>
              <th className="text-left font-semibold px-2 py-1.5">Celular</th>
              <th className="text-center font-semibold px-2 py-1.5">Respondeu em</th>
              <th className="text-center font-semibold px-4 py-1.5">Responder</th>
            </tr>
          </thead>
          <tbody>
            {linhas.map((d) => (
              <tr key={String(d.id)} className="border-t border-rose-100 dark:border-stone-800 hover:bg-rose-50 dark:hover:bg-stone-800/50">
                <td className="px-4 py-1.5">{String(d.campanha_id__rotulo ?? d.campanha_id ?? '')}</td>
                <td className="px-2 py-1.5">{String(d.nome ?? '')}</td>
                <td className="px-2 py-1.5">{String(d.destino ?? '')}</td>
                <td className="px-2 py-1.5 text-center">{d.respondido_em ? formatDateTimeBR(String(d.respondido_em)) : ''}</td>
                <td className="px-4 py-1.5 text-center">
                  <BotaoWhatsApp temNumero={Boolean(d.destino)} titulo="Abrir a conversa para responder" onAbrir={() => onConversa(String(d.destino))} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};
