interface Env {
  /** Endereço do app (Worker "factcheck" na conta do projeto). */
  ORIGEM: string;
}

/**
 * Repassa cada pedido para o app, sem mudar nada: mesma rota, método, cabeçalhos
 * e corpo. A resposta volta em streaming (o painel usa SSE), já descompactada:
 * a borda do Cloudflare compacta de novo conforme o que cada navegador aceita
 * (robôs de prévia de link, como o do WhatsApp, nem sempre aceitam br).
 */
export default {
  async fetch(req, env): Promise<Response> {
    const url = new URL(req.url);
    const headers = new Headers(req.headers);
    headers.delete("host");
    headers.set("x-forwarded-host", url.host);
    const res = await fetch(new URL(url.pathname + url.search, env.ORIGEM), {
      method: req.method,
      headers,
      body: req.method === "GET" || req.method === "HEAD" ? null : req.body,
      redirect: "manual",
    });
    const saida = new Headers(res.headers);
    saida.delete("content-encoding");
    saida.delete("content-length");
    return new Response(res.body, { status: res.status, statusText: res.statusText, headers: saida });
  },
} satisfies ExportedHandler<Env>;
