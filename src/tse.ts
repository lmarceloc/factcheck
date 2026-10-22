import { normalizar } from "./shared/dados.js";

// Leitura dos arquivos "votacao_candidato_munzona" do TSE: CSV com ";",
// campos entre aspas, em latin1, uma linha por candidato × município × zona.

export interface LinhaTse {
  ano: number;
  turno: number;
  uf: string;
  cargo: string;
  sq_candidato: string;
  numero: string;
  nome: string;
  nome_urna: string;
  partido: string;
  situacao: string;
  votos: number;
}

export function lerLinhaCsv(linha: string): string[] {
  const campos: string[] = [];
  let atual = "";
  let aspas = false;
  for (let i = 0; i < linha.length; i++) {
    const ch = linha[i];
    if (aspas) {
      if (ch === '"' && linha[i + 1] === '"') {
        atual += '"';
        i++;
      } else if (ch === '"') {
        aspas = false;
      } else {
        atual += ch;
      }
    } else if (ch === '"') {
      aspas = true;
    } else if (ch === ";") {
      campos.push(atual);
      atual = "";
    } else {
      atual += ch;
    }
  }
  campos.push(atual.replace(/\r$/, ""));
  return campos;
}

/** Converte uma linha do CSV usando o cabeçalho; aceita as variações de nome de coluna entre eleições. */
export function criarLeitor(cabecalho: string[]) {
  const idx = new Map(cabecalho.map((c, i) => [c.trim().toUpperCase(), i]));
  const col = (...nomes: string[]) => {
    for (const n of nomes) if (idx.has(n)) return idx.get(n)!;
    return -1;
  };
  const c = {
    ano: col("ANO_ELEICAO"),
    turno: col("NR_TURNO"),
    uf: col("SG_UF"),
    cargo: col("DS_CARGO"),
    sq: col("SQ_CANDIDATO"),
    numero: col("NR_CANDIDATO"),
    nome: col("NM_CANDIDATO"),
    nomeUrna: col("NM_URNA_CANDIDATO"),
    partido: col("SG_PARTIDO"),
    situacao: col("DS_SIT_TOT_TURNO"),
    // A partir de 2022 há a contagem só dos votos válidos (exclui candidaturas anuladas depois).
    votos: col("QT_VOTOS_NOMINAIS_VALIDOS", "QT_VOTOS_NOMINAIS"),
  };
  const faltando = Object.entries(c).filter(([k, v]) => v < 0 && !["numero", "situacao", "nomeUrna"].includes(k));
  if (faltando.length) throw new Error(`Colunas não encontradas no CSV do TSE: ${faltando.map(([k]) => k).join(", ")}`);

  return (campos: string[]): LinhaTse => ({
    ano: Number(campos[c.ano]),
    turno: Number(campos[c.turno]),
    uf: campos[c.uf],
    cargo: campos[c.cargo],
    sq_candidato: campos[c.sq],
    numero: c.numero >= 0 ? campos[c.numero] : "",
    nome: campos[c.nome],
    nome_urna: c.nomeUrna >= 0 ? campos[c.nomeUrna] : campos[c.nome],
    partido: campos[c.partido],
    situacao: c.situacao >= 0 ? campos[c.situacao] : "",
    votos: Number(campos[c.votos]) || 0,
  });
}

/** Soma os votos por candidato e UF (o arquivo vem por município e zona). */
export class AgregadorTse {
  readonly linhas = new Map<string, LinhaTse>();
  lidas = 0;

  constructor(private readonly cargos?: Set<string>) {}

  add(l: LinhaTse) {
    this.lidas++;
    if (this.cargos && !this.cargos.has(normalizar(l.cargo))) return;
    const chave = [l.ano, l.turno, l.uf, normalizar(l.cargo), l.sq_candidato].join("|");
    const atual = this.linhas.get(chave);
    if (atual) atual.votos += l.votos;
    else this.linhas.set(chave, { ...l });
  }
}

const sqlStr = (s: string | number) => (typeof s === "number" ? String(s) : `'${s.replace(/'/g, "''")}'`);

/** Gera o SQL para o D1: apaga a carga anterior do ano e insere em lotes. */
export function gerarSql(ano: number, linhas: Iterable<LinhaTse>, arquivoUrl: string, lote = 200): string {
  const out = [`DELETE FROM tse_votacao WHERE ano = ${ano};`];
  let buffer: string[] = [];
  let total = 0;
  const flush = () => {
    if (!buffer.length) return;
    out.push(
      `INSERT INTO tse_votacao (ano, turno, uf, cargo, cargo_busca, sq_candidato, numero, nome_urna, nome, nome_busca, partido, situacao, votos) VALUES\n${buffer.join(",\n")};`,
    );
    buffer = [];
  };
  for (const l of linhas) {
    const busca = normalizar(`${l.nome_urna} ${l.nome}`);
    buffer.push(
      `(${[l.ano, l.turno, l.uf, l.cargo, normalizar(l.cargo), l.sq_candidato, l.numero, l.nome_urna, l.nome, busca, l.partido, l.situacao, l.votos].map(sqlStr).join(", ")})`,
    );
    total++;
    if (buffer.length >= lote) flush();
  }
  flush();
  out.push(
    `INSERT INTO tse_cargas (ano, arquivo_url, linhas) VALUES (${ano}, ${sqlStr(arquivoUrl)}, ${total}) ON CONFLICT (ano, arquivo_url) DO UPDATE SET linhas = excluded.linhas, carregado_em = strftime('%Y-%m-%dT%H:%M:%fZ', 'now');`,
  );
  return out.join("\n");
}
