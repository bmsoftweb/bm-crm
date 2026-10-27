import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { SelectAuto } from './SelectAuto';
import { useGrudarNoFim } from '../utils/grudarNoFim';
import { AlertCircle, ArrowLeft, ArrowRightLeft, Bot, Building2, CircleCheck, CircleSlash, Hand, Headset, Inbox, Layers, Lock, LockOpen, Megaphone, Network, Pause, Check, CheckCheck, Clock, FileText, Hash, Loader2, MessageCircle, MessageSquarePlus, Mic, Paperclip, Play, Reply, Search, SendHorizontal, Trash2, User, UserPlus, X } from 'lucide-react';
import { ArquivoConversa, ConversaResumo, DestinoConversa, MensagemWhatsApp, createRecord, fetchDestinosConversa, fetchMidiaMensagem, fetchNumeroConversa, mudarAtendimentoConversa, encerrarConversa, descartarConversa, limparConversa, atenderConversa, marcarMensagemPrivada, apagarMensagem, pausarConversa, transferirConversa, fetchConversa, fetchOptions, fetchConversaDaAtividade, fetchConversas, responderConversa } from '../services/api';
import { INPUT_CLASS, LABEL_CLASS, FIELD_CLASS, HINT_CLASS } from '../utils/formStyles';
import { formatDateTimeBR, hojeIso, horaChegada } from '../utils/formatters';
import { OpcaoRef } from '../types';
import { SelectBusca } from './SelectBusca';
import { AvisoErro } from './AvisoErro';
import { ConfirmDialog } from './ConfirmDialog';
import { BotaoTemplates } from './BotaoTemplates';
import { BotaoEmoji } from './BotaoEmoji';
import { lerSessao } from '../utils/session';
import { TecnicosAgora } from './Chamados';

/** Quem pediu para abrir uma conversa (seq muda a cada clique) */
export interface PedidoConversa {
  /** Atividade WhatsApp da ficha do negócio: enviar a mensagem a conclui */
  atividadeId?: string | number;
  /** Ícone do WhatsApp nas listas de Pessoas e de Contatos */
  pessoaId?: string | number;
  contatoId?: string | number;
  /** Conversa atendida pela Fila de Chamados */
  telefone?: string;
  seq: number;
}

interface Props {
  refreshToken: number;
  /** Mensagens foram vistas: o menu recalcula a etiqueta de não vistas */
  onVisto: () => void;
  /** Aberta pela atividade WhatsApp da ficha do negócio, ou por uma pessoa/contato das listas */
  pedido?: PedidoConversa | null;
  /** Conversa pausada: volta para a Fila de Chamados */
  onVoltarFila?: () => void;
  onToast: (msg: string) => void;
}

/** 5547988438552 → +55 (47) 98843-8552; número de fora do Brasil fica só com o + */
export function formatarTelefoneWa(t: string): string {
  const m = /^55(\d{2})(\d{4,5})(\d{4})$/.exec(t);
  return m ? `+55 (${m[1]}) ${m[2]}-${m[3]}` : `+${t}`;
}

/**
 * Número da conversa → telefone para o cadastro: (47) 98843-8552. O WhatsApp costuma guardar o
 * celular sem o 9; número de 8 dígitos começando em 6-9 é celular e ganha o 9 de volta.
 */
export function telefoneCadastro(t: string): string {
  const m = /^55(\d{2})(\d{8,9})$/.exec(t);
  if (!m) return `+${t}`;
  const numero = m[2].length === 8 && /^[6-9]/.test(m[2]) ? `9${m[2]}` : m[2];
  return `(${m[1]}) ${numero.slice(0, -4)}-${numero.slice(-4)}`;
}

const MIDIA = ['imagem', 'figurinha', 'audio', 'video'];

/** "2026-09-25 14:05:00" → "há 12 min" / "há 2 h" */
function haQuanto(dataHora: string | null): string {
  if (!dataHora) return '';
  const min = Math.max(0, Math.round((Date.now() - new Date(dataHora.replace(' ', 'T')).getTime()) / 60_000));
  return min < 1 ? 'agora' : min < 60 ? `há ${min} min` : min < 1440 ? `há ${Math.floor(min / 60)} h` : `há ${Math.floor(min / 1440)} d`;
}

/** Arquivo enviado pela conversa: a Vercel recusa requisição acima de 4,5 MB, e o base64 cresce 1/3 */
const MAX_ARQUIVO = 3 * 1024 * 1024;

/** Arquivo/gravação → base64 sem o prefixo data: */
const paraBase64 = (b: Blob) =>
  new Promise<string>((ok, erro) => {
    const r = new FileReader();
    r.onload = () => ok(String(r.result).split(',')[1] || '');
    r.onerror = () => erro(r.error);
    r.readAsDataURL(b);
  });

const tipoDoArquivo = (mime: string): ArquivoConversa['tipo'] =>
  mime.startsWith('image/') ? 'imagem' : mime.startsWith('video/') ? 'video' : mime.startsWith('audio/') ? 'audio' : 'documento';

const tamanhoLegivel = (n: number) => (n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / 1048576).toFixed(1).replace('.', ',')} MB`);

/** Documento da mensagem (PDF, planilha...): ao clicar, baixa do WhatsApp e salva com o nome original */
const Documento: React.FC<{ id: number; nome: string | null }> = ({ id, nome }) => {
  const [estado, setEstado] = useState<'pronto' | 'baixando' | 'falhou'>('pronto');
  const baixar = async () => {
    setEstado('baixando');
    try {
      const url = await fetchMidiaMensagem(id);
      const a = document.createElement('a');
      a.href = url;
      a.download = nome || 'arquivo';
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
      setEstado('pronto');
    } catch {
      setEstado('falhou');
    }
  };
  return (
    <button
      type="button"
      onClick={baixar}
      disabled={estado === 'baixando'}
      title={estado === 'falhou' ? 'Não foi possível baixar o arquivo do WhatsApp. Clique para tentar de novo.' : 'Baixar o arquivo'}
      className="flex items-center gap-1.5 not-italic underline underline-offset-2 cursor-pointer disabled:opacity-60 text-left"
    >
      {estado === 'baixando' ? <Loader2 className="w-3.5 h-3.5 shrink-0 animate-spin" /> : <FileText className="w-3.5 h-3.5 shrink-0" />}
      {nome || TIPOS.documento}
      {estado === 'falhou' && <span className="no-underline text-rose-500"> (não disponível)</span>}
    </button>
  );
};

/**
 * Imagem, figurinha, áudio ou vídeo da mensagem, baixado do WhatsApp (o CRM não guarda o
 * arquivo). Imagem e áudio carregam ao aparecer; vídeo só ao clicar, por ser pesado.
 */
const MidiaMensagem: React.FC<{ id: number; tipo: string }> = ({ id, tipo }) => {
  const [pedir, setPedir] = useState(tipo !== 'video');
  const [src, setSrc] = useState<string | null>(null);
  const [falhou, setFalhou] = useState(false);
  useEffect(() => {
    if (!pedir) return;
    let url: string | null = null;
    let vivo = true;
    fetchMidiaMensagem(id)
      .then((u) => {
        url = u;
        if (vivo) setSrc(u);
        else URL.revokeObjectURL(u);
      })
      .catch(() => vivo && setFalhou(true));
    return () => {
      vivo = false;
      if (url) URL.revokeObjectURL(url);
    };
  }, [id, pedir]);
  const nome = TIPOS[tipo] || tipo;
  if (falhou) return <div className="italic text-xs opacity-70 mb-0.5">{nome} (não disponível)</div>;
  if (!pedir) {
    return (
      <button type="button" onClick={() => setPedir(true)} className="flex items-center gap-1.5 w-56 h-32 mb-1 justify-center rounded-lg bg-black/10 dark:bg-white/10 text-xs font-semibold cursor-pointer hover:bg-black/15">
        <Play className="w-4 h-4" /> Carregar vídeo
      </button>
    );
  }
  if (!src) {
    const tamanho = tipo === 'figurinha' ? 'w-24 h-24' : tipo === 'audio' ? 'w-60 h-10' : 'w-56 h-40';
    return <div className={`${tamanho} mb-1 rounded-lg bg-black/10 dark:bg-white/10 animate-pulse`} />;
  }
  if (tipo === 'audio') return <audio src={src} controls className="w-64 max-w-full h-10 mb-1" />;
  if (tipo === 'video') return <video src={src} controls autoPlay className="max-w-full max-h-72 rounded-lg mb-1" />;
  if (tipo === 'figurinha') return <img src={src} alt="Figurinha" className="w-24 h-24 object-contain mb-1" />;
  return (
    <a href={src} target="_blank" rel="noreferrer" title="Abrir a imagem">
      <img src={src} alt="Imagem" className="max-w-full max-h-72 rounded-lg mb-1 cursor-zoom-in" />
    </a>
  );
};

const TIPOS: Record<string, string> = {
  imagem: 'Imagem',
  video: 'Vídeo',
  audio: 'Áudio',
  documento: 'Documento',
  figurinha: 'Figurinha',
  localizacao: 'Localização',
  contato: 'Contato',
  outro: 'Mensagem não suportada',
  apagada: '🚫 Mensagem apagada',
};

/** Texto curto da última mensagem, para a lista */
const resumo = (m: { tipo: string; texto: string | null; arquivo_nome: string | null; privada?: { departamento: string; oculta?: boolean } | null }) =>
  m.privada?.oculta
    ? `🔒 Mensagem privada (${m.privada.departamento})`
    : m.tipo === 'texto' ? m.texto || '' : `[${TIPOS[m.tipo] || m.tipo}] ${m.texto || m.arquivo_nome || ''}`.trim();

/** Prévia da mensagem citada (Responder): privada de outro departamento vem sem o texto */
const citado = (m: { tipo: string | null; texto: string | null; arquivo_nome: string | null; privada?: { departamento: string; oculta?: boolean } | null }) =>
  m.privada?.oculta || (m.tipo === 'texto' && m.texto == null) ? '🔒 Mensagem privada' : resumo({ ...m, tipo: m.tipo ?? 'texto' }) || '[mensagem]';

/** AAAA-MM-DD de ontem, no horário local (nunca toISOString) */
function ontemIso(): string {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const dataBr = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
/** Dia e hora de uma mensagem: 29/09/2026 10:42 */
const diaHora = (dataHora: string) => `${dataBr(dataHora)} ${dataHora.slice(11, 16)}`;

function rotuloDia(dia: string): string {
  if (dia === hojeIso()) return 'Hoje';
  if (dia === ontemIso()) return 'Ontem';
  return dataBr(dia);
}

/** Ícone da situação de uma mensagem enviada */
const Situacao: React.FC<{ s: MensagemWhatsApp['situacao'] }> = ({ s }) => {
  if (s === 'falhou') return <AlertCircle className="w-3.5 h-3.5 text-red-300" aria-label="Falhou" />;
  if (s === 'pendente') return <Clock className="w-3.5 h-3.5 opacity-70" aria-label="Enviando" />;
  if (s === 'enviada') return <Check className="w-3.5 h-3.5 opacity-70" aria-label="Enviada" />;
  if (s === 'entregue') return <CheckCheck className="w-3.5 h-3.5 opacity-70" aria-label="Entregue" />;
  if (s === 'lida') return <CheckCheck className="w-3.5 h-3.5 text-sky-300" aria-label="Lida" />;
  return null;
};

/** Conversas do WhatsApp: lista por telefone à esquerda, mensagens e resposta à direita */
export const ConversasView: React.FC<Props> = ({ refreshToken, onVisto, pedido, onToast, onVoltarFila }) => {
  const [conversas, setConversas] = useState<ConversaResumo[] | null>(null);
  const [busca, setBusca] = useState('');
  const [aberta, setAberta] = useState<string | null>(null);
  const [conversa, setConversa] = useState<Awaited<ReturnType<typeof fetchConversa>> | null>(null);
  /** Cadastro rápido em Pessoas de um número sem cadastro */
  const [cadastrando, setCadastrando] = useState<{ telefone: string; nome: string } | null>(null);
  const [texto, setTexto] = useState('');
  const [enviando, setEnviando] = useState(false);
  /** Arquivo escolhido para enviar (o texto vira a legenda) */
  const [anexo, setAnexo] = useState<(ArquivoConversa & { tamanho: number }) | null>(null);
  /** Responder: a mensagem escolhida vai citada na próxima enviada (como no WhatsApp) */
  const [respondendo, setRespondendo] = useState<MensagemWhatsApp | null>(null);
  /** Número que envia, escolhido na tela; null = por onde o cliente escreveu por último */
  const [saiPor, setSaiPor] = useState<'provedor' | 'campanhas' | null>(null);
  useEffect(() => {
    setRespondendo(null);
    setSaiPor(null);
  }, [aberta]);
  /** Segundos de gravação do áudio em andamento; null = não está gravando */
  const [gravando, setGravando] = useState<number | null>(null);
  const [descartar, setDescartar] = useState<'anexo' | 'gravacao' | null>(null);
  /** Diálogo "Limpar a conversa" aberto (só administrador) */
  const [limpando, setLimpando] = useState(false);
  /** Diálogo "Descartar" aberto (conversa em Aguardando que não pedia atendimento) */
  const [descartandoConversa, setDescartandoConversa] = useState(false);
  const gravadorRef = useRef<{ rec: MediaRecorder; partes: Blob[]; enviar: boolean; timer: number } | null>(null);
  const arquivoRef = useRef<HTMLInputElement>(null);
  const campoRef = useRef<HTMLTextAreaElement>(null);
  const [erro, setErro] = useState<string | null>(null);
  /** Só as que eu atendo e as que aguardam (sem departamento ou no meu departamento) */
  const [minhas, setMinhas] = useState(false);
  /** Filtro da lista pelo estado do atendimento ('' = todas; vírgula = mais de um estado; campanhas = só as do número das campanhas) */
  const [filtroEstado, setFiltroEstado] = useState<'' | 'aguardando' | 'atendimento' | 'aguardando,atendimento' | 'encerrado' | 'campanhas'>('aguardando,atendimento');
  // A conversa aberta (ex.: vinda do negócio ou da atividade) fica na lista mesmo fora do filtro
  const visiveis = filtroEstado
    ? conversas?.filter((c) => c.telefone === aberta || (filtroEstado === 'campanhas' ? c.conta === 'campanhas' : filtroEstado.split(',').includes(c.estado ?? '')))
    : conversas;
  /** Transferir: destino escolhido ("u:ID" atendente, "d:ID" departamento); null = janela fechada */
  const [transferir, setTransferir] = useState<string | null>(null);
  const [destinos, setDestinos] = useState<{ usuarios: OpcaoRef[]; departamentos: OpcaoRef[] }>({ usuarios: [], departamentos: [] });
  useEffect(() => {
    Promise.all([fetchOptions('usuarios', 'nome'), fetchOptions('departamentos', 'nome')])
      .then(([usuarios, departamentos]) => setDestinos({ usuarios, departamentos }))
      .catch(() => {});
  }, []);
  /** Atividade que abriu a conversa: enviar a mensagem a conclui */
  const [atividade, setAtividade] = useState<{ id: number; assunto: string; telefone: string } | null>(null);
  /** Nome de quem ainda não tem conversa (vem da atividade) */
  const [nomePedido, setNomePedido] = useState<string | null>(null);
  /** Nova conversa: busca de pessoa/contato aberta, e o nome de quem foi escolhido (antes da 1ª mensagem) */
  const [novaAberta, setNovaAberta] = useState(false);
  const [escolhido, setEscolhido] = useState<{ telefone: string; nome: string } | null>(null);
  const fimRef = useRef<HTMLDivElement>(null);
  /** Caixa das mensagens: fica na última enquanto o atendente está no fim */
  const mensagensRef = useRef<HTMLDivElement>(null);
  const conversasRef = useRef(conversas);
  conversasRef.current = conversas;
  /** Quantas mensagens a conversa tinha: rola para o fim só quando chegam novas */
  const qtdRef = useRef(0);

  /** Conversas que eu atendo: uma aba cada, acima da conversa (como em Chamados Ativos) */
  const [minhasAbas, setMinhasAbas] = useState<ConversaResumo[]>([]);
  const eu = lerSessao()?.usuario.id;
  const carregarLista = useCallback(async () => {
    try {
      const [lista, minhasLista] = await Promise.all([fetchConversas(busca, minhas), fetchConversas('', true)]);
      setConversas(lista);
      setMinhasAbas(minhasLista.filter((c) => c.estado === 'atendimento' && Number(c.atendente_id) === Number(eu)));
    } catch (err: any) {
      setErro(err.message);
    }
  }, [busca, minhas, eu]);

  /** Conversas abertas que não são minhas (de outro ou aguardando): aba com X para fechar */
  const [extras, setExtras] = useState<string[]>([]);
  /** Último resumo visto de cada conversa: a aba continua com nome mesmo fora da lista filtrada */
  const resumos = useRef(new Map<string, ConversaResumo>());
  for (const c of [...(conversas ?? []), ...minhasAbas]) resumos.current.set(c.telefone, c);
  useEffect(() => {
    if (aberta && !minhasAbas.some((m) => m.telefone === aberta)) setExtras((ex) => (ex.includes(aberta) ? ex : [...ex, aberta]));
  }, [aberta, minhasAbas]);
  const fecharAba = (telefone: string) => {
    setExtras((ex) => ex.filter((x) => x !== telefone));
    if (aberta === telefone) setAberta(minhasAbas[0]?.telefone ?? null);
  };
  const abas = [
    ...minhasAbas.map((c) => ({ telefone: c.telefone, c: c as ConversaResumo | undefined, extra: false })),
    ...extras.filter((t) => !minhasAbas.some((m) => m.telefone === t)).map((t) => ({ telefone: t, c: resumos.current.get(t), extra: true })),
  ];

  // Clique na atividade WhatsApp da ficha do negócio: abre o número do cliente
  useEffect(() => {
    if (!pedido) return;
    if (pedido.telefone) {
      // O número pode vir numa forma diferente da conversa gravada (ex.: disparo com o 9, conversa sem): o servidor acha a dela
      const telefone = pedido.telefone;
      fetchNumeroConversa({ telefone })
        .then((r) => setAberta(r.telefone))
        .catch(() => setAberta(telefone));
      return;
    }
    if (!pedido.atividadeId) {
      fetchNumeroConversa({ pessoaId: pedido.pessoaId, contatoId: pedido.contatoId })
        .then((r) => {
          setEscolhido({ telefone: r.telefone, nome: r.nome });
          setAberta(r.telefone);
        })
        .catch((err) => setErro(err.message));
      return;
    }
    fetchConversaDaAtividade(pedido.atividadeId)
      .then((r) => {
        setAberta(r.telefone);
        setNomePedido(r.nome);
        setAtividade(r.atividade.concluida ? null : { id: r.atividade.id, assunto: r.atividade.assunto, telefone: r.telefone });
      })
      .catch((err) => setErro(err.message));
  }, [pedido?.seq]);

  // Lista: ao abrir, ao buscar (com uma pausa na digitação) e a cada 10 s
  useEffect(() => {
    const t = setTimeout(carregarLista, busca ? 300 : 0);
    const i = setInterval(() => !document.hidden && carregarLista(), 10_000);
    return () => {
      clearTimeout(t);
      clearInterval(i);
    };
  }, [carregarLista, refreshToken]);

  const carregarConversa = useCallback(
    async (telefone: string) => {
      try {
        const c = await fetchConversa(telefone);
        setConversa(c);
        // Abrir marca as recebidas como vistas: zera a etiqueta da conversa e a do menu
        if (conversasRef.current?.some((x) => x.telefone === telefone && x.nao_vistas)) {
          setConversas((lista) => lista?.map((x) => (x.telefone === telefone ? { ...x, nao_vistas: 0 } : x)) ?? lista);
          onVisto();
        }
      } catch (err: any) {
        setErro(err.message);
      }
    },
    [onVisto],
  );

  // Conversa aberta: ao abrir e a cada 5 s
  useEffect(() => {
    if (!aberta) return;
    setConversa(null);
    qtdRef.current = 0;
    carregarConversa(aberta);
    const i = setInterval(() => !document.hidden && carregarConversa(aberta), 5_000);
    return () => clearInterval(i);
  }, [aberta, carregarConversa, refreshToken]);

  useGrudarNoFim(mensagensRef, aberta && conversa ? aberta : null);

  // Mensagens novas: vai para o fim (a primeira carga também)
  useLayoutEffect(() => {
    const qtd = conversa?.mensagens.length ?? 0;
    if (qtd > qtdRef.current) fimRef.current?.scrollIntoView({ block: 'end' });
    qtdRef.current = qtd;
  }, [conversa]);

  /** Envia o texto, ou o arquivo com o texto como legenda (áudio vai sem legenda e não limpa o texto) */
  const enviar = async (arquivo: ArquivoConversa | null = anexo) => {
    const audio = arquivo?.tipo === 'audio';
    const t = audio ? '' : texto.trim();
    if (!aberta || (!t && !arquivo) || enviando) return;
    setEnviando(true);
    try {
      const vinculada = atividade?.telefone === aberta ? atividade : null;
      const r = await responderConversa(aberta, t, vinculada?.id, arquivo, respondendo?.id, conversa?.tem_campanhas ? numeroEnvio : 'provedor');
      setRespondendo(null);
      if (!audio) setTexto('');
      if (arquivo === anexo) setAnexo(null);
      if (vinculada) {
        setAtividade(null);
        if (r.atividade_concluida) onToast(`Atividade "${vinculada.assunto}" concluída.`);
      }
      // O WhatsApp pode guardar o número sem o 9: a conversa passa a ser a dele
      if (r.telefone && r.telefone !== aberta) setAberta(r.telefone);
      else await carregarConversa(aberta);
      await carregarLista();
    } catch (err: any) {
      setErro(err.message);
    } finally {
      setEnviando(false);
      // O campo fica desabilitado enquanto envia: devolve o cursor para continuar a conversa
      setTimeout(() => campoRef.current?.focus());
    }
  };

  const escolherArquivo = async (f: File | undefined) => {
    if (arquivoRef.current) arquivoRef.current.value = '';
    if (!f) return;
    if (f.size > MAX_ARQUIVO) return setErro(`Arquivo grande demais (${tamanhoLegivel(f.size)}); o máximo é 3 MB.`);
    try {
      const mimetype = f.type || 'application/octet-stream';
      setAnexo({ tipo: tipoDoArquivo(mimetype), base64: await paraBase64(f), mimetype, nome: f.name, tamanho: f.size });
    } catch (err: any) {
      setErro(`Não foi possível ler o arquivo: ${err?.message || err}`);
    }
  };

  /** Grava pelo microfone; ao parar com enviar = true, manda como mensagem de voz */
  const gravar = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const rec = new MediaRecorder(stream);
      const g = { rec, partes: [] as Blob[], enviar: false, timer: 0 };
      rec.ondataavailable = (e) => {
        if (e.data.size) g.partes.push(e.data);
      };
      rec.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        clearInterval(g.timer);
        gravadorRef.current = null;
        setGravando(null);
        if (!g.enviar) return;
        const mimetype = (rec.mimeType || 'audio/webm').split(';')[0];
        const blob = new Blob(g.partes, { type: mimetype });
        if (blob.size > MAX_ARQUIVO) return setErro('Áudio longo demais (máximo de 3 MB).');
        await enviar({ tipo: 'audio', base64: await paraBase64(blob), mimetype, nome: `audio.${mimetype.split('/')[1]}` });
      };
      rec.start();
      const inicio = Date.now();
      g.timer = window.setInterval(() => setGravando(Math.floor((Date.now() - inicio) / 1000)), 500);
      gravadorRef.current = g;
      setGravando(0);
    } catch (err: any) {
      setErro(err?.name === 'NotAllowedError' ? 'Permita o uso do microfone no navegador para gravar áudio.' : `Não foi possível gravar: ${err?.message || err}`);
    }
  };
  const pararGravacao = (enviarAudio: boolean) => {
    const g = gravadorRef.current;
    if (!g) return;
    g.enviar = enviarAudio;
    g.rec.stop();
  };
  // Trocar de conversa (ou sair da tela) descarta a gravação e o arquivo escolhido
  useEffect(
    () => () => {
      pararGravacao(false);
      setAnexo(null);
    },
    [aberta],
  );

  const resumoAberta = conversas?.find((c) => c.telefone === aberta);
  const nomeAberta =
    conversa?.pessoa?.nome ||
    conversa?.lead?.nome ||
    resumoAberta?.nome ||
    (atividade?.telefone === aberta ? nomePedido : null) ||
    (escolhido?.telefone === aberta ? escolhido.nome : null);
  /** O número é de um contato da pessoa: "João Silva (Compras)" */
  const contatoAberta = conversa?.contato
    ? `${conversa.contato.nome}${conversa.contato.departamento || conversa.contato.cargo ? ` (${conversa.contato.departamento || conversa.contato.cargo})` : ''}`
    : resumoAberta?.contato_nome
      ? `${resumoAberta.contato_nome}${resumoAberta.contato_setor ? ` (${resumoAberta.contato_setor})` : ''}`
      : null;
  /** Nome do perfil no WhatsApp, para quem não está em Pessoas */
  const perfilAberta = conversa?.nome_contato || resumoAberta?.nome_contato || null;

  const aoCadastrar = async (telefone: string) => {
    setCadastrando(null);
    onToast('Cadastrado e ligado à conversa.');
    // Abrir a conversa liga as mensagens à pessoa nova (pelo telefone)
    if (telefone === aberta) await carregarConversa(telefone);
    else setAberta(telefone);
    await carregarLista();
  };

  // Mensagens agrupadas por dia
  const dias: { dia: string; mensagens: MensagemWhatsApp[] }[] = [];
  for (const m of conversa?.mensagens ?? []) {
    const dia = m.data_hora.slice(0, 10);
    if (dias[dias.length - 1]?.dia !== dia) dias.push({ dia, mensagens: [] });
    dias[dias.length - 1].mensagens.push(m);
  }

  const linhas = Math.min(5, texto.split('\n').length);
  /** Em atendimento com outro usuário: só vê (administrador também); fecha pelo X da aba */
  const travada = conversa?.estado === 'atendimento' && !conversa.eu_atendo;
  // Última mensagem da conversa foi uma campanha (o cliente ainda não respondeu): o padrão é o número das campanhas,
  // o mesmo chat em que ele recebeu; senão, o número por onde ele escreveu
  const ultimaMsg = conversa?.mensagens.filter((m) => m.tipo !== 'evento' && m.tipo !== 'encerramento').at(-1);
  const numeroPadrao = ultimaMsg?.campanha ? 'campanhas' : (conversa?.conta ?? 'provedor');
  const numeroEnvio = saiPor ?? numeroPadrao;
  const podeMexer = Boolean(conversa) && !travada;
  /** Pode transferir: só quem está atendendo */
  const podeTransferir = conversa?.estado === 'atendimento' && conversa.eu_atendo;
  /** Ação de atendimento em andamento: os botões ficam desabilitados (sem clique repetido) */
  const [ocupadoAtendimento, setOcupadoAtendimento] = useState(false);
  /** Mensagem sendo marcada como privada (ou tornada pública) */
  const [privando, setPrivando] = useState<MensagemWhatsApp | null>(null);
  /** Mensagem a apagar para todos (diálogo de confirmação aberto) */
  const [apagando, setApagando] = useState<MensagemWhatsApp | null>(null);
  const [depPrivada, setDepPrivada] = useState('');
  const [departamentos, setDepartamentos] = useState<OpcaoRef[]>([]);
  useEffect(() => {
    if (privando && !privando.privada && conversa?.sou_admin && !departamentos.length) fetchOptions('departamentos', 'nome').then(setDepartamentos).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [privando]);
  const acaoAtendimento = async (fn: () => Promise<unknown>, aviso: string) => {
    if (!aberta || ocupadoAtendimento) return;
    setOcupadoAtendimento(true);
    try {
      await fn();
      onToast(aviso);
      await carregarConversa(aberta);
      await carregarLista();
    } catch (err: any) {
      setErro(err.message);
    } finally {
      setOcupadoAtendimento(false);
    }
  };

  const dialogoApagar = apagando && (
    <ConfirmDialog
      titulo="Apagar a mensagem para todos?"
      mensagem='Ela some do WhatsApp do cliente, que passa a ver "Mensagem apagada". Só dá para apagar até 1 minuto depois do envio.'
      confirmar="Apagar"
      onConfirmar={async () => {
        try {
          await apagarMensagem(apagando.id);
          onToast('Mensagem apagada.');
        } catch (err: any) {
          onToast(err.message);
        }
        setApagando(null);
        if (aberta) await carregarConversa(aberta);
      }}
      onCancelar={() => setApagando(null)}
    />
  );

  const dialogoPrivada = privando && (
    <ConfirmDialog
      titulo={privando.privada ? 'Tornar a mensagem pública?' : 'Tornar a mensagem privada?'}
      mensagem={
        privando.privada
          ? `Hoje só ${privando.privada.departamento} (e o administrador) vê esta mensagem. Pública, todos que acessam a conversa veem.`
          : conversa?.sou_admin
            ? 'Só o departamento escolhido (e o administrador) vai ver o conteúdo; os outros veem "mensagem privada".'
            : 'Só o seu departamento (e o administrador) vai ver o conteúdo; os outros veem "mensagem privada".'
      }
      confirmar={privando.privada ? 'Tornar pública' : 'Tornar privada'}
      tom="normal"
      onConfirmar={async () => {
        await marcarMensagemPrivada(privando.id, !privando.privada, depPrivada || null);
        setPrivando(null);
        setDepPrivada('');
        onToast(privando.privada ? 'Mensagem pública.' : 'Mensagem privada.');
        if (aberta) await carregarConversa(aberta);
      }}
      onCancelar={() => {
        setPrivando(null);
        setDepPrivada('');
      }}
    >
      {!privando.privada && conversa?.sou_admin && (
        <div className={FIELD_CLASS}>
          <label htmlFor="privada-dep" className={LABEL_CLASS}>Departamento</label>
          <SelectBusca id="privada-dep" value={depPrivada} options={departamentos} onChange={setDepPrivada} vazioLabel="— O meu —" className={`${INPUT_CLASS} w-full`} />
        </div>
      )}
    </ConfirmDialog>
  );

  return (
    <div className="flex-1 min-h-0 flex bg-white dark:bg-stone-900">
      {dialogoPrivada}
      {dialogoApagar}
      {/* Lista de conversas */}
      <aside className={`${aberta ? 'hidden lg:flex' : 'flex'} w-full lg:w-88 shrink-0 flex-col min-h-0 border-r border-stone-200 dark:border-stone-800`}>
        {/* Busca e filtros num bloco só, com uma linha embaixo (como em Chamados Ativos) */}
        <div className="px-3 pt-3 flex items-stretch gap-2">
          <div className="relative flex-1 min-w-0">
            <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-stone-400 pointer-events-none" />
            <input
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              onFocus={(e) => e.target.select()}
              placeholder="Buscar por nome ou telefone"
              className={`${INPUT_CLASS} w-full pl-8`}
            />
          </div>
          <button
            onClick={() => setNovaAberta(true)}
            title="Nova conversa com uma pessoa, um contato ou um número"
            className="shrink-0 flex items-center gap-1.5 px-3 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold cursor-pointer"
          >
            <MessageSquarePlus className="w-4 h-4" />
            <span className="hidden sm:inline">Nova</span>
          </button>
        </div>
        {/* Filtros só com ícone numa linha (como em Chamados Ativos); o nome fica no tooltip */}
        <div className="px-3 pt-2 pb-3 border-b border-stone-200 dark:border-stone-800 flex items-center gap-1">
          <button
            type="button"
            onClick={() => setMinhas(!minhas)}
            title="Só as minhas: as conversas sem departamento, as do seu departamento e as que você assumiu"
            aria-label="Só as minhas"
            aria-pressed={minhas}
            className={`flex-1 flex items-center justify-center py-1.5 rounded-md cursor-pointer ${
              minhas ? 'bg-blue-600 text-white' : 'bg-stone-100 text-stone-600 hover:bg-stone-200 dark:bg-stone-800 dark:text-stone-300'
            }`}
          >
            <User className="w-4 h-4" />
          </button>
          {(
            [
              ['', 'Todas', Layers],
              ['aguardando,atendimento', 'Aguardando + Em atendimento', Inbox],
              ['aguardando', 'Aguardando', Clock],
              ['atendimento', 'Em atendimento', Headset],
              ['encerrado', 'Encerradas', CircleCheck],
              ['campanhas', 'Só Campanhas (WhatsApp das campanhas)', Megaphone],
            ] as const
          ).map(([valor, nome, Icone]) => (
            <button
              key={valor || 'todas'}
              type="button"
              onClick={() => setFiltroEstado(valor)}
              title={nome}
              aria-label={nome}
              aria-pressed={filtroEstado === valor}
              className={`flex-1 flex items-center justify-center py-1.5 rounded-md cursor-pointer ${
                filtroEstado === valor ? 'bg-blue-600 text-white' : 'bg-stone-100 text-stone-600 hover:bg-stone-200 dark:bg-stone-800 dark:text-stone-300'
              }`}
            >
              <Icone className="w-4 h-4" />
            </button>
          ))}
        </div>
        <div className="flex-1 overflow-y-auto">
          {conversas === null ? (
            <div className="p-6 flex justify-center">
              <Loader2 className="w-4 h-4 animate-spin text-stone-400" />
            </div>
          ) : !visiveis!.length ? (
            <div className="p-6 text-xs text-center text-stone-500 dark:text-stone-400">
              {busca || filtroEstado ? 'Nenhuma conversa encontrada.' : 'Nenhuma conversa ainda. As mensagens recebidas aparecem aqui.'}
            </div>
          ) : (
            visiveis!.map((c) => {
              const dia = c.data_hora.slice(0, 10);
              const ativa = c.telefone === aberta;
              return (
                <button
                  key={c.telefone}
                  onClick={() => setAberta(c.telefone)}
                  className={`w-full text-left px-3 py-2.5 flex gap-3 items-center border-b border-stone-100 dark:border-stone-800/70 cursor-pointer transition-colors ${
                    ativa ? 'bg-blue-50 dark:bg-blue-950/40' : 'hover:bg-stone-50 dark:hover:bg-stone-800/50'
                  } ${
                    // Em atendimento: barra azul de 3 px na borda esquerda (sombra interna: o conteúdo não se desloca)
                    c.estado === 'atendimento' ? 'shadow-[inset_3px_0_0_#2563eb]' : ''
                  }`}
                >
                  {c.nome ? (
                    <div className="w-9 h-9 rounded-full bg-blue-50 dark:bg-blue-950/50 text-blue-700 dark:text-blue-300 flex items-center justify-center shrink-0 font-semibold text-xs">
                      {(c.contato_nome || c.nome).charAt(0).toUpperCase()}
                    </div>
                  ) : (
                    <span
                      role="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setCadastrando({ telefone: c.telefone, nome: c.nome_contato || '' });
                      }}
                      title="Não cadastrado: cadastrar em Pessoas"
                      className="w-9 h-9 rounded-full border border-dashed border-stone-300 dark:border-stone-600 text-stone-400 hover:text-blue-600 hover:border-blue-400 dark:hover:text-blue-400 flex items-center justify-center shrink-0 cursor-pointer"
                    >
                      <UserPlus className="w-4 h-4" />
                    </span>
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="min-w-0 truncate">
                        <span className={`text-xs ${c.nao_vistas ? 'font-bold text-stone-900 dark:text-white' : 'font-semibold text-stone-800 dark:text-stone-100'}`}>
                          {c.contato_nome || c.nome || c.nome_contato || formatarTelefoneWa(c.telefone)}
                        </span>
                        {c.contato_nome && (
                          <span className="ml-1.5 text-[10px] text-stone-500 dark:text-stone-400">
                            {c.contato_setor ? `${c.contato_setor} · ` : ''}
                            {c.nome}
                          </span>
                        )}
                        {!c.contato_nome && (c.nome || c.nome_contato) && <span className="ml-1.5 text-[10px] text-stone-400">{formatarTelefoneWa(c.telefone)}</span>}
                        {!c.nome && <span className="ml-1.5 text-[10px] italic text-amber-600 dark:text-amber-400">não cadastrado</span>}
                      </span>
                      <span className={`text-[10px] shrink-0 ${c.nao_vistas ? 'text-emerald-600 dark:text-emerald-400 font-semibold' : 'text-stone-400'}`}>
                        {dia === hojeIso() ? c.data_hora.slice(11, 16) : dataBr(dia).slice(0, 5)}
                      </span>
                    </div>
                    {/* Prévia ocupa o espaço livre; as etiquetas ficam juntas à direita */}
                    <div className="flex items-center gap-1.5 mt-0.5">
                      <span className="flex-1 min-w-0 text-[11px] text-stone-500 dark:text-stone-400 truncate">
                        {c.direcao === 'enviada' && 'Você: '}
                        {resumo(c)}
                      </span>
                      {(c.estado === 'aguardando' || c.estado === 'atendimento') && c.chegou_em && (
                        <span title={`Cliente chegou em ${formatDateTimeBR(c.chegou_em)}`} className="shrink-0 text-[10px] text-stone-500 dark:text-stone-400">
                          chegou {horaChegada(c.chegou_em)}
                        </span>
                      )}
                      {c.estado === 'aguardando' && (
                        <span
                          title={`Aguardando alguém atender${c.aguardando_desde ? ` ${haQuanto(c.aguardando_desde)}` : ''}`}
                          className="shrink-0 text-[10px] font-semibold px-1.5 rounded bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300"
                        >
                          Aguardando
                        </span>
                      )}
                      {c.pausada && (
                        <span
                          title="Pausada por quem atendia: voltou para a fila"
                          className="shrink-0 text-[10px] font-semibold px-1.5 rounded bg-orange-50 text-orange-700 dark:bg-orange-950/40 dark:text-orange-300"
                        >
                          Pausado
                        </span>
                      )}
                      {c.conta === 'campanhas' && (
                        <span
                          title="Entrou pelo WhatsApp das campanhas: as respostas saem por esse número"
                          className="shrink-0 text-[10px] font-semibold px-1.5 rounded bg-fuchsia-50 text-fuchsia-700 dark:bg-fuchsia-950/40 dark:text-fuchsia-300"
                        >
                          WhatsApp Campanha
                        </span>
                      )}
                      {c.estado === 'encerrado' && (
                        <span
                          title="Atendimento encerrado: a próxima mensagem do cliente começa um novo atendimento"
                          className="shrink-0 text-[10px] font-semibold px-1.5 rounded bg-stone-100 text-stone-600 dark:bg-stone-800 dark:text-stone-300"
                        >
                          Encerrado
                        </span>
                      )}
                      {c.estado !== 'atendimento' && c.estado !== 'encerrado' && c.tecnico_padrao_nome && (
                        <span
                          title="Técnico padrão do cliente: quem deve atender (outro pode assumir)"
                          className="shrink-0 flex items-center gap-0.5 text-[10px] font-semibold px-1.5 rounded bg-violet-50 text-violet-700 dark:bg-violet-950/40 dark:text-violet-300"
                        >
                          <User className="w-2.5 h-2.5" />
                          {c.tecnico_padrao_nome}
                        </span>
                      )}
                      {c.estado === 'atendimento' && (
                        <span
                          title={`Em atendimento com ${c.atendente_nome}${c.atendido_em ? ` desde ${c.atendido_em.slice(11, 16)}` : ''}`}
                          className="shrink-0 flex items-center gap-0.5 text-[10px] font-semibold px-1.5 rounded bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300"
                        >
                          <User className="w-2.5 h-2.5" />
                          {c.atendente_nome}
                          {c.atendido_em && ` · ${c.atendido_em.slice(11, 16)}`}
                        </span>
                      )}
                      {c.departamento && (
                        <span className="shrink-0 text-[10px] font-semibold px-1.5 rounded bg-sky-50 text-sky-700 dark:bg-sky-950/40 dark:text-sky-300">{c.departamento}</span>
                      )}
                      {c.nao_vistas > 0 && (
                        <span className="text-[10px] font-bold leading-4 h-4 min-w-4 px-1 rounded-full bg-emerald-500 text-white text-center shrink-0">
                          {c.nao_vistas > 99 ? '99+' : c.nao_vistas}
                        </span>
                      )}
                    </div>
                  </div>
                </button>
              );
            })
          )}
        </div>
        <TecnicosAgora />
      </aside>

      {/* Conversa aberta */}
      <section className={`${aberta ? 'flex' : 'hidden lg:flex'} flex-1 min-w-0 flex-col min-h-0`}>
        {abas.length > 0 && (
          <div role="tablist" className="shrink-0 flex overflow-x-auto border-b border-stone-200 dark:border-stone-800 bg-stone-100 dark:bg-stone-900">
            {abas.map(({ telefone, c, extra }) => (
              <div
                key={telefone}
                className={`shrink-0 max-w-[220px] flex items-start border-r border-b-2 border-r-stone-200 dark:border-r-stone-800 ${
                  aberta === telefone
                    ? 'bg-white dark:bg-stone-950 border-b-blue-600 dark:border-b-blue-400'
                    : 'border-b-transparent text-stone-500 dark:text-stone-400 hover:bg-stone-200 dark:hover:bg-stone-800'
                }`}
              >
                <button type="button" role="tab" aria-selected={aberta === telefone} onClick={() => setAberta(telefone)} className="min-w-0 flex-1 px-3 py-1.5 text-left text-[11px] cursor-pointer">
                  <span className="flex items-center gap-1.5">
                    <span className="font-mono text-stone-400 truncate">{formatarTelefoneWa(telefone)}</span>
                    {c?.chegou_em && <span title="Cliente chegou">{horaChegada(c.chegou_em)}</span>}
                    {!!c?.nao_vistas && <span className="text-[10px] font-bold leading-4 h-4 min-w-4 px-1 rounded-full bg-emerald-500 text-white text-center shrink-0">{c.nao_vistas > 99 ? '99+' : c.nao_vistas}</span>}
                  </span>
                  <span className="block font-bold text-stone-800 dark:text-stone-100 truncate">{c ? c.contato_nome || c.nome || c.nome_contato || 'Conversa' : 'Conversa'}</span>
                </button>
                {/* Só a aba da conversa que não é minha fecha; as minhas ficam até encerrar ou passar adiante */}
                {extra && (
                  <button type="button" onClick={() => fecharAba(telefone)} title="Fechar esta aba" className="mt-1 mr-1 p-0.5 rounded text-stone-400 hover:text-stone-700 hover:bg-stone-200 dark:hover:bg-stone-700 dark:hover:text-stone-200 cursor-pointer">
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
        {erro && (
          <div className="p-3">
            <AvisoErro mensagem={erro} onFechar={() => setErro(null)} />
          </div>
        )}
        {!aberta ? (
          <div className="flex-1 flex flex-col items-center justify-center gap-2 text-stone-400 bg-stone-50 dark:bg-stone-950/60">
            <MessageCircle className="w-8 h-8" />
            <span className="text-xs">Escolha uma conversa</span>
          </div>
        ) : (
          <>
            <header className="h-14 shrink-0 px-3 flex items-center gap-3 border-b border-stone-200 dark:border-stone-800">
              <button
                onClick={() => setAberta(null)}
                title="Voltar para a lista"
                className="lg:hidden p-1.5 rounded-lg text-stone-500 hover:bg-stone-100 dark:hover:bg-stone-800 cursor-pointer"
              >
                <ArrowLeft className="w-4 h-4" />
              </button>
              <div className="min-w-0 flex-1">
                <div className="text-sm font-semibold text-stone-900 dark:text-white truncate">{contatoAberta || nomeAberta || perfilAberta || formatarTelefoneWa(aberta)}</div>
                <div className="text-[11px] text-stone-500 dark:text-stone-400 truncate">
                  {contatoAberta && nomeAberta && <span className="font-semibold text-stone-600 dark:text-stone-300">{nomeAberta} · </span>}
                  {nomeAberta || perfilAberta ? formatarTelefoneWa(aberta) : ''}
                  {!nomeAberta && (
                    <span className="italic text-amber-600 dark:text-amber-400">{perfilAberta ? ' · ' : ''}não cadastrado</span>
                  )}
                  {conversa?.lead && <span className="italic text-amber-600 dark:text-amber-400"> · lead</span>}
                </div>
              </div>
              {conversa?.departamento && (
                <span
                  title="Departamento escolhido no menu do chatbot"
                  className="hidden sm:flex shrink-0 items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full bg-sky-50 text-sky-700 dark:bg-sky-950/40 dark:text-sky-300"
                >
                  <Network className="w-3.5 h-3.5" />
                  {conversa.departamento}
                </span>
              )}
              {conversa && (
                <div className="shrink-0 flex items-center gap-2">
                  {conversa.estado === 'bot' && (
                    <span className="hidden sm:flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full bg-violet-50 text-violet-700 dark:bg-violet-950/40 dark:text-violet-300">
                      <Bot className="w-3.5 h-3.5" />
                      {conversa.bot_nome || 'Bot'} atendendo
                    </span>
                  )}
                  {conversa.estado === 'encerrado' && (
                    <span
                      title="Atendimento encerrado: a próxima mensagem do cliente começa um novo atendimento"
                      className="hidden sm:flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full bg-stone-100 text-stone-600 dark:bg-stone-800 dark:text-stone-300"
                    >
                      <CircleCheck className="w-3.5 h-3.5" />
                      Encerrado
                    </span>
                  )}
                  {conversa.estado === 'aguardando' && (
                    <span className="hidden sm:flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300">
                      <Clock className="w-3.5 h-3.5" />
                      Aguardando atendimento{conversa.aguardando_desde ? ` · ${haQuanto(conversa.aguardando_desde)}` : ''}
                    </span>
                  )}
                  {conversa.estado === 'atendimento' && (
                    <span
                      title={conversa.eu_atendo ? 'Só você responde esta conversa' : `Só ${conversa.atendente?.nome} responde esta conversa`}
                      className="hidden sm:flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300"
                    >
                      {conversa.eu_atendo ? <User className="w-3.5 h-3.5" /> : <Lock className="w-3.5 h-3.5" />}
                      {conversa.eu_atendo ? 'Você' : conversa.atendente?.nome} · desde {conversa.atendido_em?.slice(11, 16)}
                    </span>
                  )}
                  {conversa.estado !== 'atendimento' && (
                    <button
                      disabled={ocupadoAtendimento}
                      onClick={() =>
                        acaoAtendimento(() => atenderConversa(aberta), 'Você está atendendo: só você responde esta conversa.')
                      }
                      title="Pegar a conversa: o bot para e só você responde"
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-blue-600 hover:bg-blue-700 text-white cursor-pointer disabled:opacity-50 disabled:cursor-default"
                    >
                      <Hand className="w-4 h-4" />
                      Atender
                    </button>
                  )}
                  {/* Pela lista: ela já sabe quando a conversa foi encerrada e o cliente não escreveu de novo */}
                  {resumoAberta?.estado === 'aguardando' && (
                    <button
                      disabled={ocupadoAtendimento}
                      onClick={() => setDescartandoConversa(true)}
                      title="Não é um pedido de atendimento (ex.: o bot de outra empresa respondendo): tira da fila sem atender, sem pesquisa"
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-stone-700 dark:text-stone-200 border border-stone-300 dark:border-stone-700 hover:bg-stone-100 dark:hover:bg-stone-800 cursor-pointer disabled:opacity-50 disabled:cursor-default"
                    >
                      <CircleSlash className="w-4 h-4" />
                      Descartar
                    </button>
                  )}
                  {podeTransferir && (
                    <button
                      disabled={ocupadoAtendimento}
                      onClick={() =>
                        acaoAtendimento(async () => {
                          await pausarConversa(aberta);
                          onVoltarFila?.();
                        }, 'Conversa pausada: voltou para a Fila de Chamados.')
                      }
                      title="Devolve a conversa para a Fila de Chamados: qualquer um pode atender (o bot não volta)"
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-stone-700 dark:text-stone-200 border border-stone-300 dark:border-stone-700 hover:bg-stone-100 dark:hover:bg-stone-800 cursor-pointer disabled:opacity-50 disabled:cursor-default"
                    >
                      <Pause className="w-4 h-4" />
                      Pausar
                    </button>
                  )}
                  {podeTransferir && (
                    <button onClick={() => setTransferir('')} disabled={ocupadoAtendimento} title="Passar para outro atendente ou para um departamento" className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-stone-700 dark:text-stone-200 border border-stone-300 dark:border-stone-700 hover:bg-stone-100 dark:hover:bg-stone-800 cursor-pointer disabled:opacity-50 disabled:cursor-default">
                      <ArrowRightLeft className="w-4 h-4" />
                      Transferir
                    </button>
                  )}
                  {podeMexer && conversa.com_bot && conversa.estado !== 'bot' && conversa.estado !== 'encerrado' && (
                    <button
                      disabled={ocupadoAtendimento}
                      onClick={() => acaoAtendimento(() => mudarAtendimentoConversa(aberta, 'bot'), 'Conversa devolvida ao bot.')}
                      title="O bot volta a responder esta conversa (mesma sessão)"
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-stone-700 dark:text-stone-200 border border-stone-300 dark:border-stone-700 hover:bg-stone-100 dark:hover:bg-stone-800 cursor-pointer disabled:opacity-50 disabled:cursor-default"
                    >
                      <Bot className="w-4 h-4" />
                      Devolver ao bot
                    </button>
                  )}
                  {podeMexer && conversa.encerravel && (
                    <button
                      disabled={ocupadoAtendimento}
                      onClick={() => acaoAtendimento(() => encerrarConversa(aberta), 'Atendimento encerrado: a próxima mensagem do cliente começa um atendimento novo.')}
                      title="Encerra esta sessão: sai do departamento e a próxima mensagem do cliente recomeça pela automação"
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-stone-700 dark:text-stone-200 border border-stone-300 dark:border-stone-700 hover:bg-stone-100 dark:hover:bg-stone-800 cursor-pointer disabled:opacity-50 disabled:cursor-default"
                    >
                      <CircleCheck className="w-4 h-4" />
                      Encerrar
                    </button>
                  )}
                  {conversa.sou_admin && !travada && (
                    <button
                      onClick={() => setLimpando(true)}
                      title="Limpar a conversa: apaga todas as mensagens deste número no CRM (só administrador)"
                      aria-label="Limpar a conversa"
                      className="flex items-center justify-center px-2 py-1.5 rounded-lg text-rose-600 dark:text-rose-400 border border-rose-200 dark:border-rose-900 hover:bg-rose-50 dark:hover:bg-rose-950/40 cursor-pointer"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}
                </div>
              )}
              {conversa && !nomeAberta && (
                <button
                  onClick={() => setCadastrando({ telefone: aberta, nome: perfilAberta || '' })}
                  title="Cadastrar este número como lead ou como contato de uma pessoa"
                  className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-900 hover:bg-blue-50 dark:hover:bg-blue-950/40 cursor-pointer"
                >
                  <UserPlus className="w-4 h-4" />
                  Cadastrar
                </button>
              )}
            </header>

            <div ref={mensagensRef} className="flex-1 overflow-y-auto px-3 sm:px-6 py-4 bg-stone-100 dark:bg-stone-950">
              {!conversa ? (
                <div className="flex justify-center py-6">
                  <Loader2 className="w-4 h-4 animate-spin text-stone-400" />
                </div>
              ) : (
                dias.map(({ dia, mensagens }) => (
                  <div key={dia}>
                    <div className="flex justify-center my-3">
                      <span className="text-[10px] font-semibold uppercase tracking-wide px-2.5 py-1 rounded-full bg-white dark:bg-stone-800 text-stone-500 dark:text-stone-400 shadow-xs">
                        {rotuloDia(dia)}
                      </span>
                    </div>
                    {mensagens.map((m) => {
                      const minha = m.direcao === 'enviada';
                      const origem = minha ? (m.bot ? (conversa.bot_nome ? `${conversa.bot_nome} (bot)` : 'Bot') : m.campanha ? 'Campanha' : m.automatica ? 'Automática' : m.usuario_nome) : null;
                      // Evento do atendimento (começou, transferiu, liberado pelo tempo): linha discreta
                      if (m.tipo === 'evento') {
                        // Falha da automação (server/chatbot.ts, avisarFalha): em vermelho, para o técnico ver
                        const falha = m.texto?.startsWith('Automação falhou');
                        return (
                          <div
                            key={m.id}
                            className={`flex items-center gap-3 my-2 text-[10px] ${falha ? 'font-semibold text-rose-600 dark:text-rose-400' : 'text-stone-400 dark:text-stone-500'}`}
                          >
                            <span className="flex-1 border-t border-dashed border-stone-200 dark:border-stone-800" />
                            <span className="shrink-0">
                              {m.texto} · {diaHora(m.data_hora)}
                            </span>
                            <span className="flex-1 border-t border-dashed border-stone-200 dark:border-stone-800" />
                          </div>
                        );
                      }
                      // Marcador do botão Encerrar: linha horizontal (não foi para o cliente)
                      if (m.tipo === 'encerramento') {
                        return (
                          <div key={m.id} className="flex items-center gap-3 my-3 text-[11px] font-semibold text-stone-500 dark:text-stone-400">
                            <span className="flex-1 border-t border-stone-300 dark:border-stone-700" />
                            <span className="flex items-center gap-1.5 shrink-0">
                              <CircleCheck className="w-3.5 h-3.5" />
                              {m.texto || 'Atendimento encerrado'}
                              {m.usuario_nome ? ` por ${m.usuario_nome}` : ''} · {diaHora(m.data_hora)}
                            </span>
                            <span className="flex-1 border-t border-stone-300 dark:border-stone-700" />
                          </div>
                        );
                      }
                      // Resposta do bot reservada e ainda sendo escrita (a IA pensa, "digitando..." no WhatsApp)
                      if (minha && m.situacao === 'pendente' && !m.texto && m.tipo === 'texto') {
                        return (
                          <div key={m.id} className="flex mb-1.5 justify-end">
                            <div title="O bot está escrevendo a resposta" className="rounded-2xl rounded-br-md px-3 py-1.5 bg-blue-600/70 text-white shadow-xs">
                              <div className="text-[10px] font-semibold mb-0.5 text-blue-100">{origem}</div>
                              <div className="flex items-center gap-1 h-4 italic text-xs text-blue-100">
                                digitando
                                <span className="flex gap-0.5">
                                  {[0, 150, 300].map((d) => (
                                    <span key={d} className="w-1 h-1 rounded-full bg-white animate-bounce" style={{ animationDelay: `${d}ms` }} />
                                  ))}
                                </span>
                              </div>
                            </div>
                          </div>
                        );
                      }
                      // Privada de outro departamento: só o aviso, sem o conteúdo
                      if (m.privada?.oculta) {
                        return (
                          <div key={m.id} className={`flex mb-1.5 ${minha ? 'justify-end' : 'justify-start'}`}>
                            <div className="max-w-[85%] sm:max-w-[70%] rounded-2xl px-3 py-1.5 text-xs italic bg-stone-200 dark:bg-stone-800 text-stone-500 dark:text-stone-400 flex items-center gap-1.5">
                              <Lock className="w-3.5 h-3.5 shrink-0" />
                              Mensagem privada de {m.privada.departamento} · {diaHora(m.data_hora)}
                            </div>
                          </div>
                        );
                      }
                      return (
                        <div
                          key={m.id}
                          id={`msg-${m.id}`}
                          title={m.erro ? `Não enviada: ${m.erro}` : undefined}
                          className={`group flex mb-1.5 ${minha ? 'justify-end' : 'justify-start'}`}
                        >
                          <div
                            className={`max-w-[85%] sm:max-w-[70%] rounded-2xl px-3 py-1.5 text-[13px] leading-snug shadow-xs ${
                              minha
                                ? 'bg-blue-600 text-white rounded-br-md'
                                : 'bg-white dark:bg-stone-800 text-stone-800 dark:text-stone-100 rounded-bl-md'
                            }`}
                          >
                            {origem && <div className={`text-[10px] font-semibold mb-0.5 ${minha ? 'text-blue-100' : ''}`}>{origem}</div>}
                            {m.resposta && (
                              <button
                                type="button"
                                onClick={() => document.getElementById(`msg-${m.resposta!.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })}
                                title="Ir para a mensagem respondida"
                                className={`block w-full text-left mb-1 px-2 py-1 rounded-md border-l-4 text-[11px] cursor-pointer ${
                                  minha ? 'bg-blue-700/60 border-blue-200 text-blue-50' : 'bg-stone-100 dark:bg-stone-700/60 border-emerald-500 text-stone-600 dark:text-stone-300'
                                }`}
                              >
                                <span className="block font-semibold">{m.resposta.direcao === 'recebida' ? nomeAberta || perfilAberta || 'Cliente' : 'Você'}</span>
                                <span className="block line-clamp-2 break-words">{citado(m.resposta)}</span>
                              </button>
                            )}
                            {MIDIA.includes(m.tipo) && <MidiaMensagem id={m.id} tipo={m.tipo} />}
                            {m.tipo !== 'texto' && !MIDIA.includes(m.tipo) && (
                              <div className={`flex items-center gap-1.5 italic text-xs mb-0.5 ${minha ? 'text-blue-100' : 'text-stone-500 dark:text-stone-400'}`}>
                                {m.tipo === 'documento' ? <Documento id={m.id} nome={m.arquivo_nome} /> : TIPOS[m.tipo] || m.tipo}
                              </div>
                            )}
                            {m.texto && <div className="whitespace-pre-wrap break-words">{m.texto}</div>}
                            <div className={`flex items-center justify-end gap-1 mt-0.5 text-[10px] ${minha ? 'text-blue-100' : 'text-stone-400'}`}>
                              {!travada && m.situacao !== 'falhou' && m.situacao !== 'pendente' && m.tipo !== 'apagada' && (
                                <button
                                  type="button"
                                  onClick={() => {
                                    setRespondendo(m);
                                    setTimeout(() => campoRef.current?.focus());
                                  }}
                                  title="Responder esta mensagem (o cliente vê qual mensagem você está respondendo)"
                                  className="flex items-center gap-0.5 cursor-pointer opacity-0 group-hover:opacity-100"
                                >
                                  <Reply className="w-3 h-3" />
                                  Responder
                                </button>
                              )}
                              {Boolean(m.apagar_seg) && (
                                <button
                                  type="button"
                                  onClick={() => setApagando(m)}
                                  title={`Apagar para todos (ainda ${m.apagar_seg} s)`}
                                  className="flex items-center gap-0.5 cursor-pointer opacity-0 group-hover:opacity-100"
                                >
                                  <Trash2 className="w-3 h-3" />
                                  Apagar
                                </button>
                              )}
                              <button
                                type="button"
                                onClick={() => setPrivando(m)}
                                title={m.privada ? `Privada de ${m.privada.departamento}: clique para tornar pública` : 'Tornar privada (só um departamento vê)'}
                                className={`flex items-center gap-0.5 cursor-pointer ${m.privada ? 'font-semibold' : 'opacity-0 group-hover:opacity-100'}`}
                              >
                                {m.privada ? <Lock className="w-3 h-3" /> : <LockOpen className="w-3 h-3" />}
                                {m.privada && m.privada.departamento}
                              </button>
                              {diaHora(m.data_hora)}
                              {minha && <Situacao s={m.situacao} />}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ))
              )}
              <div ref={fimRef} />
            </div>

            {atividade?.telefone === aberta && (
              <div className="shrink-0 px-3 py-2 border-t border-emerald-200 dark:border-emerald-900 bg-emerald-50 dark:bg-emerald-950/40 flex items-center justify-between gap-3 text-xs text-emerald-800 dark:text-emerald-300">
                <span className="min-w-0 truncate">
                  Atividade <b>{atividade.assunto}</b>: enviar a mensagem conclui a atividade.
                </span>
                <button
                  onClick={() => setAtividade(null)}
                  title="Conversar sem concluir a atividade"
                  className="shrink-0 font-semibold hover:underline cursor-pointer"
                >
                  Não concluir
                </button>
              </div>
            )}
            {travada ? (
              <div className="shrink-0 p-3 border-t border-stone-200 dark:border-stone-800 flex items-center gap-2 text-xs text-stone-600 dark:text-stone-300 bg-stone-50 dark:bg-stone-900">
                <Lock className="w-4 h-4 shrink-0 text-stone-400" />
                Em atendimento com <b>{conversa?.atendente?.nome}</b> desde {conversa?.atendido_em?.slice(11, 16)}: você só pode ver.
                {abas.some((a) => a.extra && a.telefone === aberta) && ' Feche pelo X da aba.'}
              </div>
            ) : (
            <>
            {conversa && conversa.estado !== 'atendimento' && (
              <div className="shrink-0 px-3 pt-2 text-[11px] text-stone-500 dark:text-stone-400">
                Ao responder, você passa a atender esta conversa (o bot para e só você responde).
              </div>
            )}
            {conversa?.tem_campanhas && (
              <div className="shrink-0 px-3 py-2 flex flex-wrap items-center gap-2 text-[11px] text-stone-500 dark:text-stone-400">
                <label htmlFor="cv-sai-por" className="font-semibold">Sai pelo</label>
                <SelectAuto
                  id="cv-sai-por"
                  value={numeroEnvio}
                  onChange={(e) => setSaiPor(e.target.value as 'provedor' | 'campanhas')}
                  title="Número do WhatsApp por onde a mensagem sai"
                  className="h-6 px-1.5 rounded border border-stone-300 dark:border-stone-700 bg-white dark:bg-stone-900 text-[11px] text-stone-700 dark:text-stone-200 cursor-pointer"
                >
                  <option value="provedor">WhatsApp principal</option>
                  <option value="campanhas">WhatsApp das campanhas</option>
                </SelectAuto>
                {numeroEnvio !== numeroPadrao && (
                  <span className="text-amber-700 dark:text-amber-400">
                    {ultimaMsg?.campanha ? 'A campanha chegou' : 'O cliente escreveu'} pelo {numeroPadrao === 'campanhas' ? 'número das campanhas' : 'número principal'}: no celular dele, esta mensagem cai em outro chat.
                  </span>
                )}
              </div>
            )}
            {respondendo && (
              <div className="shrink-0 mx-3 mt-2 flex items-center gap-2 px-3 py-2 rounded-lg border-l-4 border-emerald-500 bg-stone-100 dark:bg-stone-800 text-xs text-stone-700 dark:text-stone-200">
                <Reply className="w-4 h-4 shrink-0 text-emerald-600" />
                <span className="min-w-0">
                  <span className="block font-semibold">
                    Respondendo a {respondendo.direcao === 'recebida' ? nomeAberta || perfilAberta || 'Cliente' : 'você'}
                  </span>
                  <span className="block truncate text-stone-500 dark:text-stone-400">{citado(respondendo)}</span>
                </span>
                <button onClick={() => setRespondendo(null)} title="Não responder esta mensagem (Esc)" className="ml-auto shrink-0 text-stone-400 hover:text-red-600 cursor-pointer">
                  <X className="w-4 h-4" />
                </button>
              </div>
            )}
            {anexo && (
              <div className="shrink-0 mx-3 mt-2 flex items-center gap-2 px-3 py-2 rounded-lg bg-stone-100 dark:bg-stone-800 text-xs text-stone-700 dark:text-stone-200">
                {anexo.tipo === 'audio' ? <Mic className="w-4 h-4 shrink-0" /> : anexo.tipo === 'documento' ? <FileText className="w-4 h-4 shrink-0" /> : <Paperclip className="w-4 h-4 shrink-0" />}
                <span className="truncate font-semibold">{anexo.nome}</span>
                <span className="shrink-0 text-stone-500 dark:text-stone-400">
                  {TIPOS[anexo.tipo]} · {tamanhoLegivel(anexo.tamanho)}
                </span>
                <button onClick={() => setDescartar('anexo')} title="Remover o arquivo" className="ml-auto shrink-0 text-stone-400 hover:text-red-600 cursor-pointer">
                  <X className="w-4 h-4" />
                </button>
              </div>
            )}
            <div className="shrink-0 p-3 border-t border-stone-200 dark:border-stone-800 flex items-stretch gap-2">
              {gravando !== null ? (
                // Mesma altura do campo de texto que ela substitui (senão os botões vizinhos achatam)
                <div className="flex-1 min-h-[33px] flex items-center gap-2 px-3 rounded-lg bg-red-50 dark:bg-red-950/30 text-red-600 dark:text-red-400 text-xs font-semibold">
                  <span className="w-2.5 h-2.5 rounded-full bg-red-500 animate-pulse" />
                  Gravando {Math.floor(gravando / 60)}:{String(gravando % 60).padStart(2, '0')}
                  <button onClick={() => setDescartar('gravacao')} className="ml-auto flex items-center gap-1 hover:underline cursor-pointer">
                    <X className="w-4 h-4" /> Descartar
                  </button>
                </div>
              ) : (
                <>
                  <input
                    ref={arquivoRef}
                    type="file"
                    accept="image/*,video/*,audio/*,application/pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv,.zip,.rar"
                    onChange={(e) => escolherArquivo(e.target.files?.[0])}
                    className="hidden"
                  />
                  <button
                    onClick={() => arquivoRef.current?.click()}
                    disabled={enviando}
                    title="Enviar imagem, vídeo, áudio ou documento (até 3 MB)"
                    className="flex items-center justify-center px-3 rounded-lg text-stone-600 dark:text-stone-300 border border-stone-300 dark:border-stone-700 hover:bg-stone-100 dark:hover:bg-stone-800 cursor-pointer disabled:opacity-50 shrink-0"
                  >
                    <Paperclip className="w-4 h-4" />
                  </button>
                  <BotaoTemplates
                    canal="whatsapp"
                    vars={{ nome: conversa?.contato?.nome || resumoAberta?.contato_nome || perfilAberta || nomeAberta, atendente: lerSessao()?.usuario.nome }}
                    onEscolher={(t) => {
                      setTexto((atual) => (atual.trim() ? `${atual.trimEnd()}\n${t}` : t));
                      setTimeout(() => campoRef.current?.focus());
                    }}
                    disabled={enviando}
                    className="flex items-center justify-center px-3 rounded-lg text-stone-600 dark:text-stone-300 border border-stone-300 dark:border-stone-700 hover:bg-stone-100 dark:hover:bg-stone-800 cursor-pointer disabled:opacity-50"
                  />
                  <BotaoEmoji
                    onEscolher={(e) => {
                      // Entra no ponto do cursor (ou substitui o trecho selecionado)
                      const c = campoRef.current;
                      const ini = c?.selectionStart ?? texto.length;
                      const fim = c?.selectionEnd ?? texto.length;
                      setTexto(texto.slice(0, ini) + e + texto.slice(fim));
                      setTimeout(() => {
                        c?.focus();
                        c?.setSelectionRange(ini + e.length, ini + e.length);
                      });
                    }}
                    disabled={enviando}
                    className="flex items-center justify-center px-3 rounded-lg text-stone-600 dark:text-stone-300 border border-stone-300 dark:border-stone-700 hover:bg-stone-100 dark:hover:bg-stone-800 cursor-pointer disabled:opacity-50"
                  />
                  <textarea
                    ref={campoRef}
                    value={texto}
                    disabled={enviando}
                    onChange={(e) => setTexto(e.target.value)}
                    onKeyDown={(e) => {
                      // Esc desiste de responder a mensagem escolhida
                      if (e.key === 'Escape' && respondendo) {
                        e.preventDefault();
                        setRespondendo(null);
                        return;
                      }
                      // Enter envia; Shift+Enter quebra a linha
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault();
                        enviar();
                      }
                    }}
                    rows={linhas}
                    maxLength={4000}
                    placeholder={anexo ? (anexo.tipo === 'audio' ? 'Áudio vai sem legenda' : 'Legenda (opcional)') : 'Digite a mensagem'}
                    title="Enter envia; Shift+Enter quebra a linha"
                    className={`${INPUT_CLASS} flex-1 resize-none text-[13px] disabled:opacity-60`}
                  />
                </>
              )}
              {gravando !== null ? (
                <button onClick={() => pararGravacao(true)} title="Parar e enviar o áudio" className="flex items-center justify-center gap-2 px-4 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold cursor-pointer disabled:opacity-50 disabled:cursor-default shrink-0">
                  <SendHorizontal className="w-4 h-4" />
                  <span className="hidden sm:inline">Enviar</span>
                </button>
              ) : !texto.trim() && !anexo ? (
                <button onClick={gravar} disabled={enviando} title="Gravar áudio" className="flex items-center justify-center gap-2 px-4 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold cursor-pointer disabled:opacity-50 disabled:cursor-default shrink-0">
                  {enviando ? <Loader2 className="w-4 h-4 animate-spin" /> : <Mic className="w-4 h-4" />}
                  <span className="hidden sm:inline">{enviando ? 'Enviando...' : 'Gravar'}</span>
                </button>
              ) : (
                <button onClick={() => enviar()} disabled={enviando} title="Enviar pelo WhatsApp da empresa" className="flex items-center justify-center gap-2 px-4 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold cursor-pointer disabled:opacity-50 disabled:cursor-default shrink-0">
                  {enviando ? <Loader2 className="w-4 h-4 animate-spin" /> : <SendHorizontal className="w-4 h-4" />}
                  <span className="hidden sm:inline">{enviando ? 'Enviando...' : 'Enviar'}</span>
                </button>
              )}
            </div>
            </>
            )}
            {transferir !== null && (
              <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
                <div className="fixed inset-0 bg-stone-950/60" onClick={() => setTransferir(null)} aria-hidden="true" />
                <div role="dialog" aria-modal="true" className="relative z-10 w-full max-w-sm bg-white dark:bg-stone-900 rounded-2xl shadow-2xl p-5 flex flex-col gap-4">
                  <h3 className="text-sm font-bold text-stone-900 dark:text-stone-100">Transferir a conversa</h3>
                  <div className={FIELD_CLASS}>
                    <label htmlFor="transferir-para" className={LABEL_CLASS}>Para</label>
                    <SelectAuto id="transferir-para" autoFocus value={transferir} onChange={(e) => setTransferir(e.target.value)} className={`${INPUT_CLASS} w-full cursor-pointer`}>
                      <option value="">Escolha...</option>
                      <optgroup label="Atendente (já fica com ele)">
                        {destinos.usuarios
                          .filter((u) => !u.label.includes('(inativo)'))
                          .map((u) => (
                            <option key={`u${u.value}`} value={`u:${u.value}`}>
                              {u.label}
                            </option>
                          ))}
                      </optgroup>
                      <optgroup label="Departamento (aguarda alguém atender)">
                        {destinos.departamentos.map((d) => (
                          <option key={`d${d.value}`} value={`d:${d.value}`}>
                            {d.label}
                          </option>
                        ))}
                      </optgroup>
                    </SelectAuto>
                  </div>
                  <div className="flex justify-end gap-2">
                    <button onClick={() => setTransferir(null)} className="px-4 py-2 rounded-lg text-xs font-semibold border border-stone-300 dark:border-stone-700 hover:bg-stone-100 dark:hover:bg-stone-800 cursor-pointer">
                      Cancelar
                    </button>
                    <button
                      disabled={!transferir}
                      onClick={async () => {
                        const [tipo, id] = String(transferir).split(':');
                        setTransferir(null);
                        await acaoAtendimento(
                          () => transferirConversa(aberta!, tipo === 'u' ? { usuario_id: Number(id) } : { departamento_id: Number(id) }),
                          'Conversa transferida.',
                        );
                      }}
                      className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-semibold bg-blue-600 hover:bg-blue-700 text-white cursor-pointer disabled:opacity-50"
                    >
                      <ArrowRightLeft className="w-4 h-4" />
                      Transferir
                    </button>
                  </div>
                </div>
              </div>
            )}
            {descartandoConversa && (
              <ConfirmDialog
                titulo="Descartar esta conversa?"
                mensagem="Ela sai de Aguardando sem atendimento: não conta como atendimento e não vai pesquisa de satisfação. Se o cliente escrever de novo, volta para a fila."
                confirmar="Descartar"
                tom="normal"
                onConfirmar={async () => {
                  await descartarConversa(aberta);
                  setDescartandoConversa(false);
                  onToast('Conversa descartada: saiu de Aguardando.');
                  await carregarConversa(aberta);
                  await carregarLista();
                }}
                onCancelar={() => setDescartandoConversa(false)}
              />
            )}
            {limpando && (
              <ConfirmDialog
                titulo="Limpar a conversa?"
                mensagem={`Apaga todas as mensagens de ${nomeAberta || formatarTelefoneWa(aberta)} no CRM e a situação do atendimento (a próxima mensagem do cliente começa do zero). No WhatsApp do cliente nada muda. Não dá para desfazer.`}
                confirmar="Limpar"
                tom="perigo"
                onConfirmar={async () => {
                  const r = await limparConversa(aberta);
                  setLimpando(false);
                  setAberta(null);
                  onToast(`Conversa limpa: ${r.apagadas} mensagem(ns) apagada(s).`);
                  await carregarLista();
                }}
                onCancelar={() => setLimpando(false)}
              />
            )}
            {descartar && (
              <ConfirmDialog
                titulo={descartar === 'anexo' ? 'Remover o arquivo?' : 'Descartar a gravação?'}
                mensagem={descartar === 'anexo' ? 'O arquivo não será enviado.' : 'O áudio gravado não será enviado.'}
                confirmar={descartar === 'anexo' ? 'Remover' : 'Descartar'}
                onConfirmar={() => {
                  if (descartar === 'anexo') setAnexo(null);
                  else pararGravacao(false);
                  setDescartar(null);
                }}
                onCancelar={() => setDescartar(null)}
              />
            )}
          </>
        )}
      </section>

      {novaAberta && (
        <NovaConversa
          onFechar={() => setNovaAberta(false)}
          onEscolher={(d) => {
            setNovaAberta(false);
            setEscolhido({ telefone: d.telefone!, nome: d.tipo === 'numero' ? '' : d.nome });
            setAberta(d.telefone);
          }}
        />
      )}

      {cadastrando && <CadastroRapido {...cadastrando} onFechar={() => setCadastrando(null)} onCadastrado={() => aoCadastrar(cadastrando.telefone)} />}
    </div>
  );
};

/**
 * Nova conversa: procura pessoas e contatos pelo nome ou pelo número (ou aceita um número digitado)
 * e abre a conversa com o WhatsApp de quem for escolhido
 */
const NovaConversa: React.FC<{ onFechar: () => void; onEscolher: (d: DestinoConversa) => void }> = ({ onFechar, onEscolher }) => {
  const [busca, setBusca] = useState('');
  const [destinos, setDestinos] = useState<DestinoConversa[] | null>(null);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  // Busca com uma pausa na digitação; a resposta de uma busca antiga não sobrescreve a nova
  useEffect(() => {
    const termo = busca.trim();
    if (termo.length < 2) {
      setDestinos(null);
      return;
    }
    let vivo = true;
    setCarregando(true);
    const t = setTimeout(() => {
      fetchDestinosConversa(termo)
        .then((l) => vivo && setDestinos(l))
        .catch((err) => vivo && setErro(err.message))
        .finally(() => vivo && setCarregando(false));
    }, 300);
    return () => {
      vivo = false;
      clearTimeout(t);
    };
  }, [busca]);

  const Icone = ({ tipo }: { tipo: DestinoConversa['tipo'] }) =>
    tipo === 'contato' ? <User className="w-4 h-4" /> : tipo === 'numero' ? <Hash className="w-4 h-4" /> : <Building2 className="w-4 h-4" />;

  return (
    <div className="fixed inset-0 z-[55] flex items-start justify-center p-4 pt-[10vh]">
      <div className="fixed inset-0 bg-stone-950/70 backdrop-blur-xs" onClick={onFechar} aria-hidden="true" />
      <div role="dialog" aria-modal="true" aria-label="Nova conversa" className="relative w-full max-w-lg max-h-[75vh] flex flex-col bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-800 rounded-2xl shadow-2xl z-10">
        <div className="px-5 py-4 border-b border-stone-200 dark:border-stone-800 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <h3 className="text-base font-bold text-stone-900 dark:text-stone-100">Nova conversa</h3>
            <p className="text-[11px] text-stone-500 dark:text-stone-400">Procure uma pessoa, um contato de uma pessoa, ou digite o número com DDD.</p>
          </div>
          <button type="button" onClick={onFechar} title="Fechar" className="p-1.5 rounded-lg text-stone-400 hover:text-stone-700 hover:bg-stone-100 dark:hover:bg-stone-800 cursor-pointer">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="p-4 border-b border-stone-200 dark:border-stone-800">
          <div className="relative">
            <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-stone-400 pointer-events-none" />
            <input
              autoFocus
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              onFocus={(e) => e.target.select()}
              onKeyDown={(e) => {
                // Enter abre o primeiro que dá para mandar
                const primeiro = destinos?.find((d) => d.telefone);
                if (e.key === 'Enter' && primeiro) onEscolher(primeiro);
                if (e.key === 'Escape') onFechar();
              }}
              placeholder="Nome, empresa ou telefone"
              className={`${INPUT_CLASS} w-full pl-8`}
            />
            {carregando && <Loader2 className="w-3.5 h-3.5 animate-spin absolute right-3 top-1/2 -translate-y-1/2 text-stone-400" />}
          </div>
          {erro && (
            <div className="mt-2">
              <AvisoErro mensagem={erro} onFechar={() => setErro(null)} />
            </div>
          )}
        </div>
        <div className="flex-1 overflow-y-auto">
          {destinos === null ? (
            <p className="p-5 text-xs text-center text-stone-500 dark:text-stone-400">Digite pelo menos 2 letras ou números.</p>
          ) : !destinos.length ? (
            <p className="p-5 text-xs text-center text-stone-500 dark:text-stone-400">Nada encontrado em Pessoas nem em Contatos.</p>
          ) : (
            destinos.map((d) => (
              <button
                key={`${d.tipo}-${d.contato_id ?? d.pessoa_id ?? d.telefone}`}
                disabled={!d.telefone}
                onClick={() => onEscolher(d)}
                title={d.telefone ? `Abrir a conversa com ${formatarTelefoneWa(d.telefone)}` : `Sem como mandar WhatsApp: ${d.aviso}`}
                className="w-full text-left px-4 py-2.5 flex items-center gap-3 border-b border-stone-100 dark:border-stone-800/70 hover:bg-stone-50 dark:hover:bg-stone-800/50 cursor-pointer disabled:cursor-default disabled:opacity-50 disabled:hover:bg-transparent"
              >
                <span
                  className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${
                    d.tipo === 'contato' ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300' : 'bg-blue-50 text-blue-700 dark:bg-blue-950/50 dark:text-blue-300'
                  }`}
                >
                  <Icone tipo={d.tipo} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-xs font-semibold text-stone-800 dark:text-stone-100 truncate">
                    {d.nome}
                    {d.tipo === 'contato' && <span className="ml-1.5 text-[10px] font-medium text-emerald-700 dark:text-emerald-400">contato</span>}
                  </span>
                  <span className="block text-[11px] text-stone-500 dark:text-stone-400 truncate">
                    {d.detalhe ? `${d.detalhe} · ` : ''}
                    {d.telefone ? formatarTelefoneWa(d.telefone) : <span className="italic text-amber-600 dark:text-amber-400">{d.aviso}</span>}
                  </span>
                </span>
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
};

/** Cadastro rápido em Pessoas (lead) de quem mandou mensagem e ainda não está cadastrado */
const CadastroRapido: React.FC<{ telefone: string; nome: string; onFechar: () => void; onCadastrado: () => void }> = ({
  telefone,
  nome: nomeInicial,
  onFechar,
  onCadastrado,
}) => {
  /** Novo lead (Marketing › Leads) ou contato de uma pessoa que já existe */
  const [modo, setModo] = useState<'pessoa' | 'contato'>('pessoa');
  const [nome, setNome] = useState(nomeInicial);
  const [fone, setFone] = useState(telefoneCadastro(telefone));
  const [email, setEmail] = useState('');
  const [pessoaId, setPessoaId] = useState('');
  const [cargo, setCargo] = useState('');
  const [departamento, setDepartamento] = useState('');
  const [pessoas, setPessoas] = useState<OpcaoRef[] | null>(null);
  // A lista de pessoas só é carregada quando se escolhe "contato"
  useEffect(() => {
    if (modo !== 'contato' || pessoas) return;
    fetchOptions('pessoas', 'nome')
      .then(setPessoas)
      .catch((err) => setErro(err.message));
  }, [modo, pessoas]);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const campo = `${INPUT_CLASS} w-full`;

  const salvar = async (e: React.FormEvent) => {
    e.preventDefault();
    setSalvando(true);
    setErro(null);
    try {
      if (modo === 'pessoa') {
        await createRecord('leads', { origem: 'whatsapp', nome: nome.trim(), whatsapp: fone.trim(), email: email.trim() || null });
      } else {
        if (!pessoaId) throw new Error('Escolha a pessoa (empresa-cliente) do contato.');
        await createRecord('pessoas_contatos', {
          pessoa_id: pessoaId,
          nome: nome.trim(),
          whatsapp: fone.trim(),
          celular: fone.trim(),
          email: email.trim() || null,
          cargo: cargo.trim() || null,
          departamento: departamento.trim() || null,
        });
      }
      onCadastrado();
    } catch (err: any) {
      setErro(err.message || 'Não foi possível cadastrar.');
      setSalvando(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[55] flex items-center justify-center p-4">
      <div className="fixed inset-0 bg-stone-950/70 backdrop-blur-xs" onClick={salvando ? undefined : onFechar} aria-hidden="true" />
      <form onSubmit={salvar} role="dialog" aria-modal="true" className="relative w-full max-w-md bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-800 rounded-2xl shadow-2xl z-10">
        <div className="px-5 py-4 border-b border-stone-200 dark:border-stone-800 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <h3 className="text-base font-bold text-stone-900 dark:text-stone-100">Cadastrar este número</h3>
            <p className="text-[11px] text-stone-500 dark:text-stone-400">
              {modo === 'pessoa' ? 'Novo lead (Marketing › Leads); vira pessoa quando for convertido em cliente.' : 'Contato de uma pessoa que já está cadastrada (ex.: o comprador de um cliente).'}
            </p>
          </div>
          <button type="button" onClick={onFechar} title="Fechar" className="p-1.5 rounded-lg text-stone-400 hover:text-stone-700 hover:bg-stone-100 dark:hover:bg-stone-800 cursor-pointer">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="p-5 space-y-4">
          <div className="grid grid-cols-2 gap-1.5 p-1 rounded-lg bg-stone-100 dark:bg-stone-800">
            {(
              [
                ['pessoa', 'Novo lead'],
                ['contato', 'Contato de uma pessoa'],
              ] as const
            ).map(([v, rotulo]) => (
              <button
                key={v}
                type="button"
                onClick={() => setModo(v)}
                aria-pressed={modo === v}
                className={`py-1.5 rounded-md text-xs font-semibold cursor-pointer ${
                  modo === v ? 'bg-white dark:bg-stone-900 text-blue-700 dark:text-blue-300 shadow-xs' : 'text-stone-500 hover:text-stone-800 dark:hover:text-stone-200'
                }`}
              >
                {rotulo}
              </button>
            ))}
          </div>
          {modo === 'contato' && (
            <div className={FIELD_CLASS}>
              <label htmlFor="cad-pessoa" className={LABEL_CLASS}>Pessoa (empresa-cliente)</label>
              {pessoas ? (
                <SelectBusca id="cad-pessoa" value={pessoaId} options={pessoas} onChange={setPessoaId} required vazioLabel="— Escolha —" className={campo} />
              ) : (
                <Loader2 className="w-4 h-4 animate-spin text-stone-400" />
              )}
            </div>
          )}
          <div className={FIELD_CLASS}>
            <label htmlFor="cad-nome" className={LABEL_CLASS}>{modo === 'pessoa' ? 'Nome' : 'Nome do contato'}</label>
            <input id="cad-nome" autoFocus required maxLength={255} value={nome} onChange={(e) => setNome(e.target.value)} onFocus={(e) => e.target.select()} className={campo} />
            {nomeInicial && <span className={HINT_CLASS}>Sugerido pelo nome do perfil no WhatsApp</span>}
          </div>
          <div className={FIELD_CLASS}>
            <label htmlFor="cad-fone" className={LABEL_CLASS}>WhatsApp</label>
            <input id="cad-fone" required maxLength={50} value={fone} onChange={(e) => setFone(e.target.value)} onFocus={(e) => e.target.select()} className={campo} />
          </div>
          {modo === 'contato' && (
            <div className="grid grid-cols-2 gap-3">
              <div className={FIELD_CLASS}>
                <label htmlFor="cad-cargo" className={LABEL_CLASS}>Cargo</label>
                <input id="cad-cargo" maxLength={100} value={cargo} onChange={(e) => setCargo(e.target.value)} onFocus={(e) => e.target.select()} className={campo} />
              </div>
              <div className={FIELD_CLASS}>
                <label htmlFor="cad-depto" className={LABEL_CLASS}>Departamento</label>
                <input id="cad-depto" maxLength={100} value={departamento} onChange={(e) => setDepartamento(e.target.value)} onFocus={(e) => e.target.select()} className={campo} />
              </div>
            </div>
          )}
          <div className={FIELD_CLASS}>
            <label htmlFor="cad-email" className={LABEL_CLASS}>E-mail</label>
            <input id="cad-email" type="email" maxLength={255} value={email} onChange={(e) => setEmail(e.target.value)} onFocus={(e) => e.target.select()} className={campo} />
          </div>
          {erro && <AvisoErro mensagem={erro} onFechar={() => setErro(null)} />}
        </div>
        <div className="px-5 py-3 border-t border-stone-200 dark:border-stone-800 flex justify-end gap-2.5 bg-stone-50 dark:bg-stone-950/40 rounded-b-2xl">
          <button type="button" onClick={onFechar} disabled={salvando} className="px-4 py-2.5 rounded-lg text-xs font-semibold text-stone-600 dark:text-stone-300 border border-stone-300 dark:border-stone-700 hover:bg-stone-100 dark:hover:bg-stone-800 cursor-pointer disabled:opacity-40">
            Cancelar
          </button>
          <button type="submit" disabled={salvando} className="flex items-center gap-2 px-4 py-2.5 rounded-lg text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 cursor-pointer disabled:opacity-50">
            {salvando ? <Loader2 className="w-4 h-4 animate-spin" /> : <UserPlus className="w-4 h-4" />}
            Cadastrar
          </button>
        </div>
      </form>
    </div>
  );
};
