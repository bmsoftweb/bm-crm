/**
 * Aviso sonoro (dois bipes) gerado pelo navegador, sem arquivo de áudio. O navegador só libera som
 * depois de um clique ou tecla na página: destravarSom() fica esperando o primeiro.
 */
let ctx: AudioContext | null = null;

export function destravarSom() {
  const destravar = () => {
    ctx ??= new AudioContext();
    void ctx.resume();
  };
  window.addEventListener('pointerdown', destravar);
  window.addEventListener('keydown', destravar);
  return () => {
    window.removeEventListener('pointerdown', destravar);
    window.removeEventListener('keydown', destravar);
  };
}

/**
 * Cada aviso tem o seu som, para saber de onde veio sem olhar a tela:
 * whatsapp = dois bipes (conversa aguardando); suporte = três notas subindo, mais suaves (cliente
 * escreveu num chamado); chamado = "dim-dom" longo, descendo (chamado novo na fila, para o Suporte);
 * campainha = "ding-dong" duas vezes (chamado transferido para mim).
 */
const SONS: Record<string, { notas: number[]; intervalo: number; duracao: number; onda: OscillatorType; volume?: number }> = {
  whatsapp: { notas: [880, 1175], intervalo: 0.25, duracao: 0.22, onda: 'sine' },
  suporte: { notas: [784, 988, 1319], intervalo: 0.13, duracao: 0.2, onda: 'triangle' },
  chamado: { notas: [1047, 1047, 698], intervalo: 0.18, duracao: 0.45, onda: 'sine', volume: 0.35 },
  // Chamado transferido para mim: campainha de porta "ding-dong", duas vezes, com as notas soando longas
  campainha: { notas: [1319, 1047, 1319, 1047], intervalo: 0.5, duracao: 0.9, onda: 'triangle', volume: 0.4 },
  // Cutucão do técnico no chat do site: campainha insistente (três toques duplos)
  cutucar: { notas: [1319, 988, 1319, 988, 1319, 988], intervalo: 0.12, duracao: 0.1, onda: 'square', volume: 0.12 },
  // Ligação de outro técnico: o trinado do telefone (repete enquanto toca, src/components/Telefone.tsx)
  telefone: { notas: Array.from({ length: 20 }, (_, i) => (i % 2 ? 800 : 1000)), intervalo: 0.05, duracao: 0.05, onda: 'sine', volume: 0.25 },
};

/** Buzina de caminhão: três toques de um acorde grave em onda dente de serra, no volume máximo */
function tocarBuzina(c: AudioContext) {
  const t = c.currentTime;
  [0, 0.75, 1.5].forEach((inicio) => {
    [233, 294, 349].forEach((freq) => {
      const o = c.createOscillator();
      const g = c.createGain();
      o.type = 'sawtooth';
      o.frequency.value = freq;
      g.gain.setValueAtTime(0.0001, t + inicio);
      g.gain.exponentialRampToValueAtTime(0.33, t + inicio + 0.02);
      g.gain.setValueAtTime(0.33, t + inicio + 0.55);
      g.gain.exponentialRampToValueAtTime(0.0001, t + inicio + 0.6);
      o.connect(g).connect(c.destination);
      o.start(t + inicio);
      o.stop(t + inicio + 0.62);
    });
  });
}

export function tocarAviso(tipo: 'whatsapp' | 'suporte' | 'chamado' | 'campainha' | 'cutucar' | 'buzina' | 'telefone' = 'whatsapp') {
  try {
    ctx ??= new AudioContext();
    if (tipo === 'buzina') return tocarBuzina(ctx);
    const som = SONS[tipo];
    const t = ctx.currentTime;
    som.notas.forEach((freq, i) => {
      const o = ctx!.createOscillator();
      const g = ctx!.createGain();
      const inicio = t + i * som.intervalo;
      o.type = som.onda;
      o.frequency.value = freq;
      g.gain.setValueAtTime(0.0001, inicio);
      g.gain.exponentialRampToValueAtTime(som.volume ?? 0.3, inicio + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, inicio + som.duracao);
      o.connect(g).connect(ctx!.destination);
      o.start(inicio);
      o.stop(inicio + som.duracao + 0.03);
    });
  } catch {
    // navegador sem Web Audio: fica só o aviso na tela
  }
}
