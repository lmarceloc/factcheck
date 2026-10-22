// Tipos compartilhados entre o servidor e o site (sem dependências de Node).

import type { Tema } from "./dados.js";

/** Orador ainda não identificado: fala vinda da transmissão, o modelo descobre quem é. */
export const AUTO_SPEAKER = "auto";

export interface SpeakerInfo {
  id: string;
  nome: string;
  partido?: string;
  descricao?: string;
  cor: string;
  /** Foto oficial (URL ou caminho servido pelo site, ex.: /fotos/a.jpeg). */
  foto?: string;
}

export interface DebateInfo {
  titulo: string;
  data: string;
  pais: string;
  emissora?: string;
  candidatos: SpeakerInfo[];
  outros_falantes: SpeakerInfo[];
}

export const VERDICTS = [
  "verdadeiro",
  "verdadeiro_mas",
  "exagerado",
  "distorcido",
  "falso",
  "insustentavel",
] as const;
export type Verdict = (typeof VERDICTS)[number];

export const VERDICT_LABELS: Record<Verdict, string> = {
  verdadeiro: "Verdadeiro",
  verdadeiro_mas: "Verdadeiro, mas…",
  exagerado: "Exagerado",
  distorcido: "Distorcido",
  falso: "Falso",
  insustentavel: "Insustentável",
};

export const CATEGORIES = [
  "acusacao_adversario",
  "dado_pais",
  "sobre_si",
  "historico",
  "outro",
] as const;
export type Category = (typeof CATEGORIES)[number];

export const CATEGORY_LABELS: Record<Category, string> = {
  acusacao_adversario: "Acusação ao adversário",
  dado_pais: "Dado sobre o país",
  sobre_si: "Sobre si mesmo",
  historico: "Fato histórico",
  outro: "Outro",
};

export type Priority = "alta" | "media" | "baixa";
export type Confidence = "alta" | "media" | "baixa";

export type ClaimStatus =
  | "na_fila"
  | "verificando"
  | "rascunho" // verificada, aguardando revisão humana
  | "publicada"
  | "descartada"
  | "erro";

export interface Segment {
  id: string;
  speakerId: string;
  text: string;
  at: number;
  /** Segundo do vídeo do YouTube em que a fala começou (modo transmissão). */
  videoTime?: number;
}

export interface Source {
  titulo: string;
  url: string;
  trecho?: string;
  /** true quando a URL apareceu nos resultados reais da busca (não foi inventada). */
  confirmada: boolean;
}

export interface CheckResult {
  veredito: Verdict;
  resumo: string;
  explicacao: string;
  dados: string;
  confianca: Confidence;
  fontes: Source[];
  nota_editor: string | null;
  buscas: string[];
  modelo: string;
  duracaoMs: number;
}

/** Contexto pesquisado para uma pergunta feita no debate, antes da resposta. */
export interface ContextResult {
  resumo: string;
  dados: string;
  /** O que o checador deve observar na resposta. */
  pontos: string[];
  fontes: Source[];
  buscas: string[];
  modelo: string;
  duracaoMs: number;
}

export interface Claim {
  id: string;
  /** afirmação (padrão) ou pergunta feita no debate. */
  tipo?: "afirmacao" | "pergunta";
  speakerId: string;
  segmentIds: string[];
  trecho: string;
  afirmacao: string;
  categoria: Category;
  /** Assunto, usado pelo roteador para escolher as fontes oficiais. */
  tema?: Tema;
  alvo: string | null;
  prioridade: Priority;
  status: ClaimStatus;
  createdAt: number;
  updatedAt: number;
  publishedAt?: number;
  /** Buscas feitas até agora (atualizado enquanto verifica). */
  progresso: string[];
  resultado?: CheckResult;
  /** Só para perguntas: dados para acompanhar a resposta. */
  contexto?: ContextResult;
  repeteDe?: string;
  editado?: boolean;
  /** Por que a checagem ficou retida para revisão em vez de ir direto ao ar. */
  revisao?: string;
  /** Segundo do vídeo em que a fala começou: o público clica e o player pula para lá. */
  videoTime?: number;
  erro?: string;
}

export const ORADOR_NAO_IDENTIFICADO = "orador não identificado";

/**
 * Publicação automática: vai direto para a tela, exceto o que é incerto
 * (confiança baixa ou sem dados), exagerado ou sem orador identificado,
 * que espera revisão humana.
 */
export function motivoRevisao(r: CheckResult, speakerId: string): string | null {
  // O público nunca vê "Não identificado": a redação escolhe o nome antes.
  if (speakerId === AUTO_SPEAKER) return ORADOR_NAO_IDENTIFICADO;
  if (r.confianca === "baixa") return "confiança baixa";
  if (r.veredito === "insustentavel") return "sem dados para comprovar";
  if (r.veredito === "exagerado") return "exagerado";
  return null;
}

/** Agrupa os vereditos para o contador do espectador. */
export const GRUPOS_CONTADOR = [
  { id: "verdades", label: "Verdades", vereditos: ["verdadeiro", "verdadeiro_mas"] as Verdict[] },
  { id: "mentiras", label: "Mentiras", vereditos: ["falso"] as Verdict[] },
  { id: "distorcoes", label: "Exageros e distorções", vereditos: ["exagerado", "distorcido"] as Verdict[] },
  { id: "sem_dados", label: "Sem comprovação", vereditos: ["insustentavel"] as Verdict[] },
] as const;

export interface PublicState {
  debate: DebateInfo;
  currentSpeaker: string | null;
  segments: Segment[];
  claims: Claim[];
  /** captura: a redação está transcrevendo agora; youtube: vídeo da transmissão. */
  settings: { autoPublish: boolean; demo: boolean; captura: boolean; youtube: string | null };
}

/** Debate encerrado e guardado: aparece na lista de debates anteriores. */
export interface ArquivoResumo {
  id: string;
  titulo: string;
  data: string;
  encerradoEm: number;
  youtube: string | null;
  checagens: number;
}

export type ServerEvent =
  | { type: "snapshot"; state: PublicState }
  | { type: "segment"; segment: Segment }
  | { type: "interim"; speakerId: string; text: string }
  | { type: "claim"; claim: Claim }
  /** Só no telão: a checagem saiu do ar (despublicada ou descartada). */
  | { type: "claim_hidden"; id: string }
  | { type: "speaker"; speakerId: string | null }
  | { type: "settings"; settings: PublicState["settings"] };
