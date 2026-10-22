import type { Env } from "./debate";

export { Debate } from "./debate";

const PUBLIC_STATE = "/api/public/state";
const PUBLIC_TTL_MS = 2000;

// Estado público em memória do isolate: com muita gente assistindo, o Durable
// Object recebe no máximo uma leitura a cada 2 s por isolate, não uma por espectador.
let memo: { at: number; body: string } | null = null;
let pending: Promise<string> | null = null;

async function publicState(env: Env, ctx: ExecutionContext): Promise<Response> {
  const headers = { "content-type": "application/json; charset=utf-8", "cache-control": "public, max-age=2" };
  if (memo && Date.now() - memo.at < PUBLIC_TTL_MS) return new Response(memo.body, { headers });

  // Cache da borda (funciona em domínio próprio; em *.workers.dev é ignorado).
  const key = new Request("https://cache.checagem.internal/public-state");
  const hit = await caches.default.match(key).catch(() => undefined);
  if (hit) return hit;

  pending ??= env.DEBATE.get(env.DEBATE.idFromName("principal"))
    .fetch(`https://do${PUBLIC_STATE}`)
    .then((r) => r.text())
    .finally(() => (pending = null));
  const body = await pending;
  memo = { at: Date.now(), body };
  const res = new Response(body, { headers });
  ctx.waitUntil(caches.default.put(key, res.clone()).catch(() => {}));
  return res;
}

// O site (tela do público, painel e telão) é servido dos arquivos estáticos;
// só /api/* chega aqui e vai para o Durable Object do debate.
export default {
  async fetch(req, env, ctx): Promise<Response> {
    const url = new URL(req.url);
    if (!url.pathname.startsWith("/api/")) return env.ASSETS.fetch(req);
    if (req.method === "GET" && url.pathname === PUBLIC_STATE) return publicState(env, ctx);
    const stub = env.DEBATE.get(env.DEBATE.idFromName("principal"));
    return stub.fetch(req);
  },
} satisfies ExportedHandler<Env>;
