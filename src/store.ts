import { EventEmitter } from "node:events";
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { Claim, DebateInfo, PublicState, Segment, ServerEvent } from "./shared/types.js";

type Persisted = Pick<PublicState, "segments" | "claims" | "currentSpeaker">;

/** Estado do debate em memória, com eventos para o SSE e gravação em disco. */
export class Store extends EventEmitter {
  segments: Segment[] = [];
  claims = new Map<string, Claim>();
  currentSpeaker: string | null = null;
  autoPublish: boolean;
  readonly demo: boolean;
  private saveTimer: NodeJS.Timeout | null = null;
  private readonly file?: string;

  constructor(
    readonly debate: DebateInfo,
    opts: { autoPublish: boolean; file?: string; demo?: boolean },
  ) {
    super();
    this.setMaxListeners(0);
    this.autoPublish = opts.autoPublish;
    this.file = opts.file;
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
    return { autoPublish: this.autoPublish, demo: this.demo };
  }

  emitEvent(event: ServerEvent) {
    this.emit("event", event);
  }

  setSpeaker(speakerId: string | null) {
    this.currentSpeaker = speakerId;
    this.emitEvent({ type: "speaker", speakerId });
    this.scheduleSave();
  }

  setAutoPublish(value: boolean) {
    this.autoPublish = value;
    this.emitEvent({ type: "settings", settings: this.settings() });
  }

  addSegment(speakerId: string, text: string, at = Date.now()): Segment {
    const segment: Segment = { id: randomUUID(), speakerId, text, at };
    this.segments.push(segment);
    this.emitEvent({ type: "segment", segment });
    this.scheduleSave();
    return segment;
  }

  addClaim(data: Omit<Claim, "id" | "createdAt" | "updatedAt" | "progresso" | "status"> & Partial<Pick<Claim, "status">>): Claim {
    const now = Date.now();
    const claim: Claim = { status: "na_fila", ...data, id: randomUUID(), createdAt: now, updatedAt: now, progresso: [] };
    this.claims.set(claim.id, claim);
    this.emitEvent({ type: "claim", claim });
    this.scheduleSave();
    return claim;
  }

  updateClaim(id: string, patch: Partial<Claim>): Claim | undefined {
    const current = this.claims.get(id);
    if (!current) return undefined;
    const claim: Claim = { ...current, ...patch, id, updatedAt: Date.now() };
    this.claims.set(id, claim);
    this.emitEvent({ type: "claim", claim });
    this.scheduleSave();
    return claim;
  }

  recentSegments(limit: number): Segment[] {
    return this.segments.slice(-limit);
  }

  recentClaims(limit: number): Claim[] {
    return [...this.claims.values()].slice(-limit);
  }

  private load() {
    if (!this.file || !fs.existsSync(this.file)) return;
    try {
      const data = JSON.parse(fs.readFileSync(this.file, "utf8")) as Persisted;
      this.segments = data.segments ?? [];
      this.currentSpeaker = data.currentSpeaker ?? null;
      for (const claim of data.claims ?? []) {
        // Checagens interrompidas por um reinício voltam para a fila.
        if (claim.status === "verificando") claim.status = "na_fila";
        this.claims.set(claim.id, claim);
      }
      console.log(`[store] ${this.segments.length} falas e ${this.claims.size} afirmações restauradas de ${this.file}`);
    } catch (err) {
      console.error(`[store] não foi possível ler ${this.file}:`, err);
    }
  }

  private scheduleSave() {
    if (!this.file || this.saveTimer) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      this.saveNow();
    }, 500);
  }

  saveNow() {
    if (!this.file) return;
    const data: Persisted = {
      segments: this.segments,
      claims: [...this.claims.values()],
      currentSpeaker: this.currentSpeaker,
    };
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(data));
    fs.renameSync(tmp, this.file);
  }
}
