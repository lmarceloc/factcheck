import OpenAI from "openai";
import type { AppConfig } from "./config-core.js";

/** Cliente da OpenAI (GPT-6 Luna por padrão) usado na triagem e na checagem. */
export function createOpenAI(config: Pick<AppConfig, "OPENAI_API_KEY">): OpenAI {
  // Sem chave o app sobe mesmo assim (painel e telão funcionam); as checagens
  // falham com "credencial inválida" até a chave ser configurada.
  if (!config.OPENAI_API_KEY) console.warn("[openai] OPENAI_API_KEY não configurada: as checagens vão falhar.");
  return new OpenAI({ apiKey: config.OPENAI_API_KEY ?? "chave-nao-configurada" });
}

export function describeError(err: unknown): string {
  if (err instanceof OpenAI.AuthenticationError) return "Credencial da OpenAI inválida (OPENAI_API_KEY).";
  if (err instanceof OpenAI.RateLimitError) return "Limite de requisições da OpenAI atingido; tente de novo.";
  if (err instanceof OpenAI.APIError) return `Erro da API da OpenAI (${err.status ?? "rede"}): ${err.message}`;
  if (err instanceof Error) return err.message;
  return String(err);
}
