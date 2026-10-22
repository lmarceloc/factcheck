import type OpenAI from "openai";
import { z } from "zod";
import { rota, type Registro, type Tema } from "../shared/dados.js";
import type { ClienteDados } from "./cliente.js";

// Ferramentas que o modelo usa para consultar as fontes oficiais durante a checagem.

export const FERRAMENTAS_DADOS = ["consultar_fonte_oficial", "serie_bcb", "tse_votacao"] as const;
export type FerramentaDados = (typeof FERRAMENTAS_DADOS)[number];

const ConsultaInput = z.object({
  fonte: z.string(),
  caminho: z.string(),
  parametros: z.array(z.object({ nome: z.string(), valor: z.string() })),
});
const SerieInput = z.object({
  codigo: z.number().int().positive(),
  ultimos: z.number().int().nullable(),
  inicio: z.string().nullable(),
  fim: z.string().nullable(),
});
const TseInput = z.object({
  ano: z.number().int(),
  cargo: z.string(),
  uf: z.string().nullable(),
  nome: z.string().nullable(),
  turno: z.number().int().nullable(),
});

export function definirFerramentas(registro: Registro, cliente: ClienteDados): OpenAI.Responses.FunctionTool[] {
  const ativas = registro.fontes.filter((f) => f.ativo);
  const catalogo = ativas
    .map((f) => `- ${f.id}: ${f.nome}. Base: ${f.base_url}. ${f.dicas} Exemplos de caminho: ${f.exemplos.join(" | ")}`)
    .join("\n");
  const series = registro.series_bcb.map((s) => `${s.codigo} = ${s.nome} (${s.unidade})`).join("; ");

  const ferramentas: OpenAI.Responses.FunctionTool[] = [
    {
      type: "function",
      name: "consultar_fonte_oficial",
      description: `Consulta a API oficial de um órgão público brasileiro e devolve a resposta bruta (JSON ou XML, possivelmente truncada). Use antes da busca na web sempre que o dado puder estar numa destas fontes:\n${catalogo}`,
      strict: true,
      parameters: {
        type: "object",
        additionalProperties: false,
        required: ["fonte", "caminho", "parametros"],
        properties: {
          fonte: { type: "string", enum: ativas.map((f) => f.id) },
          caminho: {
            type: "string",
            description: "Caminho relativo à base da fonte, começando com / (ou ? para fontes sem caminho). Pode incluir a query string.",
          },
          parametros: {
            type: "array",
            description: "Parâmetros extras de query string (opcional; pode ir vazio se já estiverem no caminho).",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["nome", "valor"],
              properties: { nome: { type: "string" }, valor: { type: "string" } },
            },
          },
        },
      },
    },
    {
      type: "function",
      name: "serie_bcb",
      description: `Série temporal do Banco Central (SGS), já normalizada (data AAAA-MM-DD, valor numérico). As séries do catálogo ficam sincronizadas no banco e respondem na hora: ${series}. Outros códigos do SGS também funcionam. Atenção: a série 432 (meta Selic) é diária e já vem preenchida com datas futuras até a próxima reunião do Copom; o que importa é o valor vigente e a data em que ele passou a valer.`,
      strict: true,
      parameters: {
        type: "object",
        additionalProperties: false,
        required: ["codigo", "ultimos", "inicio", "fim"],
        properties: {
          codigo: { type: "integer" },
          ultimos: { type: ["integer", "null"], description: "Quantos valores mais recentes (até 20). Use null se informar datas." },
          inicio: { type: ["string", "null"], description: "Data inicial AAAA-MM-DD, ou null" },
          fim: { type: ["string", "null"], description: "Data final AAAA-MM-DD, ou null" },
        },
      },
    },
  ];

  if (cliente.modo === "gateway") {
    ferramentas.push({
      type: "function",
      name: "tse_votacao",
      description:
        "Votos por candidato em eleições, a partir dos dados oficiais do TSE pré-carregados no banco. Soma todas as UFs quando uf é null. Use para afirmações como 'tive X milhões de votos' ou 'ganhei em tal estado'.",
      strict: true,
      parameters: {
        type: "object",
        additionalProperties: false,
        required: ["ano", "cargo", "uf", "nome", "turno"],
        properties: {
          ano: { type: "integer" },
          cargo: { type: "string", description: "Ex.: PRESIDENTE, GOVERNADOR, SENADOR, DEPUTADO FEDERAL" },
          uf: { type: ["string", "null"], description: "Sigla da UF, ou null para o total" },
          nome: { type: ["string", "null"], description: "Parte do nome ou nome de urna do candidato, ou null" },
          turno: { type: ["integer", "null"] },
        },
      },
    });
  }
  return ferramentas;
}

export interface ResultadoFerramenta {
  /** Conteúdo devolvido ao modelo. */
  texto: string;
  /** Linha curta para o painel ("IBGE: /6381/…"). */
  rotulo: string;
  /** Fonte oficial consultada, que entra na lista de fontes confirmadas. */
  fonte?: { titulo: string; url: string };
  erro?: boolean;
}

export async function executarFerramenta(
  nome: FerramentaDados,
  input: unknown,
  cliente: ClienteDados,
  registro: Registro,
): Promise<ResultadoFerramenta> {
  try {
    switch (nome) {
      case "consultar_fonte_oficial": {
        const q = ConsultaInput.parse(input);
        const fonte = registro.fontes.find((f) => f.id === q.fonte);
        const params = Object.fromEntries(q.parametros.map((p) => [p.nome, p.valor]));
        const r = await cliente.consulta(q.fonte, q.caminho, params);
        return {
          texto: JSON.stringify({ url: r.url, status: r.status, truncado: r.truncado, conteudo: r.conteudo }),
          rotulo: `${fonte?.orgao ?? q.fonte}: ${q.caminho}`,
          fonte: r.ok ? { titulo: `${fonte?.nome ?? q.fonte} — dados oficiais`, url: r.url } : undefined,
          erro: !r.ok,
        };
      }
      case "serie_bcb": {
        const q = SerieInput.parse(input);
        const r = await cliente.serieBcb(q.codigo, q);
        return {
          texto: JSON.stringify(r),
          rotulo: `Banco Central: série ${q.codigo}${r.nome ? ` (${r.nome})` : ""}`,
          fonte: { titulo: `Banco Central — SGS ${q.codigo}${r.nome ? `: ${r.nome}` : ""}`, url: r.url },
        };
      }
      case "tse_votacao": {
        const q = TseInput.parse(input);
        const r = await cliente.tseVotacao(q);
        const url = r.arquivos?.[0]?.arquivo_url ?? "https://dadosabertos.tse.jus.br/";
        return {
          texto: JSON.stringify(r),
          rotulo: `TSE: ${q.cargo} ${q.ano}${q.nome ? ` — ${q.nome}` : ""}${q.uf ? ` (${q.uf})` : ""}`,
          fonte: r.resultados.length ? { titulo: `TSE — resultados de ${q.ano} (${q.cargo.toLowerCase()})`, url } : undefined,
        };
      }
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { texto: JSON.stringify({ erro: msg }), rotulo: `${nome}: falhou (${msg})`, erro: true };
  }
}

/** Texto do roteador de evidências para o prompt: quais fontes oficiais olhar primeiro para o tema. */
export function textoRota(registro: Registro, tema: Tema | undefined, cliente: ClienteDados | null): string {
  if (!cliente) return "Fontes oficiais diretas indisponíveis nesta configuração: use a busca na web.";
  if (!tema || tema === "outro") {
    return "Tema não classificado: escolha a fonte oficial mais adequada na lista das ferramentas; use a busca na web se nenhuma servir.";
  }
  const fontes = rota(registro, tema).map((f) => `${f.id} (${f.nome})`);
  if (tema === "eleicao" && cliente.modo === "gateway") fontes.unshift("tse_votacao (TSE pré-carregado)");
  if (["inflacao_precos", "juros_cambio_credito", "contas_publicas"].includes(tema)) fontes.unshift("serie_bcb");
  return fontes.length
    ? `Tema: ${tema}. Fontes oficiais indicadas, nesta ordem: ${fontes.join("; ")}. Recorra à busca na web só se elas não resolverem.`
    : `Tema: ${tema}. Nenhuma fonte oficial direta cadastrada para este tema: use a busca na web.`;
}
