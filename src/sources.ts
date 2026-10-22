import type Anthropic from "@anthropic-ai/sdk";
import type { Source } from "./shared/types.js";

type Block = Anthropic.Beta.BetaContentBlock;

export interface SeenSource {
  url: string;
  titulo: string;
  trechos: string[];
}

/** Normaliza a URL para comparar a fonte citada pelo modelo com as que a busca devolveu. */
export function normalizeUrl(raw: string): string {
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

  addBlocks(blocks: Block[]) {
    for (const block of blocks) this.addBlock(block);
  }

  addBlock(block: Block) {
    switch (block.type) {
      case "server_tool_use": {
        const input = block.input as { query?: unknown; url?: unknown };
        if (block.name === "web_search" && typeof input.query === "string") this.queries.push(input.query);
        if (block.name === "web_fetch" && typeof input.url === "string") this.queries.push(`abrindo ${input.url}`);
        break;
      }
      case "web_search_tool_result":
        if (Array.isArray(block.content)) {
          for (const result of block.content) this.add(result.url, result.title);
        }
        break;
      case "web_fetch_tool_result":
        if (block.content.type === "web_fetch_result") {
          this.add(block.content.url, block.content.content.title ?? block.content.url);
        }
        break;
      case "text":
        for (const citation of block.citations ?? []) {
          if (citation.type === "web_search_result_location") {
            this.add(citation.url, citation.title ?? citation.url, citation.cited_text);
          }
        }
        break;
    }
  }

  private add(url: string, titulo: string, trecho?: string) {
    const key = normalizeUrl(url);
    const entry = this.seen.get(key) ?? { url, titulo, trechos: [] };
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
