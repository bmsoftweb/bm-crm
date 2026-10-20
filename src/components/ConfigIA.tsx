import React, { useEffect, useState } from 'react';
import { SelectAuto } from './SelectAuto';
import { Bot, Loader2, Save } from 'lucide-react';
import { fetchConfig, salvarConfig, testarChatbot } from '../services/api';
import { INPUT_CLASS, LABEL_CLASS, FIELD_CLASS, HINT_CLASS } from '../utils/formStyles';
import { AvisoErro } from './AvisoErro';

type Ia = 'gemini' | 'claude' | 'deepseek';

/** Onde pegar a chave e o que muda entre os modelos, por IA */
const AJUDA: Record<Ia, { nome: string; chave: string; modelos: string }> = {
  gemini: { nome: 'Gemini', chave: 'Google AI Studio › Get API key', modelos: 'Flash: respostas melhores. Flash-Lite: mais rápido e mais barato.' },
  claude: { nome: 'Claude', chave: 'console.anthropic.com › API Keys', modelos: 'Opus: respostas melhores. Sonnet: equilíbrio. Haiku: mais rápido e mais barato.' },
  deepseek: { nome: 'DeepSeek', chave: 'platform.deepseek.com › API keys', modelos: 'Flash: rápido e barato.' },
};

interface Props {
  somenteLeitura: boolean;
  onToast: (msg: string) => void;
}

/**
 * Configurações › IA: a IA usada no app (Gemini, Claude ou DeepSeek, com chave e modelo): Automação do WhatsApp,
 * análise das conversas, Bot das atividades, pesquisas de satisfação. Fica gravada junto com o chatbot (config
 * whatsapp/chatbot, que o servidor já lê em toda parte); esta aba só mexe na IA, a aba Chatbot no resto.
 */
export const ConfigIA: React.FC<Props> = ({ somenteLeitura, onToast }) => {
  /** A configuração inteira do chatbot: grava de volta com só a IA mudada */
  const [cfg, setCfg] = useState<any>(null);
  const [chave, setChave] = useState('');
  /** Qual IA já tem chave gravada, e a IA gravada (o Testar usa o que está gravado) */
  const [chaves, setChaves] = useState<Record<Ia, boolean>>({ gemini: false, claude: false, deepseek: false });
  const [iaGravada, setIaGravada] = useState<Ia>('gemini');
  const [ocupado, setOcupado] = useState<'salvar' | 'testar' | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    fetchConfig<any>('whatsapp', 'chatbot')
      .then(({ valor }) => {
        setCfg(valor);
        setChaves({ gemini: Boolean(valor?.chaves?.gemini), claude: Boolean(valor?.chaves?.claude), deepseek: Boolean(valor?.chaves?.deepseek) });
        setIaGravada(valor?.ia ?? 'gemini');
      })
      .catch((e) => setErro(e.message));
  }, []);

  if (!cfg) return erro ? <AvisoErro mensagem={erro} onFechar={() => setErro(null)} /> : <Loader2 className="w-4 h-4 animate-spin text-stone-400" />;

  const ia: Ia = cfg.ia ?? 'gemini';
  const ias: { value: Ia; label: string; modelos: { value: string; label: string }[] }[] = cfg.ias ?? [];
  const ajuda = AJUDA[ia];
  const modelos = ias.find((i) => i.value === ia)?.modelos ?? [];
  const chaveGravada = chaves[ia];
  const campo = `${INPUT_CLASS} w-full`;
  /** Trocar de IA: o modelo passa para o primeiro da lista dela; a chave digitada é descartada */
  const trocarIa = (nova: Ia) => {
    setCfg({ ...cfg, ia: nova, modelo: ias.find((i) => i.value === nova)?.modelos[0]?.value ?? '' });
    setChave('');
    setErro(null);
  };
  const podeTestar = chaveGravada && ia === iaGravada;

  const salvar = async (e: React.FormEvent) => {
    e.preventDefault();
    setOcupado('salvar');
    try {
      // Relê o gravado e muda só a IA: o resto (aba Chatbot) fica como está no banco
      const { valor } = await fetchConfig<any>('whatsapp', 'chatbot');
      const { ias: _ias, chaves: _chaves, ...resto } = valor ?? {};
      await salvarConfig('whatsapp', 'chatbot', { ...resto, ia, modelo: cfg.modelo, chave });
      if (chave) setChaves({ ...chaves, [ia]: true });
      setIaGravada(ia);
      setChave('');
      onToast('IA gravada.');
    } catch (err: any) {
      setErro(err.message);
    } finally {
      setOcupado(null);
    }
  };

  const testar = async () => {
    setOcupado('testar');
    try {
      onToast((await testarChatbot()).mensagem);
    } catch (err: any) {
      setErro(err.message);
    } finally {
      setOcupado(null);
    }
  };

  return (
    <form onSubmit={salvar} className="max-w-3xl flex flex-col gap-4">
      {erro && <AvisoErro mensagem={erro} onFechar={() => setErro(null)} />}

      <p className="text-xs text-stone-600 dark:text-stone-300">
        A IA que o app usa: nos nós de IA da Automação do WhatsApp, na análise das conversas encerradas (tarefas das pendências), no Bot das atividades e nas
        pesquisas de satisfação.
      </p>

      <fieldset disabled={somenteLeitura} className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className={FIELD_CLASS}>
          <label htmlFor="ia-ia" className={LABEL_CLASS}>IA</label>
          <SelectAuto id="ia-ia" value={ia} onChange={(e) => trocarIa(e.target.value as Ia)} required className={`${campo} cursor-pointer`}>
            {ias.map((i) => (
              <option key={i.value} value={i.value}>
                {i.label}
              </option>
            ))}
          </SelectAuto>
          <span className={HINT_CLASS}>Cada IA tem a sua chave; trocar não apaga a chave da outra</span>
        </div>
        <div className={FIELD_CLASS}>
          <label htmlFor="ia-modelo" className={LABEL_CLASS}>Modelo</label>
          <SelectAuto id="ia-modelo" value={cfg.modelo} onChange={(e) => setCfg({ ...cfg, modelo: e.target.value })} required className={`${campo} cursor-pointer`}>
            {modelos.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </SelectAuto>
          <span className={HINT_CLASS}>{ajuda.modelos}</span>
        </div>
        <div className={FIELD_CLASS}>
          <label htmlFor="ia-chave" className={LABEL_CLASS}>Chave do {ajuda.nome}</label>
          <input
            id="ia-chave"
            type="password"
            value={chave}
            onChange={(e) => setChave(e.target.value)}
            maxLength={500}
            autoComplete="new-password"
            required={!chaveGravada}
            placeholder={chaveGravada ? 'Gravada — deixe em branco para manter' : ajuda.chave}
            className={campo}
          />
          <span className={HINT_CLASS}>Gravada cifrada; não é exibida de volta</span>
        </div>
      </fieldset>

      {!somenteLeitura && (
        <div className="flex items-center gap-2">
          <button
            type="submit"
            disabled={ocupado !== null}
            className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2.5 rounded-lg text-xs font-semibold shadow-xs cursor-pointer disabled:opacity-50"
          >
            {ocupado === 'salvar' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            Salvar IA
          </button>
          <button
            type="button"
            onClick={testar}
            disabled={ocupado !== null || !podeTestar}
            title={podeTestar ? `Faz uma pergunta curta ao ${ajuda.nome} com a chave e o modelo gravados` : `Salve com a chave do ${ajuda.nome} antes de testar`}
            className="flex items-center gap-2 px-4 py-2.5 rounded-lg text-xs font-semibold text-stone-700 dark:text-stone-200 border border-stone-300 dark:border-stone-700 hover:bg-stone-100 dark:hover:bg-stone-800 cursor-pointer disabled:opacity-50"
          >
            {ocupado === 'testar' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Bot className="w-4 h-4" />}
            Testar {ajuda.nome}
          </button>
        </div>
      )}
    </form>
  );
};
