import { useEffect } from "react";
import { PRESENCA_INTERVALO_MS } from "../../src/presenca";

const CHAVE = "fc-visitante";

/** Id aleatório deste navegador (o mesmo em todas as abas), só para não contar a pessoa duas vezes. */
function idVisitante(): string {
  try {
    const salvo = localStorage.getItem(CHAVE);
    if (salvo) return salvo;
    const novo = crypto.randomUUID();
    localStorage.setItem(CHAVE, novo);
    return novo;
  } catch {
    return crypto.randomUUID();
  }
}

/** Avisa o servidor que esta tela do público está aberta (a cada 30 s) e quando fecha. */
export function usePresenca(ativo: boolean) {
  useEffect(() => {
    if (!ativo) return;
    const id = idVisitante();
    const url = "/api/public/presenca";
    const bater = () =>
      fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id }), keepalive: true }).catch(() => {});
    const sair = () => navigator.sendBeacon?.(url, JSON.stringify({ id, saindo: true }));
    // Voltou pelo "voltar" do navegador (página guardada em cache): avisa de novo.
    const voltar = (e: PageTransitionEvent) => e.persisted && bater();

    bater();
    const timer = window.setInterval(bater, PRESENCA_INTERVALO_MS);
    window.addEventListener("pagehide", sair);
    window.addEventListener("pageshow", voltar);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("pagehide", sair);
      window.removeEventListener("pageshow", voltar);
    };
  }, [ativo]);
}
