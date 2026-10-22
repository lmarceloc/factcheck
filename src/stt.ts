import type { AppConfig } from "./config-core.js";

export interface SttSession {
  /** URL completa do WebSocket, já com o token temporário (uso único). */
  url: string;
  sampleRate: number;
}

/**
 * Gera um token temporário do AssemblyAI para o navegador abrir o streaming
 * direto, sem nunca ver a chave da API.
 */
export async function createSttSession(
  config: Pick<AppConfig, "ASSEMBLYAI_API_KEY" | "ASSEMBLYAI_SPEECH_MODEL" | "ASSEMBLYAI_PARAMS" | "ASSEMBLYAI_BASE_URL">,
  fetchImpl: typeof fetch = fetch,
): Promise<SttSession> {
  if (!config.ASSEMBLYAI_API_KEY) throw new Error("ASSEMBLYAI_API_KEY não configurada.");
  const base = config.ASSEMBLYAI_BASE_URL.replace(/\/+$/, "");
  const tokenUrl = `${base}/token?${new URLSearchParams({
    expires_in_seconds: "60",
    max_session_duration_seconds: "10800",
  })}`;
  const res = await fetchImpl(tokenUrl, {
    headers: { Authorization: config.ASSEMBLYAI_API_KEY },
    signal: AbortSignal.timeout(10000),
  });
  const data = (await res.json().catch(() => ({}))) as { token?: string; error?: string };
  if (!res.ok || !data.token) throw new Error(`AssemblyAI recusou o token (${res.status}): ${data.error ?? "sem detalhes"}`);

  const sampleRate = 16000;
  const params = new URLSearchParams({
    sample_rate: String(sampleRate),
    encoding: "pcm_s16le",
    speech_model: config.ASSEMBLYAI_SPEECH_MODEL,
  });
  for (const [k, v] of new URLSearchParams(config.ASSEMBLYAI_PARAMS)) params.set(k, v);
  params.set("token", data.token);
  return { url: `${base.replace(/^http/, "ws")}/ws?${params}`, sampleRate };
}
