// Baixa as fotos oficiais dos candidatos do site de resultados do TSE e grava
// em web/public/fotos/<id>.jpeg, preenchendo o campo "foto" em config/debate.json.
//
// Uso:
//   npm run tse:fotos -- --eleicao 6258 --cargo 1
//   npm run tse:fotos -- --eleicao 6258 --cargo 1 --mapa "a=FLAVIO,b=LULA"
//
// O site do TSE (resultados.tse.jus.br) é alimentado por arquivos JSON públicos:
// a lista de candidatos fica em dados-simplificados e as fotos em fotos/<uf>/<sqcand>.jpeg.
import fs from "node:fs";
import path from "node:path";
import { DebateConfigSchema } from "../src/config-core.js";
import { normalizar } from "../src/shared/dados.js";

const BASE = process.env.TSE_RESULTADOS_URL ?? "https://resultados.tse.jus.br/oficial";
const args = process.argv.slice(2);
const flag = (nome: string) => {
  const i = args.indexOf(`--${nome}`);
  return i >= 0 ? args[i + 1] : undefined;
};

const eleicao = flag("eleicao") ?? "6258";
const cargo = Number(flag("cargo") ?? "1");
const uf = (flag("uf") ?? "br").toLowerCase();
const arquivoDebate = flag("debate") ?? "config/debate.json";
const mapa = new Map(
  (flag("mapa") ?? "")
    .split(",")
    .filter(Boolean)
    .map((par) => par.split("=").map((s) => s.trim()) as [string, string]),
);

async function json(url: string): Promise<unknown> {
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`${res.status} em ${url}`);
  return res.json();
}

/** Procura em qualquer profundidade (o formato dos JSONs do TSE muda entre eleições). */
function* percorrer(no: unknown, caminho: unknown[] = []): Generator<{ no: Record<string, unknown>; caminho: unknown[] }> {
  if (Array.isArray(no)) for (const item of no) yield* percorrer(item, [...caminho, no]);
  else if (no && typeof no === "object") {
    yield { no: no as Record<string, unknown>, caminho };
    for (const v of Object.values(no)) yield* percorrer(v, [...caminho, no]);
  }
}

async function descobrirCiclo(): Promise<string> {
  if (flag("ciclo")) return flag("ciclo")!;
  try {
    const config = await json(`${BASE}/comum/config/ele-c.json`);
    for (const { no, caminho } of percorrer(config)) {
      if (String(no.cd) !== String(Number(eleicao))) continue;
      for (const anc of [...caminho].reverse()) {
        const ciclo = Object.values(anc as Record<string, unknown>).find((v) => typeof v === "string" && /^ele\d{4}$/.test(v));
        if (ciclo) return ciclo as string;
      }
    }
  } catch (err) {
    console.warn(`Não consegui ler a configuração do TSE (${(err as Error).message}).`);
  }
  console.warn("Ciclo não encontrado na configuração; tentando ele2026 (use --ciclo para informar).");
  return "ele2026";
}

const ciclo = await descobrirCiclo();
const e6 = eleicao.padStart(6, "0");
const c4 = String(cargo).padStart(4, "0");
const urlResultados = `${BASE}/${ciclo}/${eleicao}/dados-simplificados/${uf}/${uf}-c${c4}-e${e6}-r.json`;
console.log(`Candidatos: ${urlResultados}`);

const candidatos: { sqcand: string; nome: string; numero?: string }[] = [];
for (const { no } of percorrer(await json(urlResultados))) {
  if (no.sqcand && no.nm) candidatos.push({ sqcand: String(no.sqcand), nome: String(no.nm), numero: no.n ? String(no.n) : undefined });
}
if (!candidatos.length) throw new Error("Nenhum candidato encontrado no arquivo do TSE.");
console.log(`TSE lista: ${candidatos.map((c) => `${c.nome} (${c.numero ?? "?"})`).join(", ")}`);

if (!fs.existsSync(arquivoDebate)) fs.copyFileSync("config/debate.example.json", arquivoDebate);
const debate = DebateConfigSchema.parse(JSON.parse(fs.readFileSync(arquivoDebate, "utf8")));
fs.mkdirSync("web/public/fotos", { recursive: true });

for (const cand of debate.candidatos) {
  const termo = normalizar(mapa.get(cand.id) ?? cand.nome);
  const palavras = termo.split(" ").filter((p) => p.length > 2);
  const achado =
    candidatos.find((c) => normalizar(c.nome) === termo) ??
    candidatos.find((c) => palavras.some((p) => normalizar(c.nome).split(" ").includes(p)));
  if (!achado) {
    console.warn(`✗ ${cand.nome}: não achei no TSE. Use --mapa "${cand.id}=NOME NA URNA".`);
    continue;
  }
  const urlFoto = `${BASE}/${ciclo}/${eleicao}/fotos/${uf}/${achado.sqcand}.jpeg`;
  const res = await fetch(urlFoto);
  if (!res.ok) {
    console.warn(`✗ ${cand.nome}: foto indisponível (${res.status}) em ${urlFoto}`);
    continue;
  }
  const destino = path.join("web/public/fotos", `${cand.id}.jpeg`);
  fs.writeFileSync(destino, Buffer.from(await res.arrayBuffer()));
  cand.foto = `/fotos/${cand.id}.jpeg`;
  console.log(`✓ ${cand.nome} ← ${achado.nome} (${urlFoto})`);
}

fs.writeFileSync(arquivoDebate, JSON.stringify(debate, null, 2) + "\n");
console.log(`\n${arquivoDebate} atualizado. Rode npm run cf:deploy (ou reinicie o npm run dev) para publicar as fotos.`);
