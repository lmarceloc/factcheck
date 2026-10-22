import fs from "node:fs";
import path from "node:path";
import type { Persisted, Persistence } from "./store.js";
import type { Claim, Segment } from "./shared/types.js";

/** Grava o estado inteiro num JSON (com atraso de meio segundo para agrupar mudanças). */
export class FilePersistence implements Persistence {
  private segments: Segment[] = [];
  private claims = new Map<string, Claim>();
  private currentSpeaker: string | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly file: string) {}

  load(): Persisted | null {
    if (!fs.existsSync(this.file)) return null;
    try {
      const data = JSON.parse(fs.readFileSync(this.file, "utf8")) as Persisted;
      this.segments = data.segments ?? [];
      this.currentSpeaker = data.currentSpeaker ?? null;
      for (const c of data.claims ?? []) this.claims.set(c.id, c);
      return data;
    } catch (err) {
      console.error(`[store] não foi possível ler ${this.file}:`, err);
      return null;
    }
  }

  saveSegment(segment: Segment) {
    this.segments.push(segment);
    this.schedule();
  }

  saveClaim(claim: Claim) {
    this.claims.set(claim.id, claim);
    this.schedule();
  }

  saveMeta(meta: { currentSpeaker: string | null }) {
    this.currentSpeaker = meta.currentSpeaker;
    this.schedule();
  }

  private schedule() {
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.flush();
    }, 500);
  }

  flush() {
    const data: Persisted = { segments: this.segments, claims: [...this.claims.values()], currentSpeaker: this.currentSpeaker };
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(data));
    fs.renameSync(tmp, this.file);
  }
}
