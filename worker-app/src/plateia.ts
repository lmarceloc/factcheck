import { DurableObject } from "cloudflare:workers";
import { PRESENCA_CICLO_MS, PRESENCA_VALIDADE_MS } from "../../src/presenca";
import type { Env } from "./debate";

/** Em quantas fatias a audiência é dividida: cada uma aguenta milhares de pessoas. */
export const FATIAS_PLATEIA = 16;

/** Fatia de um id de navegador: o mesmo navegador cai sempre na mesma (não conta duas vezes). */
export function fatiaDe(id: string) {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return h % FATIAS_PLATEIA;
}

/**
 * Uma fatia da audiência. Recebe o "estou aqui" de cada tela aberta e, a cada
 * ciclo, entrega ao debate quantos estão online e quantos visitantes novos
 * chegaram. Assim o debate recebe 16 avisos a cada 10 s, não um por espectador.
 * Tudo fica no SQLite da fatia: se o Cloudflare a desligar, a contagem continua.
 */
export class Plateia extends DurableObject<Env> {
  private readonly sql: SqlStorage;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.sql.exec(`CREATE TABLE IF NOT EXISTS vivos (id TEXT PRIMARY KEY, visto INTEGER NOT NULL)`);
    // informado = 0: visitante novo que o debate ainda não somou; 2: sendo informado agora; 1: já somado.
    this.sql.exec(`CREATE TABLE IF NOT EXISTS vistos (id TEXT PRIMARY KEY, informado INTEGER NOT NULL DEFAULT 0)`);
    this.sql.exec(`CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT NOT NULL)`);
  }

  async bater(id: string, saindo: boolean) {
    if (saindo) {
      this.sql.exec(`DELETE FROM vivos WHERE id = ?`, id);
      return;
    }
    this.sql.exec(`INSERT INTO vivos (id, visto) VALUES (?, ?) ON CONFLICT (id) DO UPDATE SET visto = excluded.visto`, id, Date.now());
    this.sql.exec(`INSERT OR IGNORE INTO vistos (id) VALUES (?)`, id);
    if ((await this.ctx.storage.getAlarm()) === null) await this.ctx.storage.setAlarm(Date.now() + PRESENCA_CICLO_MS);
  }

  async alarm() {
    this.sql.exec(`DELETE FROM vivos WHERE visto < ?`, Date.now() - PRESENCA_VALIDADE_MS);
    const online = this.sql.exec(`SELECT count(*) AS n FROM vivos`).one().n as number;
    // Marca antes de esperar o debate: quem chegar durante a espera fica para o próximo ciclo.
    this.sql.exec(`UPDATE vistos SET informado = 2 WHERE informado <> 1`);
    const novos = this.sql.exec(`SELECT count(*) AS n FROM vistos WHERE informado = 2`).one().n as number;

    const debate = this.env.DEBATE.get(this.env.DEBATE.idFromName("principal"));
    const sessao = await debate.registrarPresenca(this.ctx.id.toString(), online, novos);

    const anterior = this.sql.exec(`SELECT v FROM meta WHERE k = 'sessao'`).toArray()[0]?.v as string | undefined;
    if (anterior !== undefined && sessao !== anterior) {
      // Outro debate começou: os visitantes do anterior saem, e quem está na sala conta para o novo
      // (menos quem acabou de ser somado a ele neste ciclo).
      this.sql.exec(`DELETE FROM vistos WHERE informado = 1`);
      this.sql.exec(`INSERT OR IGNORE INTO vistos (id) SELECT id FROM vivos`);
    }
    this.sql.exec(`UPDATE vistos SET informado = 1 WHERE informado = 2`);
    if (sessao !== anterior) this.sql.exec(`INSERT OR REPLACE INTO meta (k, v) VALUES ('sessao', ?)`, sessao);
    if (online > 0) await this.ctx.storage.setAlarm(Date.now() + PRESENCA_CICLO_MS);
  }
}
