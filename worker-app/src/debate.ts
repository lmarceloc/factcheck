import { DurableObject } from "cloudflare:workers";
import registro from "../../config/fontes.json";
import debateConfig from "../generated/debate.json";
import { createApi } from "../../src/api";
import { configFromEnv, type AppConfig } from "../../src/config-core";
import { ClienteGateway, type ClienteDados } from "../../src/data/cliente";
import { demoBriefer, demoExtractor, demoVerifier } from "../../src/demo";
import { createExtractor } from "../../src/extractor";
import { createOpenAI } from "../../src/llm";
import { Pipeline } from "../../src/pipeline";
import type { Registro } from "../../src/shared/dados";
import type { ServerEvent } from "../../src/shared/types";
import { Store } from "../../src/store";
import { SqlPersistence } from "../../src/store-sql";
import { createSttSession } from "../../src/stt";
import { createBriefer, createVerifier } from "../../src/verifier";
import type { Plateia } from "./plateia";

export interface Env {
  DEBATE: DurableObjectNamespace<Debate>;
  PLATEIA: DurableObjectNamespace<Plateia>;
  ASSETS: Fetcher;
  DADOS?: Fetcher;
  OPENAI_API_KEY?: string;
  OPERATOR_TOKEN?: string;
  DATA_GATEWAY_TOKEN?: string;
  ASSEMBLYAI_API_KEY?: string;
  [key: string]: unknown;
}

const KEEPALIVE_MS = 20_000;
const encoder = new TextEncoder();

/**
 * Um debate = um Durable Object. Guarda o estado no SQLite próprio, roda a
 * triagem e as checagens e transmite tudo por SSE para o painel e o telão.
 */
export class Debate extends DurableObject<Env> {
  private readonly config: AppConfig;
  private readonly store: Store;
  private readonly pipeline: Pipeline;
  private readonly api: ReturnType<typeof createApi>;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    const strings = Object.fromEntries(Object.entries(env).filter(([, v]) => typeof v === "string")) as Record<string, string>;
    this.config = configFromEnv(strings, debateConfig, registro as unknown as Registro);
    const config = this.config;

    this.store = new Store(config.debate, {
      autoPublish: config.AUTO_PUBLISH,
      demo: config.DEMO_MODE,
      persistence: new SqlPersistence(ctx.storage.sql),
    });

    let dados: ClienteDados | null = null;
    if (env.DADOS && env.DATA_GATEWAY_TOKEN) {
      const binding = env.DADOS;
      dados = new ClienteGateway("https://factcheck-dados", env.DATA_GATEWAY_TOKEN, (input, init) => binding.fetch(input as RequestInfo, init));
    }

    if (config.DEMO_MODE) {
      this.pipeline = new Pipeline(this.store, demoExtractor, demoVerifier, config, { brief: demoBriefer });
    } else {
      const client = createOpenAI(config);
      this.pipeline = new Pipeline(this.store, createExtractor(client, config), createVerifier(client, config, dados), config, {
        brief: createBriefer(client, config, dados),
      });
    }

    this.api = createApi(this.store, this.pipeline, {
      operatorToken: env.OPERATOR_TOKEN,
      requireOperatorToken: true,
      createSttSession: env.ASSEMBLYAI_API_KEY ? () => createSttSession(config) : undefined,
    });
    this.store.on("event", () => this.keepAlive());
  }

  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);
    if (req.method === "GET" && (url.pathname === "/api/events" || url.pathname === "/api/public/events")) {
      return this.sse(req, url, url.pathname === "/api/events" ? "operator" : "public");
    }

    let body: unknown = undefined;
    if (req.method !== "GET" && req.method !== "HEAD") body = await req.json().catch(() => undefined);
    const r = await this.api.handle({
      method: req.method,
      path: url.pathname,
      query: url.searchParams,
      header: (name) => req.headers.get(name) ?? undefined,
      body,
    });
    this.keepAlive();
    if (r.text !== undefined) {
      return new Response(r.text, { status: r.status, headers: { "content-type": r.contentType ?? "text/plain" } });
    }
    return Response.json(r.json, { status: r.status });
  }

  /** Chamado pelas fatias da audiência (Plateia). Devolve a sessão do debate atual. */
  registrarPresenca(fonte: string, online: number, novos: number): string {
    return this.store.registrarPresenca(fonte, online, novos);
  }

  private sse(req: Request, url: URL, view: "operator" | "public"): Response {
    const header = (name: string) => req.headers.get(name) ?? undefined;
    if (view === "operator" && !this.api.isOperator({ header, query: url.searchParams })) {
      return Response.json({ error: "Token do operador ausente ou inválido." }, { status: 401 });
    }
    const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
    const writer = writable.getWriter();
    let closed = false;
    const write = (chunk: string) => {
      if (closed) return;
      writer.write(encoder.encode(chunk)).catch(() => cleanup());
    };
    const unsubscribe = this.api.subscribe(view, (event: ServerEvent) => write(`data: ${JSON.stringify(event)}\n\n`));
    const heartbeat = setInterval(() => write(": ping\n\n"), 15000);
    const cleanup = () => {
      if (closed) return;
      closed = true;
      clearInterval(heartbeat);
      unsubscribe();
      writer.close().catch(() => {});
    };
    req.signal?.addEventListener("abort", cleanup);

    return new Response(readable, {
      headers: {
        "content-type": "text/event-stream",
        "cache-control": "no-cache, no-transform",
        connection: "keep-alive",
      },
    });
  }

  /** Enquanto houver triagem ou checagem em andamento, um alarme mantém o objeto acordado. */
  private keepAlive() {
    if (!this.pipeline.busy) return;
    this.ctx.storage
      .getAlarm()
      .then((current) => {
        if (current === null) return this.ctx.storage.setAlarm(Date.now() + KEEPALIVE_MS);
      })
      .catch((err) => console.error("alarme:", err));
  }

  async alarm() {
    if (this.pipeline.busy) await this.ctx.storage.setAlarm(Date.now() + KEEPALIVE_MS);
  }
}
