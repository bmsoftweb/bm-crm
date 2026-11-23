import React, { useEffect, useState } from 'react';
import { ArrowRightLeft, Loader2, X } from 'lucide-react';
import { createRecord, fetchOptions, getRecord, religarConversa, updateRecord } from '../services/api';
import { OpcaoRef } from '../types';
import { SelectBusca } from './SelectBusca';
import { AvisoErro } from './AvisoErro';
import { INPUT_CLASS, LABEL_CLASS, FIELD_CLASS } from '../utils/formStyles';

type Recurso = 'pessoas' | 'pessoas_contatos' | 'leads';

interface Props {
  telefone: string;
  /** Número formatado para o cadastro: (47) 98906-9435 */
  fone: string;
  /** Cadastro que hoje tem o número (o contato, senão a pessoa, senão o lead) */
  recurso: Recurso;
  id: number;
  nomeAtual: string;
  /** Nome do perfil no WhatsApp: nome do contato quando o cliente escolhido já tem outro WhatsApp */
  perfil: string | null;
  onFechar: () => void;
  onTrocado: (aviso: string | null) => void;
}

const CAMPOS: Record<Recurso, string[]> = {
  pessoas: ['whatsapp', 'telefone'],
  pessoas_contatos: ['whatsapp', 'celular', 'telefone'],
  leads: ['whatsapp', 'telefone'],
};
const oito = (t: unknown) => String(t ?? '').replace(/\D/g, '').slice(-8);

/**
 * Clicar no avatar da conversa: escolhe o cliente certo para o número. O número sai do cadastro que o tinha
 * e entra no escolhido (no WhatsApp dele, ou como contato dele se já tiver outro WhatsApp); a conversa vai junto.
 */
export const ClienteConversa: React.FC<Props> = ({ telefone, fone, recurso, id, nomeAtual, perfil, onFechar, onTrocado }) => {
  const [pessoas, setPessoas] = useState<OpcaoRef[] | null>(null);
  const [pessoaId, setPessoaId] = useState('');
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    fetchOptions('pessoas', 'nome')
      .then((l) => setPessoas(recurso === 'pessoas' ? l.filter((o) => String(o.value) !== String(id)) : l))
      .catch((err) => setErro(err.message));
  }, [recurso, id]);

  const trocar = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pessoaId) return setErro('Escolha o cliente.');
    setSalvando(true);
    setErro(null);
    try {
      // 1. Tira o número do cadastro errado
      const atual = await getRecord(recurso, id);
      const limpar = Object.fromEntries(CAMPOS[recurso].filter((c) => oito(atual[c]) === oito(telefone)).map((c) => [c, null]));
      if (Object.keys(limpar).length) await updateRecord(recurso, id, limpar);
      // 2. Põe no cliente escolhido: no WhatsApp dele, ou num contato se ele já tem outro
      const novo = await getRecord('pessoas', pessoaId);
      if (!novo.whatsapp) await updateRecord('pessoas', pessoaId, { whatsapp: fone });
      else if (oito(novo.whatsapp) !== oito(telefone))
        await createRecord('pessoas_contatos', { pessoa_id: pessoaId, nome: perfil || 'WhatsApp', whatsapp: fone, celular: fone });
      // 3. A conversa passa para o dono novo do número
      const r = await religarConversa(telefone);
      onTrocado(String(r.pessoa_id ?? '') === String(pessoaId) ? null : 'O número ainda aparece em outro cadastro: confira em Pessoas quem mais tem esse telefone.');
    } catch (err: any) {
      setErro(err.message);
      setSalvando(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-stone-900/50 backdrop-blur-sm" onClick={onFechar} />
      <form onSubmit={trocar} role="dialog" aria-modal="true" className="relative w-full max-w-md bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-800 rounded-2xl shadow-2xl z-10">
        <div className="px-5 py-4 border-b border-stone-200 dark:border-stone-800 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <h3 className="text-base font-bold text-stone-900 dark:text-stone-100">Trocar o cliente deste número</h3>
            <p className="text-[11px] text-stone-500 dark:text-stone-400">
              Hoje está em <strong>{nomeAtual}</strong>. O número sai desse cadastro e passa para o cliente escolhido, com a conversa.
            </p>
          </div>
          <button type="button" onClick={onFechar} title="Fechar" className="p-1.5 rounded-lg text-stone-400 hover:text-stone-700 hover:bg-stone-100 dark:hover:bg-stone-800 cursor-pointer">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="p-5 space-y-4">
          <div className={FIELD_CLASS}>
            <label htmlFor="troca-pessoa" className={LABEL_CLASS}>Cliente</label>
            {pessoas ? (
              <SelectBusca id="troca-pessoa" value={pessoaId} options={pessoas} onChange={setPessoaId} required vazioLabel="— Escolha —" className={`${INPUT_CLASS} w-full`} />
            ) : (
              <div className="h-[38px] flex items-center text-stone-400">
                <Loader2 className="w-4 h-4 animate-spin" />
              </div>
            )}
          </div>
        </div>
        <div className="px-5 py-3 border-t border-stone-200 dark:border-stone-800 flex justify-end gap-2.5 bg-stone-50 dark:bg-stone-950/40 rounded-b-2xl">
          <button type="button" onClick={onFechar} disabled={salvando} className="px-4 py-2.5 rounded-lg text-xs font-semibold text-stone-600 dark:text-stone-300 border border-stone-300 dark:border-stone-700 hover:bg-stone-100 dark:hover:bg-stone-800 cursor-pointer disabled:opacity-40">
            Cancelar
          </button>
          <button type="submit" disabled={salvando || !pessoaId} className="flex items-center gap-2 px-4 py-2.5 rounded-lg text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 cursor-pointer disabled:opacity-50">
            {salvando ? <Loader2 className="w-4 h-4 animate-spin" /> : <ArrowRightLeft className="w-4 h-4" />}
            Trocar
          </button>
        </div>
      </form>
      {erro && <AvisoErro mensagem={erro} onFechar={() => setErro(null)} />}
    </div>
  );
};
