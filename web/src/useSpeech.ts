import { useMotionValue, type MotionValue } from "motion/react";
import { useCallback, useEffect, useRef, useState } from "react";

// A Web Speech API ainda não está nos tipos padrão do TypeScript.
interface RecognitionResult {
  isFinal: boolean;
  0: { transcript: string };
}
interface RecognitionEvent {
  resultIndex: number;
  results: { length: number; [i: number]: RecognitionResult };
}
interface Recognition {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((e: RecognitionEvent) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
}
type RecognitionCtor = new () => Recognition;

function getRecognition(): RecognitionCtor | null {
  const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export const speechSupported = typeof window !== "undefined" && getRecognition() !== null;

const ERRORS: Record<string, string> = {
  "not-allowed": "Permissão do microfone negada.",
  "service-not-allowed": "Reconhecimento de voz bloqueado neste navegador.",
  "audio-capture": "Nenhum microfone encontrado.",
  network: "Sem conexão com o serviço de reconhecimento de voz.",
};

/**
 * Reconhecimento de voz contínuo em pt-BR. O Chrome encerra a sessão depois de
 * alguns segundos de silêncio; aqui ela é reiniciada enquanto estiver ligada.
 */
export function useSpeech(onFinal: (text: string) => void, onInterim: (text: string) => void) {
  const [listening, setListening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const wanted = useRef(false);
  const rec = useRef<Recognition | null>(null);
  const handlers = useRef({ onFinal, onInterim });
  handlers.current = { onFinal, onInterim };

  const start = useCallback(() => {
    const Ctor = getRecognition();
    if (!Ctor) {
      setError("Este navegador não tem reconhecimento de voz. Use o Google Chrome ou o Edge.");
      return;
    }
    const r = new Ctor();
    r.lang = "pt-BR";
    r.continuous = true;
    r.interimResults = true;
    r.onresult = (e) => {
      let interim = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const result = e.results[i];
        const text = result[0].transcript;
        if (result.isFinal) handlers.current.onFinal(text);
        else interim += text;
      }
      handlers.current.onInterim(interim);
    };
    r.onerror = (e) => {
      if (e.error === "no-speech" || e.error === "aborted") return;
      setError(ERRORS[e.error] ?? `Erro no reconhecimento de voz: ${e.error}`);
      if (e.error === "not-allowed" || e.error === "service-not-allowed" || e.error === "audio-capture") {
        wanted.current = false;
      }
    };
    r.onend = () => {
      if (wanted.current) {
        try {
          r.start();
          return;
        } catch {
          /* cai no estado desligado abaixo */
        }
      }
      setListening(false);
    };
    wanted.current = true;
    rec.current = r;
    setError(null);
    r.start();
    setListening(true);
  }, []);

  const stop = useCallback(() => {
    wanted.current = false;
    rec.current?.stop();
    handlers.current.onInterim("");
    setListening(false);
  }, []);

  useEffect(() => () => {
    wanted.current = false;
    rec.current?.stop();
  }, []);

  return { listening, error, start, stop };
}

/** Volume do microfone (0–1) como MotionValue, para animar o medidor sem re-render. */
export function useMicLevel(active: boolean): MotionValue<number> {
  const level = useMotionValue(0);

  useEffect(() => {
    if (!active || !navigator.mediaDevices?.getUserMedia) return;
    let stopped = false;
    let raf = 0;
    let stream: MediaStream | null = null;
    let ctx: AudioContext | null = null;

    navigator.mediaDevices
      .getUserMedia({ audio: true })
      .then((s) => {
        if (stopped) return s.getTracks().forEach((t) => t.stop());
        stream = s;
        ctx = new AudioContext();
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 512;
        ctx.createMediaStreamSource(s).connect(analyser);
        const buf = new Uint8Array(analyser.fftSize);
        const tick = () => {
          analyser.getByteTimeDomainData(buf);
          let sum = 0;
          for (const v of buf) sum += ((v - 128) / 128) ** 2;
          level.set(Math.min(1, Math.sqrt(sum / buf.length) * 4));
          raf = requestAnimationFrame(tick);
        };
        tick();
      })
      .catch(() => level.set(0));

    return () => {
      stopped = true;
      cancelAnimationFrame(raf);
      stream?.getTracks().forEach((t) => t.stop());
      ctx?.close();
      level.set(0);
    };
  }, [active, level]);

  return level;
}
