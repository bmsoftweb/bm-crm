import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import { UserCheck } from 'lucide-react';
import { converterLead } from '../services/api';
import { RegistroCrud } from '../types';
import { BotaoAcao } from './MenuAcoes';
import { ConfirmDialog } from './ConfirmDialog';

/** Marketing › Leads: "Converter em cliente" (copia para Pessoas e leva junto conversas, atividades e disparos) */
export const ConverterLead: React.FC<{ registro: RegistroCrud; onConvertido: () => void; onToast: (msg: string) => void }> = ({ registro, onConvertido, onToast }) => {
  const [confirmando, setConfirmando] = useState(false);
  return (
    <>
      <BotaoAcao icone={UserCheck} titulo="Converter em cliente" descricao="Copia o lead para Pessoas, com as conversas, atividades e disparos dele" onClick={() => setConfirmando(true)} />
      {confirmando &&
        createPortal(
          <ConfirmDialog
            titulo="Converter em cliente?"
            mensagem={`"${registro.nome}" vai para o cadastro de Pessoas como cliente, com as conversas do WhatsApp, as atividades e os disparos de campanha. Ele sai da lista de leads.`}
            confirmar="Converter"
            tom="normal"
            onConfirmar={async () => {
              await converterLead(registro.id as number);
              setConfirmando(false);
              onToast('Lead convertido em cliente.');
              onConvertido();
            }}
            onCancelar={() => setConfirmando(false)}
          />,
          document.body,
        )}
    </>
  );
};
