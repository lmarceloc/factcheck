import type { ClaimStatus, Verdict } from "../../src/shared/types";

export const VERDICT_STYLE: Record<Verdict, { color: string; glow: string; icon: string }> = {
  verdadeiro: { color: "#22c55e", glow: "rgba(34,197,94,.45)", icon: "M5 12.5l4.5 4.5L19 7.5" },
  verdadeiro_mas: { color: "#84cc16", glow: "rgba(132,204,22,.4)", icon: "M5 12.5l4.5 4.5L19 7.5M12 3v0" },
  exagerado: { color: "#facc15", glow: "rgba(250,204,21,.4)", icon: "M12 19V5M6 11l6-6 6 6" },
  distorcido: { color: "#fb923c", glow: "rgba(251,146,60,.45)", icon: "M4 12c3-5 5 5 8 0s5 5 8 0" },
  falso: { color: "#ef4444", glow: "rgba(239,68,68,.5)", icon: "M6 6l12 12M18 6L6 18" },
  insustentavel: { color: "#a78bfa", glow: "rgba(167,139,250,.4)", icon: "M9 9a3 3 0 1 1 4 2.8c-.7.3-1 .9-1 1.7V15M12 18.5v.01" },
};

export const STATUS_LABEL: Record<ClaimStatus, string> = {
  na_fila: "Na fila",
  verificando: "Checando",
  rascunho: "Revisar",
  publicada: "No ar",
  descartada: "Descartada",
  erro: "Erro",
};

export const spring = { type: "spring", stiffness: 420, damping: 34 } as const;
export const softSpring = { type: "spring", stiffness: 220, damping: 26 } as const;
