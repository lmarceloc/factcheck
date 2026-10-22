import { useEffect, useRef, useState } from "react";

// O mínimo da API de iframe do YouTube que usamos (sem depender de @types).
interface YTPlayer {
  getCurrentTime(): number;
  seekTo(seconds: number, allowSeekAhead: boolean): void;
  playVideo(): void;
  destroy(): void;
}
interface YTNamespace {
  Player: new (
    el: HTMLElement,
    opts: { videoId: string; host?: string; width?: string; height?: string; playerVars?: Record<string, number | string> },
  ) => YTPlayer;
}
declare global {
  interface Window {
    YT?: YTNamespace;
    onYouTubeIframeAPIReady?: () => void;
  }
}

let carregando: Promise<YTNamespace> | null = null;

function carregarApi(): Promise<YTNamespace> {
  if (window.YT?.Player) return Promise.resolve(window.YT);
  carregando ??= new Promise<YTNamespace>((resolve, reject) => {
    const anterior = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      anterior?.();
      if (window.YT) resolve(window.YT);
    };
    const s = document.createElement("script");
    s.src = "https://www.youtube.com/iframe_api";
    s.onerror = () => reject(new Error("API do YouTube indisponível"));
    document.head.appendChild(s);
    window.setTimeout(() => reject(new Error("API do YouTube demorou demais")), 10000);
  }).catch((err) => {
    carregando = null;
    throw err;
  });
  return carregando;
}

export const formatarTempo = (s: number) => {
  const t = Math.max(0, Math.floor(s));
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const ss = String(t % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
};

/**
 * Player do YouTube controlável: lê o minuto atual (para marcar cada fala) e
 * pula para um momento (o "ver no vídeo" do público). Se a API não carregar,
 * `fallback` vira true e a página mostra o player simples.
 */
export function useYouTube(videoId: string | null) {
  const ref = useRef<HTMLDivElement>(null);
  const player = useRef<YTPlayer | null>(null);
  const [fallback, setFallback] = useState(false);

  useEffect(() => {
    if (!videoId || fallback) return;
    let ativo = true;
    carregarApi()
      .then((YT) => {
        if (!ativo || !ref.current) return;
        const alvo = document.createElement("div");
        ref.current.replaceChildren(alvo);
        player.current = new YT.Player(alvo, {
          videoId,
          host: "https://www.youtube-nocookie.com",
          width: "100%",
          height: "100%",
          playerVars: { autoplay: 1, rel: 0, modestbranding: 1, playsinline: 1 },
        });
      })
      .catch(() => ativo && setFallback(true));
    return () => {
      ativo = false;
      player.current?.destroy();
      player.current = null;
    };
  }, [videoId, fallback]);

  return {
    ref,
    fallback,
    /** Segundo atual do vídeo, ou undefined se o player não estiver pronto. */
    tempoAtual: (): number | undefined => {
      try {
        const t = player.current?.getCurrentTime();
        return typeof t === "number" && Number.isFinite(t) ? t : undefined;
      } catch {
        return undefined;
      }
    },
    irPara: (segundos: number) => {
      player.current?.seekTo(segundos, true);
      player.current?.playVideo();
    },
    controlavel: () => player.current !== null,
  };
}
