import { EventEmitter } from "node:events";
import type { Claim, DebateInfo, PublicState, Segment, ServerEvent } from "./shared/types.js";

export interface Meta {
  currentSpeaker: string | null;
  /** Vídeo do YouTube da transmissão, escolhido pela redação e mostrado a todos. */
  youtube: string | null;
}

export type Persisted = Pick<PublicState, "segments" | "claims"> & Partial<Meta>;

/** Onde o estado do debate é gravado: arquivo JSON no Node, SQLite no Durable Object. */
export interface Persistence {
  load(): Persisted | null;
  saveSegment(segment: Segment): void;
  saveClaim(claim: Claim): void;
  saveMeta(meta: Meta): void;
  /** Grava o que estiver pendente (no desligamento). */
  flush?(): void;
}

/** Estado do debate em memória, com eventos para o SSE e gravação em disco. */
export class Store extends EventEmitter {
  segments: Segment[] = [];
  claims = new Map<string, Claim>();
  currentSpeaker: string | null = null;
  autoPublish: boolean;
  /** A redação está transcrevendo a transmissão agora. */
  captura = false;
  youtube: string | null = null;
  readonly demo: boolean;
  private readonly persistence?: Persistence;

  constructor(
    readonly debate: DebateInfo,
    opts: { autoPublish: boolean; persistence?: Persistence; demo?: boolean },
  ) {
    super();
    this.setMaxListeners(0);
    this.autoPublish = opts.autoPublish;
    this.persistence = opts.persistence;
    this.demo = opts.demo ?? false;
    this.load();
  }

  snapshot(): PublicState {
    return {
      debate: this.debate,
      currentSpeaker: this.currentSpeaker,
      segments: this.segments,
      claims: [...this.claims.values()],
      settings: this.settings(),
    };
  }

  settings() {
    return { autoPublish: this.autoPublish, demo: this.demo, captura: this.captura, youtube: this.youtube };
  }

  emitEvent(event: ServerEvent) {
    this.emit("event", event);
  }

  setSpeaker(speakerId: string | null) {
    this.currentSpeaker = speakerId;
    this.emitEvent({ type: "speaker", speakerId });
    this.saveMeta();
  }

  setYoutube(videoId: string | null) {
    this.youtube = videoId;
    this.emitEvent({ type: "settings", settings: this.settings() });
    this.saveMeta();
  }

  private saveMeta() {
    this.persistence?.saveMeta({ currentSpeaker: this.currentSpeaker, youtube: this.youtube });
  }

  setCaptura(value: boolean) {
    if (this.captura === value) return;
    this.captura = value;
    this.emitEvent({ type: "settings", settings: this.settings() });
  }

  setAutoPublish(value: boolean) {
    this.autoPublish = value;
    this.emitEvent({ type: "settings", settings: this.settings() });
  }

  addSegment(speakerId: string, text: string, at = Date.now()): Segment {
    const segment: Segment = { id: crypto.randomUUID(), speakerId, text, at };
    this.segments.push(segment);
    this.emitEvent({ type: "segment", segment });
    this.persistence?.saveSegment(segment);
    return segment;
  }

  addClaim(data: Omit<Claim, "id" | "createdAt" | "updatedAt" | "progresso" | "status"> & Partial<Pick<Claim, "status">>): Claim {
    const now = Date.now();
    const claim: Claim = { status: "na_fila", ...data, id: crypto.randomUUID(), createdAt: now, updatedAt: now, progresso: [] };
    this.claims.set(claim.id, claim);
    this.emitEvent({ type: "claim", claim });
    this.persistence?.saveClaim(claim);
    return claim;
  }

  updateClaim(id: string, patch: Partial<Claim>): Claim | undefined {
    const current = this.claims.get(id);
    if (!current) return undefined;
    const claim: Claim = { ...current, ...patch, id, updatedAt: Date.now() };
    this.claims.set(id, claim);
    this.emitEvent({ type: "claim", claim });
    this.persistence?.saveClaim(claim);
    return claim;
  }

  recentSegments(limit: number): Segment[] {
    return this.segments.slice(-limit);
  }

  recentClaims(limit: number): Claim[] {
    return [...this.claims.values()].slice(-limit);
  }

  private load() {
    const data = this.persistence?.load();
    if (!data) return;
    this.segments = data.segments ?? [];
    this.currentSpeaker = data.currentSpeaker ?? null;
    this.youtube = data.youtube ?? null;
    for (const claim of data.claims ?? []) {
      // Checagens interrompidas por um reinício voltam para a fila.
      if (claim.status === "verificando") claim.status = "na_fila";
      this.claims.set(claim.id, claim);
    }
    console.log(`[store] ${this.segments.length} falas e ${this.claims.size} afirmações restauradas`);
  }

  saveNow() {
    this.persistence?.flush?.();
  }
}
