// Gera o SQL que espelha config/fontes.json na tabela `fontes` do D1.
// Uso: npm run fontes:sql  →  cd worker && npx wrangler d1 execute factcheck-dados --remote --file=../data/fontes.sql
import fs from "node:fs";
import registro from "../config/fontes.json" with { type: "json" };

const s = (v: string | null) => (v === null ? "NULL" : `'${v.replace(/'/g, "''")}'`);
const linhas = registro.fontes.map(
  (f) =>
    `INSERT INTO fontes (id, nome, orgao, base_url, tipo, modo, requer_chave, prioridade, frequencia_atualizacao, ativo, config) VALUES (${[
      s(f.id),
      s(f.nome),
      s(f.orgao),
      s(f.base_url),
      s(f.tipo),
      s(f.modo),
      f.requer_chave ? 1 : 0,
      f.prioridade,
      s(f.frequencia_atualizacao),
      f.ativo ? 1 : 0,
      s(JSON.stringify(f)),
    ].join(", ")}) ON CONFLICT (id) DO UPDATE SET nome = excluded.nome, orgao = excluded.orgao, base_url = excluded.base_url, tipo = excluded.tipo, modo = excluded.modo, requer_chave = excluded.requer_chave, prioridade = excluded.prioridade, frequencia_atualizacao = excluded.frequencia_atualizacao, config = excluded.config;`,
);
fs.mkdirSync("data", { recursive: true });
fs.writeFileSync("data/fontes.sql", linhas.join("\n") + "\n");
console.log(`data/fontes.sql: ${linhas.length} fontes (versão ${registro.versao}). O campo ativo no D1 é preservado.`);
