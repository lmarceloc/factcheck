import { useMotionValue } from "motion/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "./api";

export type AudioSource = "microfone" | "aba" | "esta_aba";

interface TurnMessage {
  type: "Turn";
  transcript: string;
  end_of_turn: boolean;
  turn_is_formatted: boolean;
  turn_order: number;
}

// Captura o áudio cru do grafo de áudio e entrega blocos Float32 para a thread principal.
const WORKLET = `
class PcmCaptura extends AudioWorkletProcessor {
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (ch) this.port.postMessage(ch.slice(0));
    return true;
  }
}
registerProcessor("pcm-captura", PcmCaptura);
`;

const CHUNK_MS = 50;
/** Espera pela versão formatada de um turno antes de usar a crua. */
const FORMAT_WAIT_MS = 700;

function downsample(input: Float32Array, from: number, to: number): Float32Array {
  if (from === to) return input;
  const ratio = from / to;
  const out = new Float32Array(Math.floor(input.length / ratio));
  for (let i = 0; i < out.length; i++) out[i] = input[Math.floor(i * ratio)];
  return out;
}

function toPcm16(samples: Float32Array): ArrayBuffer {
  const out = new Int16Array(samples.length);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    out[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return out.buffer;
}

async function openStream(source: AudioSource): Promise<MediaStream> {
  if (source === "microfone") {
    return navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, noiseSuppression: true } });
  }
  // O Chrome só compartilha o áudio de uma aba junto com o vídeo; o vídeo é descartado.
  // "esta_aba" já sugere a própria página (onde está o player do YouTube).
  const options =
    source === "esta_aba"
      ? { video: true, audio: true, preferCurrentTab: true, selfBrowserSurface: "include", surfaceSwitching: "exclude", systemAudio: "exclude" }
      : { video: true, audio: true };
  const stream = await navigator.mediaDevices.getDisplayMedia(options as DisplayMediaStreamOptions);
  stream.getVideoTracks().forEach((t) => t.stop());
  if (stream.getAudioTracks().length === 0) {
    throw new Error("A aba foi compartilhada sem áudio. Escolha uma aba e marque “Compartilhar áudio da aba”.");
  }
  return stream;
}

/**
 * Transcrição em tempo real pelo AssemblyAI (streaming v3). O servidor gera um
 * token temporário de uso único; o áudio vai do navegador direto para o AssemblyAI.
 */
export function useAssembly(onFinal: (text: string) => void, onInterim: (text: string) => void) {
  const [listening, setListening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const level = useMotionValue(0);
  const handlers = useRef({ onFinal, onInterim });
  handlers.current = { onFinal, onInterim };

  const wanted = useRef(false);
  const ws = useRef<WebSocket | null>(null);
  const media = useRef<{ stream: MediaStream; ctx: AudioContext } | null>(null);
  const failures = useRef<number[]>([]);

  const teardownAudio = () => {
    media.current?.stream.getTracks().forEach((t) => t.stop());
    media.current?.ctx.close().catch(() => {});
    media.current = null;
    level.set(0);
  };

  const connect = useCallback(async () => {
    const { url, sampleRate } = await api.sttSession();
    const socket = new WebSocket(url);
    socket.binaryType = "arraybuffer";
    ws.current = socket;

    const emitted = new Set<number>();
    let pending: { order: number; text: string; timer: number } | null = null;
    const emit = (order: number, text: string) => {
      if (emitted.has(order) || !text.trim()) return;
      emitted.add(order);
      handlers.current.onInterim("");
      handlers.current.onFinal(text);
    };

    socket.onmessage = (ev) => {
      const msg = JSON.parse(ev.data as string) as { type: string };
      if (msg.type === "Begin") {
        failures.current = [];
        setListening(true);
        return;
      }
      if (msg.type !== "Turn") return;
      const turn = msg as unknown as TurnMessage;
      if (!turn.end_of_turn) {
        handlers.current.onInterim(turn.transcript);
        return;
      }
      if (turn.turn_is_formatted) {
        if (pending?.order === turn.turn_order) window.clearTimeout(pending.timer);
        emit(turn.turn_order, turn.transcript);
        return;
      }
      // Turno encerrado mas ainda sem pontuação: dá um instante para a versão formatada chegar.
      if (pending) window.clearTimeout(pending.timer);
      const order = turn.turn_order;
      const text = turn.transcript;
      pending = { order, text, timer: window.setTimeout(() => emit(order, text), FORMAT_WAIT_MS) };
    };

    socket.onclose = (ev) => {
      if (ws.current === socket) ws.current = null;
      if (!wanted.current) return;
      const now = Date.now();
      failures.current = [...failures.current.filter((t) => now - t < 30000), now];
      if (failures.current.length >= 3) {
        setError(`A conexão com o AssemblyAI caiu repetidas vezes${ev.reason ? `: ${ev.reason}` : ""}.`);
        wanted.current = false;
        teardownAudio();
        setListening(false);
        return;
      }
      // Cada token vale para uma sessão só: reconecta com um novo, mantendo o áudio aberto.
      window.setTimeout(() => {
        if (wanted.current) connect().catch((e) => setError((e as Error).message));
      }, 800);
    };

    return { socket, sampleRate };
  }, [level]);

  const start = useCallback(
    async (source: AudioSource) => {
      setError(null);
      wanted.current = true;
      try {
        const stream = await openStream(source);
        const ctx = new AudioContext({ sampleRate: 16000 });
        media.current = { stream, ctx };
        // Se o usuário encerrar o compartilhamento pela barra do Chrome, para tudo.
        stream.getAudioTracks()[0].addEventListener("ended", () => stopRef.current());

        const { sampleRate } = await connect();
        const url = URL.createObjectURL(new Blob([WORKLET], { type: "application/javascript" }));
        await ctx.audioWorklet.addModule(url);
        URL.revokeObjectURL(url);
        const node = new AudioWorkletNode(ctx, "pcm-captura");
        ctx.createMediaStreamSource(stream).connect(node);

        const chunk = Math.round((sampleRate * CHUNK_MS) / 1000);
        let buffer: number[] = [];
        node.port.onmessage = (ev) => {
          const samples = downsample(ev.data as Float32Array, ctx.sampleRate, sampleRate);
          let sum = 0;
          for (const s of samples) sum += s * s;
          level.set(Math.min(1, Math.sqrt(sum / samples.length) * 4));
          for (const s of samples) buffer.push(s);
          while (buffer.length >= chunk) {
            const piece = Float32Array.from(buffer.slice(0, chunk));
            buffer = buffer.slice(chunk);
            if (ws.current?.readyState === WebSocket.OPEN) ws.current.send(toPcm16(piece));
          }
        };
      } catch (e) {
        wanted.current = false;
        teardownAudio();
        ws.current?.close();
        setListening(false);
        const err = e as Error;
        setError(err.name === "NotAllowedError" ? "Permissão de áudio negada." : err.message);
      }
    },
    [connect, level],
  );

  const stop = useCallback(() => {
    wanted.current = false;
    const socket = ws.current;
    if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: "Terminate" }));
    window.setTimeout(() => socket?.close(), 1500);
    teardownAudio();
    handlers.current.onInterim("");
    setListening(false);
  }, []);
  const stopRef = useRef(stop);
  stopRef.current = stop;

  useEffect(() => () => stopRef.current(), []);

  return { listening, error, level, start, stop };
}
