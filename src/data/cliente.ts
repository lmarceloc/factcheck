import {
  consultarFonte,
  ErroConsulta,
  lerSerieBcb,
  urlSerieBcb,
  type ConsultaTse,
  type Registro,
  type RespostaFonte,
  type ValorSerie,
} from "../shared/dados.js";

export interface RespostaSerie {
  codigo: number;
  nome?: string;
  unidade?: string;
  origem: "d1" | "api";
  url: string;
  valores: ValorSerie[];
}

export interface RespostaTse {
  resultados: Record<string, unknown>[];
  arquivos?: { arquivo_url: string; carregado_em: string }[];
  aviso?: string;
}

/** Acesso às fontes oficiais: pelo gateway no Cloudflare ou direto do servidor. */
export interface ClienteDados {
  readonly modo: "gateway" | "direto";
  consulta(fonte: string, caminho: string, parametros: Record<string, string>): Promise<RespostaFonte & { cache?: string }>;
  serieBcb(codigo: number, q: { ultimos?: number | null; inicio?: string | null; fim?: string | null }): Promise<RespostaSerie>;
  tseVotacao(q: ConsultaTse): Promise<RespostaTse>;
}

export class ClienteGateway implements ClienteDados {
  readonly modo = "gateway";

  constructor(
    private readonly baseUrl: string,
    private readonly token: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  private async req<T>(method: "GET" | "POST", caminho: string, body?: unknown): Promise<T> {
    const res = await this.fetchImpl(`${this.baseUrl.replace(/\/+$/, "")}${caminho}`, {
      method,
      headers: { Authorization: `Bearer ${this.token}`, ...(body ? { "Content-Type": "application/json" } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(20000),
    });
    const data = (await res.json().catch(() => ({}))) as T & { erro?: string };
    if (!res.ok) throw new ErroConsulta(data.erro ?? `Gateway respondeu ${res.status}`, res.status);
    return data;
  }

  consulta(fonte: string, caminho: string, parametros: Record<string, string>) {
    return this.req<RespostaFonte & { cache?: string }>("POST", "/v1/consulta", { fonte, caminho, parametros });
  }

  serieBcb(codigo: number, q: { ultimos?: number | null; inicio?: string | null; fim?: string | null }) {
    const params = new URLSearchParams();
    if (q.ultimos) params.set("ultimos", String(q.ultimos));
    if (q.inicio) params.set("inicio", q.inicio);
    if (q.fim) params.set("fim", q.fim);
    return this.req<RespostaSerie>("GET", `/v1/bcb/serie/${codigo}?${params}`);
  }

  tseVotacao(q: ConsultaTse) {
    const params = new URLSearchParams({ ano: String(q.ano), cargo: q.cargo });
    if (q.uf) params.set("uf", q.uf);
    if (q.nome) params.set("nome", q.nome);
    if (q.turno) params.set("turno", String(q.turno));
    return this.req<RespostaTse>("GET", `/v1/tse/votacao?${params}`);
  }
}

/** Sem gateway: consulta as APIs direto daqui. O TSE fica de fora (depende do D1). */
export class ClienteDireto implements ClienteDados {
  readonly modo = "direto";

  constructor(
    private readonly registro: Registro,
    private readonly chaves: Record<string, string | undefined>,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  consulta(fonteId: string, caminho: string, parametros: Record<string, string>) {
    const fonte = this.registro.fontes.find((f) => f.id === fonteId);
    if (!fonte) throw new ErroConsulta(`Fonte desconhecida: ${fonteId}`, 404);
    return consultarFonte(fonte, caminho, parametros, { chaves: this.chaves, fetch: this.fetchImpl });
  }

  async serieBcb(codigo: number, q: { ultimos?: number | null; inicio?: string | null; fim?: string | null }) {
    const url = urlSerieBcb(codigo, q);
    const res = await this.fetchImpl(url, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(10000) });
    if (!res.ok) throw new ErroConsulta(`O SGS respondeu ${res.status}.`, 502);
    const cat = this.registro.series_bcb.find((s) => s.codigo === codigo);
    return { codigo, nome: cat?.nome, unidade: cat?.unidade, origem: "api" as const, url, valores: lerSerieBcb(await res.json()) };
  }

  async tseVotacao(): Promise<RespostaTse> {
    throw new ErroConsulta("Os dados do TSE ficam no D1: configure DATA_GATEWAY_URL para consultá-los.", 503);
  }
}

export function criarClienteDados(config: {
  DATA_LAYER: "auto" | "gateway" | "direto" | "desligado";
  DATA_GATEWAY_URL?: string;
  DATA_GATEWAY_TOKEN?: string;
  PORTAL_TRANSPARENCIA_API_KEY?: string;
  registro: Registro;
}): ClienteDados | null {
  const modo = config.DATA_LAYER === "auto" ? (config.DATA_GATEWAY_URL ? "gateway" : "direto") : config.DATA_LAYER;
  if (modo === "desligado") return null;
  if (modo === "gateway") {
    if (!config.DATA_GATEWAY_URL || !config.DATA_GATEWAY_TOKEN) {
      throw new Error("DATA_LAYER=gateway exige DATA_GATEWAY_URL e DATA_GATEWAY_TOKEN.");
    }
    return new ClienteGateway(config.DATA_GATEWAY_URL, config.DATA_GATEWAY_TOKEN);
  }
  return new ClienteDireto(config.registro, { PORTAL_TRANSPARENCIA_API_KEY: config.PORTAL_TRANSPARENCIA_API_KEY });
}
