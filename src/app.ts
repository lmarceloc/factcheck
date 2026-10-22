import express, { type NextFunction, type Request, type Response } from "express";
import { z } from "zod";
import type { Pipeline } from "./pipeline.js";
import { markdownReport } from "./report.js";
import type { Claim, PublicState, ServerEvent } from "./shared/types.js";
import { VERDICTS } from "./shared/types.js";
import type { Store } from "./store.js";

const isPublic = (c: Claim) => c.status === "publicada";

/** O telão só enxerga o que o editor publicou: nada de rascunho nem transcrição bruta. */
export function publicSnapshot(state: PublicState): PublicState {
  return { ...state, segments: [], claims: state.claims.filter(isPublic) };
}

export function publicEvent(event: ServerEvent): ServerEvent | null {
  switch (event.type) {
    case "claim":
      return isPublic(event.claim) ? event : { type: "claim_hidden", id: event.claim.id };
    case "segment":
    case "interim":
      return null;
    default:
      return event;
  }
}

const TranscriptBody = z.object({
  speakerId: z.string().optional(),
  text: z.string(),
  final: z.boolean().default(true),
});
const SpeakerBody = z.object({ speakerId: z.string().nullable() });
const ManualClaimBody = z.object({ speakerId: z.string(), text: z.string().min(3) });
const EditBody = z.object({
  veredito: z.enum(VERDICTS).optional(),
  resumo: z.string().optional(),
  explicacao: z.string().optional(),
  dados: z.string().optional(),
});
const SettingsBody = z.object({ autoPublish: z.boolean() });

export function createApp(store: Store, pipeline: Pipeline, opts: { operatorToken?: string } = {}) {
  const app = express();
  app.use(express.json({ limit: "1mb" }));
  const speakerIds = new Set([...store.debate.candidatos, ...store.debate.outros_falantes].map((s) => s.id));

  const requireOperator = (req: Request, res: Response, next: NextFunction) => {
    if (!opts.operatorToken) return next();
    const token = req.get("x-operator-token") ?? req.query.token;
    if (token === opts.operatorToken) return next();
    res.status(401).json({ error: "Token do operador ausente ou inválido." });
  };

  const getClaim = (req: Request, res: Response): Claim | undefined => {
    const claim = store.claims.get(String(req.params.id));
    if (!claim) res.status(404).json({ error: "Afirmação não encontrada." });
    return claim;
  };

  app.get("/api/health", (_req, res) => {
    res.json({ ok: true, fila: pipeline.checks.size, verificando: pipeline.checks.active });
  });

  app.get("/api/public/state", (_req, res) => res.json(publicSnapshot(store.snapshot())));
  app.get("/api/state", requireOperator, (_req, res) => res.json(store.snapshot()));

  // Server-Sent Events: estado inicial e depois cada mudança, em tempo real.
  const sse = (view: "operator" | "public") => (req: Request, res: Response) => {
    res.set({
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    res.flushHeaders();
    const send = (event: ServerEvent) => res.write(`data: ${JSON.stringify(event)}\n\n`);
    const state = store.snapshot();
    send({ type: "snapshot", state: view === "public" ? publicSnapshot(state) : state });

    const listener = (event: ServerEvent) => {
      const out = view === "public" ? publicEvent(event) : event;
      if (out) send(out);
    };
    store.on("event", listener);
    const heartbeat = setInterval(() => res.write(": ping\n\n"), 15000);
    req.on("close", () => {
      clearInterval(heartbeat);
      store.off("event", listener);
    });
  };
  app.get("/api/events", requireOperator, sse("operator"));
  app.get("/api/public/events", sse("public"));

  app.post("/api/transcript", requireOperator, (req, res) => {
    const body = TranscriptBody.safeParse(req.body);
    if (!body.success) return void res.status(400).json({ error: body.error.message });
    const speakerId = body.data.speakerId ?? store.currentSpeaker;
    if (!speakerId || !speakerIds.has(speakerId)) {
      return void res.status(400).json({ error: "Selecione quem está falando antes de enviar a transcrição." });
    }
    if (!body.data.final) {
      store.emitEvent({ type: "interim", speakerId, text: body.data.text });
      return void res.json({ ok: true });
    }
    const segment = pipeline.ingest(speakerId, body.data.text);
    res.json({ ok: true, segment });
  });

  app.post("/api/speaker", requireOperator, (req, res) => {
    const body = SpeakerBody.safeParse(req.body);
    if (!body.success || (body.data.speakerId && !speakerIds.has(body.data.speakerId))) {
      return void res.status(400).json({ error: "Orador inválido." });
    }
    // Troca de orador fecha o trecho de quem falava antes.
    pipeline.segmenter.flush();
    store.setSpeaker(body.data.speakerId);
    res.json({ ok: true });
  });

  app.post("/api/flush", requireOperator, (_req, res) => {
    pipeline.segmenter.flush();
    res.json({ ok: true });
  });

  app.post("/api/claims", requireOperator, (req, res) => {
    const body = ManualClaimBody.safeParse(req.body);
    if (!body.success || !speakerIds.has(body.data.speakerId)) {
      return void res.status(400).json({ error: "Informe o orador e a afirmação." });
    }
    res.json(pipeline.submitManual(body.data.speakerId, body.data.text));
  });

  app.post("/api/claims/:id/publish", requireOperator, (req, res) => {
    const claim = getClaim(req, res);
    if (!claim) return;
    if (!claim.resultado) return void res.status(409).json({ error: "A checagem ainda não terminou." });
    res.json(store.updateClaim(claim.id, { status: "publicada", publishedAt: Date.now() }));
  });

  app.post("/api/claims/:id/unpublish", requireOperator, (req, res) => {
    const claim = getClaim(req, res);
    if (!claim) return;
    res.json(store.updateClaim(claim.id, { status: claim.resultado ? "rascunho" : "na_fila", publishedAt: undefined }));
  });

  app.post("/api/claims/:id/discard", requireOperator, (req, res) => {
    const claim = getClaim(req, res);
    if (!claim) return;
    res.json(store.updateClaim(claim.id, { status: "descartada", publishedAt: undefined }));
  });

  app.post("/api/claims/:id/recheck", requireOperator, (req, res) => {
    const claim = getClaim(req, res);
    if (!claim) return;
    res.json(pipeline.recheck(claim.id));
  });

  app.patch("/api/claims/:id", requireOperator, (req, res) => {
    const claim = getClaim(req, res);
    if (!claim) return;
    const body = EditBody.safeParse(req.body);
    if (!body.success) return void res.status(400).json({ error: body.error.message });
    if (!claim.resultado) return void res.status(409).json({ error: "A checagem ainda não terminou." });
    res.json(store.updateClaim(claim.id, { resultado: { ...claim.resultado, ...body.data }, editado: true }));
  });

  app.post("/api/settings", requireOperator, (req, res) => {
    const body = SettingsBody.safeParse(req.body);
    if (!body.success) return void res.status(400).json({ error: body.error.message });
    store.setAutoPublish(body.data.autoPublish);
    res.json({ ok: true });
  });

  app.get("/api/report.md", (_req, res) => {
    res.type("text/markdown; charset=utf-8").send(markdownReport(publicSnapshot(store.snapshot())));
  });
  app.get("/api/report.json", requireOperator, (_req, res) => res.json(store.snapshot()));

  return app;
}
