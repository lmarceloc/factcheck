import Anthropic from "@anthropic-ai/sdk";
import express from "express";
import fs from "node:fs";
import path from "node:path";
import { createApp } from "./app.js";
import { criarClienteDados } from "./data/cliente.js";
import { createSttSession } from "./stt.js";
import { demoExtractor, demoVerifier } from "./demo.js";
import { loadConfig } from "./config.js";
import { createExtractor } from "./extractor.js";
import { Pipeline } from "./pipeline.js";
import { Store } from "./store.js";
import { FilePersistence } from "./store-file.js";
import { createVerifier } from "./verifier.js";

// Lê o .env se existir; variáveis já definidas no ambiente têm prioridade.
try {
  process.loadEnvFile(".env");
} catch {
  /* sem .env: segue só com o ambiente */
}

const config = loadConfig();
const dados = config.DEMO_MODE ? null : criarClienteDados(config);

const store = new Store(config.debate, {
  autoPublish: config.AUTO_PUBLISH,
  demo: config.DEMO_MODE,
  persistence: new FilePersistence(path.join(config.DATA_DIR, config.DEMO_MODE ? "state-demo.json" : "state.json")),
});
const pipeline = config.DEMO_MODE
  ? new Pipeline(store, demoExtractor, demoVerifier, config)
  : (() => {
      const client = new Anthropic();
      return new Pipeline(store, createExtractor(client, config), createVerifier(client, config, dados), config);
    })();
const app = createApp(store, pipeline, {
  operatorToken: config.OPERATOR_TOKEN,
  createSttSession: config.ASSEMBLYAI_API_KEY ? () => createSttSession(config) : undefined,
});

const webRoot = path.resolve("web");
const dist = path.resolve("dist/web");

if (config.NODE_ENV === "production" && fs.existsSync(dist)) {
  app.use(express.static(dist));
  app.get(/^\/(?!api\/).*/, (_req, res) => res.sendFile(path.join(dist, "index.html")));
} else {
  // Em desenvolvimento o Vite roda dentro do mesmo servidor, com recarga instantânea.
  const { createServer } = await import("vite");
  const vite = await createServer({ root: webRoot, server: { middlewareMode: true }, appType: "spa" });
  app.use(vite.middlewares);
}

const server = app.listen(config.PORT, () => {
  console.log(`\n  Checagem ao vivo — ${config.debate.titulo}`);
  console.log(`  Painel do checador: http://localhost:${config.PORT}/`);
  console.log(`  Telão / overlay:    http://localhost:${config.PORT}/telao\n`);
  console.log(
    config.ASSEMBLYAI_API_KEY
      ? `  Transcrição: AssemblyAI (${config.ASSEMBLYAI_SPEECH_MODEL})`
      : "  Transcrição: reconhecimento de voz do navegador (defina ASSEMBLYAI_API_KEY para usar o AssemblyAI)",
  );
  if (!config.DEMO_MODE) {
    console.log(
      dados
        ? `  Fontes oficiais: ${dados.modo === "gateway" ? `gateway ${config.DATA_GATEWAY_URL}` : "consulta direta (sem gateway; TSE indisponível)"}\n`
        : "  Fontes oficiais: desligadas (só busca na web)\n",
    );
  }
  if (config.DEMO_MODE) console.log("  ⚠  MODO DEMONSTRAÇÃO: as checagens são falsas, só para ensaio.\n");
});

const shutdown = () => {
  store.saveNow();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 2000).unref();
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
