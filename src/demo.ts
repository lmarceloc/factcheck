import type { ExtractedClaim, Extractor } from "./extractor.js";
import type { Verifier } from "./verifier.js";
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
  const sentences = chunk.text.split(/(?<=[.!?…])\s+/).filter((s) => s.length > 25 && CHECKABLE.test(s));
  return sentences.map<ExtractedClaim>((s) => {
    const repeat = known.find((k) => k.trecho.toLowerCase() === s.toLowerCase());
    return {
      trecho: s,
      afirmacao: s,
      categoria: /\d|%/.test(s) ? "dado_pais" : /ele|ela|advers|govern/i.test(s) ? "acusacao_adversario" : "sobre_si",
      tema: /infla|preço/i.test(s) ? "inflacao_precos" : /desempreg|emprego/i.test(s) ? "emprego_renda" : /vot/i.test(s) ? "votacao_legislativa" : "outro",
      alvo: null,
      prioridade: /\d/.test(s) ? "alta" : "media",
      repete_id: repeat?.id ?? null,
    };
  });
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
