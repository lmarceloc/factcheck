// Prepara o Worker do app: embute a configuração do debate (config/debate.json,
// ou o exemplo se ainda não existir) para o Durable Object.
import fs from "node:fs";
import { DebateConfigSchema } from "../src/config-core.js";

const fonte = fs.existsSync("config/debate.json") ? "config/debate.json" : "config/debate.example.json";
const debate = DebateConfigSchema.parse(JSON.parse(fs.readFileSync(fonte, "utf8")));
fs.mkdirSync("worker-app/generated", { recursive: true });
fs.writeFileSync("worker-app/generated/debate.json", JSON.stringify(debate, null, 2));
console.log(`worker-app/generated/debate.json ← ${fonte} (${debate.titulo})`);
if (fonte.endsWith("example.json")) console.warn("⚠  Usando o debate de exemplo. Crie config/debate.json com os candidatos reais.");
