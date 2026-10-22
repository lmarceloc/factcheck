import express, { type Request, type Response } from "express";
import { createApi, type ApiOptions } from "./api.js";
import type { Pipeline } from "./pipeline.js";
import type { ServerEvent } from "./shared/types.js";
import type { Store } from "./store.js";

export { publicEvent, publicSnapshot } from "./api.js";

/** Servidor Node: traduz as requisições do Express para a API e serve o fluxo SSE. */
export function createApp(store: Store, pipeline: Pipeline, opts: ApiOptions = {}) {
  const app = express();
  app.use(express.json({ limit: "1mb" }));
  const api = createApi(store, pipeline, opts);

  const header = (req: Request) => (name: string) => req.get(name) ?? undefined;
  const query = (req: Request) => new URLSearchParams(req.url.split("?")[1] ?? "");

  // Server-Sent Events: estado inicial e depois cada mudança, em tempo real.
  const sse = (view: "operator" | "public") => (req: Request, res: Response) => {
    if (view === "operator" && !api.isOperator({ header: header(req), query: query(req) })) {
      return void res.status(401).json({ error: "Token do operador ausente ou inválido." });
    }
    res.set({
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    res.flushHeaders();
    const unsubscribe = api.subscribe(view, (event: ServerEvent) => res.write(`data: ${JSON.stringify(event)}\n\n`));
    const heartbeat = setInterval(() => res.write(": ping\n\n"), 15000);
    req.on("close", () => {
      clearInterval(heartbeat);
      unsubscribe();
    });
  };
  app.get("/api/events", sse("operator"));
  app.get("/api/public/events", sse("public"));

  app.use("/api", async (req, res) => {
    const r = await api.handle({
      method: req.method,
      path: `/api${req.path}`,
      query: query(req),
      header: header(req),
      body: req.body,
    });
    if (r.text !== undefined) res.status(r.status).type(r.contentType ?? "text/plain").send(r.text);
    else res.status(r.status).json(r.json);
  });

  return app;
}
