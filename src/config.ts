import fs from "node:fs";
import path from "node:path";
import { configFromEnv, DebateConfigSchema, type AppConfig, type DebateConfig } from "./config-core.js";
import type { Registro } from "./shared/dados.js";

export * from "./config-core.js";

export function loadDebateConfig(file: string): DebateConfig {
  const candidates = [file, "config/debate.example.json"];
  for (const candidate of candidates) {
    const resolved = path.resolve(candidate);
    if (fs.existsSync(resolved)) {
      const raw = JSON.parse(fs.readFileSync(resolved, "utf8"));
      if (candidate !== file) {
        console.warn(`[config] ${file} não encontrado; usando ${candidate}`);
      }
      return DebateConfigSchema.parse(raw);
    }
  }
  throw new Error(`Arquivo de configuração do debate não encontrado: ${file}`);
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const debateFile = env.DEBATE_CONFIG ?? "config/debate.json";
  const fontesFile = env.FONTES_CONFIG ?? "config/fontes.json";
  const registro = JSON.parse(fs.readFileSync(path.resolve(fontesFile), "utf8")) as Registro;
  return configFromEnv(env, loadDebateConfig(debateFile), registro);
}
