import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  ChevronRight,
  Clock,
  CloudOff,
  LogOut,
  MapPin,
  MessageCircle,
  Phone,
  PenLine,
  Play,
  RefreshCw,
  Upload,
  Camera,
  X,
  Minus,
  Plus,
} from 'lucide-react';
import { LoginView } from '../components/LoginView';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { Sessao, lerSessao, limparSessao, salvarSessao } from '../utils/session';
import { applyTheme, getInitialTheme } from '../utils/theme';
import { formatDateBR, formatDateTimeBR, hojeIso } from '../utils/formatters';
import { FIELD_CLASS, LABEL_CLASS } from '../utils/formStyles';
import { Assinatura } from './Assinatura';
import {
  Foto,
  ItemCatalogo,
  ItemOS,
  OS,
  SessaoExpirada,
  adicionarFoto,
  agora,
  alterar,
  db,
  descartar,
  limparTudo,
  localizacao,
  reduzirFoto,
  removerFoto,
  sincronizar,
  useConsulta,
} from './dados';

const STATUS: Record<OS['status'], { label: string; cor: string }> = {
  aberta: { label: 'Aberta', cor: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300' },
  em_execucao: { label: 'Em execução', cor: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300' },
  concluida: { label: 'Concluída', cor: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300' },
  cancelada: { label: 'Cancelada', cor: 'bg-stone-200 text-stone-600 dark:bg-stone-700 dark:text-stone-300' },
};

const TIPOS: Record<string, string> = {
  instalacao: 'Instalação',
  manutencao_corretiva: 'Manutenção corretiva',
  manutencao_preventiva: 'Manutenção preventiva',
  treinamento: 'Treinamento',
  visita_tecnica: 'Visita técnica',
  outro: 'Outro',
};

/** Técnico dono das OS guardadas neste aparelho */
const DONO = 'crmweb_tecnico_usuario';

const BOTAO = 'flex w-full items-center justify-center gap-2 rounded-xl py-3.5 text-base font-semibold disabled:opacity-40';
const hora = (v: string | null) => (v ? v.slice(0, 5) : '');

function quando(o: OS): string {
  const dia = o.data_agendada === hojeIso() ? 'Hoje' : formatDateBR(o.data_agendada || '');
  return [dia, [hora(o.hora_inicio), hora(o.hora_fim)].filter(Boolean).join('–')].filter(Boolean).join(' • ');
}

/** Guarda no cache do service worker os arquivos que esta página já carregou (o app abre sem sinal) */
async function guardarArquivos() {
  const urls = new Set([
    '/tecnico',
    ...performance
      .getEntriesByType('resource')
      .map((e) => e.name)
      .filter((u) => u.startsWith(location.origin) && !u.includes('/api/')),
  ]);
  const cache = await caches.open('tecnico-v1');
  await Promise.all([...urls].map((u) => cache.add(u).catch(() => {})));
}

/** /tecnico: app das OS para o celular do técnico (PWA, funciona sem sinal) */
export default function AppTecnico() {
  const [sessao, setSessao] = useState<Sessao | null>(() => lerSessao());
  const [aviso, setAviso] = useState<string | null>(null);

  useEffect(() => {
    applyTheme(getInitialTheme());
    document.title = 'OS • Técnico';
    const link = Object.assign(document.createElement('link'), { rel: 'manifest', href: '/tecnico.webmanifest' });
    document.head.appendChild(link);
    // Só no build: no modo dev o service worker atrapalharia o Vite
    if (import.meta.env.PROD && 'serviceWorker' in navigator) {
      navigator.serviceWorker
        .register('/sw-tecnico.js', { scope: '/tecnico' })
        .then(() => navigator.serviceWorker.ready)
        .then(guardarArquivos)
        .catch((e) => console.warn('Service worker:', e));
    }
  }, []);

  if (!sessao) {
    return (
      <LoginView
        avisoInicial={aviso}
        onLoginSuccess={async (usuario, empresa, token) => {
          // Sem sinal o app precisa da sessão: fica sempre neste aparelho. Outro técnico entrando começa do zero;
          // o mesmo (sessão expirada) continua com a fila que ficou no aparelho
          if (localStorage.getItem(DONO) !== String(usuario.id)) await limparTudo();
          localStorage.setItem(DONO, String(usuario.id));
          const s = { usuario, empresa, token };
          salvarSessao(s, true);
          setAviso(null);
          setSessao(s);
        }}
      />
    );
  }

  return (
    <Painel
      sessao={sessao}
      onSair={async (msg) => {
        if (!msg) await limparTudo();
        limparSessao();
        setAviso(msg ?? null);
        setSessao(null);
      }}
    />
  );
}

const Painel: React.FC<{ sessao: Sessao; onSair: (aviso?: string) => void }> = ({ sessao, onSair }) => {
  const lista = useConsulta(() => db.os.toArray());
  // Pendente = alteração na fila ou foto ainda não enviada (ou a remover do servidor)
  const fotosPendentes = useConsulta(() => db.fotos.filter((f) => !f.url || Boolean(f.remover)).toArray());
  const pendentes = (useConsulta(() => db.fila.count()) ?? 0) + (fotosPendentes?.length ?? 0);
  const comFila =
    useConsulta(async () => new Set([...(await db.fila.toArray()).map((p) => p.osId), ...(fotosPendentes ?? []).map((f) => f.osId)]), [fotosPendentes]) ??
    new Set<number>();
  const [online, setOnline] = useState(navigator.onLine);
  const [sincronizando, setSincronizando] = useState(false);
  const [falha, setFalha] = useState<string | null>(null);
  const [aba, setAba] = useState<'afazer' | 'feitas'>('afazer');
  const [abertaId, setAbertaId] = useState<number | null>(null);
  const [sair, setSair] = useState(false);

  const sinc = useCallback(async () => {
    if (!navigator.onLine) return;
    setSincronizando(true);
    try {
      await sincronizar(sessao.token);
      setFalha(null);
    } catch (e: any) {
      // Expirou: a fila continua no aparelho e vai depois do novo login
      if (e instanceof SessaoExpirada) return onSair(e.message);
      setFalha(e instanceof TypeError ? 'Sem conexão com o servidor.' : e.message);
    } finally {
      setSincronizando(false);
    }
  }, [sessao.token, onSair]);

  useEffect(() => {
    const on = () => (setOnline(true), sinc());
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    sinc();
    const t = setInterval(sinc, 60000);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
      clearInterval(t);
    };
  }, [sinc]);

  const aberta = lista?.find((o) => o.id === abertaId);
  if (aberta) return <Detalhe os={aberta} pendente={comFila.has(aberta.id)} onVoltar={() => setAbertaId(null)} onSincronizar={sinc} />;

  const ordem = (a: OS, b: OS) => `${a.data_agendada}${a.hora_inicio}${a.numero}`.localeCompare(`${b.data_agendada}${b.hora_inicio}${b.numero}`);
  const afazer = (lista ?? []).filter((o) => o.status === 'aberta' || o.status === 'em_execucao').sort(ordem);
  const feitas = (lista ?? []).filter((o) => o.status === 'concluida' || o.status === 'cancelada').sort((a, b) => ordem(b, a));
  const mostradas = aba === 'afazer' ? afazer : feitas;

  return (
    <div className="min-h-screen bg-stone-100 text-stone-900 dark:bg-stone-950 dark:text-white">
      <header className="sticky top-0 z-10 bg-blue-600 px-4 pb-3 pt-[max(0.75rem,env(safe-area-inset-top))] text-white shadow">
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <h1 className="text-lg font-bold leading-tight">Ordens de Serviço</h1>
            <p className="truncate text-xs text-blue-100">{sessao.usuario.nome}</p>
          </div>
          <div className="flex items-center gap-1">
            <button type="button" onClick={sinc} disabled={!online || sincronizando} className="rounded-lg p-2.5 hover:bg-white/10 disabled:opacity-50" title="Sincronizar agora">
              <RefreshCw size={20} className={sincronizando ? 'animate-spin' : ''} />
            </button>
            <button type="button" onClick={() => setSair(true)} className="rounded-lg p-2.5 hover:bg-white/10" title="Sair">
              <LogOut size={20} />
            </button>
          </div>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
          {online ? (
            <span className="rounded-full bg-white/15 px-2 py-0.5">● Online</span>
          ) : (
            <span className="flex items-center gap-1 rounded-full bg-amber-400 px-2 py-0.5 font-semibold text-amber-950">
              <CloudOff size={12} /> Sem sinal: tudo fica salvo no aparelho
            </span>
          )}
          {pendentes > 0 && (
            <span className="flex items-center gap-1 rounded-full bg-white/15 px-2 py-0.5">
              <Upload size={12} /> {pendentes} {pendentes === 1 ? 'alteração' : 'alterações'} a enviar
            </span>
          )}
          {falha && online && <span className="rounded-full bg-rose-500 px-2 py-0.5">{falha}</span>}
        </div>
      </header>

      <div className="flex gap-1 p-3 pb-0">
        {(
          [
            ['afazer', `A fazer (${afazer.length})`],
            ['feitas', `Concluídas (${feitas.length})`],
          ] as const
        ).map(([id, rotulo]) => (
          <button
            key={id}
            type="button"
            onClick={() => setAba(id)}
            className={`flex-1 rounded-lg py-2 text-sm font-semibold ${aba === id ? 'bg-white shadow dark:bg-stone-800' : 'text-stone-500'}`}
          >
            {rotulo}
          </button>
        ))}
      </div>

      <main className="flex flex-col gap-2 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        {lista === undefined ? null : mostradas.length === 0 ? (
          <p className="py-12 text-center text-sm text-stone-500">
            {aba === 'afazer' ? (online ? 'Nenhuma OS para você.' : 'Nenhuma OS baixada neste aparelho.') : 'Nenhuma OS concluída nos últimos 7 dias.'}
          </p>
        ) : (
          mostradas.map((o) => (
            <button
              key={o.id}
              type="button"
              onClick={() => setAbertaId(o.id)}
              className="flex items-center gap-3 rounded-xl bg-white p-3 text-left shadow-sm active:bg-stone-50 dark:bg-stone-900"
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 text-xs">
                  <span className="font-bold text-stone-500">Nº {o.numero}</span>
                  <span className={`rounded-full px-2 py-0.5 font-semibold ${STATUS[o.status].cor}`}>{STATUS[o.status].label}</span>
                  {o.erro ? <AlertTriangle size={14} className="text-rose-600" /> : comFila.has(o.id) ? <Upload size={14} className="text-amber-600" /> : null}
                </div>
                <div className="mt-1 truncate font-semibold">{o.pessoa_nome}</div>
                <div className="flex items-center gap-1 text-xs text-stone-500">
                  <Clock size={12} /> {quando(o)}
                </div>
                {o.endereco && <div className="truncate text-xs text-stone-500">{o.endereco}</div>}
              </div>
              <ChevronRight size={20} className="shrink-0 text-stone-400" />
            </button>
          ))
        )}
      </main>

      {sair && (
        <ConfirmDialog
          titulo="Sair do app"
          mensagem={
            pendentes > 0
              ? `Há ${pendentes} ${pendentes === 1 ? 'alteração que ainda não foi enviada' : 'alterações que ainda não foram enviadas'}. Saindo agora, elas se perdem. Sincronize antes, com sinal.`
              : 'As OS baixadas saem deste aparelho. Para usar de novo, entre com seu e-mail e senha (com sinal).'
          }
          confirmar={pendentes > 0 ? 'Sair e descartar' : 'Sair'}
          tom={pendentes > 0 ? 'perigo' : 'normal'}
          onConfirmar={() => onSair()}
          onCancelar={() => setSair(false)}
        />
      )}
    </div>
  );
};

const Detalhe: React.FC<{ os: OS; pendente: boolean; onVoltar: () => void; onSincronizar: () => void }> = ({ os, pendente, onVoltar, onSincronizar }) => {
  const [feito, setFeito] = useState(os.servico_executado ?? '');
  const [assinando, setAssinando] = useState(false);
  const [encerrar, setEncerrar] = useState(false);
  const [descartando, setDescartando] = useState(false);
  const [iniciando, setIniciando] = useState(false);
  /** Tela de fechamento (serviços, o que foi feito, assinatura): só depois de tocar em "Fechar OS" */
  const [fechando, setFechando] = useState(false);
  const espera = useRef<ReturnType<typeof setTimeout>>(undefined);

  // O texto vai para a fila 1 s depois de parar de digitar (fechar o app no meio não perde o que foi escrito)
  const gravarFeito = (texto: string) => {
    setFeito(texto);
    clearTimeout(espera.current);
    espera.current = setTimeout(() => alterar(os.id, { servico_executado: texto }), 1000);
  };
  const gravarFeitoJa = async () => {
    clearTimeout(espera.current);
    if (feito !== (os.servico_executado ?? '')) await alterar(os.id, { servico_executado: feito });
  };
  useEffect(() => () => clearTimeout(espera.current), []);

  const iniciar = async () => {
    setIniciando(true);
    await alterar(os.id, { status: 'em_execucao', inicio_em: agora(), inicio_geo: await localizacao() });
    setIniciando(false);
    onSincronizar();
  };

  const tel = os.contato_telefone || os.pessoa_whatsapp || os.pessoa_telefone;
  const zap = (os.pessoa_whatsapp || os.contato_telefone || '').replace(/\D/g, '');
  const emExecucao = os.status === 'em_execucao';
  const preenchendo = emExecucao && fechando;
  const podeEncerrar = emExecucao && feito.trim().length > 0 && Boolean(os.assinada);
  const link = 'flex flex-1 flex-col items-center gap-1 rounded-xl bg-stone-100 py-2.5 text-xs font-semibold text-stone-700 dark:bg-stone-800 dark:text-stone-200';

  return (
    <div className="min-h-screen bg-stone-100 text-stone-900 dark:bg-stone-950 dark:text-white">
      <header className="sticky top-0 z-10 flex items-center gap-2 bg-blue-600 px-2 pb-3 pt-[max(0.75rem,env(safe-area-inset-top))] text-white shadow">
        <button
          type="button"
          onClick={async () => {
            await gravarFeitoJa();
            if (preenchendo) return setFechando(false);
            onVoltar();
            onSincronizar();
          }}
          className="rounded-lg p-2 hover:bg-white/10"
          title="Voltar"
        >
          <ArrowLeft size={22} />
        </button>
        <div className="min-w-0 flex-1">
          <h1 className="text-lg font-bold leading-tight">{preenchendo ? 'Fechar' : 'OS'} nº {os.numero}</h1>
          <p className="text-xs text-blue-100">{TIPOS[os.tipo] || os.tipo} • {quando(os)}</p>
        </div>
        <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${STATUS[os.status].cor}`}>{STATUS[os.status].label}</span>
      </header>

      <main className="flex flex-col gap-3 p-3 pb-[max(1rem,env(safe-area-inset-bottom))]">
        {os.erro && (
          <div className="rounded-xl border border-rose-300 bg-rose-50 p-3 text-sm text-rose-800 dark:border-rose-800 dark:bg-rose-950/50 dark:text-rose-200">
            <div className="flex items-start gap-2 font-semibold">
              <AlertTriangle size={18} className="shrink-0" /> O servidor não aceitou o que foi feito aqui: {os.erro}
            </div>
            <button type="button" onClick={() => setDescartando(true)} className="mt-2 font-semibold text-rose-700 underline dark:text-rose-300">
              Descartar minhas alterações desta OS
            </button>
          </div>
        )}
        {!os.erro && pendente && (
          <div className="flex items-center gap-2 rounded-xl bg-amber-50 p-2.5 text-xs font-medium text-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
            <Upload size={14} /> Salvo no aparelho; vai para o escritório quando houver sinal.
          </div>
        )}
        {os.status === 'cancelada' && <div className="rounded-xl bg-stone-200 p-3 text-center font-semibold dark:bg-stone-800">OS cancelada pelo escritório</div>}

        <section className="rounded-xl bg-white p-3 shadow-sm dark:bg-stone-900">
          <div className="text-base font-bold">{os.pessoa_nome}</div>
          {os.pessoa_cpf && <div className="text-xs text-stone-500">{os.pessoa_cpf}</div>}
          {os.endereco && <div className="mt-1 text-sm">{os.endereco}</div>}
          {(os.contato_nome || os.contato_telefone) && (
            <div className="mt-1 text-sm">
              <span className="text-stone-500">Falar com:</span> {[os.contato_nome, os.contato_telefone].filter(Boolean).join(' • ')}
            </div>
          )}
          <div className="mt-3 flex gap-2">
            {os.endereco && (
              <a className={link} href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(os.endereco)}`} target="_blank" rel="noreferrer">
                <MapPin size={20} /> Mapa
              </a>
            )}
            {tel && (
              <a className={link} href={`tel:${tel.replace(/[^\d+]/g, '')}`}>
                <Phone size={20} /> Ligar
              </a>
            )}
            {zap.length >= 10 && (
              <a className={link} href={`https://wa.me/${zap.length <= 11 ? `55${zap}` : zap}`} target="_blank" rel="noreferrer">
                <MessageCircle size={20} /> WhatsApp
              </a>
            )}
          </div>
        </section>

        <section className="rounded-xl bg-white p-3 shadow-sm dark:bg-stone-900">
          <h2 className={LABEL_CLASS}>O que será feito</h2>
          <p className="mt-1 whitespace-pre-wrap text-sm">{os.servico_solicitado}</p>
        </section>

        {!preenchendo && <HistoricoCliente os={os} />}

        {os.status === 'aberta' && (
          <button type="button" onClick={iniciar} disabled={iniciando} className={`${BOTAO} bg-blue-600 text-white`}>
            <Play size={20} /> {iniciando ? 'Registrando a chegada…' : 'Iniciar atendimento'}
          </button>
        )}

        {/* Em atendimento: só o início registrado; os dados entram no fechamento ("Fechar OS") */}
        {emExecucao && !fechando && os.inicio_em && (
          <div className="flex items-center gap-2 rounded-xl bg-amber-50 p-3 text-sm font-medium text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
            <Clock size={16} /> Em atendimento desde {formatDateTimeBR(os.inicio_em)}
          </div>
        )}

        {/* Fotos durante todo o atendimento (as de antes, logo ao chegar) */}
        {(emExecucao || os.status === 'concluida') && <FotosOS os={os} editavel={emExecucao} onSincronizar={onSincronizar} />}

        {(preenchendo || (os.status !== 'cancelada' && (os.itens?.length ?? 0) > 0)) && <ServicosOS os={os} editavel={preenchendo} />}

        {emExecucao && !fechando && (
          <button type="button" onClick={() => setFechando(true)} className={`${BOTAO} bg-emerald-600 text-white`}>
            <CheckCircle2 size={20} /> Fechar OS
          </button>
        )}

        {(preenchendo || os.status === 'concluida') && (
          <section className="flex flex-col gap-3 rounded-xl bg-white p-3 shadow-sm dark:bg-stone-900">
            {os.inicio_em && <div className="text-xs text-stone-500">Início: {formatDateTimeBR(os.inicio_em)}{os.fim_em ? ` • Término: ${formatDateTimeBR(os.fim_em)}` : ''}</div>}
            <div className={FIELD_CLASS}>
              <label htmlFor="os-feito" className={LABEL_CLASS}>O que foi feito</label>
              {preenchendo ? (
                <textarea
                  id="os-feito"
                  required
                  rows={6}
                  value={feito}
                  onChange={(e) => gravarFeito(e.target.value)}
                  onBlur={gravarFeitoJa}
                  className="bg-stone-50 p-3 text-base text-stone-800 dark:bg-stone-800/80 dark:text-stone-100"
                  placeholder="Descreva o serviço realizado, peças trocadas, pendências…"
                />
              ) : (
                <p className="whitespace-pre-wrap text-sm">{os.servico_executado}</p>
              )}
            </div>

            <div>
              <h2 className={LABEL_CLASS}>Assinatura do cliente</h2>
              {os.assinatura ? (
                <img src={os.assinatura} alt="Assinatura" className="mt-1 max-h-28 rounded-lg border border-stone-200 bg-white" />
              ) : os.assinada ? (
                <p className="mt-1 flex items-center gap-1 text-sm text-emerald-700 dark:text-emerald-400">
                  <CheckCircle2 size={16} /> Assinatura coletada
                </p>
              ) : null}
              {os.assinatura_nome && (
                <p className="text-xs text-stone-500">
                  {os.assinatura_nome}
                  {os.assinatura_documento ? ` • ${os.assinatura_documento}` : ''}
                </p>
              )}
              {preenchendo && (
                <button type="button" onClick={() => setAssinando(true)} className={`${BOTAO} mt-2 bg-stone-100 text-stone-800 dark:bg-stone-800 dark:text-stone-100`}>
                  <PenLine size={20} /> {os.assinada ? 'Refazer assinatura' : 'Coletar assinatura'}
                </button>
              )}
            </div>
          </section>
        )}

        {preenchendo && (
          <button type="button" onClick={() => setEncerrar(true)} disabled={!podeEncerrar} className={`${BOTAO} bg-emerald-600 text-white`}>
            <CheckCircle2 size={20} /> {podeEncerrar ? 'Encerrar OS' : !feito.trim() ? 'Para encerrar, descreva o que foi feito' : 'Para encerrar, colete a assinatura'}
          </button>
        )}
      </main>

      {assinando && (
        <Assinatura
          nomeInicial={os.assinatura_nome || os.contato_nome || ''}
          documentoInicial={os.assinatura_documento || ''}
          onCancelar={() => setAssinando(false)}
          onConfirmar={async (dados) => {
            await alterar(os.id, dados);
            setAssinando(false);
            onSincronizar();
          }}
        />
      )}
      {encerrar && (
        <ConfirmDialog
          titulo="Encerrar OS"
          mensagem={`Encerrar a OS nº ${os.numero} de ${os.pessoa_nome}? Depois de encerrada, não dá para alterar pelo app.`}
          confirmar="Encerrar"
          tom="normal"
          onConfirmar={async () => {
            clearTimeout(espera.current);
            await alterar(os.id, { servico_executado: feito, status: 'concluida', fim_em: agora(), fim_geo: await localizacao() });
            setEncerrar(false);
            onSincronizar();
          }}
          onCancelar={() => setEncerrar(false)}
        />
      )}
      {descartando && (
        <ConfirmDialog
          titulo="Descartar alterações"
          mensagem="O que foi feito nesta OS pelo app (texto, assinatura, horários) sai do aparelho e não vai para o escritório."
          confirmar="Descartar"
          onConfirmar={async () => {
            await descartar(os.id);
            setDescartando(false);
            onSincronizar();
          }}
          onCancelar={() => setDescartando(false)}
        />
      )}
    </div>
  );
};

const MOMENTOS = [
  { id: 'antes', rotulo: 'Fotos de antes' },
  { id: 'depois', rotulo: 'Fotos de depois' },
] as const;
const MAX_FOTOS = 10;

/** Fotos de antes e depois: tiradas na câmera, reduzidas e guardadas no aparelho até haver sinal */
const FotosOS: React.FC<{ os: OS; editavel: boolean; onSincronizar: () => void }> = ({ os, editavel, onSincronizar }) => {
  const fotos = useConsulta(() => db.fotos.where('osId').equals(os.id).filter((f) => !f.remover).sortBy('criada'), [os.id]) ?? [];
  const [lendo, setLendo] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [ampliada, setAmpliada] = useState<string | null>(null);
  const [remover, setRemover] = useState<Foto | null>(null);

  const incluir = async (momento: Foto['momento'], arquivos: FileList | null, livres: number) => {
    if (!arquivos?.length) return;
    setLendo(true);
    setErro(null);
    try {
      for (const a of [...arquivos].slice(0, livres)) await adicionarFoto(os.id, momento, await reduzirFoto(a));
      if (arquivos.length > livres) setErro(`No máximo ${MAX_FOTOS} fotos de ${momento}: as demais ficaram de fora.`);
    } catch {
      setErro('Não foi possível ler a foto. Tente de novo.');
    } finally {
      setLendo(false);
    }
    onSincronizar();
  };

  if (!editavel && !fotos.length) return null;

  return (
    <section className="flex flex-col gap-3 rounded-xl bg-white p-3 shadow-sm dark:bg-stone-900">
      {MOMENTOS.map(({ id, rotulo }) => {
        const doMomento = fotos.filter((f) => f.momento === id);
        if (!editavel && !doMomento.length) return null;
        const livres = MAX_FOTOS - doMomento.length;
        return (
          <div key={id}>
            <h2 className={LABEL_CLASS}>
              {rotulo} ({doMomento.length})
            </h2>
            <div className="mt-1 grid grid-cols-3 gap-2">
              {doMomento.map((f) => (
                <div key={f.uuid} className="relative aspect-square overflow-hidden rounded-lg bg-stone-100 dark:bg-stone-800">
                  <img src={f.imagem || f.url || ''} alt="" className="h-full w-full object-cover" onClick={() => setAmpliada(f.imagem || f.url || null)} />
                  {!f.url && (
                    <span className="absolute bottom-1 left-1 rounded-full bg-amber-500 p-1 text-white" title="Ainda não enviada">
                      <Upload size={12} />
                    </span>
                  )}
                  {editavel && (
                    <button type="button" onClick={() => setRemover(f)} className="absolute right-1 top-1 rounded-full bg-black/60 p-1 text-white" title="Remover foto">
                      <X size={14} />
                    </button>
                  )}
                </div>
              ))}
              {editavel && livres > 0 && (
                <label className="flex aspect-square cursor-pointer flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed border-stone-300 text-xs font-semibold text-stone-500 dark:border-stone-600">
                  <Camera size={24} />
                  {lendo ? 'Lendo…' : 'Foto'}
                  {/* capture: abre direto a câmera traseira (sem a galeria), uma foto por vez */}
                  <input
                    type="file"
                    accept="image/*"
                    capture="environment"
                    hidden
                    disabled={lendo}
                    onChange={(e) => {
                      incluir(id, e.target.files, livres);
                      e.target.value = '';
                    }}
                  />
                </label>
              )}
            </div>
          </div>
        );
      })}
      {erro && <p className="text-xs font-medium text-rose-600">{erro}</p>}

      {ampliada && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 p-2" onClick={() => setAmpliada(null)}>
          <img src={ampliada} alt="" className="max-h-full max-w-full object-contain" />
          <button type="button" className="absolute right-3 top-[max(0.75rem,env(safe-area-inset-top))] rounded-full bg-white/20 p-2 text-white" title="Fechar">
            <X size={22} />
          </button>
        </div>
      )}
      {remover && (
        <ConfirmDialog
          titulo="Remover foto"
          mensagem={`Remover esta foto de ${remover.momento} da OS nº ${os.numero}?`}
          confirmar="Remover"
          onConfirmar={async () => {
            await removerFoto(remover);
            setRemover(null);
            onSincronizar();
          }}
          onCancelar={() => setRemover(null)}
        />
      )}
    </section>
  );
};

const qtdBR = (v: unknown) => new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 3 }).format(Number(v) || 0);

/**
 * Serviços e produtos da OS: escolhidos no catálogo guardado no aparelho (busca por nome ou código);
 * cada mudança manda a lista inteira para a fila
 */
const ServicosOS: React.FC<{ os: OS; editavel: boolean }> = ({ os, editavel }) => {
  const [busca, setBusca] = useState('');
  const termo = busca.trim().toLowerCase();
  const temCatalogo = (useConsulta(() => db.catalogo.count()) ?? 0) > 0;
  // Até 20 achados: serviços primeiro, depois produtos
  const achados =
    useConsulta(
      async () =>
        termo.length < 2
          ? []
          : (await db.catalogo.filter((c) => `${c.nome} ${c.codigo ?? ''}`.toLowerCase().includes(termo)).limit(60).toArray())
              .sort((a, b) => (a.tipo === b.tipo ? a.nome.localeCompare(b.nome) : a.tipo === 'servico' ? -1 : 1))
              .slice(0, 20),
      [termo],
    ) ?? [];
  const itens = os.itens ?? [];
  const [remover, setRemover] = useState<number | null>(null);
  const gravar = (lista: ItemOS[]) => alterar(os.id, { itens: lista });
  const somar = (n: number, delta: number) =>
    gravar(itens.map((i, k) => (k === n ? { ...i, quantidade: Math.max(1, (Number(i.quantidade) || 0) + delta) } : i)));
  const adicionar = (c: ItemCatalogo) => {
    gravar([
      ...itens,
      { servico_id: c.tipo === 'servico' ? c.id : null, produto_id: c.tipo === 'produto' ? c.id : null, quantidade: 1, item_nome: c.nome, unidade: c.unidade },
    ]);
    setBusca('');
  };

  return (
    <section className="flex flex-col gap-2 rounded-xl bg-white p-3 shadow-sm dark:bg-stone-900">
      <h2 className={LABEL_CLASS}>{editavel || os.status === 'concluida' ? 'Serviços e produtos utilizados' : 'Serviços e produtos lançados'}</h2>
      {!editavel && os.status !== 'concluida' && <p className="text-xs text-stone-500">Lançados pelo escritório. No fechamento da OS, confira e ajuste.</p>}
      {editavel && itens.length > 0 && <p className="text-xs text-stone-500">Confira: ajuste a quantidade, tire ou adicione.</p>}
      {itens.length === 0 && <p className="text-sm text-stone-500">Nada lançado.</p>}
      {itens.map((i, n) => (
        <div key={`${i.servico_id ?? 'p' + i.produto_id}-${n}`} className="flex items-center gap-2 rounded-lg bg-stone-50 p-2 dark:bg-stone-800/60">
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-semibold">{i.item_nome}</div>
            <div className="text-xs text-stone-500">
              {i.produto_id ? 'Produto' : 'Serviço'} • {i.unidade}
            </div>
          </div>
          {editavel ? (
            <>
              <button type="button" onClick={() => somar(n, -1)} disabled={Number(i.quantidade) <= 1} className="rounded-lg bg-white p-2 shadow-sm disabled:opacity-30 dark:bg-stone-700" title="Menos">
                <Minus size={16} />
              </button>
              <span className="w-10 text-center font-semibold tabular-nums">{qtdBR(i.quantidade)}</span>
              <button type="button" onClick={() => somar(n, 1)} className="rounded-lg bg-white p-2 shadow-sm dark:bg-stone-700" title="Mais">
                <Plus size={16} />
              </button>
              <button type="button" onClick={() => setRemover(n)} className="rounded-lg p-2 text-stone-400" title="Tirar item">
                <X size={18} />
              </button>
            </>
          ) : (
            <span className="font-semibold tabular-nums">{qtdBR(i.quantidade)}</span>
          )}
        </div>
      ))}
      {editavel &&
        (temCatalogo ? (
          <div className="flex flex-col gap-1">
            <input
              type="search"
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              placeholder="+ Adicionar serviço ou produto (nome ou código)"
              className="rounded-xl bg-stone-100 p-3 text-base text-stone-800 placeholder:font-semibold placeholder:text-blue-700 dark:bg-stone-800 dark:text-stone-100 dark:placeholder:text-blue-300"
            />
            {termo.length >= 2 &&
              (achados.length ? (
                <div className="max-h-72 overflow-y-auto rounded-xl border border-stone-200 dark:border-stone-700">
                  {achados.map((c) => (
                    <button
                      key={c.chave}
                      type="button"
                      onClick={() => adicionar(c)}
                      className="flex w-full items-center gap-2 border-b border-stone-100 p-3 text-left text-sm last:border-0 active:bg-stone-100 dark:border-stone-800 dark:active:bg-stone-800"
                    >
                      <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold ${c.tipo === 'servico' ? 'bg-blue-100 text-blue-700' : 'bg-amber-100 text-amber-800'}`}>
                        {c.tipo === 'servico' ? 'Serviço' : 'Produto'}
                      </span>
                      <span className="min-w-0 flex-1 truncate">{c.nome}</span>
                      <span className="shrink-0 text-xs text-stone-500">{c.unidade}</span>
                    </button>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-stone-500">Nada encontrado com "{busca.trim()}".</p>
              ))}
          </div>
        ) : (
          <p className="text-xs text-stone-500">Nenhum serviço ou produto no aparelho: sincronize com sinal para baixar o cadastro.</p>
        ))}

      {remover !== null && (
        <ConfirmDialog
          titulo="Tirar item"
          mensagem={`Tirar "${itens[remover]?.item_nome}" da OS?`}
          confirmar="Tirar"
          onConfirmar={async () => {
            await gravar(itens.filter((_, k) => k !== remover));
            setRemover(null);
          }}
          onCancelar={() => setRemover(null)}
        />
      )}
    </section>
  );
};

/** Histórico do cliente: as últimas OS concluídas (de qualquer técnico), recolhidas; tocar abre o que foi feito */
const HistoricoCliente: React.FC<{ os: OS }> = ({ os }) => {
  const lista = os.historico ?? [];
  return (
    <details className="group rounded-xl bg-white p-3 shadow-sm dark:bg-stone-900">
      <summary className="flex cursor-pointer list-none items-center justify-between">
        <span className={LABEL_CLASS}>Histórico do cliente ({lista.length})</span>
        <ChevronRight size={18} className="text-stone-400 transition-transform group-open:rotate-90" />
      </summary>
      {lista.length === 0 ? (
        <p className="mt-2 text-sm text-stone-500">Nenhuma OS concluída deste cliente.</p>
      ) : (
        <div className="mt-2 flex flex-col gap-2">
          {lista.map((h) => (
            <details key={h.id} className="rounded-lg bg-stone-50 p-2.5 dark:bg-stone-800/60">
              <summary className="cursor-pointer list-none">
                <div className="flex items-center justify-between gap-2 text-xs">
                  <span className="font-bold text-stone-600 dark:text-stone-300">Nº {h.numero}</span>
                  <span className="text-stone-500">{formatDateBR(String(h.fim_em ?? h.data_agendada ?? ''))}</span>
                </div>
                <div className="text-xs text-stone-500">
                  {TIPOS[h.tipo] || h.tipo}
                  {h.tecnico_nome ? ` • ${h.tecnico_nome}` : ''}
                </div>
                <div className="mt-0.5 line-clamp-2 text-sm">{h.servico_executado || h.servico_solicitado}</div>
              </summary>
              <div className="mt-2 flex flex-col gap-1.5 border-t border-stone-200 pt-2 text-sm dark:border-stone-700">
                {h.servico_solicitado && (
                  <div>
                    <span className="text-xs text-stone-500">O que seria feito: </span>
                    <span className="whitespace-pre-wrap">{h.servico_solicitado}</span>
                  </div>
                )}
                {h.servico_executado && (
                  <div>
                    <span className="text-xs text-stone-500">O que foi feito: </span>
                    <span className="whitespace-pre-wrap">{h.servico_executado}</span>
                  </div>
                )}
                {h.itens.length > 0 && (
                  <ul className="text-xs text-stone-600 dark:text-stone-300">
                    {h.itens.map((i, n) => (
                      <li key={n}>
                        {qtdBR(i.quantidade)} {i.unidade} • {i.item_nome}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </details>
          ))}
        </div>
      )}
    </details>
  );
};
