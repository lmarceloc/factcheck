import Anthropic from "@anthropic-ai/sdk";
import type { AppConfig } from "./config.js";

export type Beta = Anthropic.Beta.AnthropicBeta;

/**
 * Parâmetros comuns a todas as chamadas: fallback do lado do servidor em caso
 * de recusa (`fallbacks: "default"`) e, opcionalmente, o modo rápido.
 */
export function baseParams(config: AppConfig, fast = config.FAST_MODE) {
  const betas: Beta[] = ["server-side-fallback-2026-07-01"];
  if (fast) betas.push("fast-mode-2026-02-01");
  return {
    betas,
    fallbacks: "default" as const,
    ...(fast ? { speed: "fast" as const } : {}),
  };
}

/**
 * Roda `call` com o modo rápido; se o limite de taxa do modo rápido estourar,
 * repete no modo padrão em vez de deixar a checagem parada.
 */
export async function withFastFallback<T>(config: AppConfig, call: (fast: boolean) => Promise<T>): Promise<T> {
  if (!config.FAST_MODE) return call(false);
  try {
    return await call(true);
  } catch (err) {
    if (err instanceof Anthropic.RateLimitError) {
      console.warn("[llm] limite do modo rápido atingido; repetindo no modo padrão");
      return call(false);
    }
    throw err;
  }
}

export function describeError(err: unknown): string {
  if (err instanceof Anthropic.AuthenticationError) return "Credencial da API inválida (ANTHROPIC_API_KEY).";
  if (err instanceof Anthropic.RateLimitError) return "Limite de requisições da API atingido; tente de novo.";
  if (err instanceof Anthropic.APIError) return `Erro da API (${err.status ?? "rede"}): ${err.message}`;
  if (err instanceof Error) return err.message;
  return String(err);
}
