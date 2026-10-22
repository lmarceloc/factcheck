import { z } from "zod";
import { PresencaBody, type Presenca } from "./presenca.js";
import type { Pipeline } from "./pipeline.js";
import { markdownReport } from "./report.js";
import type { Claim, PublicState, ServerEvent } from "./shared/types.js";
import { AUTO_SPEAKER, motivoRevisao, ORADOR_NAO_IDENTIFICADO, VERDICTS } from "./shared/types.js";
import type { Store } from "./store.js";
import type { SttSession } from "./stt.js";

// Rotas da API sem depender de framework: o Express (Node) e o Durable Object
// (Cloudflare) só traduzem a requisição e a resposta.

export interface ApiRequest {
  method: string;
  path: string;
  query: URLSearchParams;
  header(name: string): string | undefined;
  body: unknown;
}

export interface ApiResponse {
  status: number;
  json?: unknown;
  text?: string;
  contentType?: string;
}

export interface ApiOptions {
  operatorToken?: string;
  /** No Cloudflare o token é obrigatório: sem ele o painel fica fechado. */
  requireOperatorToken?: boolean;
  createSttSession?: () => Promise<SttSession>;
  /** Contagem de audiência local (Node). No Cloudflare o Worker cuida disso antes de chegar aqui. */
  presenca?: Presenca;
}

const isPublic = (c: Claim) => c.status === "publicada";

/** Tira da checagem o que é interno da redação (nota ao editor, motivo de revisão, buscas). */
export function publicClaim(c: Claim): Claim {
  const { revisao: _revisao, erro: _erro, progresso: _progresso, resultado, ...rest } = c;
  return {
    ...rest,
    progresso: [],
    ...(resultado ? { resultado: { ...resultado, nota_editor: null, buscas: [] } } : {}),
  };
}

/** O público só enxerga o que o editor publicou: nada de rascunho, transcrição bruta ou nota interna. */
export function publicSnapshot(state: PublicState): PublicState {
  return {
    ...state,
    segments: [],
    claims: state.claims.filter(isPublic).map(publicClaim),
    audiencia: { online: state.audiencia?.online ?? 0 },
  };
}

export function publicEvent(event: ServerEvent): ServerEvent | null {
  switch (event.type) {
    case "snapshot":
      return { type: "snapshot", state: publicSnapshot(event.state) };
    case "claim":
      return isPublic(event.claim) ? { type: "claim", claim: publicClaim(event.claim) } : { type: "claim_hidden", id: event.claim.id };
    case "audiencia":
      return { type: "audiencia", audiencia: { online: event.audiencia.online } };
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
  /** Segundo do vídeo do YouTube em que a fala começou. */
  videoTime: z.number().nonnegative().optional(),
});
const SpeakerBody = z.object({ speakerId: z.string().nullable() });
const ManualClaimBody = z.object({ speakerId: z.string(), text: z.string().min(3) });
const EditBody = z.object({
  veredito: z.enum(VERDICTS).optional(),
  resumo: z.string().optional(),
  explicacao: z.string().optional(),
  dados: z.string().optional(),
  speakerId: z.string().optional(),
});
const SettingsBody = z.object({ autoPublish: z.boolean() });
const TransmissaoBody = z.object({
  youtube: z.string().regex(/^[\w-]{11}$/).nullable().optional(),
  captura: z.boolean().optional(),
});

const ok = (json: unknown): ApiResponse => ({ status: 200, json });
const fail = (status: number, error: string): ApiResponse => ({ status, json: { error } });

export function createApi(store: Store, pipeline: Pipeline, opts: ApiOptions = {}) {
  const speakerIds = new Set([...store.debate.candidatos, ...store.debate.outros_falantes].map((s) => s.id));
  speakerIds.add(AUTO_SPEAKER);

  /** Painel e ações exigem o token do operador (quando configurado); o telão é aberto. */
  function isOperator(req: Pick<ApiRequest, "header" | "query">): boolean {
    if (!opts.operatorToken) return !opts.requireOperatorToken;
    return (req.header("x-operator-token") ?? req.query.get("token")) === opts.operatorToken;
  }

  /** Assinatura do fluxo de eventos (SSE). Devolve a função para cancelar. */
  function subscribe(view: "operator" | "public", send: (event: ServerEvent) => void): () => void {
    const state = store.snapshot();
    send({ type: "snapshot", state: view === "public" ? publicSnapshot(state) : state });
    const listener = (event: ServerEvent) => {
      const out = view === "public" ? publicEvent(event) : event;
      if (out) send(out);
    };
    store.on("event", listener);
    return () => store.off("event", listener);
  }

  async function handle(req: ApiRequest): Promise<ApiResponse> {
    const { method, path } = req;
    const route = `${method} ${path}`;

    // Rotas públicas
    if (route === "GET /api/health") {
      return ok({ ok: true, fila: pipeline.checks.size, verificando: pipeline.checks.active });
    }
    if (route === "GET /api/public/state") return ok(publicSnapshot(store.snapshot()));
    const chk = path.match(/^\/api\/public\/checagem\/([\w-]+)$/);
    if (chk && method === "GET") {
      const achada = store.findPublished(chk[1]);
      return achada ? ok({ ...achada, claim: publicClaim(achada.claim) }) : fail(404, "Checagem não encontrada.");
    }
    // Debates encerrados: lista e cada um completo (o público vê só o que foi publicado).
    if (route === "GET /api/arquivos") {
      const lista = store.listArchives();
      return ok(isOperator(req) ? lista : lista.map(({ pico: _p, visitantes: _v, ...r }) => r));
    }
    if (route === "POST /api/public/presenca" && opts.presenca) {
      const body = PresencaBody.safeParse(req.body);
      if (!body.success) return fail(400, "Presença inválida.");
      opts.presenca.bater(body.data.id, body.data.saindo);
      return ok({ ok: true });
    }
    const arq = path.match(/^\/api\/arquivos\/([\w-]+)$/);
    if (arq && method === "GET") {
      const estado = store.getArchive(arq[1]);
      if (!estado) return fail(404, "Debate não encontrado.");
      return ok(isOperator(req) ? estado : publicSnapshot(estado));
    }
    const arqMd = path.match(/^\/api\/arquivos\/([\w-]+)\/report\.md$/);
    if (arqMd && method === "GET") {
      const estado = store.getArchive(arqMd[1]);
      if (!estado) return fail(404, "Debate não encontrado.");
      return { status: 200, text: markdownReport(publicSnapshot(estado)), contentType: "text/markdown; charset=utf-8" };
    }

    if (route === "GET /api/report.md") {
      return { status: 200, text: markdownReport(publicSnapshot(store.snapshot())), contentType: "text/markdown; charset=utf-8" };
    }

    if (!isOperator(req)) {
      return fail(401, opts.operatorToken ? "Token do operador ausente ou inválido." : "Configure OPERATOR_TOKEN para abrir o painel.");
    }

    if (route === "GET /api/state") return ok(store.snapshot());
    if (route === "GET /api/report.json") return ok(store.snapshot());

    if (route === "GET /api/stt/config") return ok({ assemblyai: Boolean(opts.createSttSession) });
    if (route === "POST /api/stt/session") {
      if (!opts.createSttSession) return fail(404, "AssemblyAI não configurado.");
      try {
        return ok(await opts.createSttSession());
      } catch (err) {
        return fail(502, err instanceof Error ? err.message : String(err));
      }
    }

    if (route === "POST /api/transcript") {
      const body = TranscriptBody.safeParse(req.body);
      if (!body.success) return fail(400, body.error.message);
      const speakerId = body.data.speakerId ?? store.currentSpeaker;
      if (!speakerId || !speakerIds.has(speakerId)) {
        return fail(400, "Selecione quem está falando antes de enviar a transcrição.");
      }
      if (!body.data.final) {
        store.emitEvent({ type: "interim", speakerId, text: body.data.text });
        return ok({ ok: true });
      }
      return ok({ ok: true, segment: pipeline.ingest(speakerId, body.data.text, undefined, body.data.videoTime) });
    }

    if (route === "POST /api/speaker") {
      const body = SpeakerBody.safeParse(req.body);
      if (!body.success || (body.data.speakerId && !speakerIds.has(body.data.speakerId))) {
        return fail(400, "Orador inválido.");
      }
      // Troca de orador fecha o trecho de quem falava antes.
      pipeline.segmenter.flush();
      store.setSpeaker(body.data.speakerId);
      return ok({ ok: true });
    }

    if (route === "POST /api/flush") {
      pipeline.segmenter.flush();
      return ok({ ok: true });
    }

    if (route === "POST /api/claims") {
      const body = ManualClaimBody.safeParse(req.body);
      if (!body.success || !speakerIds.has(body.data.speakerId)) return fail(400, "Informe o orador e a afirmação.");
      return ok(pipeline.submitManual(body.data.speakerId, body.data.text));
    }

    // A redação define o vídeo da transmissão (mostrado a todos) e avisa quando está transcrevendo.
    if (route === "POST /api/transmissao") {
      const body = TransmissaoBody.safeParse(req.body);
      if (!body.success) return fail(400, "Vídeo do YouTube inválido.");
      if (body.data.youtube !== undefined) store.setYoutube(body.data.youtube);
      if (body.data.captura !== undefined) {
        store.setCaptura(body.data.captura);
        if (!body.data.captura) pipeline.segmenter.flush();
      }
      return ok(store.settings());
    }

    if (route === "POST /api/encerrar") {
      pipeline.reset();
      return ok(store.encerrar());
    }

    if (route === "POST /api/settings") {
      const body = SettingsBody.safeParse(req.body);
      if (!body.success) return fail(400, body.error.message);
      store.setAutoPublish(body.data.autoPublish);
      return ok({ ok: true });
    }

    const m = path.match(/^\/api\/claims\/([^/]+)(?:\/(publish|unpublish|discard|recheck))?$/);
    if (m) {
      const claim = store.claims.get(decodeURIComponent(m[1]));
      if (!claim) return fail(404, "Afirmação não encontrada.");
      const action = m[2];
      if (method === "POST" && action === "publish") {
        if (claim.tipo === "pergunta") return fail(409, "Perguntas ficam só no painel; não vão para o telão.");
        if (claim.speakerId === AUTO_SPEAKER) return fail(409, "Escolha quem disse antes de publicar.");
        if (!claim.resultado) return fail(409, "A checagem ainda não terminou.");
        return ok(store.updateClaim(claim.id, { status: "publicada", publishedAt: Date.now() }));
      }
      if (method === "POST" && action === "unpublish") {
        return ok(store.updateClaim(claim.id, { status: claim.resultado ? "rascunho" : "na_fila", publishedAt: undefined }));
      }
      if (method === "POST" && action === "discard") {
        return ok(store.updateClaim(claim.id, { status: "descartada", publishedAt: undefined }));
      }
      if (method === "POST" && action === "recheck") return ok(pipeline.recheck(claim.id));
      if (method === "PATCH" && !action) {
        const body = EditBody.safeParse(req.body);
        if (!body.success) return fail(400, body.error.message);
        const { speakerId, ...resultado } = body.data;
        if (speakerId && !speakerIds.has(speakerId)) return fail(400, "Orador inválido.");
        if (!claim.resultado && Object.keys(resultado).length) return fail(409, "A checagem ainda não terminou.");
        const novoResultado = claim.resultado ? { ...claim.resultado, ...resultado } : undefined;
        const patch: Partial<Claim> = {
          ...(speakerId ? { speakerId } : {}),
          ...(novoResultado ? { resultado: novoResultado } : {}),
          editado: true,
        };
        // Retida só por falta de orador: com o nome escolhido, vai ao ar na hora.
        if (speakerId && claim.status === "rascunho" && claim.revisao === ORADOR_NAO_IDENTIFICADO && novoResultado) {
          const motivo = motivoRevisao(novoResultado, speakerId);
          patch.revisao = motivo ?? undefined;
          if (!motivo && store.autoPublish) Object.assign(patch, { status: "publicada", publishedAt: Date.now() });
        }
        return ok(store.updateClaim(claim.id, patch));
      }
    }

    return fail(404, "Rota não encontrada.");
  }

  return { handle, subscribe, isOperator };
}
