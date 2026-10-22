import type { ExtractedClaim, Extractor } from "./extractor.js";
import type { Briefer, Verifier } from "./verifier.js";
import { VERDICTS } from "./shared/types.js";

// Modo de demonstração: extração e checagem falsas, sem chamar a API.
// Serve para ensaiar a operação e testar o telão. Nada aqui é checagem de verdade.

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const CHECKABLE = /\d|%|milh|bilh|votou|aument|caiu|cresc|reduz|dobr|nunca|sempre|maior|menor|record|primeir/i;

function hash(text: string) {
  let h = 0;
  for (const ch of text) h = (h * 31 + ch.charCodeAt(0)) | 0;
  return Math.abs(h);
}

export const demoExtractor: Extractor = async (chunk, _context, known) => {
  await sleep(600);
  const all = chunk.text.split(/(?<=[.!?…])\s+/);
  const perguntas = all
    .filter((s) => s.trim().endsWith("?") && s.length > 25)
    .map((s) => ({ trecho: s, pergunta: s, quem_pergunta: null, para_quem: null, tema: "outro" as const }));
  const sentences = all.filter((s) => !s.trim().endsWith("?") && s.length > 25 && CHECKABLE.test(s));
  const afirmacoes = sentences.map<ExtractedClaim>((s) => {
    const repeat = known.find((k) => k.trecho.toLowerCase() === s.toLowerCase());
    return {
      trecho: s,
      afirmacao: s,
      categoria: /\d|%/.test(s) ? "dado_pais" : /ele|ela|advers|govern/i.test(s) ? "acusacao_adversario" : "sobre_si",
      tema: /infla|preço/i.test(s) ? "inflacao_precos" : /desempreg|emprego/i.test(s) ? "emprego_renda" : /vot/i.test(s) ? "votacao_legislativa" : "outro",
      alvo: null,
      orador_id: null,
      prioridade: /\d/.test(s) ? "alta" : "media",
      repete_id: repeat?.id ?? null,
    };
  });
  return { afirmacoes, perguntas };
};

export const demoVerifier: Verifier = async (claim, _context, onProgress) => {
  const started = Date.now();
  const words = claim.afirmacao.split(/\s+/).slice(0, 6).join(" ");
  const queries: string[] = [];
  for (const q of [`${words} dados oficiais`, `${words} IBGE`, `checagem ${words}`]) {
    await sleep(900 + (hash(q) % 1200));
    queries.push(q);
    onProgress([...queries]);
  }
  const veredito = VERDICTS[hash(claim.afirmacao) % VERDICTS.length];
  return {
    veredito,
    resumo: "[SIMULAÇÃO] Veredito de demonstração — não é uma checagem real.",
    explicacao:
      "Este resultado foi gerado pelo modo de demonstração (DEMO_MODE=true), que não consulta nenhuma fonte. Use apenas para ensaiar a operação do painel e do telão.",
    dados: "Nenhum dado foi consultado.",
    confianca: "baixa",
    fontes: [{ titulo: "IBGE — Instituto Brasileiro de Geografia e Estatística", url: "https://www.ibge.gov.br/", confirmada: false }],
    nota_editor: "Modo de demonstração ativo.",
    buscas: queries,
    modelo: "demo",
    duracaoMs: Date.now() - started,
  };
};

export const demoBriefer: Briefer = async (q, _context, onProgress) => {
  const started = Date.now();
  const words = q.afirmacao.split(/\s+/).slice(0, 6).join(" ");
  const queries = [`${words} dados oficiais`];
  await sleep(1200);
  onProgress(queries);
  await sleep(800);
  return {
    resumo: "[SIMULAÇÃO] Contexto de demonstração — nenhuma fonte foi consultada.",
    dados: "Nenhum dado foi consultado.",
    pontos: ["Observe números citados na resposta", "Compare com o período da pergunta"],
    fontes: [],
    buscas: queries,
    modelo: "demo",
    duracaoMs: Date.now() - started,
  };
};
