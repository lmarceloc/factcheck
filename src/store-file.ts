import fs from "node:fs";
import path from "node:path";
import type { Meta, Persisted, Persistence } from "./store.js";
import type { ArquivoResumo, Claim, PublicState, Segment } from "./shared/types.js";

/** Grava o estado inteiro num JSON (com atraso de meio segundo para agrupar mudanças). */
export class FilePersistence implements Persistence {
  private segments: Segment[] = [];
  private claims = new Map<string, Claim>();
  private meta: Meta = { currentSpeaker: null, youtube: null };
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly file: string) {}

  load(): Persisted | null {
    if (!fs.existsSync(this.file)) return null;
    try {
      const data = JSON.parse(fs.readFileSync(this.file, "utf8")) as Persisted;
      this.segments = data.segments ?? [];
      this.meta = {
        currentSpeaker: data.currentSpeaker ?? null,
        youtube: data.youtube ?? null,
        captura: data.captura ?? false,
        capturaVistaEm: data.capturaVistaEm ?? 0,
      };
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

  saveMeta(meta: Meta) {
    this.meta = meta;
    this.schedule();
  }

  private schedule() {
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.flush();
    }, 500);
  }

  clear() {
    this.segments = [];
    this.claims.clear();
    this.meta = { currentSpeaker: null, youtube: null };
    this.flush();
  }

  private get archiveDir() {
    return path.join(path.dirname(this.file), "arquivos");
  }

  saveArchive(resumo: ArquivoResumo, estado: PublicState) {
    fs.mkdirSync(this.archiveDir, { recursive: true });
    fs.writeFileSync(path.join(this.archiveDir, `${resumo.id}.json`), JSON.stringify({ resumo, estado }));
  }

  listArchives(): ArquivoResumo[] {
    if (!fs.existsSync(this.archiveDir)) return [];
    return fs
      .readdirSync(this.archiveDir)
      .filter((f) => f.endsWith(".json"))
      .map((f) => (JSON.parse(fs.readFileSync(path.join(this.archiveDir, f), "utf8")) as { resumo: ArquivoResumo }).resumo)
      .sort((a, b) => b.encerradoEm - a.encerradoEm);
  }

  getArchive(id: string): PublicState | null {
    if (!/^[\w-]+$/.test(id)) return null;
    const file = path.join(this.archiveDir, `${id}.json`);
    if (!fs.existsSync(file)) return null;
    return (JSON.parse(fs.readFileSync(file, "utf8")) as { estado: PublicState }).estado;
  }

  flush() {
    const data: Persisted = { segments: this.segments, claims: [...this.claims.values()], ...this.meta };
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(data));
    fs.renameSync(tmp, this.file);
  }
}
