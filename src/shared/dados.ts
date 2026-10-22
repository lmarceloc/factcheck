// Camada de dados oficiais: registro de fontes, montagem segura de URLs e
// leitura das respostas. Roda igual no Cloudflare Worker e no Node.

export const TEMAS = [
  "emprego_renda",
  "inflacao_precos",
  "juros_cambio_credito",
  "economia_pib",
  "contas_publicas",
  "gasto_federal",
  "eleicao",
  "votacao_legislativa",
  "atuacao_parlamentar",
  "legislacao",
  "indicador_social",
  "seguranca",
  "saude",
  "educacao",
  "populacao_territorio",
  "outro",
] as const;
export type Tema = (typeof TEMAS)[number];

export interface Fonte {
  id: string;
  nome: string;
  orgao: string;
  base_url: string;
  tipo: "rest" | "odata" | "webservice" | "sru";
  modo: "online";
  requer_chave: string | null;
  header_chave?: string;
  headers?: Record<string, string>;
  prioridade: number;
  cache_ttl: number;
  frequencia_atualizacao: string;
  temas: Tema[];
  docs: string;
  dicas: string;
  exemplos: string[];
  ativo: boolean;
}

export interface SerieCatalogo {
  codigo: number;
  nome: string;
  unidade: string;
}

export interface Registro {
  versao: string;
  fontes: Fonte[];
  fontes_pre_carregadas: { id: string; nome: string; orgao: string; base_url: string; temas: Tema[] }[];
  series_bcb: SerieCatalogo[];
}

export class ErroConsulta extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

/**
 * Junta a URL base da fonte com o caminho pedido pelo modelo, sem deixar sair
 * do host e do prefixo da fonte (nada de "../", outro host ou credenciais na URL).
 */
export function montarUrl(fonte: Fonte, caminho: string, parametros: Record<string, string> = {}): string {
  const c = caminho.trim();
  if (c && !c.startsWith("/") && !c.startsWith("?")) throw new ErroConsulta("O caminho deve começar com / ou ?.");
  if (/:\/\/|\\|^\/\/|@/.test(c) || /(^|\/)\.\.?(\/|$|\?)/.test(c.split("?")[0])) {
    throw new ErroConsulta("Caminho inválido.");
  }
  const base = new URL(fonte.base_url);
  const url = new URL(fonte.base_url.replace(/\/+$/, "") + c);
  const prefix = base.pathname.replace(/\/+$/, "");
  if (url.origin !== base.origin || !(url.pathname === prefix || url.pathname.startsWith(`${prefix}/`) || prefix === "")) {
    throw new ErroConsulta("O caminho sai do escopo da fonte.");
  }
  for (const [k, v] of Object.entries(parametros)) url.searchParams.set(k, v);
  return url.toString();
}

export function rota(registro: Registro, tema: Tema): Fonte[] {
  return registro.fontes
    .filter((f) => f.ativo && f.temas.includes(tema))
    .sort((a, b) => b.prioridade - a.prioridade);
}

export interface RespostaFonte {
  fonte: string;
  url: string;
  status: number;
  ok: boolean;
  tipo: "json" | "texto";
  conteudo: string;
  truncado: boolean;
  ms: number;
}

export interface OpcoesConsulta {
  fetch?: typeof fetch;
  chaves?: Record<string, string | undefined>;
  timeoutMs?: number;
  maxChars?: number;
}

/** Busca na fonte e devolve o corpo como texto compacto (JSON minificado quando der). */
export async function consultarFonte(
  fonte: Fonte,
  caminho: string,
  parametros: Record<string, string> = {},
  opts: OpcoesConsulta = {},
): Promise<RespostaFonte> {
  if (!fonte.ativo) throw new ErroConsulta(`A fonte ${fonte.id} está desativada.`);
  const url = montarUrl(fonte, caminho, parametros);
  const headers: Record<string, string> = {
    Accept: "application/json, text/xml;q=0.8, */*;q=0.5",
    "User-Agent": "checagem-ao-vivo/1.0",
    ...fonte.headers,
  };
  if (fonte.requer_chave) {
    const chave = opts.chaves?.[fonte.requer_chave];
    if (!chave) throw new ErroConsulta(`A fonte ${fonte.id} exige a chave ${fonte.requer_chave}, que não está configurada.`, 503);
    headers[fonte.header_chave ?? "Authorization"] = chave;
  }

  const started = Date.now();
  const res = await (opts.fetch ?? fetch)(url, { headers, signal: AbortSignal.timeout(opts.timeoutMs ?? 10000) });
  const raw = await res.text();
  let tipo: RespostaFonte["tipo"] = "texto";
  let conteudo = raw;
  try {
    conteudo = JSON.stringify(JSON.parse(raw));
    tipo = "json";
  } catch {
    conteudo = raw.replace(/\s+/g, " ").trim();
  }
  const max = opts.maxChars ?? 15000;
  return {
    fonte: fonte.id,
    url,
    status: res.status,
    ok: res.ok,
    tipo,
    conteudo: conteudo.length > max ? conteudo.slice(0, max) : conteudo,
    truncado: conteudo.length > max,
    ms: Date.now() - started,
  };
}

// ---------- Banco Central: SGS ----------

export interface ValorSerie {
  data: string; // AAAA-MM-DD
  valor: number;
}

export const isoParaBr = (iso: string) => {
  const [a, m, d] = iso.split("-");
  return `${d}/${m}/${a}`;
};
export const brParaIso = (br: string) => {
  const [d, m, a] = br.split("/");
  return `${a}-${m}-${d}`;
};

const ISO = /^\d{4}-\d{2}-\d{2}$/;

export function urlSerieBcb(
  codigo: number,
  q: { ultimos?: number | null; inicio?: string | null; fim?: string | null } = {},
): string {
  if (!Number.isInteger(codigo) || codigo <= 0) throw new ErroConsulta("Código de série inválido.");
  const base = `https://api.bcb.gov.br/dados/serie/bcdata.sgs.${codigo}/dados`;
  if (q.inicio || q.fim) {
    for (const d of [q.inicio, q.fim]) if (d && !ISO.test(d)) throw new ErroConsulta("Datas no formato AAAA-MM-DD.");
    const params = new URLSearchParams({ formato: "json" });
    if (q.inicio) params.set("dataInicial", isoParaBr(q.inicio));
    if (q.fim) params.set("dataFinal", isoParaBr(q.fim));
    return `${base}?${params}`;
  }
  // O SGS aceita no máximo 20 valores em /ultimos; para mais, use um intervalo de datas.
  const n = Math.min(Math.max(1, Math.trunc(q.ultimos ?? 12)), 20);
  return `${base}/ultimos/${n}?formato=json`;
}

export function lerSerieBcb(json: unknown): ValorSerie[] {
  if (!Array.isArray(json)) throw new ErroConsulta("Resposta inesperada do SGS.", 502);
  return json
    .filter((r): r is { data: string; valor: string } => typeof r?.data === "string" && r?.valor != null)
    .map((r) => ({ data: brParaIso(r.data), valor: Number(String(r.valor).replace(",", ".")) }))
    .filter((r) => Number.isFinite(r.valor));
}

// ---------- TSE (pré-carregado) ----------

export interface ConsultaTse {
  ano: number;
  cargo: string;
  uf?: string | null;
  nome?: string | null;
  turno?: number | null;
}

/** Maiúsculas sem acento: é assim que nomes e cargos ficam na coluna de busca. */
export const normalizar = (s: string) =>
  s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase().replace(/\s+/g, " ").trim();

/** SQL parametrizado para a soma de votos por candidato (D1/SQLite). */
export function sqlVotacaoTse(q: ConsultaTse): { sql: string; params: (string | number)[] } {
  const where = ["ano = ?", "cargo_busca LIKE ?"];
  const params: (string | number)[] = [q.ano, `%${normalizar(q.cargo)}%`];
  if (q.uf) {
    where.push("uf = ?");
    params.push(q.uf.trim().toUpperCase());
  }
  if (q.turno) {
    where.push("turno = ?");
    params.push(q.turno);
  }
  if (q.nome) {
    where.push("nome_busca LIKE ?");
    params.push(`%${normalizar(q.nome)}%`);
  }
  const sql = `SELECT ano, turno, cargo, nome_urna, nome, partido, numero, situacao,
      SUM(votos) AS votos, COUNT(DISTINCT uf) AS ufs
    FROM tse_votacao WHERE ${where.join(" AND ")}
    GROUP BY ano, turno, cargo, sq_candidato
    ORDER BY turno, votos DESC LIMIT 30`;
  return { sql, params };
}
