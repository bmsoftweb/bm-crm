import React, { useEffect, useRef, useState } from 'react';
import { Loader2, Phone, PhoneIncoming, PhoneOff } from 'lucide-react';
import { atenderLigacao, encerrarLigacao, enviarGravacaoLigacao, fetchLigacao, ligarPara, ligarParaCliente } from '../services/api';
import { tocarAviso } from '../utils/som';

/**
 * Ligação entre técnicos, como um ramal: o telefone de "Técnicos agora" chama; na tela do outro toca e ele atende.
 * O áudio vai direto entre os navegadores (WebRTC). O servidor guarda só o convite (oferta) e a resposta, cada um
 * já com todos os caminhos de rede (sem troca de candidatos depois): quem é chamado vê o convite na contagem dos
 * chamados (a cada 5 s), quem liga consulta a ligação a cada 2 s até atenderem. Desligar fecha o canal de dados,
 * e o outro lado desliga junto.
 * O técnico também liga para o cliente de um chamado do site (botão Ligar do chamado): no chat do cliente
 * (src/components/SuportePublico.tsx) este mesmo cartão toca, com o `canal` público, e ele só atende.
 * Ligação com cliente é sempre gravada no navegador do técnico (as duas vozes num arquivo): ao desligar, sobe para o
 * Blob e o Gemini resume (nota interna no chamado e pendências, server/pendencias.ts). O cliente vê o aviso da gravação.
 */
const ICE: RTCIceServer[] = [{ urls: 'stun:stun.l.google.com:19302' }];
const EVENTO = 'crmweb:ligar';

/** Chamado pelo telefone de "Técnicos agora" (src/components/Chamados.tsx) */
export const ligar = (id: number, nome: string) => window.dispatchEvent(new CustomEvent(EVENTO, { detail: { id, nome } }));
/** Botão Ligar do chamado do site: toca no chat do cliente */
export const ligarCliente = (chamado: number, nome: string) => window.dispatchEvent(new CustomEvent(EVENTO, { detail: { chamado, nome } }));

/** Como quem recebe atende e desliga: o técnico pelas rotas logadas; o cliente do chat pelas públicas do chamado */
export interface CanalLigacao {
  atender: (id: number, resposta: string) => Promise<unknown>;
  encerrar: (id: number) => Promise<unknown>;
}
const CANAL_TECNICO: CanalLigacao = { atender: atenderLigacao, encerrar: encerrarLigacao };

/** chamado: ligação do técnico para o cliente desse chamado (gravada) */
type Estado = { fase: 'chamando' | 'tocando' | 'falando'; id: number | null; nome: string; oferta?: string; inicio?: number; chamado?: number };

/** Formato da gravação: WebM (Chrome, Edge, Firefox) ou MP4 (Safari) */
const FORMATO_GRAVACAO = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'].find((t) => typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(t));

/** Espera juntar os caminhos de rede (no máximo 3 s: os que vieram bastam) */
const esperarIce = (pc: RTCPeerConnection) =>
  new Promise<void>((ok) => {
    if (pc.iceGatheringState === 'complete') return ok();
    const fim = () => pc.iceGatheringState === 'complete' && ok();
    pc.addEventListener('icegatheringstatechange', fim);
    setTimeout(ok, 3000);
  });

const mensagem = (err: any) =>
  err?.name === 'NotAllowedError' ? 'Libere o microfone no navegador para usar a ligação.' : err?.name === 'NotFoundError' ? 'Nenhum microfone encontrado.' : err?.message || 'Falha na ligação.';

const duracao = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
};

export const Telefone: React.FC<{
  chegando: { id: number; de: string; oferta: string } | null;
  onAviso: (msg: string) => void;
  canal?: CanalLigacao;
  /** Linha a mais no cartão de quem recebe (o cliente: "esta ligação é gravada") */
  aviso?: string;
}> = ({ chegando, onAviso, canal = CANAL_TECNICO, aviso }) => {
  const [estado, setEstado] = useState<Estado | null>(null);
  const [atendendo, setAtendendo] = useState(false);
  const [agora, setAgora] = useState(Date.now());
  const estadoRef = useRef(estado);
  estadoRef.current = estado;
  const avisoRef = useRef(onAviso);
  avisoRef.current = onAviso;
  const conexao = useRef<{ pc: RTCPeerConnection; mic: MediaStream } | null>(null);
  const audio = useRef<HTMLAudioElement>(null);
  /** Voz do outro lado (para a gravação) */
  const remoto = useRef<MediaStream | null>(null);
  const gravacao = useRef<MediaRecorder | null>(null);

  /** Fecha microfone e conexão aqui (o outro lado vê o canal fechar) */
  const desligarLocal = (msg?: string) => {
    const c = conexao.current;
    conexao.current = null;
    // Para a gravação antes de fechar o microfone (o envio sai no onstop)
    if (gravacao.current?.state === 'recording') gravacao.current.stop();
    gravacao.current = null;
    c?.mic.getTracks().forEach((t) => t.stop());
    c?.pc.close();
    setEstado(null);
    setAtendendo(false);
    if (msg) avisoRef.current(msg);
  };
  const desligar = (msg?: string) => {
    const id = estadoRef.current?.id;
    if (id) canal.encerrar(id).catch(() => {});
    desligarLocal(msg);
  };

  const conectar = async () => {
    const mic = await navigator.mediaDevices.getUserMedia({ audio: true });
    const pc = new RTCPeerConnection({ iceServers: ICE });
    mic.getTracks().forEach((t) => pc.addTrack(t, mic));
    pc.ontrack = (e) => {
      remoto.current = e.streams[0];
      if (audio.current) audio.current.srcObject = e.streams[0];
    };
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed' && conexao.current?.pc === pc) desligar('A ligação caiu: os dois computadores não conseguiram se conectar.');
    };
    conexao.current = { pc, mic };
    return pc;
  };
  /** Canal de dados: fechou do outro lado = desligaram */
  const vigiar = (pc: RTCPeerConnection, canal: RTCDataChannel) => {
    canal.onclose = () => {
      if (conexao.current?.pc === pc) desligar('Ligação encerrada.');
    };
  };

  // Telefone de "Técnicos agora": prepara o convite e liga
  useEffect(() => {
    const aoLigar = async (e: Event) => {
      if (estadoRef.current) return avisoRef.current('Termine a ligação atual antes de fazer outra.');
      const { id: para, chamado, nome } = (e as CustomEvent<{ id?: number; chamado?: number; nome: string }>).detail;
      setEstado({ fase: 'chamando', id: null, nome, chamado });
      try {
        const pc = await conectar();
        vigiar(pc, pc.createDataChannel('ramal'));
        await pc.setLocalDescription(await pc.createOffer());
        await esperarIce(pc);
        if (conexao.current?.pc !== pc) return; // desligou enquanto preparava
        const sdp = pc.localDescription!.sdp;
        const { id } = chamado ? await ligarParaCliente(chamado, sdp) : await ligarPara(para!, sdp);
        if (conexao.current?.pc !== pc) return void encerrarLigacao(id).catch(() => {});
        setEstado({ fase: 'chamando', id, nome, chamado });
      } catch (err) {
        desligarLocal(mensagem(err));
      }
    };
    window.addEventListener(EVENTO, aoLigar);
    return () => window.removeEventListener(EVENTO, aoLigar);
  }, []);

  // Quem liga: espera atenderem (ou recusarem, ou passar o tempo)
  useEffect(() => {
    if (estado?.fase !== 'chamando' || !estado.id) return;
    const { id, nome, chamado } = estado;
    const i = setInterval(async () => {
      try {
        const r = await fetchLigacao(id);
        if (estadoRef.current?.id !== id || estadoRef.current.fase !== 'chamando') return;
        if (r.situacao === 'atendida' && r.resposta) {
          await conexao.current?.pc.setRemoteDescription({ type: 'answer', sdp: r.resposta });
          setEstado({ fase: 'falando', id, nome, chamado, inicio: Date.now() });
        } else if (r.situacao !== 'chamando') {
          desligarLocal(r.situacao === 'recusada' ? `${nome} não pode atender agora.` : r.situacao === 'perdida' ? `${nome} não atendeu.` : undefined);
        }
      } catch {
        // falhou a consulta: tenta de novo em 2 s
      }
    }, 2000);
    return () => clearInterval(i);
  }, [estado?.fase, estado?.id]);

  // Quem é chamado: toca; já em outra ligação, recusa (quem ligou vê "não pode atender"); sumiu da contagem = desistiram
  useEffect(() => {
    const s = estadoRef.current;
    if (chegando && !s) setEstado({ fase: 'tocando', id: chegando.id, nome: chegando.de, oferta: chegando.oferta });
    else if (chegando && s && s.id !== chegando.id) canal.encerrar(chegando.id).catch(() => {});
    else if (!chegando && s?.fase === 'tocando' && !atendendo) setEstado(null);
  }, [chegando?.id]);

  // Trinado enquanto toca
  useEffect(() => {
    if (estado?.fase !== 'tocando') return;
    tocarAviso('telefone');
    const i = setInterval(() => tocarAviso('telefone'), 3000);
    return () => clearInterval(i);
  }, [estado?.fase]);

  // Ligação com cliente atendida: grava as duas vozes; ao parar, envia e o servidor manda analisar
  useEffect(() => {
    const c = conexao.current;
    if (estado?.fase !== 'falando' || !estado.chamado || !estado.id || !c || !remoto.current || !FORMATO_GRAVACAO) return;
    const ligacaoId = estado.id;
    const inicio = Date.now();
    const ac = new AudioContext();
    const mistura = ac.createMediaStreamDestination();
    ac.createMediaStreamSource(c.mic).connect(mistura);
    ac.createMediaStreamSource(remoto.current).connect(mistura);
    const rec = new MediaRecorder(mistura.stream, { mimeType: FORMATO_GRAVACAO, audioBitsPerSecond: 32_000 });
    const partes: Blob[] = [];
    rec.ondataavailable = (e) => e.data.size && partes.push(e.data);
    rec.onstop = () => {
      void ac.close();
      const segundos = Math.round((Date.now() - inicio) / 1000);
      if (segundos < 3 || !partes.length) return;
      enviarGravacaoLigacao(ligacaoId, new Blob(partes, { type: FORMATO_GRAVACAO }), segundos)
        .then(() => avisoRef.current('Ligação gravada: o resumo vai aparecer como nota interna no chamado em instantes.'))
        .catch((err) => avisoRef.current(`Não foi possível guardar a gravação da ligação: ${err.message}`));
    };
    rec.start(10_000);
    gravacao.current = rec;
  }, [estado?.fase, estado?.id]);

  // Relógio da ligação
  useEffect(() => {
    if (estado?.fase !== 'falando') return;
    const i = setInterval(() => setAgora(Date.now()), 1000);
    return () => clearInterval(i);
  }, [estado?.fase]);

  const atender = async () => {
    const s = estadoRef.current;
    if (!s?.id || !s.oferta || atendendo) return;
    setAtendendo(true);
    try {
      const pc = await conectar();
      pc.ondatachannel = (e) => vigiar(pc, e.channel);
      await pc.setRemoteDescription({ type: 'offer', sdp: s.oferta });
      await pc.setLocalDescription(await pc.createAnswer());
      await esperarIce(pc);
      await canal.atender(s.id, pc.localDescription!.sdp);
      setEstado({ fase: 'falando', id: s.id, nome: s.nome, inicio: Date.now() });
      setAtendendo(false);
    } catch (err) {
      desligar(mensagem(err));
    }
  };

  return (
    <>
      <audio ref={audio} autoPlay />
      {estado && (
        <div className="fixed bottom-4 right-4 z-[60] w-72 rounded-xl border border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-900 shadow-2xl p-4">
          <div className="flex items-center gap-3">
            <span
              className={`shrink-0 w-10 h-10 rounded-full flex items-center justify-center ${
                estado.fase === 'falando' ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300' : 'bg-blue-100 text-blue-700 dark:bg-blue-950/50 dark:text-blue-300 animate-pulse'
              }`}
            >
              {estado.fase === 'tocando' ? <PhoneIncoming className="w-5 h-5" /> : <Phone className="w-5 h-5" />}
            </span>
            <div className="min-w-0 flex-1">
              <div className="text-sm font-semibold text-stone-800 dark:text-stone-100 truncate">{estado.nome}</div>
              <div className="text-xs text-stone-500 dark:text-stone-400">
                {estado.fase === 'chamando' ? 'Chamando…' : estado.fase === 'tocando' ? (atendendo ? 'Conectando…' : 'Ligando para você') : `Em ligação · ${duracao(agora - (estado.inicio ?? agora))}`}
                {estado.chamado && estado.fase === 'falando' && <span className="ml-1.5 text-rose-600 dark:text-rose-400 font-semibold">● Gravando</span>}
              </div>
              {aviso && <div className="text-[11px] text-stone-400 mt-0.5">{aviso}</div>}
            </div>
          </div>
          <div className="flex gap-2 mt-3">
            {estado.fase === 'tocando' && (
              <button
                type="button"
                onClick={atender}
                disabled={atendendo}
                className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold cursor-pointer disabled:opacity-50"
              >
                {atendendo ? <Loader2 className="w-4 h-4 animate-spin" /> : <Phone className="w-4 h-4" />}
                Atender
              </button>
            )}
            <button
              type="button"
              onClick={() => desligar()}
              className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-rose-600 hover:bg-rose-700 text-white text-sm font-semibold cursor-pointer"
            >
              <PhoneOff className="w-4 h-4" />
              {estado.fase === 'tocando' ? 'Recusar' : estado.fase === 'chamando' ? 'Cancelar' : 'Desligar'}
            </button>
          </div>
        </div>
      )}
    </>
  );
};
