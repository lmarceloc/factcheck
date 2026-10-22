import type { ArquivoResumo, Claim, Verdict } from "../../src/shared/types";

const TOKEN_KEY = "factcheck.token";

/**
 * Token do operador: vem de ?token= na URL e fica guardado neste navegador.
 * Sai da barra de endereço na hora (não aparece em print, tela compartilhada nem histórico).
 */
export function operatorToken(): string | null {
  const params = new URLSearchParams(location.search);
  const fromUrl = params.get("token");
  try {
    if (fromUrl) {
      localStorage.setItem(TOKEN_KEY, fromUrl);
      params.delete("token");
      const resto = params.toString();
      history.replaceState(history.state, "", `${location.pathname}${resto ? `?${resto}` : ""}${location.hash}`);
    }
    return fromUrl ?? localStorage.getItem(TOKEN_KEY);
  } catch {
    return fromUrl;
  }
}

async function request<T>(method: string, url: string, body?: unknown): Promise<T> {
  const token = operatorToken();
  const res = await fetch(url, {
    method,
    headers: {
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      ...(token ? { "x-operator-token": token } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error ?? `Erro ${res.status}`);
  return data as T;
}

export const api = {
  transcript: (text: string, final = true, speakerId?: string, videoTime?: number) =>
    request("POST", "/api/transcript", { text, final, speakerId, videoTime }),
  encerrar: () => request<ArquivoResumo>("POST", "/api/encerrar"),
  limpar: () => request("POST", "/api/limpar"),
  setSpeaker: (speakerId: string | null) => request("POST", "/api/speaker", { speakerId }),
  flush: () => request("POST", "/api/flush"),
  manualClaim: (speakerId: string, text: string) => request<Claim>("POST", "/api/claims", { speakerId, text }),
  publish: (id: string) => request<Claim>("POST", `/api/claims/${id}/publish`),
  unpublish: (id: string) => request<Claim>("POST", `/api/claims/${id}/unpublish`),
  discard: (id: string) => request<Claim>("POST", `/api/claims/${id}/discard`),
  recheck: (id: string) => request<Claim>("POST", `/api/claims/${id}/recheck`),
  edit: (id: string, patch: { veredito?: Verdict; resumo?: string; explicacao?: string; dados?: string; speakerId?: string }) =>
    request<Claim>("PATCH", `/api/claims/${id}`, patch),
  settings: (autoPublish: boolean) => request("POST", "/api/settings", { autoPublish }),
  transmissao: (body: { youtube?: string | null; captura?: boolean }) => request("POST", "/api/transmissao", body),
  sttConfig: () => request<{ assemblyai: boolean }>("GET", "/api/stt/config"),
  sttSession: () => request<{ url: string; sampleRate: number }>("POST", "/api/stt/session"),
};

export function eventsUrl(view: "operator" | "public") {
  if (view === "public") return "/api/public/events";
  const token = operatorToken();
  return token ? `/api/events?token=${encodeURIComponent(token)}` : "/api/events";
}
