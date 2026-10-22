// Tipos compartilhados entre o servidor e o site (sem dependências de Node).

import type { Tema } from "./dados.js";

/** Orador ainda não identificado: fala vinda da transmissão, o Claude descobre quem é. */
export const AUTO_SPEAKER = "auto";

export interface SpeakerInfo {
  id: string;
  nome: string;
  partido?: string;
  descricao?: string;
  cor: string;
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

export interface Claim {
  id: string;
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
  repeteDe?: string;
  editado?: boolean;
  erro?: string;
}

export interface PublicState {
  debate: DebateInfo;
  currentSpeaker: string | null;
  segments: Segment[];
  claims: Claim[];
  settings: { autoPublish: boolean; demo: boolean };
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
