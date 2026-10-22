import type { Env } from "./debate";

export { Debate } from "./debate";

// O site (painel e telão) é servido direto dos arquivos estáticos; só /api/*
// chega aqui e vai para o Durable Object do debate.
export default {
  async fetch(req, env): Promise<Response> {
    const url = new URL(req.url);
    if (!url.pathname.startsWith("/api/")) return env.ASSETS.fetch(req);
    const stub = env.DEBATE.get(env.DEBATE.idFromName("principal"));
    return stub.fetch(req);
  },
} satisfies ExportedHandler<Env>;
