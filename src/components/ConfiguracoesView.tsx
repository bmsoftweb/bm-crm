import React, { useState } from 'react';
import { Usuario } from '../types';
import { CamposPersonalizados } from './CamposPersonalizados';
import { ConfigEmail } from './ConfigEmail';
import { ConfigWhatsApp } from './ConfigWhatsApp';
import { ConfigAutomaticas } from './ConfigAutomaticas';
import { ConfigChatbot } from './ConfigChatbot';
import { ConfigIA } from './ConfigIA';
import { ConfigPesquisa } from './ConfigPesquisa';
import { ConfigJornada } from './ConfigJornada';
import { ConfigVendas } from './ConfigVendas';
import { ConfigAssinatura } from './ConfigAssinatura';
import { ModelosContrato } from './ModelosContrato';
import { ConfigAgendaGoogle } from './ConfigAgendaGoogle';
import { ConfigProspeccao } from './ConfigProspeccao';
import { AbasRolagem } from './AbasRolagem';

/**
 * Configurações da empresa, no mesmo formato do meuConsultorioWeb: uma aba por
 * grupo de configuração. Cada aba grava na tabela `config` (empresa + grupo + chave).
 */
const ABAS = [
  {
    id: 'pessoas',
    titulo: 'Campos Personalizados de Pessoas',
    descricao: 'Campos extras que aparecem no cadastro de pessoas, definidos por você.',
  },
  {
    id: 'email',
    titulo: 'E-mail (SMTP)',
    descricao: 'Duas contas: a comercial (propostas, pedidos, contratos, campanhas) e a do suporte (pesquisa de satisfação e chamados).',
  },
  {
    id: 'whatsapp',
    titulo: 'WhatsApp',
    descricao: 'Provedor usado para enviar propostas e as mensagens das campanhas.',
  },
  {
    id: 'ia',
    titulo: 'IA',
    descricao: 'A IA usada no app (Gemini, Claude ou DeepSeek, com chave e modelo): Automação do WhatsApp, análise das conversas, Bot das atividades e pesquisas.',
  },
  {
    id: 'chatbot',
    titulo: 'Chatbot',
    descricao: 'Nome do assistente, tempo para liberar o atendente, revezamento de leads, análise das conversas e pesquisa de satisfação.',
  },
  {
    id: 'jornada',
    titulo: 'Automação',
    descricao: 'Atendimento automático do WhatsApp desenhado em nós: menus, perguntas, condições, esperas, chamadas de API, IA (com o texto-base) e departamentos.',
  },
  {
    id: 'automaticas',
    titulo: 'Mensagens automáticas',
    descricao: 'WhatsApp enviado ao cliente quando algo acontece no CRM: lembrete de atividade, proposta e contrato perto de vencer, pedido aprovado ou faturado.',
  },
  {
    id: 'vendas',
    titulo: 'Vendas',
    descricao: 'Comportamentos do envio de propostas e pedidos.',
  },
  {
    id: 'assinatura',
    titulo: 'Assinatura (D4Sign)',
    descricao: 'Conta da D4Sign usada para enviar os contratos para assinatura eletrônica.',
  },
  {
    id: 'agenda',
    titulo: 'Google Agenda',
    descricao: 'Agenda do Google da empresa: os eventos viram atividades, e visitas e reuniões do CRM vão para a agenda.',
  },
  {
    id: 'prospeccao',
    titulo: 'Prospecção',
    descricao: 'Chave da Google Places API usada na tela Prospecção para buscar empresas no Google Maps.',
  },
  {
    id: 'modelos_contrato',
    titulo: 'Modelos de contrato',
    descricao: 'Textos dos contratos com variáveis: ao gerar o PDF de um contrato, escolhe-se o modelo e os dados dele são preenchidos.',
  },
];

interface Props {
  usuario: Usuario | null;
  onToast: (msg: string) => void;
}

export const ConfiguracoesView: React.FC<Props> = ({ usuario, onToast }) => {
  const [aba, setAba] = useState(ABAS[0].id);
  const somenteLeitura = usuario?.tipo !== 'admin';
  const atual = ABAS.find((a) => a.id === aba) || ABAS[0];

  return (
    <div className="flex flex-col flex-1 min-h-0 bg-white dark:bg-stone-900">
      {/* Abas dos grupos de configuração */}
      <AbasRolagem className="bg-stone-50 dark:bg-stone-950/60 border-b border-stone-200 dark:border-stone-800 shrink-0">
        {ABAS.map((a) => (
          <button
            key={a.id}
            onClick={() => setAba(a.id)}
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

      <div className="flex-1 overflow-y-auto min-h-0">
        <div className="px-4 py-4">
          <div className="mb-3">
            <h2 className="text-base font-bold text-stone-900 dark:text-stone-100">{atual.titulo}</h2>
            <p className="text-xs text-stone-500 dark:text-stone-400 mt-0.5">{atual.descricao}</p>
          </div>

          {somenteLeitura && (
            <div className="mb-3 p-3 bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-900 text-xs text-amber-800 dark:text-amber-300">
              Somente administradores alteram as configurações da empresa.
            </div>
          )}

          {aba === 'pessoas' && <CamposPersonalizados somenteLeitura={somenteLeitura} onToast={onToast} />}
          {aba === 'email' && (
            <div className="flex flex-col gap-8">
              <section className="flex flex-col gap-3">
                <h3 className="text-sm font-bold text-stone-800 dark:text-stone-100">E-mail comercial</h3>
                <p className="text-xs text-stone-500 dark:text-stone-400 -mt-2">Propostas, pedidos, contratos, campanhas e o Bot das atividades.</p>
                <ConfigEmail chave="smtp" somenteLeitura={somenteLeitura} onToast={onToast} />
              </section>
              <section className="flex flex-col gap-3 pt-6 border-t border-stone-200 dark:border-stone-800">
                <h3 className="text-sm font-bold text-stone-800 dark:text-stone-100">E-mail do suporte</h3>
                <p className="text-xs text-stone-500 dark:text-stone-400 -mt-2">
                  Pesquisa de satisfação (envio e leitura das respostas) e o Bot das atividades de chamados. Em branco: usa o e-mail comercial.
                </p>
                <ConfigEmail chave="smtp_suporte" somenteLeitura={somenteLeitura} onToast={onToast} />
              </section>
            </div>
          )}
          {aba === 'whatsapp' && (
            <div className="flex flex-col gap-8">
              <ConfigWhatsApp somenteLeitura={somenteLeitura} onToast={onToast} />
              <section className="flex flex-col gap-3 pt-6 border-t border-stone-200 dark:border-stone-800">
                <div>
                  <h3 className="text-sm font-bold text-stone-900 dark:text-stone-100">WhatsApp das campanhas</h3>
                  <p className="text-xs text-stone-500 dark:text-stone-400 max-w-3xl">
                    Outro número só para as campanhas: se o disparo em massa levar a um bloqueio, o número do atendimento continua
                    funcionando. Sem ele, as campanhas saem pelo WhatsApp acima.
                  </p>
                </div>
                <ConfigWhatsApp conta="campanhas" somenteLeitura={somenteLeitura} onToast={onToast} />
              </section>
            </div>
          )}
          {aba === 'ia' && <ConfigIA somenteLeitura={somenteLeitura} onToast={onToast} />}
          {aba === 'chatbot' && (
            <>
              <ConfigChatbot somenteLeitura={somenteLeitura} onToast={onToast} />
              <ConfigPesquisa somenteLeitura={somenteLeitura} onToast={onToast} />
            </>
          )}
          {aba === 'jornada' && <AutomacoesWhatsApp somenteLeitura={somenteLeitura} onToast={onToast} />}
          {aba === 'automaticas' && <ConfigAutomaticas somenteLeitura={somenteLeitura} onToast={onToast} />}
          {aba === 'vendas' && <ConfigVendas somenteLeitura={somenteLeitura} onToast={onToast} />}
          {aba === 'assinatura' && <ConfigAssinatura somenteLeitura={somenteLeitura} onToast={onToast} />}
          {aba === 'agenda' && <ConfigAgendaGoogle somenteLeitura={somenteLeitura} onToast={onToast} />}
          {aba === 'prospeccao' && <ConfigProspeccao somenteLeitura={somenteLeitura} onToast={onToast} />}
          {aba === 'modelos_contrato' && <ModelosContrato somenteLeitura={somenteLeitura} onToast={onToast} />}
        </div>
      </div>
    </div>
  );
};

/** Aba Automação: a do atendimento (número padrão) e a de quem responde no WhatsApp das campanhas */
const AutomacoesWhatsApp: React.FC<{ somenteLeitura: boolean; onToast: (msg: string) => void }> = ({ somenteLeitura, onToast }) => {
  const [chave, setChave] = React.useState<'jornada' | 'jornada_campanhas'>('jornada');
  const botao = (valor: typeof chave, rotulo: string) => (
    <button
      type="button"
      onClick={() => setChave(valor)}
      className={`px-3 py-1.5 rounded-lg text-xs font-semibold cursor-pointer ${
        chave === valor ? 'bg-blue-600 text-white' : 'text-stone-600 dark:text-stone-300 hover:bg-stone-100 dark:hover:bg-stone-800'
      }`}
    >
      {rotulo}
    </button>
  );
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3">
        <div className="inline-flex gap-1 p-1 rounded-xl border border-stone-200 dark:border-stone-800">
          {botao('jornada', 'Atendimento')}
          {botao('jornada_campanhas', 'Campanhas')}
        </div>
        <span className="text-xs text-stone-500 dark:text-stone-400 max-w-3xl">
          {chave === 'jornada'
            ? 'Quem escreve no WhatsApp padrão.'
            : 'Quem responde a uma campanha no WhatsApp das campanhas. A IA recebe a mensagem da campanha e as "Instruções para a IA" dela. "SAIR" descadastra a pessoa mesmo com esta automação desligada.'}
        </span>
      </div>
      <ConfigJornada key={chave} chave={chave} somenteLeitura={somenteLeitura} onToast={onToast} />
    </div>
  );
};
