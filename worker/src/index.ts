// Gateway de dados oficiais (Cloudflare Worker + D1).
//
// Uma porta só para IBGE, Banco Central, Câmara, Senado, IPEA, Portal da
// Transparência e LexML, com cache na borda para aguentar o pico de consultas
// durante o debate, e o D1 guardando o que é pré-carregado (TSE, séries do BCB).

import registroPadrao from "../../config/fontes.json";
import {
  consultarFonte,
  ErroConsulta,
  lerSerieBcb,
  rota,
  sqlVotacaoTse,
  TEMAS,
  urlSerieBcb,
  type Fonte,
  type Registro,
  type Tema,
  type ValorSerie,
} from "../../src/shared/dados";

export interface Env {
  DB: D1Database;
  GATEWAY_TOKEN?: string;
  PORTAL_TRANSPARENCIA_API_KEY?: string;
}

const PADRAO = registroPadrao as unknown as Registro;
const SERIE_FRESCA_MS = 26 * 3600 * 1000;

const json = (data: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", ...headers },
  });

// ---------- registro de fontes (D1 com fallback para o JSON versionado) ----------

let memo: { at: number; registro: Registro } | null = null;

async function carregarRegistro(env: Env): Promise<Registro> {
  if (memo && Date.now() - memo.at < 60_000) return memo.registro;
  let registro = PADRAO;
  try {
    const { results } = await env.DB.prepare("SELECT config, ativo FROM fontes").all<{ config: string; ativo: number }>();
    if (results.length) {
      const fontes = results.map((r) => ({ ...(JSON.parse(r.config) as Fonte), ativo: r.ativo === 1 }));
      registro = { ...PADRAO, fontes };
    }
  } catch (err) {
    console.warn("registro: usando config/fontes.json embutido", err);
  }
  memo = { at: Date.now(), registro };
  return registro;
}

// ---------- cache na borda + junção de pedidos iguais simultâneos ----------

const emVoo = new Map<string, Promise<unknown>>();

async function comCache<T extends { ok?: boolean }>(
  chave: string,
  ttl: number,
  ctx: ExecutionContext,
  produzir: () => Promise<T>,
): Promise<{ corpo: T; cache: "hit" | "miss" }> {
  const req = new Request(`https://cache.checagem.internal/${encodeURIComponent(chave)}`);
  const hit = await caches.default.match(req);
  if (hit) return { corpo: (await hit.json()) as T, cache: "hit" };

  let pendente = emVoo.get(chave) as Promise<T> | undefined;
  if (!pendente) {
    pendente = produzir().finally(() => emVoo.delete(chave));
    emVoo.set(chave, pendente);
  }
  const corpo = await pendente;
  if (corpo.ok !== false && ttl > 0) {
    const res = new Response(JSON.stringify(corpo), {
      headers: { "content-type": "application/json", "cache-control": `public, max-age=${ttl}` },
    });
    ctx.waitUntil(caches.default.put(req, res));
  }
  return { corpo, cache: "miss" };
}

function registrarConsulta(env: Env, ctx: ExecutionContext, fonte: string, url: string, status: number, ms: number, cache: string) {
  ctx.waitUntil(
    env.DB.prepare("INSERT INTO consultas (fonte, url, status, ms, cache) VALUES (?, ?, ?, ?, ?)")
      .bind(fonte, url, status, ms, cache)
      .run()
      .catch((err) => console.error("consultas: falha ao registrar", err)),
  );
}

// ---------- Banco Central ----------

async function salvarValores(env: Env, codigo: number, valores: ValorSerie[]) {
  const stmt = env.DB.prepare(
    "INSERT INTO bcb_valores (codigo, data, valor) VALUES (?, ?, ?) ON CONFLICT (codigo, data) DO UPDATE SET valor = excluded.valor",
  );
  for (let i = 0; i < valores.length; i += 100) {
    await env.DB.batch(valores.slice(i, i + 100).map((v) => stmt.bind(codigo, v.data, v.valor)));
  }
}

async function serieBcb(env: Env, ctx: ExecutionContext, codigo: number, q: { ultimos?: number; inicio?: string; fim?: string }) {
  const catalogo = PADRAO.series_bcb.find((s) => s.codigo === codigo);
  const meta = await env.DB.prepare("SELECT ultima_sincronizacao FROM bcb_series WHERE codigo = ?")
    .bind(codigo)
    .first<{ ultima_sincronizacao: string | null }>()
    .catch(() => null);
  const fresca = meta?.ultima_sincronizacao && Date.now() - Date.parse(meta.ultima_sincronizacao) < SERIE_FRESCA_MS;
  const urlPublica = urlSerieBcb(codigo, { ultimos: q.ultimos, inicio: q.inicio, fim: q.fim });

  if (fresca) {
    const rows = q.inicio || q.fim
      ? await env.DB.prepare("SELECT data, valor FROM bcb_valores WHERE codigo = ? AND data >= ? AND data <= ? ORDER BY data")
          .bind(codigo, q.inicio ?? "0000-01-01", q.fim ?? "9999-12-31")
          .all<ValorSerie>()
      : await env.DB.prepare("SELECT data, valor FROM bcb_valores WHERE codigo = ? ORDER BY data DESC LIMIT ?")
          .bind(codigo, Math.min(q.ultimos ?? 12, 500))
          .all<ValorSerie>();
    if (rows.results.length) {
      const valores = q.inicio || q.fim ? rows.results : rows.results.reverse();
      return { ok: true, codigo, nome: catalogo?.nome, unidade: catalogo?.unidade, origem: "d1", url: urlPublica, atualizado_em: meta!.ultima_sincronizacao, valores };
    }
  }

  const { corpo, cache } = await comCache(`bcb:${urlPublica}`, 1800, ctx, async () => {
    const started = Date.now();
    const res = await fetch(urlPublica, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(10000) });
    const ms = Date.now() - started;
    if (!res.ok) return { ok: false, status: res.status, ms, valores: [] as ValorSerie[] };
    return { ok: true, status: res.status, ms, valores: lerSerieBcb(await res.json()) };
  });
  registrarConsulta(env, ctx, "bcb_sgs", urlPublica, corpo.ok ? 200 : (corpo as { status?: number }).status ?? 502, (corpo as { ms?: number }).ms ?? 0, cache);
  if (!corpo.ok) throw new ErroConsulta(`O SGS respondeu ${(corpo as { status?: number }).status}.`, 502);
  return { ok: true, codigo, nome: catalogo?.nome, unidade: catalogo?.unidade, origem: "api", url: urlPublica, valores: corpo.valores };
}

/** Cron: mantém as séries do catálogo no D1 (últimos 5 anos), para responder na hora e resistir a quedas do SGS. */
async function sincronizarSeries(env: Env) {
  const hoje = new Date();
  const inicio = new Date(hoje);
  inicio.setFullYear(hoje.getFullYear() - 5);
  const iso = (d: Date) => d.toISOString().slice(0, 10);

  for (const serie of PADRAO.series_bcb) {
    try {
      const url = urlSerieBcb(serie.codigo, { inicio: iso(inicio), fim: iso(hoje) });
      const res = await fetch(url, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(20000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const valores = lerSerieBcb(await res.json());
      await salvarValores(env, serie.codigo, valores);
      await env.DB.prepare(
        "INSERT INTO bcb_series (codigo, nome, unidade, ultima_sincronizacao) VALUES (?, ?, ?, ?) ON CONFLICT (codigo) DO UPDATE SET nome = excluded.nome, unidade = excluded.unidade, ultima_sincronizacao = excluded.ultima_sincronizacao",
      )
        .bind(serie.codigo, serie.nome, serie.unidade, new Date().toISOString())
        .run();
      await env.DB.prepare("INSERT INTO sincronizacoes (fonte, detalhe, ok, mensagem) VALUES ('bcb_sgs', ?, 1, ?)")
        .bind(String(serie.codigo), `${valores.length} valores`)
        .run();
    } catch (err) {
      await env.DB.prepare("INSERT INTO sincronizacoes (fonte, detalhe, ok, mensagem) VALUES ('bcb_sgs', ?, 0, ?)")
        .bind(String(serie.codigo), String(err))
        .run();
    }
  }
  await env.DB.prepare("UPDATE fontes SET ultima_sincronizacao = ? WHERE id = 'bcb_sgs'").bind(new Date().toISOString()).run();
}

// ---------- rotas HTTP ----------

const ConsultaBody = (b: unknown) => {
  const body = b as { fonte?: unknown; caminho?: unknown; parametros?: unknown };
  if (typeof body?.fonte !== "string" || typeof body.caminho !== "string") {
    throw new ErroConsulta("Informe fonte e caminho.");
  }
  const parametros: Record<string, string> = {};
  if (body.parametros && typeof body.parametros === "object") {
    for (const [k, v] of Object.entries(body.parametros)) parametros[k] = String(v);
  }
  return { fonte: body.fonte, caminho: body.caminho, parametros };
};

async function rotear(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const url = new URL(req.url);
  const p = url.pathname;

  if (p === "/v1/saude") return json({ ok: true, versao_fontes: PADRAO.versao });

  // Sem token configurado o gateway não abre: ele guarda a chave do Portal da Transparência.
  if (!env.GATEWAY_TOKEN) return json({ erro: "Configure o secret GATEWAY_TOKEN." }, 503);
  if (req.headers.get("authorization") !== `Bearer ${env.GATEWAY_TOKEN}`) return json({ erro: "Não autorizado." }, 401);

  const registro = await carregarRegistro(env);

  if (p === "/v1/fontes" && req.method === "GET") {
    return json({
      versao: registro.versao,
      fontes: registro.fontes.map((f) => ({ ...f, chave_configurada: f.requer_chave ? Boolean(env[f.requer_chave as keyof Env]) : null })),
      fontes_pre_carregadas: registro.fontes_pre_carregadas,
      series_bcb: registro.series_bcb,
    });
  }

  if (p === "/v1/rota" && req.method === "GET") {
    const tema = url.searchParams.get("tema") as Tema;
    if (!TEMAS.includes(tema)) return json({ erro: `Tema inválido. Use: ${TEMAS.join(", ")}` }, 400);
    return json({ tema, fontes: rota(registro, tema).map((f) => f.id) });
  }

  if (p === "/v1/consulta" && req.method === "POST") {
    const q = ConsultaBody(await req.json());
    const fonte = registro.fontes.find((f) => f.id === q.fonte);
    if (!fonte) return json({ erro: `Fonte desconhecida: ${q.fonte}` }, 404);
    const chave = `${fonte.id}:${q.caminho}:${JSON.stringify(q.parametros)}`;
    const { corpo, cache } = await comCache(chave, fonte.cache_ttl, ctx, () =>
      consultarFonte(fonte, q.caminho, q.parametros, { chaves: { PORTAL_TRANSPARENCIA_API_KEY: env.PORTAL_TRANSPARENCIA_API_KEY } }),
    );
    registrarConsulta(env, ctx, fonte.id, corpo.url, corpo.status, corpo.ms, cache);
    return json({ ...corpo, cache });
  }

  const serie = p.match(/^\/v1\/bcb\/serie\/(\d+)$/);
  if (serie && req.method === "GET") {
    const num = (k: string) => (url.searchParams.get(k) ? Number(url.searchParams.get(k)) : undefined);
    return json(
      await serieBcb(env, ctx, Number(serie[1]), {
        ultimos: num("ultimos"),
        inicio: url.searchParams.get("inicio") ?? undefined,
        fim: url.searchParams.get("fim") ?? undefined,
      }),
    );
  }

  if (p === "/v1/tse/votacao" && req.method === "GET") {
    const ano = Number(url.searchParams.get("ano"));
    const cargo = url.searchParams.get("cargo");
    if (!Number.isInteger(ano) || !cargo) return json({ erro: "Informe ano e cargo." }, 400);
    const { sql, params } = sqlVotacaoTse({
      ano,
      cargo,
      uf: url.searchParams.get("uf"),
      nome: url.searchParams.get("nome"),
      turno: url.searchParams.get("turno") ? Number(url.searchParams.get("turno")) : null,
    });
    const started = Date.now();
    const { results } = await env.DB.prepare(sql).bind(...params).all();
    const cargas = await env.DB.prepare("SELECT arquivo_url, carregado_em FROM tse_cargas WHERE ano = ?").bind(ano).all();
    registrarConsulta(env, ctx, "tse", `d1:tse_votacao?${url.searchParams}`, 200, Date.now() - started, "d1");
    return json({
      ok: true,
      origem: "d1",
      aviso: cargas.results.length ? undefined : `Não há dados do TSE de ${ano} carregados no D1.`,
      fonte: "Tribunal Superior Eleitoral — Portal de Dados Abertos",
      arquivos: cargas.results,
      resultados: results,
    });
  }

  if (p === "/v1/consultas" && req.method === "GET") {
    const limite = Math.min(Number(url.searchParams.get("limite")) || 50, 500);
    const { results } = await env.DB.prepare("SELECT * FROM consultas ORDER BY id DESC LIMIT ?").bind(limite).all();
    return json({ consultas: results });
  }

  if (p === "/v1/sincronizar" && req.method === "POST") {
    ctx.waitUntil(sincronizarSeries(env));
    return json({ ok: true, mensagem: "Sincronização das séries do BCB iniciada." }, 202);
  }

  return json({ erro: "Rota não encontrada." }, 404);
}

export default {
  async fetch(req, env, ctx): Promise<Response> {
    try {
      return await rotear(req, env, ctx);
    } catch (err) {
      if (err instanceof ErroConsulta) return json({ erro: err.message }, err.status);
      if (err instanceof DOMException && err.name === "TimeoutError") return json({ erro: "A fonte demorou demais para responder." }, 504);
      console.error(err);
      return json({ erro: "Erro interno no gateway." }, 500);
    }
  },
  async scheduled(_event, env, ctx) {
    ctx.waitUntil(sincronizarSeries(env));
  },
} satisfies ExportedHandler<Env>;
