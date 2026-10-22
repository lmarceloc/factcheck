import type OpenAI from "openai";
import type { Source } from "./shared/types.js";

type Item = OpenAI.Responses.ResponseOutputItem;

export interface SeenSource {
  url: string;
  titulo: string;
  trechos: string[];
}

/** Normaliza a URL para comparar a fonte citada pelo modelo com as que a busca devolveu. */
export function normalizeUrl(raw: string): string {
  if (typeof raw !== "string") return "";
  try {
    const u = new URL(raw.trim());
    u.hash = "";
    for (const key of [...u.searchParams.keys()]) {
      if (key.startsWith("utm_") || key === "fbclid" || key === "gclid") u.searchParams.delete(key);
    }
    const host = u.hostname.replace(/^www\./, "").toLowerCase();
    const pathname = u.pathname.replace(/\/+$/, "");
    return `${host}${pathname}${u.search}`;
  } catch {
    return raw.trim().toLowerCase();
  }
}

/** Junta todas as URLs que a busca e o fetch realmente devolveram, e as citações do texto. */
export class SourceCollector {
  private seen = new Map<string, SeenSource>();
  readonly queries: string[] = [];

  addItems(items: Item[]) {
    for (const item of items) this.addItem(item);
  }

  addItem(item: Item) {
    switch (item.type) {
      case "web_search_call": {
        const action = item.action;
        if (action.type === "search") {
          const queries = action.queries?.length ? action.queries : action.query ? [action.query] : [];
          for (const q of queries) if (!this.queries.includes(q)) this.queries.push(q);
          // Fontes do tipo "api" (dados internos da busca) não têm endereço.
          for (const src of action.sources ?? []) if ("url" in src && src.url) this.add(src.url, src.url);
        } else if (action.type === "open_page" && action.url) {
          this.queries.push(`abrindo ${action.url}`);
          this.add(action.url, action.url);
        }
        break;
      }
      case "message":
        for (const part of item.content) {
          if (part.type !== "output_text") continue;
          for (const ann of part.annotations) {
            if (ann.type === "url_citation") {
              this.add(ann.url, ann.title || ann.url, part.text.slice(ann.start_index, ann.end_index) || ann.title);
            }
          }
        }
        break;
    }
  }

  private add(url: string, titulo: string, trecho?: string) {
    if (!url) return;
    const key = normalizeUrl(url);
    const entry = this.seen.get(key) ?? { url, titulo, trechos: [] };
    if (entry.titulo === entry.url && titulo !== url) entry.titulo = titulo;
    if (trecho && !entry.trechos.includes(trecho)) entry.trechos.push(trecho);
    this.seen.set(key, entry);
  }

  /** Fonte oficial consultada por API: entra como confirmada e vale como citação. */
  addOficial(url: string, titulo: string) {
    this.add(url, titulo, "consulta direta à API oficial");
  }

  addConsulta(rotulo: string) {
    this.queries.push(rotulo);
  }

  has(url: string) {
    return this.seen.has(normalizeUrl(url));
  }

  cited(): SeenSource[] {
    return [...this.seen.values()].filter((s) => s.trechos.length > 0);
  }

  /**
   * Marca cada fonte do veredito como confirmada (a URL veio da busca) ou não
   * (o modelo pode ter escrito de memória). Sem fontes, usa as citações do texto.
   */
  resolve(fontes: { titulo: string; url: string; trecho?: string | null }[]): Source[] {
    const out: Source[] = [];
    const used = new Set<string>();
    for (const f of fontes) {
      if (!f.url) continue;
      const key = normalizeUrl(f.url);
      if (used.has(key)) continue;
      used.add(key);
      out.push({ titulo: f.titulo, url: f.url, trecho: f.trecho ?? undefined, confirmada: this.seen.has(key) });
    }
    if (out.length === 0) {
      for (const s of this.cited().slice(0, 4)) {
        out.push({ titulo: s.titulo, url: s.url, trecho: s.trechos[0], confirmada: true });
      }
    }
    return out;
  }
}
