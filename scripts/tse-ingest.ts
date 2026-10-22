// Baixa os resultados do TSE e gera o SQL para carregar no D1.
//
// Uso:
//   npm run tse:ingest -- --ano 2022
//   npm run tse:ingest -- --ano 2022 --cargos "PRESIDENTE,GOVERNADOR,SENADOR" --executar remote
//   npm run tse:ingest -- --ano 2022 --arquivo ~/Downloads/votacao_candidato_munzona_2022.zip
//
// Os arquivos do TSE são grandes (centenas de MB descompactados): tudo é lido
// em streaming e só o total por candidato e UF vai para o banco.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { Unzip, UnzipInflate, type UnzipFile } from "fflate";
import registro from "../config/fontes.json" with { type: "json" };
import { normalizar } from "../src/shared/dados.js";
import { AgregadorTse, criarLeitor, gerarSql, lerLinhaCsv } from "../src/tse.js";

const args = process.argv.slice(2);
const flag = (nome: string) => {
  const i = args.indexOf(`--${nome}`);
  return i >= 0 ? args[i + 1] : undefined;
};

const ano = Number(flag("ano"));
if (!Number.isInteger(ano)) {
  console.error("Informe o ano: npm run tse:ingest -- --ano 2022");
  process.exit(1);
}
const base = registro.fontes_pre_carregadas.find((f) => f.id === "tse")!.base_url;
const url = flag("url") ?? `${base}/votacao_candidato_munzona/votacao_candidato_munzona_${ano}.zip`;
const saida = flag("saida") ?? "data/tse";
const cargos = flag("cargos") ? new Set(flag("cargos")!.split(",").map(normalizar)) : undefined;
const executar = flag("executar"); // "local" | "remote"

fs.mkdirSync(saida, { recursive: true });
let arquivo = flag("arquivo");
if (!arquivo) {
  arquivo = path.join(saida, path.basename(new URL(url).pathname));
  if (!fs.existsSync(arquivo)) {
    console.log(`Baixando ${url}…`);
    const res = await fetch(url);
    if (!res.ok || !res.body) throw new Error(`Falha ao baixar (${res.status}). Confira a URL no Portal de Dados Abertos do TSE.`);
    await pipeline(Readable.fromWeb(res.body as never), fs.createWriteStream(`${arquivo}.parcial`));
    fs.renameSync(`${arquivo}.parcial`, arquivo);
  }
}

const agregador = new AgregadorTse(cargos);

function lerCsv() {
  const decoder = new TextDecoder("latin1");
  let resto = "";
  let leitor: ReturnType<typeof criarLeitor> | null = null;
  const linha = (l: string) => {
    if (!l.trim()) return;
    const campos = lerLinhaCsv(l);
    if (!leitor) leitor = criarLeitor(campos);
    else agregador.add(leitor(campos));
  };
  return {
    push(chunk: Uint8Array, final: boolean) {
      resto += decoder.decode(chunk, { stream: !final });
      const partes = resto.split("\n");
      resto = final ? "" : partes.pop()!;
      for (const p of partes) linha(p);
      if (final && resto) linha(resto);
    },
  };
}

if (arquivo.toLowerCase().endsWith(".csv")) {
  const csv = lerCsv();
  for await (const chunk of fs.createReadStream(arquivo)) csv.push(chunk as Uint8Array, false);
  csv.push(new Uint8Array(), true);
} else {
  // Se o zip tiver o consolidado do país (_BRASIL.csv), usa só ele para não contar em dobro.
  const nomes: string[] = [];
  await new Promise<void>((resolve, reject) => {
    const listar = new Unzip((f) => nomes.push(f.name));
    const s = fs.createReadStream(arquivo!);
    s.on("data", (c) => listar.push(c as Uint8Array));
    s.on("end", () => {
      listar.push(new Uint8Array(), true);
      resolve();
    });
    s.on("error", reject);
  });
  const csvs = nomes.filter((n) => n.toLowerCase().endsWith(".csv"));
  const brasil = csvs.find((n) => /_BRASIL\.csv$/i.test(n));
  const escolhidos = new Set(brasil ? [brasil] : csvs);
  console.log(`Lendo ${escolhidos.size} arquivo(s): ${[...escolhidos].slice(0, 3).join(", ")}${escolhidos.size > 3 ? "…" : ""}`);

  await new Promise<void>((resolve, reject) => {
    const pendentes = new Set<string>();
    let fimZip = false;
    const talvezFim = () => fimZip && pendentes.size === 0 && resolve();
    const unzip = new Unzip((file: UnzipFile) => {
      if (!escolhidos.has(file.name)) return;
      pendentes.add(file.name);
      const csv = lerCsv();
      file.ondata = (err, data, final) => {
        if (err) return reject(err);
        csv.push(data, final);
        if (final) {
          pendentes.delete(file.name);
          talvezFim();
        }
      };
      file.start();
    });
    unzip.register(UnzipInflate);
    const s = fs.createReadStream(arquivo!);
    s.on("data", (c) => unzip.push(c as Uint8Array));
    s.on("end", () => {
      unzip.push(new Uint8Array(), true);
      fimZip = true;
      talvezFim();
    });
    s.on("error", reject);
  });
}

const sqlPath = path.join(saida, `tse_votacao_${ano}.sql`);
fs.writeFileSync(sqlPath, gerarSql(ano, agregador.linhas.values(), url));
console.log(`${agregador.lidas.toLocaleString("pt-BR")} linhas lidas → ${agregador.linhas.size.toLocaleString("pt-BR")} totais por candidato/UF`);
console.log(`SQL gerado em ${sqlPath}`);

const comando = ["wrangler", "d1", "execute", "factcheck-dados", `--${executar ?? "remote"}`, `--file=${path.resolve(sqlPath)}`];
if (executar) {
  const r = spawnSync("npx", comando, { cwd: "worker", stdio: "inherit" });
  process.exit(r.status ?? 1);
} else {
  console.log(`\nPara carregar no D1:\n  cd worker && npx ${comando.join(" ")}`);
}
