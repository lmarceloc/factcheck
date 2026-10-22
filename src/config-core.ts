import { z } from "zod";
import type { Registro } from "./shared/dados.js";

// Configuração sem dependência de Node: usada pelo servidor Node e pelo Worker.

const SpeakerSchema = z.object({
  id: z.string().min(1),
  nome: z.string().min(1),
  partido: z.string().optional(),
  descricao: z.string().optional(),
  cor: z.string().default("#94a3b8"),
  foto: z.string().optional(),
});

export const DebateConfigSchema = z.object({
  titulo: z.string(),
  data: z.string(),
  pais: z.string().default("Brasil"),
  emissora: z.string().optional(),
  candidatos: z.array(SpeakerSchema).min(1),
  outros_falantes: z.array(SpeakerSchema).default([]),
  contexto: z.string().default(""),
  fontes_preferidas: z.array(z.string()).default([]),
});

export type Speaker = z.infer<typeof SpeakerSchema>;
export type DebateConfig = z.infer<typeof DebateConfigSchema>;

const Effort = z.enum(["low", "medium", "high", "xhigh", "max"]);
export type Effort = z.infer<typeof Effort>;

const bool = z
  .string()
  .optional()
  .transform((v) => v === "true" || v === "1");

const EnvSchema = z.object({
  PORT: z.coerce.number().default(3000),
  DEBATE_CONFIG: z.string().default("config/debate.json"),
  DATA_DIR: z.string().default("data"),
  EXTRACTION_MODEL: z.string().default("claude-opus-5-5"),
  VERIFICATION_MODEL: z.string().default("claude-opus-5-5"),
  EXTRACTION_EFFORT: Effort.default("low"),
  VERIFICATION_EFFORT: Effort.default("medium"),
  FAST_MODE: bool,
  MAX_CONCURRENT_CHECKS: z.coerce.number().int().positive().default(4),
  MAX_SEARCHES_PER_CHECK: z.coerce.number().int().positive().default(5),
  AUTO_PUBLISH: bool,
  /** Extração e checagem falsas, sem API: só para ensaio. */
  DEMO_MODE: bool,
  /** Camada de dados oficiais: auto = gateway se DATA_GATEWAY_URL existir, senão direto. */
  DATA_LAYER: z.enum(["auto", "gateway", "direto", "desligado"]).default("auto"),
  DATA_GATEWAY_URL: z.string().url().optional(),
  DATA_GATEWAY_TOKEN: z.string().optional(),
  PORTAL_TRANSPARENCIA_API_KEY: z.string().optional(),
  FONTES_CONFIG: z.string().default("config/fontes.json"),
  /** Transcrição em tempo real pelo AssemblyAI (a chave fica só no servidor). */
  ASSEMBLYAI_API_KEY: z.string().optional(),
  ASSEMBLYAI_SPEECH_MODEL: z.string().default("universal-3-6-pro"),
  /** Base do streaming (troque para a região da UE se precisar). */
  ASSEMBLYAI_BASE_URL: z.string().url().default("https://streaming.assemblyai.com/v3"),
  /** Parâmetros extras da conexão de streaming, em formato de query string (ex.: language_code=pt). */
  ASSEMBLYAI_PARAMS: z.string().default(""),
  /** Se definido, o painel do checador e as ações exigem este token; o telão continua aberto. */
  OPERATOR_TOKEN: z.string().optional(),
  NODE_ENV: z.string().default("development"),
});

export type AppConfig = z.infer<typeof EnvSchema> & { debate: DebateConfig; registro: Registro };

/** Monta a configuração a partir das variáveis de ambiente e dos JSONs já lidos. */
export function configFromEnv(
  env: Record<string, string | undefined>,
  debateRaw: unknown,
  registro: Registro,
): AppConfig {
  return { ...EnvSchema.parse(env), debate: DebateConfigSchema.parse(debateRaw), registro };
}

export function allSpeakers(debate: DebateConfig): Speaker[] {
  return [...debate.candidatos, ...debate.outros_falantes];
}
