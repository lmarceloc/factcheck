import { useEffect, useState } from "react";
import type { PublicState } from "../../src/shared/types";

/**
 * Estado público por consulta periódica (com cache no Worker): aguenta muita
 * gente assistindo sem manter uma conexão aberta por espectador.
 */
export function usePublicState(intervalMs = 3000) {
  const [data, setData] = useState<PublicState | null>(null);
  const [online, setOnline] = useState(true);

  useEffect(() => {
    let stopped = false;
    let timer = 0;
    const tick = async () => {
      try {
        const res = await fetch("/api/public/state", { cache: "no-store" });
        if (!res.ok) throw new Error(String(res.status));
        const next = (await res.json()) as PublicState;
        if (!stopped) {
          setData(next);
          setOnline(true);
        }
      } catch {
        if (!stopped) setOnline(false);
      }
      if (!stopped) timer = window.setTimeout(tick, document.hidden ? intervalMs * 4 : intervalMs);
    };
    tick();
    const onVisible = () => {
      if (!document.hidden) {
        window.clearTimeout(timer);
        tick();
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      stopped = true;
      window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [intervalMs]);

  return { data, online };
}
