import type { Meta, Persisted, Persistence } from "./store.js";
import type { ArquivoResumo, Claim, PublicState, Segment } from "./shared/types.js";

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
    sql.exec(
      `CREATE TABLE IF NOT EXISTS arquivos (id TEXT PRIMARY KEY, encerrado_em INTEGER NOT NULL, resumo TEXT NOT NULL, estado TEXT NOT NULL)`,
    );
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
    const raw = this.sql.exec(`SELECT v FROM meta WHERE k = 'meta'`).toArray()[0]?.v as string | undefined;
    if (!segments.length && !claims.length && raw === undefined) return null;
    const meta: Partial<Meta> = raw ? JSON.parse(raw) : {};
    return { segments, claims, ...meta };
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

  saveMeta(meta: Meta) {
    this.sql.exec(`INSERT OR REPLACE INTO meta (k, v) VALUES ('meta', ?)`, JSON.stringify(meta));
  }

  clear() {
    this.sql.exec(`DELETE FROM segments`);
    this.sql.exec(`DELETE FROM claims`);
    this.sql.exec(`DELETE FROM meta`);
  }

  saveArchive(resumo: ArquivoResumo, estado: PublicState) {
    this.sql.exec(
      `INSERT OR REPLACE INTO arquivos (id, encerrado_em, resumo, estado) VALUES (?, ?, ?, ?)`,
      resumo.id,
      resumo.encerradoEm,
      JSON.stringify(resumo),
      JSON.stringify(estado),
    );
  }

  listArchives(): ArquivoResumo[] {
    return this.sql
      .exec(`SELECT resumo FROM arquivos ORDER BY encerrado_em DESC`)
      .toArray()
      .map((r) => JSON.parse(r.resumo as string) as ArquivoResumo);
  }

  getArchive(id: string): PublicState | null {
    const row = this.sql.exec(`SELECT estado FROM arquivos WHERE id = ?`, id).toArray()[0];
    return row ? (JSON.parse(row.estado as string) as PublicState) : null;
  }
}
