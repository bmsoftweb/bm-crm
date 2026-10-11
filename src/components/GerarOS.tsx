import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import { Wrench } from 'lucide-react';
import { gerarOSDaAtividade } from '../services/api';
import { RegistroCrud } from '../types';
import { BotaoAcao } from './MenuAcoes';
import { ConfirmDialog } from './ConfirmDialog';

/**
 * "Gerar OS" do menu das Atividades: cria a Ordem de Serviço com o contato, o executor, a data/hora e o assunto
 * da atividade (server/os.ts) e abre a OS para conferir.
 */
export const AcaoGerarOS: React.FC<{ registro: RegistroCrud; onGerada: (os: { id: number; numero: number }) => void }> = ({ registro, onGerada }) => {
  const [confirmar, setConfirmar] = useState(false);
  return (
    <>
      <BotaoAcao icone={Wrench} titulo="Gerar OS" descricao="Cria a ordem de serviço com o contato, o executor, a data e o assunto da atividade" onClick={() => setConfirmar(true)} />
      {confirmar &&
        createPortal(
          // O span segura os cliques: no React eles subiriam até a linha da lista mesmo pelo portal
          <span onClick={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}>
            <ConfirmDialog
              titulo="Gerar OS"
              mensagem={`Gerar uma ordem de serviço a partir de "${String(registro.assunto ?? '')}"? Ela abre em seguida para você conferir.`}
              confirmar="Gerar OS"
              tom="normal"
              onConfirmar={async () => {
                const os = await gerarOSDaAtividade(registro.id as string);
                setConfirmar(false);
                onGerada(os);
              }}
              onCancelar={() => setConfirmar(false)}
            />
          </span>,
          document.body,
        )}
    </>
  );
};
