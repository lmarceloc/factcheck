import type { AppConfig } from "./config-core.js";
import type { Extractor } from "./extractor.js";
import { describeError } from "./llm.js";
import { PriorityQueue } from "./queue.js";
import { Segmenter, type Chunk } from "./segmenter.js";
import { AUTO_SPEAKER, motivoRevisao, type Claim, type Segment } from "./shared/types.js";
import type { Store } from "./store.js";
import type { Briefer, Verifier } from "./verifier.js";

const CONTEXT_SEGMENTS = 12;
const KNOWN_CLAIMS = 40;

/**
 * Fala → trechos → afirmações checáveis → checagem com busca na web → painel.
 */
export class Pipeline {
  readonly segmenter: Segmenter;
  readonly checks: PriorityQueue;
  private readonly extractions = new PriorityQueue(2);
  /** Pesquisa de contexto das perguntas (sem ela, perguntas são ignoradas). */
  private readonly brief?: Briefer;

  constructor(
    private readonly store: Store,
    private readonly extract: Extractor,
    private readonly verify: Verifier,
    config: Pick<AppConfig, "MAX_CONCURRENT_CHECKS">,
    opts: { segmenter?: ConstructorParameters<typeof Segmenter>[1]; brief?: Briefer } = {},
  ) {
    this.brief = opts.brief;
    this.checks = new PriorityQueue(config.MAX_CONCURRENT_CHECKS);
    this.segmenter = new Segmenter((chunk) => this.extractions.add("alta", () => this.handleChunk(chunk)), opts.segmenter);
    for (const claim of store.claims.values()) {
      if (claim.status === "na_fila") this.enqueue(claim);
    }
  }

  /** Há trabalho em andamento (triagem ou checagem)? Usado para manter o Durable Object acordado. */
  get busy(): boolean {
    return (
      this.segmenter.pending ||
      this.checks.size + this.checks.active + this.extractions.size + this.extractions.active > 0
    );
  }

  /** Recebe um pedaço final de transcrição de quem está falando. */
  ingest(speakerId: string, text: string, at?: number): Segment | null {
    const clean = text.replace(/\s+/g, " ").trim();
    if (!clean) return null;
    const segment = this.store.addSegment(speakerId, clean, at);
    this.segmenter.push(segment);
    return segment;
  }

  /** Afirmação digitada pelo checador: vai direto para a fila, com prioridade alta. */
  submitManual(speakerId: string, text: string): Claim {
    const claim = this.store.addClaim({
      speakerId,
      segmentIds: [],
      trecho: text,
      afirmacao: text,
      categoria: "outro",
      alvo: null,
      prioridade: "alta",
    });
    this.enqueue(claim);
    return claim;
  }

  recheck(id: string): Claim | undefined {
    const claim = this.store.updateClaim(id, {
      status: "na_fila",
      resultado: undefined,
      contexto: undefined,
      erro: undefined,
      repeteDe: undefined,
      editado: false,
      progresso: [],
      publishedAt: undefined,
    });
    if (claim) this.enqueue(claim);
    return claim;
  }

  async handleChunk(chunk: Chunk) {
    const firstIdx = this.store.segments.findIndex((s) => s.id === chunk.segmentIds[0]);
    const context = this.store.segments.slice(Math.max(0, firstIdx - CONTEXT_SEGMENTS), Math.max(0, firstIdx));
    const known = this.store.recentClaims(KNOWN_CLAIMS).filter((c) => c.status !== "descartada");

    let extracted;
    try {
      extracted = await this.extract(chunk, context, known);
    } catch (err) {
      console.error("[extração] falhou:", describeError(err));
      return;
    }

    // Perguntas feitas no debate: pesquisa o assunto antes da resposta chegar.
    if (this.brief) {
      for (const q of extracted.perguntas) {
        this.enqueue(
          this.store.addClaim({
            tipo: "pergunta",
            speakerId: chunk.speakerId === AUTO_SPEAKER ? (q.quem_pergunta ?? AUTO_SPEAKER) : chunk.speakerId,
            segmentIds: chunk.segmentIds,
            trecho: q.trecho,
            afirmacao: q.pergunta,
            categoria: "outro",
            tema: q.tema,
            alvo: q.para_quem,
            prioridade: "alta",
          }),
        );
      }
    }

    for (const item of extracted.afirmacoes) {
      const original = item.repete_id ? this.store.claims.get(item.repete_id) : undefined;
      const base = {
        // Na transmissão (orador "auto") vale quem o modelo identificou pelo contexto.
        speakerId: chunk.speakerId === AUTO_SPEAKER ? (item.orador_id ?? AUTO_SPEAKER) : chunk.speakerId,
        segmentIds: chunk.segmentIds,
        trecho: item.trecho,
        afirmacao: item.afirmacao,
        categoria: item.categoria,
        tema: item.tema,
        alvo: item.alvo,
        prioridade: item.prioridade,
      };

      // Candidatos repetem bordões: reaproveita a checagem já feita na hora.
      if (original?.resultado) {
        const revisao = motivoRevisao(original.resultado, base.speakerId);
        const publish = !revisao && (original.status === "publicada" || this.store.autoPublish);
        this.store.addClaim({
          ...base,
          repeteDe: original.id,
          resultado: original.resultado,
          status: publish ? "publicada" : "rascunho",
          revisao: revisao ?? undefined,
          ...(publish ? { publishedAt: Date.now() } : {}),
        });
        continue;
      }
      this.enqueue(this.store.addClaim(base));
    }
  }

  private enqueue(claim: Claim) {
    this.checks.add(claim.prioridade, () => this.check(claim.id));
  }

  private async check(id: string) {
    const claim = this.store.claims.get(id);
    if (!claim || claim.status !== "na_fila") return;
    this.store.updateClaim(id, { status: "verificando", progresso: [] });

    const onProgress = (progresso: string[]) => this.store.updateClaim(id, { progresso });
    try {
      if (claim.tipo === "pergunta") {
        if (!this.brief) throw new Error("Pesquisa de perguntas indisponível.");
        const contexto = await this.brief(claim, this.contextFor(claim), onProgress);
        if (this.store.claims.get(id)?.status !== "verificando") return;
        // Contexto é material interno da redação: fica no painel, não vai ao telão.
        this.store.updateClaim(id, { contexto, status: "rascunho" });
        return;
      }
      const resultado = await this.verify(claim, this.contextFor(claim), onProgress);
      // O editor pode ter descartado enquanto a checagem rodava.
      if (this.store.claims.get(id)?.status !== "verificando") return;
      // Publica direto, exceto o que é incerto ou exagerado: isso espera revisão humana.
      // Vale o orador atual: a redação pode ter escolhido o nome durante a checagem.
      const revisao = motivoRevisao(resultado, this.store.claims.get(id)?.speakerId ?? claim.speakerId);
      const publish = this.store.autoPublish && !revisao;
      this.store.updateClaim(id, {
        resultado,
        revisao: revisao ?? undefined,
        status: publish ? "publicada" : "rascunho",
        ...(publish ? { publishedAt: Date.now() } : {}),
      });
    } catch (err) {
      this.store.updateClaim(id, { status: "erro", erro: describeError(err) });
    }
  }

  private contextFor(claim: Claim): Segment[] {
    const segs = this.store.segments;
    const ids = new Set(claim.segmentIds);
    const lastIdx = segs.findLastIndex((s) => ids.has(s.id));
    if (lastIdx < 0) return segs.slice(-6);
    return segs.slice(Math.max(0, lastIdx - 8), lastIdx + 2);
  }
}
