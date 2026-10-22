import type { Persisted, Persistence } from "./store.js";
import type { Claim, Segment } from "./shared/types.js";

/** O mínimo da API SQL do Durable Object (ctx.storage.sql) que usamos aqui. */
export interface SqlLike {
  exec(query: string, ...bindings: unknown[]): { toArray(): Record<string, unknown>[] };
}

/** Grava cada fala e cada afirmação numa linha do SQLite do Durable Object (síncrono e durável). */
export class SqlPersistence implements Persistence {
  constructor(private readonly sql: SqlLike) {
    sql.exec(`CREATE TABLE IF NOT EXISTS segments (id TEXT PRIMARY KEY, at INTEGER NOT NULL, json TEXT NOT NULL)`);
    sql.exec(`CREATE TABLE IF NOT EXISTS claims (id TEXT PRIMARY KEY, json TEXT NOT NULL)`);
    sql.exec(`CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT NOT NULL)`);
  }

  load(): Persisted | null {
    const segments = this.sql
      .exec(`SELECT json FROM segments ORDER BY at, rowid`)
      .toArray()
      .map((r) => JSON.parse(r.json as string) as Segment);
    const claims = this.sql
      .exec(`SELECT json FROM claims ORDER BY rowid`)
      .toArray()
      .map((r) => JSON.parse(r.json as string) as Claim);
    const speaker = this.sql.exec(`SELECT v FROM meta WHERE k = 'currentSpeaker'`).toArray()[0]?.v as string | undefined;
    if (!segments.length && !claims.length && speaker === undefined) return null;
    return { segments, claims, currentSpeaker: speaker ? (JSON.parse(speaker) as string | null) : null };
  }

  saveSegment(s: Segment) {
    this.sql.exec(`INSERT OR REPLACE INTO segments (id, at, json) VALUES (?, ?, ?)`, s.id, s.at, JSON.stringify(s));
  }

  saveClaim(c: Claim) {
    this.sql.exec(
      `INSERT INTO claims (id, json) VALUES (?, ?) ON CONFLICT (id) DO UPDATE SET json = excluded.json`,
      c.id,
      JSON.stringify(c),
    );
  }

  saveMeta(meta: { currentSpeaker: string | null }) {
    this.sql.exec(`INSERT OR REPLACE INTO meta (k, v) VALUES ('currentSpeaker', ?)`, JSON.stringify(meta.currentSpeaker));
  }
}
