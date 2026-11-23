import React, { useEffect, useState } from 'react';
import { Loader2, X } from 'lucide-react';
import { fetchOptions, fetchResources, getRecord, religarConversa, updateRecord } from '../services/api';
import { OpcaoRef, RegistroCrud, ResourceDef } from '../types';
import { RecordForm } from './RecordForm';
import { AvisoErro } from './AvisoErro';

interface Props {
  telefone: string;
  /** Cadastro ligado à conversa: o contato (o número é dele), senão a pessoa, senão o lead */
  recurso: 'pessoas' | 'pessoas_contatos' | 'leads';
  id: number;
  onFechar: () => void;
  /** Gravou: a conversa foi religada (pessoa_id null = o número não é mais de ninguém) */
  onSalvo: (r: { pessoa_id: number | null; lead_id: number | null }) => void;
}

const TITULO: Record<Props['recurso'], string> = {
  pessoas: 'Cliente desta conversa',
  pessoas_contatos: 'Contato desta conversa',
  leads: 'Lead desta conversa',
};

/**
 * Clicar no avatar da conversa: abre o cadastro ligado ao número para corrigir (ex.: o número estava no
 * telefone de outro cliente). Ao gravar, o dono do número é procurado de novo e a conversa passa para ele.
 */
export const ClienteConversa: React.FC<Props> = ({ telefone, recurso, id, onFechar, onSalvo }) => {
  const [resource, setResource] = useState<ResourceDef | null>(null);
  const [registro, setRegistro] = useState<RegistroCrud | null>(null);
  const [refOptions, setRefOptions] = useState<Record<string, OpcaoRef[]>>({});
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    let vivo = true;
    (async () => {
      const def = (await fetchResources()).find((r) => r.name === recurso);
      if (!def) throw new Error('Cadastro não encontrado.');
      const reg = await getRecord(recurso, id);
      const opcoes: Record<string, OpcaoRef[]> = {};
      for (const f of def.fields.filter((c) => c.ref)) opcoes[f.name] = await fetchOptions(f.ref!.resource, f.ref!.labelField).catch(() => []);
      if (!vivo) return;
      setResource(def);
      setRegistro(reg);
      setRefOptions(opcoes);
    })().catch((err) => vivo && setErro(err.message));
    return () => {
      vivo = false;
    };
  }, [recurso, id]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-stone-900/50 backdrop-blur-sm" onClick={onFechar} />
      <div role="dialog" aria-modal="true" className="relative w-full max-w-4xl max-h-[90vh] flex flex-col bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-800 rounded-2xl shadow-2xl z-10">
        <div className="px-5 py-4 border-b border-stone-200 dark:border-stone-800 flex items-center justify-between gap-3 shrink-0">
          <div className="min-w-0">
            <h3 className="text-base font-bold text-stone-900 dark:text-stone-100">{TITULO[recurso]}</h3>
            <p className="text-[11px] text-stone-500 dark:text-stone-400">
              Número ligado errado? Tire-o deste cadastro (ou ponha no cliente certo) e salve: a conversa é religada pelo número.
              Mudar o nome aqui muda o cadastro em todo o CRM.
            </p>
          </div>
          <button type="button" onClick={onFechar} title="Fechar" className="p-1.5 rounded-lg text-stone-400 hover:text-stone-700 hover:bg-stone-100 dark:hover:bg-stone-800 cursor-pointer">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto flex flex-col">
          {resource && registro ? (
            <RecordForm
              resource={resource}
              record={registro}
              refOptions={refOptions}
              onCancel={onFechar}
              onSave={async (payload) => {
                await updateRecord(recurso, id, payload);
                onSalvo(await religarConversa(telefone));
              }}
            />
          ) : (
            !erro && (
              <div className="p-10 flex justify-center text-stone-400">
                <Loader2 className="w-5 h-5 animate-spin" />
              </div>
            )
          )}
        </div>
      </div>
      {erro && <AvisoErro mensagem={erro} onFechar={() => setErro(null)} />}
    </div>
  );
};
