import React, { useCallback, useEffect, useRef, useState } from 'react';
import { SelectAuto } from './SelectAuto';
import { Bell, CheckCircle2, Download, Headset, Loader2, MonitorSmartphone, Send, Star, X } from 'lucide-react';
import { erroCelular, formatDateTimeBR } from '../utils/formatters';
import { ConfirmDialog } from './ConfirmDialog';
import { destravarSom, tocarAviso } from '../utils/som';
import { INPUT_CLASS } from '../utils/formStyles';

/**
 * Página pública /suporte?e=<empresa> (dentro do painel do widget.js, no site do cliente): abre o
 * chamado e conversa com a equipe (server/suporte.ts). O token do chamado fica neste navegador:
 * voltando ao site, a conversa continua de onde parou.
 */

interface Chamado {
  numero: number;
  titulo: string;
  status: string;
  atendente: string | null;
  posicao: number | null;
  avaliado: boolean;
  mensagens: { id: number; autor: 'cliente' | 'equipe'; texto: string; criado_em: string; usuario_nome: string | null }[];
}

const api = async (url: string, corpo?: unknown) => {
  const r = await fetch(url, corpo === undefined ? undefined : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corpo) });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || 'Não foi possível concluir agora. Tente de novo.');
  return d;
};

/** O storage pode estar bloqueado (iframe de outro site, modo privado): sem ele, vale só enquanto a página está aberta */
const ler = (k: string) => {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
};
const gravar = (k: string, v: string | null) => {
  try {
    if (v === null) localStorage.removeItem(k);
    else localStorage.setItem(k, v);
  } catch {
    // sem storage
  }
};

const soDigitos = (v: string, max: number) => v.replace(/\D/g, '').slice(0, max);

/**
 * BM-ClientChat (programa na máquina do cliente, D:\bmsoftx\crmWeb\bmClientChat): a página roda num WebView2 e
 * conversa com o programa por window.chrome.webview. O programa manda o nome do computador em ?pc=
 */
const webviewApp: { postMessage: (m: string) => void } | undefined = (window as any).chrome?.webview;
const PC_APP = new URLSearchParams(window.location.search).get('pc')?.slice(0, 60) || '';
const avisarApp = (msg: Record<string, string>) => {
  try {
    webviewApp?.postMessage(JSON.stringify(msg));
  } catch {
    // fora do programa
  }
};

/** Avisa o widget (site em volta) quem é o cliente, para dar nome à visita (Suporte › Visitas do Site) */
const avisarCliente = (dados: { nome?: string; documento?: string }) => {
  if (window.parent !== window && (dados.nome || dados.documento)) {
    window.parent.postMessage({ crmweb: 'cliente', nome: dados.nome || '', documento: dados.documento || '' }, '*');
  }
};

/** Pedido de tela remota do técnico (server/chamados.ts): vira o cartão para baixar o BMSoft Suporte */
const TELA_REMOTA = '[[anydesk]]';
/** Cutucão do técnico (server/chamados.ts): campainha, tremida e aviso ao site (widget.js) */
const CUTUCAR = '[[cutucar]]';

/** Número do AnyDesk que o cliente enviou (chamados antigos, antes de ficar só o BMSoft Suporte) */
const ID_ANYDESK = /^\[\[anydesk-id:(\d+)\]\]$/;
/** "123456789" → "123 456 789" (como o AnyDesk mostra) */
const formatarAnydesk = (id: string) => id.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');

/** Cartão "Acesso remoto": o cliente dá nome ao computador e baixa o BMSoft Suporte (só ele; o AnyDesk saiu) */
const CartaoTelaRemota: React.FC<{ tecnico: string; quando: string; ultimo: boolean; url: string }> = ({ tecnico, quando, ultimo, url }) => {
  const [baixando, setBaixando] = useState(false);
  /** Nome que o cliente dá ao computador antes de baixar: o técnico acha o computador no chamado e vira o apelido dele */
  const [nomePc, setNomePc] = useState(PC_APP);
  const campoNomePc = useRef<HTMLInputElement>(null);
  const [erro, setErro] = useState<string | null>(null);
  /**
   * BMSoft Suporte (BMDesk): a página do instalador abre numa aba nova. A aba abre já no clique
   * (depois da chamada o navegador bloquearia o pop-up) e recebe o endereço quando ele chega
   */
  const baixarAgente = async () => {
    // Obrigatório: confere antes de abrir a aba
    if (!nomePc.trim()) {
      setErro('Informe o nome deste computador (ex.: Recepção) para baixar o BMSoft Suporte.');
      campoNomePc.current?.focus();
      return;
    }
    const janela = window.open('', '_blank');
    setBaixando(true);
    setErro(null);
    try {
      const { url: link } = await api(`${url}/agente`, { nome: nomePc.trim() });
      if (janela) {
        janela.opener = null;
        janela.location.href = link;
      } else window.location.href = link;
    } catch (err: any) {
      janela?.close();
      setErro(err.message);
    } finally {
      setBaixando(false);
    }
  };
  return (
    <div className={`self-start max-w-[90%] rounded-2xl rounded-bl-md border px-3 py-2.5 text-sm ${ultimo ? 'bg-rose-50 border-rose-200' : 'bg-white border-stone-200'}`}>
      <div className="flex items-center gap-2 font-semibold text-rose-700">
        <MonitorSmartphone className="w-4 h-4" /> Acesso remoto
      </div>
      <p className="text-xs text-stone-600 mt-1">
        {tecnico} pediu para ver a sua tela e ajudar. Baixe o BMSoft Suporte, abra o arquivo e clique em "Instalar" ou "Conectar".
      </p>
      <div className="flex gap-2 mt-2">
        <input
          ref={campoNomePc}
          required
          value={nomePc}
          onChange={(e) => setNomePc(e.target.value.slice(0, 60))}
          onFocus={(e) => e.target.select()}
          onKeyDown={(e) => e.key === 'Enter' && !baixando && baixarAgente()}
          placeholder="Nome deste computador (OBRIGATÓRIO)"
          aria-label="Nome deste computador (obrigatório)"
          title="Obrigatório: ajuda o técnico a achar este computador (ex.: Recepção, Caixa 1, Notebook da Maria)"
          className={`${INPUT_CLASS} flex-1 min-w-0 text-sm`}
        />
        <button
          type="button"
          onClick={baixarAgente}
          disabled={baixando}
          className="shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold cursor-pointer disabled:opacity-60"
        >
          {baixando ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />} Baixar BMSoft Suporte
        </button>
      </div>
      {erro && <p className="text-xs text-rose-700 mt-1">{erro}</p>}
      <div className="text-[10px] mt-1 text-right text-stone-400">{formatDateTimeBR(quando)}</div>
    </div>
  );
};

export const SuportePublico: React.FC<{ empresa: string; cnpj: string }> = ({ empresa, cnpj }) => {
  const chaveToken = `crmweb_suporte_${empresa}`;
  const chaveDados = `crmweb_suporte_dados_${empresa}`;
  const [info, setInfo] = useState<{ empresa: { nome: string; logo: string | null }; categorias: { id: number; nome: string }[] } | null>(null);
  const [token, setToken] = useState<string | null>(() => ler(chaveToken));
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    api(`/api/publico/suporte/${encodeURIComponent(empresa)}`)
      .then(setInfo)
      .catch((e) => setErro(e.message));
  }, [empresa]);

  // Cliente que já se identificou antes neste navegador: a visita ganha o nome dele
  useEffect(() => {
    try {
      avisarCliente(JSON.parse(ler(chaveDados) || '{}') || {});
    } catch {
      // dados salvos inválidos
    }
  }, [chaveDados]);

  /** Aviso no topo do formulário (atendimento anterior que acabou de terminar) */
  const [aviso, setAviso] = useState<string | null>(null);
  const trocarToken = (t: string | null, msg: string | null = null) => {
    gravar(chaveToken, t);
    setToken(t);
    setAviso(msg);
  };
  // O aviso fica 3 s e some: o formulário volta ao estado inicial (com ele, o botão de enviar saía da janela)
  useEffect(() => {
    if (!aviso) return;
    const t = setTimeout(() => setAviso(null), 3000);
    return () => clearTimeout(t);
  }, [aviso]);

  // Link direto (fora do iframe do widget): o mesmo painel do widget, centralizado; no celular, a tela toda
  const caixa = avulso
    ? 'h-[100dvh] sm:h-[640px] sm:max-h-[calc(100dvh-2rem)] w-full sm:w-[400px] sm:rounded-2xl sm:shadow-2xl overflow-hidden'
    : 'h-screen';
  const moldura = (filho: React.ReactNode) =>
    avulso ? <div className="min-h-[100dvh] bg-stone-200 sm:flex sm:items-center sm:justify-center sm:p-4">{filho}</div> : filho;

  if (!info) {
    return moldura(<div className={`${caixa} bg-stone-50 flex items-center justify-center text-sm text-stone-500 p-4`}>{erro ?? <Loader2 className="w-6 h-6 animate-spin text-stone-400" />}</div>);
  }

  return moldura(
    <div className={`${caixa} flex flex-col bg-stone-50 text-stone-800`}>
      {/* BM-ClientChat: a janela não tem barra de título; arrastar o topo do chat move a janela */}
      <header
        className={`px-4 py-3 bg-blue-600 text-white flex items-center gap-3 shrink-0${webviewApp ? ' select-none cursor-move' : ''}`}
        onMouseDown={(e) => {
          if (!webviewApp || e.button !== 0) return;
          e.preventDefault();
          avisarApp({ crmweb: 'mover' });
        }}
      >
        {info.empresa.logo ? (
          <img src={info.empresa.logo} alt="" className="h-8 w-8 rounded-full bg-white object-contain p-0.5" />
        ) : (
          <Headset className="w-7 h-7" />
        )}
        <div className="min-w-0">
          <div className="text-sm font-bold truncate">Suporte {info.empresa.nome}</div>
          <div className="text-[11px] text-blue-100">Fale com a nossa equipe</div>
        </div>
        {/* BM-ClientChat: esconde a janela na bandeja (as mensagens continuam chegando) */}
        {webviewApp && (
          <button
            type="button"
            title="Esconder o chat (continua no ícone perto do relógio)"
            className="ml-auto p-1.5 rounded hover:bg-blue-500 cursor-pointer"
            onMouseDown={(e) => e.stopPropagation()}
            onClick={() => avisarApp({ crmweb: 'esconder' })}
          >
            <X className="w-5 h-5" />
          </button>
        )}
      </header>
      {token ? (
        <Conversa token={token} onNovo={(msg) => trocarToken(null, msg ?? null)} />
      ) : (
        <Abrir empresa={empresa} cnpj={cnpj} categorias={info.categorias} chaveDados={chaveDados} aviso={aviso} onAberto={(t) => trocarToken(t)} />
      )}
    </div>,
  );
};

/** Aberto pelo link direto (não dentro do iframe do widget num site) */
const avulso = (() => {
  try {
    return window.self === window.top;
  } catch {
    return false; // iframe de outro site: o navegador não deixa comparar
  }
})();

const Abrir: React.FC<{
  empresa: string;
  cnpj: string;
  categorias: { id: number; nome: string }[];
  chaveDados: string;
  aviso: string | null;
  onAberto: (token: string) => void;
}> = ({ empresa, cnpj, categorias, chaveDados, aviso, onAberto }) => {
  // Nome, WhatsApp e CNPJ da última vez vêm preenchidos
  const salvos = (() => {
    try {
      return JSON.parse(ler(chaveDados) || '{}');
    } catch {
      return {};
    }
  })();
  const [v, setV] = useState({
    documento: soDigitos(cnpj || salvos.documento || '', 14),
    nome: salvos.nome || '',
    telefone: salvos.telefone || '',
    fixo: salvos.fixo || '',
    categoria_id: '',
    descricao: '',
  });
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const alterar = (m: Partial<typeof v>) => setV({ ...v, ...m });

  const enviar = async (e: React.FormEvent) => {
    e.preventDefault();
    setEnviando(true);
    setErro(null);
    try {
      const r = await api(`/api/publico/suporte/${encodeURIComponent(empresa)}/chamados`, { ...v, categoria_id: Number(v.categoria_id) || null, pc: PC_APP || undefined });
      gravar(chaveDados, JSON.stringify({ documento: v.documento, nome: v.nome, telefone: v.telefone, fixo: v.fixo }));
      avisarCliente(v);
      onAberto(r.token);
    } catch (err: any) {
      setErro(err.message);
    } finally {
      setEnviando(false);
    }
  };

  // Foco no primeiro campo vazio
  const primeiroVazio = !v.documento ? 'sp-doc' : !v.nome ? 'sp-nome' : !v.telefone ? 'sp-tel' : categorias.length ? 'sp-cat' : 'sp-desc';
  // Visual próprio do formulário do site (pedido do usuário, como o "Agendar Apresentação" da homepage):
  // rótulo pequeno em maiúsculas em cima, campo em caixa arredondada com borda
  // Borda e foco vêm da classe campo-site (index.css): o padrão global dos campos usa !important
  const campo = 'campo-site w-full bg-white px-3.5 py-2.5 text-sm text-stone-800 placeholder:text-stone-400 outline-none transition-colors';
  const rotulo = 'block mb-1.5 text-[10px] font-bold uppercase tracking-wider text-stone-500';

  return (
    <form onSubmit={enviar} className="flex-1 overflow-y-auto p-5 flex flex-col gap-4">
      {aviso && (
        <p className="p-2.5 rounded-lg bg-emerald-50 text-emerald-800 text-xs flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 shrink-0" /> {aviso}
        </p>
      )}
      <p className="text-xs text-stone-600">Conte o que está acontecendo. O primeiro atendente livre continua a conversa por aqui.</p>
      <div>
        <label htmlFor="sp-doc" className={rotulo}>CNPJ da empresa (ou CPF)</label>
        <input id="sp-doc" autoFocus={primeiroVazio === 'sp-doc'} inputMode="numeric" value={v.documento} onChange={(e) => alterar({ documento: soDigitos(e.target.value, 14) })} onFocus={(e) => e.target.select()} placeholder="Ex: 12345678000199" required pattern="\d{11}|\d{14}" title="CNPJ com 14 dígitos ou CPF com 11" className={campo} />
      </div>
      <div>
        <label htmlFor="sp-nome" className={rotulo}>Seu nome</label>
        <input id="sp-nome" autoFocus={primeiroVazio === 'sp-nome'} value={v.nome} onChange={(e) => alterar({ nome: e.target.value })} onFocus={(e) => e.target.select()} placeholder="Ex: Pedro" maxLength={120} autoComplete="name" required minLength={2} className={campo} />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label htmlFor="sp-tel" className={rotulo}>Celular / WhatsApp</label>
          <input id="sp-tel" autoFocus={primeiroVazio === 'sp-tel'} inputMode="tel" value={v.telefone} onChange={(e) => {
              const telefone = soDigitos(e.target.value, 13);
              // Mesma regra do servidor (DDD que existe, 9 na frente, dígitos não todos iguais): o navegador mostra o motivo
              e.target.setCustomValidity(telefone ? (erroCelular(telefone) ?? '') : '');
              alterar({ telefone });
            }}
            onFocus={(e) => e.target.select()}
            placeholder="Ex: 11999999999"
            required
            title="Celular com DDD (só os números), ex.: 11999999999"
            className={campo}
          />
        </div>
        <div>
          <label htmlFor="sp-fixo" className={rotulo}>Telefone fixo (opcional)</label>
          <input id="sp-fixo" inputMode="tel" value={v.fixo} onChange={(e) => alterar({ fixo: soDigitos(e.target.value, 13) })} onFocus={(e) => e.target.select()} placeholder="Ex: 1133334444" pattern="\d{10,13}" title="Telefone com DDD (só os números)" className={campo} />
        </div>
      </div>
      {categorias.length > 0 && (
        <div>
          <label htmlFor="sp-cat" className={rotulo}>Assunto</label>
          <SelectAuto id="sp-cat" autoFocus={primeiroVazio === 'sp-cat'} value={v.categoria_id} onChange={(e) => alterar({ categoria_id: e.target.value })} className={`${campo} cursor-pointer`}>
            <option value="">Escolha...</option>
            {categorias.map((c) => (
              <option key={c.id} value={c.id}>
                {c.nome}
              </option>
            ))}
          </SelectAuto>
        </div>
      )}
      <div>
        <label htmlFor="sp-desc" className={rotulo}>Como podemos ajudar?</label>
        <textarea id="sp-desc" autoFocus={primeiroVazio === 'sp-desc'} value={v.descricao} onChange={(e) => alterar({ descricao: e.target.value })} rows={5} maxLength={4000} required minLength={5} placeholder="Ex: não consigo emitir a nota fiscal" className={`${campo} resize-none`} />
      </div>
      {erro && <div className="p-2.5 rounded-lg bg-rose-50 text-rose-800 text-xs">{erro}</div>}
      <button type="submit" disabled={enviando} className="flex items-center justify-center gap-2 py-3 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-sm font-bold shadow-lg shadow-blue-500/30 transition-colors cursor-pointer disabled:opacity-50">
        {enviando ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
        Iniciar atendimento
      </button>
    </form>
  );
};

const Conversa: React.FC<{ token: string; onNovo: (aviso?: string) => void }> = ({ token, onNovo }) => {
  const [c, setC] = useState<Chamado | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [texto, setTexto] = useState('');
  const [encerrando, setEncerrando] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const fim = useRef<HTMLDivElement>(null);
  const qtd = useRef(0);
  /** Campo da mensagem: o foco volta para ele depois de enviar (fica desabilitado enquanto envia) */
  const campoMensagem = useRef<HTMLTextAreaElement>(null);
  /** Maior id de mensagem já visto (null = ainda não carregou): o que a equipe mandou depois avisa o site */
  const vistoAte = useRef<number | null>(null);
  const [tremer, setTremer] = useState(false);
  // O navegador só libera som depois do primeiro clique ou tecla na página
  useEffect(() => destravarSom(), []);
  const url = `/api/publico/suporte/chamado/${encodeURIComponent(token)}`;
  const onNovoRef = useRef(onNovo);
  onNovoRef.current = onNovo;

  const carregar = useCallback(() => {
    api(url)
      .then((d) => {
        setC(d);
        setErro(null);
      })
      .catch((e) => {
        // Token que não vale mais (chamado excluído): volta ao formulário
        if (/não encontrado/i.test(e.message)) onNovoRef.current();
        else setErro(e.message);
      });
  }, [url]);
  // BM-ClientChat chama quando o cliente abre a janela depois do cutucão (registra no chamado que ele viu)
  useEffect(() => {
    if (!webviewApp) return;
    (window as any).bmVisto = () => api(`${url}/visto`, {}).catch(() => {});
    return () => {
      delete (window as any).bmVisto;
    };
  }, [url]);

  // Atualiza a cada 4 s (resposta da equipe, posição na fila)
  useEffect(() => {
    carregar();
    const i = setInterval(carregar, 4000);
    return () => clearInterval(i);
  }, [carregar]);
  // Cancelado, ou encerrado e já avaliado: não há mais nada aqui, vai direto para abrir um novo
  useEffect(() => {
    if (c?.status === 'cancelado') onNovoRef.current('Atendimento anterior cancelado.');
    else if (c?.status === 'encerrado' && c.avaliado) onNovoRef.current('Atendimento anterior encerrado. Obrigado pela avaliação!');
  }, [c?.status, c?.avaliado]);
  useEffect(() => {
    if (c && c.mensagens.length !== qtd.current) {
      qtd.current = c.mensagens.length;
      fim.current?.scrollIntoView({ block: 'end' });
    }
    if (!c) return;
    const maior = c.mensagens.reduce((m, x) => Math.max(m, x.id), 0);
    // O que a equipe mandou desde a última olhada: cutucão (campainha e tremida) ou resposta (som). Nos dois casos o
    // site é avisado (widget.js): abre o painel, pisca o título da aba e mostra a notificação do Windows
    const novas = vistoAte.current === null ? [] : c.mensagens.filter((m) => m.autor === 'equipe' && m.id > vistoAte.current!);
    if (novas.length) {
      const cutucou = novas.some((m) => m.texto === CUTUCAR);
      const ultima = novas.filter((m) => m.texto !== CUTUCAR).pop();
      if (cutucou) {
        tocarAviso('cutucar');
        setTremer(true);
        setTimeout(() => setTremer(false), 1000);
      } else if (document.activeElement !== campoMensagem.current || !document.hasFocus()) {
        // Resposta: o mesmo som que o técnico ouve quando o cliente escreve, só se o cliente não está digitando
        // (o foco fora do campo da mensagem, ou a janela sem foco)
        tocarAviso('suporte');
      }
      const de = (ultima ?? novas[novas.length - 1]).usuario_nome || 'Suporte';
      const texto = !ultima ? 'Precisa de sua atenção no chat do suporte.' : ultima.texto === TELA_REMOTA ? 'Pediu para acessar a sua tela.' : ultima.texto;
      try {
        window.parent.postMessage({ crmweb: cutucou ? 'cutucar' : 'mensagem', de, texto: texto.slice(0, 200) }, '*');
      } catch {
        // página aberta fora do widget
      }
      // BM-ClientChat: põe a janela por cima, pisca o ícone na barra de tarefas e mostra notificação do Windows
      avisarApp({ crmweb: cutucou ? 'cutucar' : 'mensagem', de, texto: texto.slice(0, 200) });
    }
    vistoAte.current = maior;
  }, [c]);

  if (!c) return <div className="flex-1 flex items-center justify-center">{erro ?? <Loader2 className="w-6 h-6 animate-spin text-stone-400" />}</div>;

  const encerrado = ['encerrado', 'cancelado'].includes(c.status);
  const enviar = async (e: React.FormEvent) => {
    e.preventDefault();
    // Enter de novo enquanto envia: ignora (o campo fica só leitura, não desabilitado, para manter o foco)
    if (!texto.trim() || enviando) return;
    setEnviando(true);
    try {
      await api(`${url}/mensagens`, { texto: texto.trim() });
      setTexto('');
      carregar();
    } catch (err: any) {
      setErro(err.message);
    } finally {
      setEnviando(false);
      setTimeout(() => campoMensagem.current?.focus(), 0);
    }
  };

  return (
    <>
      <div className="px-4 py-2 bg-white border-b border-stone-200 text-xs shrink-0 relative">
        {!encerrado && (
          <button
            type="button"
            onClick={() => setEncerrando(true)}
            className="absolute right-3 top-2 px-2.5 py-1 rounded-lg border border-stone-300 text-stone-600 hover:bg-stone-50 hover:text-rose-700 text-[11px] font-semibold cursor-pointer"
          >
            Encerrar
          </button>
        )}
        <div className={`font-semibold text-stone-800 truncate ${encerrado ? '' : 'pr-20'}`}>
          Atendimento nº {c.numero} • {c.titulo}
        </div>
        <div className="text-stone-500">
          {c.status === 'cancelado'
            ? 'Atendimento cancelado.'
            : encerrado
            ? 'Atendimento encerrado.'
            : c.status === 'pausado'
              ? `Atendimento em pausa${c.atendente ? ` com ${c.atendente}` : ''}. Já voltamos a falar com você.`
            : c.atendente
              ? `Em atendimento com ${c.atendente}.`
              : 'Aguardando um atendente. Ele já vai falar com você.'}
        </div>
      </div>

      <div className={`flex-1 overflow-y-auto p-4 flex flex-col gap-2 ${tremer ? 'animate-tremer' : ''}`}>
        {/* Lugar na fila em destaque, enquanto ninguém assumiu */}
        {!encerrado && !c.atendente && c.posicao ? (
          <div className="sticky top-0 z-10 self-center flex items-center gap-3 rounded-full bg-white border border-blue-200 shadow-sm pl-1.5 pr-4 py-1.5">
            <span className="w-12 h-12 rounded-full bg-blue-600 text-white flex items-center justify-center text-xl font-bold">{c.posicao}º</span>
            <span className="text-xs text-stone-600 leading-tight">
              <strong className="block text-sm text-stone-800">Seu lugar na fila</strong>
              Um atendente já vai falar com você
            </span>
          </div>
        ) : null}
        {c.mensagens.map((m, i) =>
          m.texto === CUTUCAR ? (
            <div key={m.id} className="self-center text-xs font-semibold text-amber-800 bg-amber-100 rounded-full px-3 py-1 inline-flex items-center gap-1.5">
              <Bell className="w-3.5 h-3.5" /> {m.usuario_nome || 'O técnico'} precisa de sua atenção • {formatDateTimeBR(m.criado_em)}
            </div>
          ) : m.texto === TELA_REMOTA ? (
            <CartaoTelaRemota
              key={m.id}
              tecnico={m.usuario_nome || 'O técnico'}
              quando={m.criado_em}
              ultimo={i === c.mensagens.length - 1}
              url={url}
            />
          ) : (
          <div
            key={m.id}
            className={`max-w-[85%] rounded-2xl px-3 py-2 text-sm whitespace-pre-wrap ${
              m.autor === 'cliente' ? 'self-end bg-blue-600 text-white rounded-br-md' : 'self-start bg-white border border-stone-200 rounded-bl-md'
            }`}
          >
            {m.autor === 'equipe' && <div className="text-[10px] font-semibold text-blue-600 mb-0.5">{m.usuario_nome || 'Suporte'}</div>}
            {ID_ANYDESK.test(m.texto) ? `Número do AnyDesk enviado: ${formatarAnydesk(ID_ANYDESK.exec(m.texto)![1])}` : m.texto}
            <div className={`text-[10px] mt-0.5 text-right ${m.autor === 'cliente' ? 'text-blue-100' : 'text-stone-400'}`}>{formatDateTimeBR(m.criado_em)}</div>
          </div>
          ),
        )}
        {!c.mensagens.length && !encerrado && <p className="text-xs text-stone-500 text-center mt-4">Recebemos sua mensagem.<br />Se quiser, mande mais detalhes por aqui.</p>}
        <div ref={fim} />
      </div>

      {erro && <div className="mx-4 mb-2 p-2 rounded-lg bg-rose-50 text-rose-800 text-xs">{erro}</div>}

      {encerrando && (
        <ConfirmDialog
          titulo="Encerrar o atendimento?"
          mensagem={c.atendente ? 'A conversa termina e você poderá avaliar o atendimento.' : 'Você sai da fila e o pedido é cancelado.'}
          confirmar="Encerrar"
          onConfirmar={async () => {
            await api(`${url}/encerrar`, {});
            setEncerrando(false);
            carregar();
          }}
          onCancelar={() => setEncerrando(false)}
        />
      )}

      {encerrado ? (
        // Encerrado: avalia (cancelado e já avaliado vão direto para o formulário, no efeito acima)
        // Avaliação obrigatória: sem ela o cliente não abre um novo atendimento
        <Avaliar url={url} onFeito={carregar} />
      ) : (
        <form onSubmit={enviar} className="p-3 bg-white border-t border-stone-200 flex items-end gap-2 shrink-0">
          <textarea
            ref={campoMensagem}
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                (e.currentTarget.form as HTMLFormElement).requestSubmit();
              }
            }}
            readOnly={enviando}
            rows={1}
            maxLength={4000}
            placeholder={enviando ? 'Enviando...' : 'Escreva a sua mensagem'}
            aria-label="Mensagem"
            className={`${INPUT_CLASS} flex-1 resize-none text-sm`}
          />
          <button type="submit" disabled={enviando || !texto.trim()} title="Enviar" className="h-9 w-9 shrink-0 flex items-center justify-center rounded-full bg-blue-600 hover:bg-blue-700 text-white cursor-pointer disabled:opacity-40">
            {enviando ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
          </button>
        </form>
      )}
    </>
  );
};

const Avaliar: React.FC<{ url: string; onFeito: () => void }> = ({ url, onFeito }) => {
  const [nota, setNota] = useState(0);
  const [comentario, setComentario] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  return (
    <div className="p-4 bg-white border-t border-stone-200 flex flex-col gap-2 shrink-0">
      <p className="text-sm font-semibold text-stone-800">Como foi o atendimento?</p>
      <div className="flex gap-1">
        {[1, 2, 3, 4, 5].map((n) => (
          <button key={n} type="button" onClick={() => setNota(n)} aria-label={`${n} estrela(s)`} className="p-1 cursor-pointer">
            <Star className={`w-7 h-7 ${n <= nota ? 'fill-amber-400 text-amber-400' : 'text-stone-300'}`} />
          </button>
        ))}
      </div>
      {nota > 0 && nota <= 3 && (
        <textarea value={comentario} onChange={(e) => setComentario(e.target.value)} rows={2} maxLength={2000} placeholder="O que podemos melhorar?" aria-label="Comentário" className={`${INPUT_CLASS} w-full resize-none text-sm`} />
      )}
      {erro && <div className="p-2 rounded-lg bg-rose-50 text-rose-800 text-xs">{erro}</div>}
      <button
        type="button"
        disabled={!nota || enviando}
        onClick={async () => {
          setEnviando(true);
          try {
            await api(`${url}/avaliar`, { nota, comentario });
            onFeito();
          } catch (e: any) {
            setErro(e.message);
          } finally {
            setEnviando(false);
          }
        }}
        className="py-2.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold cursor-pointer disabled:opacity-40"
      >
        Enviar avaliação
      </button>
    </div>
  );
};
