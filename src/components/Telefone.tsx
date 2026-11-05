import React, { useEffect, useRef, useState } from 'react';
import { Loader2, Phone, PhoneIncoming, PhoneOff } from 'lucide-react';
import { atenderLigacao, encerrarLigacao, fetchLigacao, ligarPara } from '../services/api';
import { tocarAviso } from '../utils/som';

/**
 * Ligação entre técnicos, como um ramal: o telefone de "Técnicos agora" chama; na tela do outro toca e ele atende.
 * O áudio vai direto entre os navegadores (WebRTC). O servidor guarda só o convite (oferta) e a resposta, cada um
 * já com todos os caminhos de rede (sem troca de candidatos depois): quem é chamado vê o convite na contagem dos
 * chamados (a cada 5 s), quem liga consulta a ligação a cada 2 s até atenderem. Desligar fecha o canal de dados,
 * e o outro lado desliga junto.
 */
const ICE: RTCIceServer[] = [{ urls: 'stun:stun.l.google.com:19302' }];
const EVENTO = 'crmweb:ligar';

/** Chamado pelo telefone de "Técnicos agora" (src/components/Chamados.tsx) */
export const ligar = (id: number, nome: string) => window.dispatchEvent(new CustomEvent(EVENTO, { detail: { id, nome } }));

type Estado = { fase: 'chamando' | 'tocando' | 'falando'; id: number | null; nome: string; oferta?: string; inicio?: number };

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

export const Telefone: React.FC<{ chegando: { id: number; de: string; oferta: string } | null; onAviso: (msg: string) => void }> = ({ chegando, onAviso }) => {
  const [estado, setEstado] = useState<Estado | null>(null);
  const [atendendo, setAtendendo] = useState(false);
  const [agora, setAgora] = useState(Date.now());
  const estadoRef = useRef(estado);
  estadoRef.current = estado;
  const avisoRef = useRef(onAviso);
  avisoRef.current = onAviso;
  const conexao = useRef<{ pc: RTCPeerConnection; mic: MediaStream } | null>(null);
  const audio = useRef<HTMLAudioElement>(null);

  /** Fecha microfone e conexão aqui (o outro lado vê o canal fechar) */
  const desligarLocal = (msg?: string) => {
    const c = conexao.current;
    conexao.current = null;
    c?.mic.getTracks().forEach((t) => t.stop());
    c?.pc.close();
    setEstado(null);
    setAtendendo(false);
    if (msg) avisoRef.current(msg);
  };
  const desligar = (msg?: string) => {
    const id = estadoRef.current?.id;
    if (id) encerrarLigacao(id).catch(() => {});
    desligarLocal(msg);
  };

  const conectar = async () => {
    const mic = await navigator.mediaDevices.getUserMedia({ audio: true });
    const pc = new RTCPeerConnection({ iceServers: ICE });
    mic.getTracks().forEach((t) => pc.addTrack(t, mic));
    pc.ontrack = (e) => {
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
      const { id: para, nome } = (e as CustomEvent<{ id: number; nome: string }>).detail;
      setEstado({ fase: 'chamando', id: null, nome });
      try {
        const pc = await conectar();
        vigiar(pc, pc.createDataChannel('ramal'));
        await pc.setLocalDescription(await pc.createOffer());
        await esperarIce(pc);
        if (conexao.current?.pc !== pc) return; // desligou enquanto preparava
        const { id } = await ligarPara(para, pc.localDescription!.sdp);
        if (conexao.current?.pc !== pc) return void encerrarLigacao(id).catch(() => {});
        setEstado({ fase: 'chamando', id, nome });
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
    const { id, nome } = estado;
    const i = setInterval(async () => {
      try {
        const r = await fetchLigacao(id);
        if (estadoRef.current?.id !== id || estadoRef.current.fase !== 'chamando') return;
        if (r.situacao === 'atendida' && r.resposta) {
          await conexao.current?.pc.setRemoteDescription({ type: 'answer', sdp: r.resposta });
          setEstado({ fase: 'falando', id, nome, inicio: Date.now() });
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
    else if (chegando && s && s.id !== chegando.id) encerrarLigacao(chegando.id).catch(() => {});
    else if (!chegando && s?.fase === 'tocando' && !atendendo) setEstado(null);
  }, [chegando?.id]);

  // Trinado enquanto toca
  useEffect(() => {
    if (estado?.fase !== 'tocando') return;
    tocarAviso('telefone');
    const i = setInterval(() => tocarAviso('telefone'), 3000);
    return () => clearInterval(i);
  }, [estado?.fase]);

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
      await atenderLigacao(s.id, pc.localDescription!.sdp);
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
              </div>
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
