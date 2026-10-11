import React, { useEffect, useState } from 'react';
import { SelectAuto } from './SelectAuto';
import { Loader2, PlugZap, Save, Webhook } from 'lucide-react';
import { cadastrarWebhookCofreD4Sign, fetchConfig, salvarConfig, testarD4Sign } from '../services/api';
import { INPUT_CLASS, LABEL_CLASS, FIELD_CLASS, HINT_CLASS } from '../utils/formStyles';
import { AvisoErro } from './AvisoErro';

interface D4 {
  ambiente: '' | 'producao' | 'sandbox';
  cofre: string;
  /** Digitados agora; em branco mantêm os gravados */
  token: string;
  crypt: string;
  hmac: string;
  /** Endereço público do CRM, para a D4Sign chamar o webhook */
  url_publica: string;
}

const VAZIO: D4 = { ambiente: '', cofre: '', token: '', crypt: '', hmac: '', url_publica: '' };

interface Props {
  somenteLeitura: boolean;
  onToast: (msg: string) => void;
}

/**
 * Configurações › Assinatura: conta da D4Sign usada nos contratos. As chaves são gravadas
 * cifradas no servidor e nunca voltam para a tela. "Testar conexão" lista os cofres da conta.
 */
export const ConfigAssinatura: React.FC<Props> = ({ somenteLeitura, onToast }) => {
  const [v, setV] = useState<D4 | null>(null);
  const [definidos, setDefinidos] = useState({ token: false, crypt: false, hmac: false });
  const [cofres, setCofres] = useState<{ uuid: string; nome: string }[] | null>(null);
  const [ocupado, setOcupado] = useState<'salvar' | 'testar' | 'webhook' | null>(null);
  /** Webhook 2.0 cadastrado no cofre (gravado pelo servidor ao cadastrar) */
  const [webhookCofre, setWebhookCofre] = useState<{ cofre: string; url: string; em: string } | null>(null);
  /** Configuração como está gravada: o cadastro no cofre usa ela, não o que está só digitado */
  const [gravado, setGravado] = useState({ cofre: '', url_publica: '' });
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    fetchConfig<any>('assinatura', 'd4sign')
      .then(({ valor }) => {
        setV(valor ? { ...VAZIO, ambiente: valor.ambiente, cofre: valor.cofre || '', url_publica: valor.url_publica || '' } : VAZIO);
        setDefinidos({ token: Boolean(valor?.token_definido), crypt: Boolean(valor?.crypt_definido), hmac: Boolean(valor?.hmac_definido) });
        setWebhookCofre(valor?.webhook_cofre ?? null);
        setGravado({ cofre: valor?.cofre || '', url_publica: valor?.url_publica || '' });
        // Com as chaves gravadas, já traz os cofres para o campo mostrar o nome, não o UUID
        // (falhando, fica o campo de texto e o "Testar conexão" mostra o erro)
        if (valor?.token_definido && valor?.crypt_definido) {
          testarD4Sign()
            .then((r) => setCofres(r.cofres))
            .catch(() => {});
        }
      })
      .catch((e) => setErro(e.message));
  }, []);

  if (!v) return erro ? <AvisoErro mensagem={erro} onFechar={() => setErro(null)} /> : <Loader2 className="w-4 h-4 animate-spin text-stone-400" />;

  const alterar = (m: Partial<D4>) => {
    setV({ ...v, ...m });
    setErro(null);
  };
  const ativo = v.ambiente !== '';

  const salvar = async (e: React.FormEvent) => {
    e.preventDefault();
    setOcupado('salvar');
    try {
      await salvarConfig('assinatura', 'd4sign', v);
      setDefinidos({
        token: ativo && (Boolean(v.token) || definidos.token),
        crypt: ativo && (Boolean(v.crypt) || definidos.crypt),
        hmac: ativo && (Boolean(v.hmac) || definidos.hmac),
      });
      setV({ ...v, token: '', crypt: '', hmac: '' });
      const url = v.url_publica.trim().replace(/\/+$/, '');
      setGravado({ cofre: v.cofre, url_publica: url });
      // O servidor só mantém o webhook do cofre se cofre e endereço não mudaram
      if (webhookCofre && (webhookCofre.cofre !== v.cofre || !url || webhookCofre.url !== `${url}/api/webhooks/d4sign`)) setWebhookCofre(null);
      onToast(ativo ? 'Configuração da D4Sign gravada.' : 'Configuração da D4Sign removida.');
    } catch (err: any) {
      setErro(err.message);
    } finally {
      setOcupado(null);
    }
  };

  const testar = async () => {
    setOcupado('testar');
    try {
      const r = await testarD4Sign();
      setCofres(r.cofres);
      onToast(`Conexão com a D4Sign OK: ${r.cofres.length} cofre(s) na conta. ${r.cofre}`);
      if (!r.cofre_ok) setErro(`${r.cofre} Escolha o cofre na lista e salve.`);
    } catch (err: any) {
      setErro(err.message);
    } finally {
      setOcupado(null);
    }
  };

  const cadastrarWebhook = async () => {
    setOcupado('webhook');
    try {
      const r = await cadastrarWebhookCofreD4Sign();
      setWebhookCofre({ cofre: gravado.cofre, url: r.url, em: '' });
      onToast(r.conferido ? 'Webhook 2.0 cadastrado e conferido no cofre.' : 'Webhook 2.0 cadastrado no cofre (a D4Sign não o mostrou na listagem; confira no painel dela).');
    } catch (err: any) {
      setErro(err.message);
    } finally {
      setOcupado(null);
    }
  };
  const podeWebhook = ativo && Boolean(gravado.cofre && gravado.url_publica) && definidos.token && definidos.crypt;

  const campo = `${INPUT_CLASS} w-full`;

  return (
    <form onSubmit={salvar} className="max-w-3xl flex flex-col gap-4">
      {erro && <AvisoErro mensagem={erro} onFechar={() => setErro(null)} />}

      <fieldset disabled={somenteLeitura} className="grid grid-cols-1 sm:grid-cols-4 gap-4">
        <div className={`${FIELD_CLASS} sm:col-span-2`}>
          <label htmlFor="d4-ambiente" className={LABEL_CLASS}>Ambiente</label>
          <SelectAuto id="d4-ambiente" value={v.ambiente} onChange={(e) => alterar({ ambiente: e.target.value as D4['ambiente'] })} className={`${campo} cursor-pointer`}>
            <option value="">— Desligado —</option>
            <option value="producao">Produção (secure.d4sign.com.br)</option>
            <option value="sandbox">Testes / sandbox (sandbox.d4sign.com.br)</option>
          </SelectAuto>
        </div>

        {ativo && (
          <>
            <div className={`${FIELD_CLASS} sm:col-span-2`}>
              <label htmlFor="d4-token" className={LABEL_CLASS}>Token da API (tokenAPI)</label>
              <input
                id="d4-token"
                type="password"
                value={v.token}
                onChange={(e) => alterar({ token: e.target.value })}
                maxLength={300}
                autoComplete="new-password"
                required={!definidos.token}
                placeholder={definidos.token ? 'Gravado — deixe em branco para manter' : 'Na D4Sign: Dev API › Token'}
                className={campo}
              />
            </div>
            <div className={`${FIELD_CLASS} sm:col-span-2`}>
              <label htmlFor="d4-crypt" className={LABEL_CLASS}>Chave de criptografia (cryptKey)</label>
              <input
                id="d4-crypt"
                type="password"
                value={v.crypt}
                onChange={(e) => alterar({ crypt: e.target.value })}
                maxLength={300}
                autoComplete="new-password"
                required={!definidos.crypt}
                placeholder={definidos.crypt ? 'Gravada — deixe em branco para manter' : 'Na D4Sign: Dev API › cryptKey'}
                className={campo}
              />
              <span className={HINT_CLASS}>Gravadas cifradas; não são exibidas de volta</span>
            </div>
            <div className={`${FIELD_CLASS} sm:col-span-2`}>
              <label htmlFor="d4-cofre" className={LABEL_CLASS}>Cofre dos contratos</label>
              {cofres?.length ? (
                <SelectAuto id="d4-cofre" value={v.cofre} onChange={(e) => alterar({ cofre: e.target.value })} required className={`${campo} cursor-pointer`}>
                  <option value="">— Selecione —</option>
                  {cofres.map((c) => (
                    <option key={c.uuid} value={c.uuid}>
                      {c.nome}
                    </option>
                  ))}
                </SelectAuto>
              ) : (
                <input id="d4-cofre" value={v.cofre} onChange={(e) => alterar({ cofre: e.target.value })} maxLength={100} autoComplete="off" placeholder="UUID do cofre" className={campo} />
              )}
              <span className={HINT_CLASS}>Grave as chaves e clique em &quot;Testar conexão&quot; para escolher o cofre pela lista</span>
            </div>
            <div className={`${FIELD_CLASS} sm:col-span-2`}>
              <label htmlFor="d4-url" className={LABEL_CLASS}>Endereço público do CRM (webhook)</label>
              <input
                id="d4-url"
                type="url"
                value={v.url_publica}
                onChange={(e) => alterar({ url_publica: e.target.value })}
                maxLength={200}
                autoComplete="off"
                placeholder="https://crm.suaempresa.com.br"
                className={campo}
              />
              <span className={HINT_CLASS}>
                {v.url_publica.trim()
                  ? `A D4Sign avisará em ${v.url_publica.trim().replace(/\/+$/, '')}/api/webhooks/d4sign a cada assinatura.`
                  : 'Opcional. Sem ele, o CRM consulta a D4Sign de hora em hora.'}
              </span>
            </div>
            <div className={`${FIELD_CLASS} sm:col-span-2`}>
              <label htmlFor="d4-hmac" className={LABEL_CLASS}>Secret Key MAC (webhook)</label>
              <input
                id="d4-hmac"
                type="password"
                value={v.hmac}
                onChange={(e) => alterar({ hmac: e.target.value })}
                maxLength={300}
                autoComplete="new-password"
                placeholder={definidos.hmac ? 'Gravada — deixe em branco para manter' : 'Na D4Sign: Dev API › Gerar Secret Key MAC'}
                className={campo}
              />
              <span className={HINT_CLASS}>Recomendada: confere que o aviso veio mesmo da D4Sign</span>
            </div>
            <div className="sm:col-span-4 flex flex-wrap items-center gap-3 p-3 rounded-lg bg-stone-50 dark:bg-stone-950/60 border border-stone-200 dark:border-stone-800">
              <div className="flex-1 min-w-64 text-xs text-stone-600 dark:text-stone-300">
                <b>Webhook 2.0 no cofre</b> (precisa estar ativado na sua conta D4Sign): vale para todos os documentos do cofre, inclusive os já
                enviados, e dispensa o cadastro documento a documento.
                <div className={`mt-1 font-semibold ${webhookCofre ? 'text-emerald-700 dark:text-emerald-400' : 'text-stone-500'}`}>
                  {webhookCofre ? `Cadastrado${webhookCofre.em ? ` em ${webhookCofre.em.slice(8, 10)}/${webhookCofre.em.slice(5, 7)}/${webhookCofre.em.slice(0, 4)}` : ''}: ${webhookCofre.url}` : 'Não cadastrado: cada documento enviado cadastra o seu webhook (versão 1.0).'}
                </div>
              </div>
              <button
                type="button"
                onClick={cadastrarWebhook}
                disabled={somenteLeitura || !podeWebhook || ocupado !== null}
                title={podeWebhook ? 'Cadastra (ou atualiza) o endereço do CRM no cofre, na D4Sign' : 'Grave as chaves, o cofre e o endereço público antes'}
                className="flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-semibold text-stone-700 dark:text-stone-200 border border-stone-300 dark:border-stone-700 hover:bg-stone-100 dark:hover:bg-stone-800 cursor-pointer disabled:opacity-50 disabled:cursor-default shrink-0"
              >
                {ocupado === 'webhook' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Webhook className="w-4 h-4" />}
                {webhookCofre ? 'Cadastrar de novo' : 'Cadastrar no cofre'}
              </button>
            </div>
          </>
        )}
      </fieldset>

      {!somenteLeitura && (
        <div className="flex items-center gap-2">
          <button
            type="submit"
            disabled={ocupado !== null}
            className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2.5 rounded-lg text-xs font-semibold shadow-xs cursor-pointer disabled:opacity-50"
          >
            {ocupado === 'salvar' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            Salvar configuração
          </button>
          <button
            type="button"
            onClick={testar}
            disabled={ocupado !== null}
            title="Testa as chaves gravadas e lista os cofres da conta"
            className="flex items-center gap-2 px-4 py-2.5 rounded-lg text-xs font-semibold text-stone-700 dark:text-stone-200 border border-stone-300 dark:border-stone-700 hover:bg-stone-100 dark:hover:bg-stone-800 cursor-pointer disabled:opacity-50"
          >
            {ocupado === 'testar' ? <Loader2 className="w-4 h-4 animate-spin" /> : <PlugZap className="w-4 h-4" />}
            Testar conexão
          </button>
        </div>
      )}
    </form>
  );
};
