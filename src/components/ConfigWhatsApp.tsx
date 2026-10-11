import React, { useEffect, useState } from 'react';
import { SelectAuto } from './SelectAuto';
import { Loader2, PlugZap, QrCode, Save, Smartphone, Unplug, Webhook, X } from 'lucide-react';
import { ativarRecebimentoWhatsApp, conectarWhatsApp, ContaWhats, desconectarWhatsApp, fetchConfig, salvarConfig, testarWhatsApp } from '../services/api';
import { INPUT_CLASS, LABEL_CLASS, FIELD_CLASS, HINT_CLASS } from '../utils/formStyles';
import { NumberField } from './NumberField';
import { AvisoErro } from './AvisoErro';
import { ConfirmDialog } from './ConfirmDialog';
import { telefoneCadastro } from './ConversasView';

interface Whats {
  provedor: '' | 'evolution' | 'zapi';
  url: string;
  instancia: string;
  intervalo: string;
  /** Digitados agora; em branco mantêm os gravados */
  token: string;
  client_token: string;
}

const VAZIO: Whats = { provedor: '', url: '', instancia: '', intervalo: '5', token: '', client_token: '' };

interface Props {
  somenteLeitura: boolean;
  onToast: (msg: string) => void;
  /** provedor = WhatsApp padrão (atendimento, propostas); campanhas = outro número só para as campanhas */
  conta?: ContaWhats;
}

/**
 * Configurações › WhatsApp: provedor usado no atendimento e no envio de propostas (conta padrão) ou, na conta
 * "campanhas", o número só das campanhas (sem ele, as campanhas saem pelo padrão).
 * Os tokens são gravados cifrados no servidor e nunca voltam para a tela: só se sabe se existem.
 */
export const ConfigWhatsApp: React.FC<Props> = ({ somenteLeitura, onToast, conta: contaProp }) => {
  const conta: ContaWhats = contaProp ?? 'provedor';
  const campanhas = conta === 'campanhas';
  /** Ids dos campos: as duas contas ficam na mesma tela */
  const idc = (nome: string) => `wa-${conta}-${nome}`;
  const [v, setV] = useState<Whats | null>(null);
  const [definidos, setDefinidos] = useState({ token: false, client: false, provedor: '' });
  const [ocupado, setOcupado] = useState<'salvar' | 'testar' | 'receber' | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  /** Painel do QR Code: aberto enquanto não é null; '' = carregando */
  const [qrcode, setQrcode] = useState<string | null>(null);
  const [desconectando, setDesconectando] = useState(false);
  /** Situação do número no provedor; null = não se sabe (sem configuração ou provedor com falha) */
  const [conectado, setConectado] = useState<boolean | null>(null);
  /** Número do aparelho conectado (Evolution) */
  const [numero, setNumero] = useState<string | undefined>();
  /** Recebimento de mensagens ativado (webhook na Evolution): endereço do CRM e quando */
  const [recebimento, setRecebimento] = useState<{ origem: string; em: string } | null>(null);

  const consultarSituacao = () =>
    testarWhatsApp(conta)
      .then((r) => {
        setConectado(r.conectado);
        setNumero(r.numero);
      })
      .catch(() => setConectado(null));

  useEffect(() => {
    consultarSituacao();
    fetchConfig<any>('whatsapp', conta)
      .then(({ valor }) => {
        setV(valor ? { ...VAZIO, provedor: valor.provedor, url: valor.url || '', instancia: valor.instancia || '', intervalo: String(valor.intervalo ?? 5) } : VAZIO);
        setDefinidos({ token: Boolean(valor?.token_definido), client: Boolean(valor?.client_token_definido), provedor: valor?.provedor || '' });
        setRecebimento(valor?.webhook ?? null);
      })
      .catch((e) => setErro(e.message));
  }, []);

  // Com o painel aberto: a situação é consultada a cada 3 s até o número conectar, e o QR só é
  // pedido de novo a cada 45 s, antes de expirar (cada pedido na Evolution gera um QR novo)
  const painelAberto = qrcode !== null;
  useEffect(() => {
    if (!painelAberto) return;
    let vivo = true;
    let t: ReturnType<typeof setTimeout>;
    let proximoQr = 0;
    const ciclo = async () => {
      try {
        const agora = Date.now();
        const r = agora >= proximoQr ? await conectarWhatsApp(conta) : await testarWhatsApp(conta);
        if (!vivo) return;
        if (r.conectado) {
          setQrcode(null);
          consultarSituacao(); // traz o número conectado
          onToast('WhatsApp conectado.');
          return;
        }
        if ('qrcode' in r) {
          setQrcode(r.qrcode || '');
          proximoQr = agora + 45_000;
        }
        t = setTimeout(ciclo, 3000);
      } catch (err: any) {
        if (!vivo) return;
        setQrcode(null);
        setErro(err.message);
      }
    };
    ciclo();
    return () => {
      vivo = false;
      clearTimeout(t);
    };
  }, [painelAberto]);

  if (!v) return erro ? <AvisoErro mensagem={erro} onFechar={() => setErro(null)} /> : <Loader2 className="w-4 h-4 animate-spin text-stone-400" />;

  const alterar = (m: Partial<Whats>) => {
    setV({ ...v, ...m });
    setErro(null);
  };
  // Trocar de provedor descarta os tokens gravados do anterior (o servidor faz o mesmo)
  const mesmoProvedor = v.provedor === definidos.provedor;
  const tokenGravado = mesmoProvedor && definidos.token;
  const clientGravado = mesmoProvedor && definidos.client;
  const ativo = v.provedor !== '';

  const salvar = async (e: React.FormEvent) => {
    e.preventDefault();
    setOcupado('salvar');
    try {
      await salvarConfig('whatsapp', conta, { ...v, intervalo: Number(v.intervalo) });
      setDefinidos({
        token: ativo && (Boolean(v.token) || tokenGravado),
        client: v.provedor === 'zapi' && (Boolean(v.client_token) || clientGravado),
        provedor: v.provedor,
      });
      setV({ ...v, token: '', client_token: '' });
      consultarSituacao();
      // Trocar servidor ou instância desfaz o recebimento (o servidor decide)
      fetchConfig<any>('whatsapp', conta)
        .then(({ valor }) => setRecebimento(valor?.webhook ?? null))
        .catch(() => {});
      onToast(
        ativo
          ? `Configuração do WhatsApp${campanhas ? ' das campanhas' : ''} gravada.`
          : campanhas
            ? 'WhatsApp das campanhas removido: as campanhas voltam a sair pelo WhatsApp padrão.'
            : 'Configuração do WhatsApp removida: vale a do servidor (.env).',
      );
    } catch (err: any) {
      setErro(err.message);
    } finally {
      setOcupado(null);
    }
  };

  const testar = async () => {
    setOcupado('testar');
    try {
      const r = await testarWhatsApp(conta);
      setConectado(r.conectado);
      setNumero(r.numero);
      onToast(r.mensagem);
    } catch (err: any) {
      setErro(err.message);
    } finally {
      setOcupado(null);
    }
  };

  const ativarRecebimento = async () => {
    setOcupado('receber');
    try {
      setRecebimento(await ativarRecebimentoWhatsApp(window.location.origin, conta));
      onToast('Recebimento de mensagens ativado na Evolution.');
    } catch (err: any) {
      setErro(err.message);
    } finally {
      setOcupado(null);
    }
  };
  // O recebimento usa a configuração gravada
  const podeReceber = definidos.provedor === 'evolution' && definidos.token;

  const campo = `${INPUT_CLASS} w-full`;
  const ehZapi = v.provedor === 'zapi';

  return (
    <form onSubmit={salvar} className="max-w-3xl flex flex-col gap-4">
      {erro && <AvisoErro mensagem={erro} onFechar={() => setErro(null)} />}

      <fieldset disabled={somenteLeitura} className="grid grid-cols-1 sm:grid-cols-4 gap-4">
        <div className={`${FIELD_CLASS} sm:col-span-2`}>
          <label htmlFor={idc('provedor')} className={LABEL_CLASS}>Provedor</label>
          <SelectAuto id={idc('provedor')} value={v.provedor} onChange={(e) => alterar({ provedor: e.target.value as Whats['provedor'] })} className={`${campo} cursor-pointer`}>
            <option value="">{campanhas ? '— Nenhum (as campanhas usam o WhatsApp padrão) —' : '— Nenhum (usa o .env do servidor) —'}</option>
            <option value="evolution">Evolution API</option>
            <option value="zapi">Z-API</option>
          </SelectAuto>
        </div>
        <div className={FIELD_CLASS}>
          <label htmlFor={idc('intervalo')} className={LABEL_CLASS}>Intervalo (segundos)</label>
          <NumberField id={idc('intervalo')} value={v.intervalo} onChange={(i) => alterar({ intervalo: i })} scale={0} disabled={!ativo} className={campo} />
          <span className={HINT_CLASS}>{campanhas ? 'Pausa entre as mensagens das campanhas' : 'Pausa entre mensagens das campanhas (sem o WhatsApp das campanhas)'}</span>
        </div>

        {ativo && (
          <>
            {!ehZapi && (
              <div className={`${FIELD_CLASS} sm:col-span-4`}>
                <label htmlFor={idc('url')} className={LABEL_CLASS}>Endereço do servidor Evolution</label>
                <input id={idc('url')} value={v.url} onChange={(e) => alterar({ url: e.target.value })} maxLength={255} required placeholder="http://IP-DA-VPS:8080" className={campo} />
              </div>
            )}
            <div className={`${FIELD_CLASS} sm:col-span-2`}>
              <label htmlFor={idc('instancia')} className={LABEL_CLASS}>{ehZapi ? 'ID da instância' : 'Nome da instância'}</label>
              <input id={idc('instancia')} value={v.instancia} onChange={(e) => alterar({ instancia: e.target.value })} maxLength={200} required autoComplete="off" placeholder={ehZapi ? '3C...' : 'crmweb'} className={campo} />
            </div>
            <div className={`${FIELD_CLASS} sm:col-span-2`}>
              <label htmlFor={idc('token')} className={LABEL_CLASS}>{ehZapi ? 'Token da instância' : 'API Key'}</label>
              <input
                id={idc('token')}
                type="password"
                value={v.token}
                onChange={(e) => alterar({ token: e.target.value })}
                maxLength={500}
                autoComplete="new-password"
                required={!tokenGravado}
                placeholder={tokenGravado ? 'Gravado — deixe em branco para manter' : ehZapi ? 'Token da instância na Z-API' : 'AUTHENTICATION_API_KEY da Evolution'}
                className={campo}
              />
              <span className={HINT_CLASS}>Gravado cifrado; não é exibido de volta</span>
            </div>
            {ehZapi && (
              <div className={`${FIELD_CLASS} sm:col-span-2`}>
                <label htmlFor={idc('client')} className={LABEL_CLASS}>Token de segurança da conta</label>
                <input
                  id={idc('client')}
                  type="password"
                  value={v.client_token}
                  onChange={(e) => alterar({ client_token: e.target.value })}
                  maxLength={500}
                  autoComplete="new-password"
                  required={!clientGravado}
                  placeholder={clientGravado ? 'Gravado — deixe em branco para manter' : 'Client-Token (Segurança, no painel da Z-API)'}
                  className={campo}
                />
              </div>
            )}
            {!ehZapi && (
              <div className="sm:col-span-4 flex flex-wrap items-center gap-3 p-3 rounded-lg bg-stone-50 dark:bg-stone-950/60 border border-stone-200 dark:border-stone-800">
                <div className="flex-1 min-w-64 text-xs text-stone-600 dark:text-stone-300">
                  <b>Recebimento de mensagens</b>: a Evolution avisa o CRM das mensagens recebidas e da entrega e leitura das enviadas
                  {campanhas ? ' (respostas às campanhas entram na conversa e seguem a Automação das campanhas, se ligada)' : ''}. Ative pelo endereço público do CRM
                  (o da Vercel): a Evolution não alcança o computador local.
                  <div className={`mt-1 font-semibold ${recebimento ? 'text-emerald-700 dark:text-emerald-400' : 'text-stone-500'}`}>
                    {recebimento
                      ? `Ativo desde ${recebimento.em.slice(8, 10)}/${recebimento.em.slice(5, 7)}/${recebimento.em.slice(0, 4)} ${recebimento.em.slice(11, 16)}, em ${recebimento.origem}`
                      : 'Não ativado.'}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={ativarRecebimento}
                  disabled={somenteLeitura || !podeReceber || ocupado !== null}
                  title={podeReceber ? `Cadastra na Evolution o endereço ${window.location.origin}` : 'Grave a configuração da Evolution antes'}
                  className="flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-semibold text-stone-700 dark:text-stone-200 border border-stone-300 dark:border-stone-700 hover:bg-stone-100 dark:hover:bg-stone-800 cursor-pointer disabled:opacity-50 disabled:cursor-default shrink-0"
                >
                  {ocupado === 'receber' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Webhook className="w-4 h-4" />}
                  {recebimento ? 'Ativar de novo' : 'Ativar recebimento'}
                </button>
              </div>
            )}
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
            title="Consulta no provedor, com a configuração gravada, se o número está conectado"
            className="flex items-center gap-2 px-4 py-2.5 rounded-lg text-xs font-semibold text-stone-700 dark:text-stone-200 border border-stone-300 dark:border-stone-700 hover:bg-stone-100 dark:hover:bg-stone-800 cursor-pointer disabled:opacity-50"
          >
            {ocupado === 'testar' ? <Loader2 className="w-4 h-4 animate-spin" /> : <PlugZap className="w-4 h-4" />}
            Testar conexão
          </button>
          <button
            type="button"
            onClick={() => {
              setErro(null);
              setQrcode('');
            }}
            disabled={ocupado !== null || qrcode !== null || conectado === true}
            title="Mostra o QR Code para ler no WhatsApp do celular (usa a configuração gravada)"
            className="flex items-center gap-2 px-4 py-2.5 rounded-lg text-xs font-semibold text-stone-700 dark:text-stone-200 border border-stone-300 dark:border-stone-700 hover:bg-stone-100 dark:hover:bg-stone-800 cursor-pointer disabled:opacity-50"
          >
            <QrCode className="w-4 h-4" />
            Conectar WhatsApp
          </button>
          <button
            type="button"
            onClick={() => setDesconectando(true)}
            disabled={ocupado !== null || qrcode !== null || conectado !== true}
            title="Desconecta o número da instância (usa a configuração gravada)"
            className="flex items-center gap-2 px-4 py-2.5 rounded-lg text-xs font-semibold text-red-600 dark:text-red-400 border border-stone-300 dark:border-stone-700 hover:bg-red-50 dark:hover:bg-red-950/40 cursor-pointer disabled:opacity-50"
          >
            <Unplug className="w-4 h-4" />
            Desconectar
          </button>
        </div>
      )}

      {conectado !== null && (
        <div
          className={`self-start flex items-center gap-3 pl-3 pr-5 py-3 rounded-lg border ${
            conectado
              ? 'border-emerald-200 bg-emerald-50 dark:border-emerald-900 dark:bg-emerald-950/30'
              : 'border-stone-200 bg-stone-50 dark:border-stone-800 dark:bg-stone-900'
          }`}
        >
          <span className={`flex items-center justify-center w-9 h-9 rounded-full ${conectado ? 'bg-emerald-100 text-emerald-600 dark:bg-emerald-900/50 dark:text-emerald-400' : 'bg-stone-200 text-stone-500 dark:bg-stone-800 dark:text-stone-400'}`}>
            {conectado ? <Smartphone className="w-4 h-4" /> : <Unplug className="w-4 h-4" />}
          </span>
          <div className="flex flex-col">
            <span className={`flex items-center gap-1.5 text-xs font-semibold ${conectado ? 'text-emerald-700 dark:text-emerald-300' : 'text-stone-600 dark:text-stone-300'}`}>
              <span className={`w-2 h-2 rounded-full ${conectado ? 'bg-emerald-500 animate-pulse' : 'bg-stone-400'}`} />
              {conectado ? 'Conectado' : 'Desconectado'}
            </span>
            <span className="text-sm font-semibold text-stone-800 dark:text-stone-100">
              {conectado ? (numero ? telefoneCadastro(numero) : 'Número conectado') : 'Nenhum número conectado'}
            </span>
            {v.instancia && <span className="text-[11px] text-stone-500 dark:text-stone-400">Instância {v.instancia}</span>}
          </div>
        </div>
      )}

      {qrcode !== null && (
        <div className="self-start flex flex-col items-center gap-3 p-4 rounded-lg border border-stone-300 dark:border-stone-700 bg-white dark:bg-stone-900">
          <div className="self-stretch flex items-center justify-between gap-4">
            <span className="text-xs font-semibold text-stone-700 dark:text-stone-200">Leia o QR Code no WhatsApp do celular</span>
            <button type="button" onClick={() => setQrcode(null)} title="Fechar" className="text-stone-400 hover:text-stone-700 dark:hover:text-stone-200 cursor-pointer">
              <X className="w-4 h-4" />
            </button>
          </div>
          <div className="w-64 h-64 flex items-center justify-center bg-white rounded">
            {qrcode ? <img src={qrcode} alt="QR Code do WhatsApp" className="w-full h-full object-contain" /> : <Loader2 className="w-6 h-6 animate-spin text-stone-400" />}
          </div>
          <span className={HINT_CLASS}>WhatsApp › Aparelhos conectados › Conectar um aparelho. A tela fecha sozinha ao conectar.</span>
        </div>
      )}
      {desconectando && (
        <ConfirmDialog
          titulo={campanhas ? 'Desconectar o WhatsApp das campanhas?' : 'Desconectar o WhatsApp?'}
          mensagem={
            campanhas
              ? 'O número sai da instância e as campanhas deixam de ser enviadas por WhatsApp até conectar de novo pelo QR Code.'
              : 'O número sai da instância e as propostas e campanhas deixam de ser enviadas por WhatsApp até conectar de novo pelo QR Code.'
          }
          confirmar="Desconectar"
          onConfirmar={async () => {
            await desconectarWhatsApp(conta);
            setDesconectando(false);
            setConectado(false);
            onToast('WhatsApp desconectado.');
          }}
          onCancelar={() => setDesconectando(false)}
        />
      )}
    </form>
  );
};
