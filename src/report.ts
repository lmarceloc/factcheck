import type { PublicState } from "./shared/types.js";
import { CATEGORY_LABELS, VERDICT_LABELS } from "./shared/types.js";

/** Relatório pós-debate com as checagens publicadas, pronto para virar matéria. */
export function markdownReport(state: PublicState): string {
  const names = new Map([...state.debate.candidatos, ...state.debate.outros_falantes].map((s) => [s.id, s.nome]));
  const published = state.claims
    .filter((c) => c.status === "publicada" && c.resultado && !c.repeteDe)
    .sort((a, b) => a.createdAt - b.createdAt);

  const lines = [`# Checagem — ${state.debate.titulo}`, "", `${state.debate.data} · ${state.debate.pais}`, ""];

  for (const cand of state.debate.candidatos) {
    const mine = published.filter((c) => c.speakerId === cand.id);
    const tally = new Map<string, number>();
    for (const c of mine) tally.set(c.resultado!.veredito, (tally.get(c.resultado!.veredito) ?? 0) + 1);
    const summary = [...tally].map(([v, n]) => `${n} ${VERDICT_LABELS[v as keyof typeof VERDICT_LABELS].toLowerCase()}`);
    lines.push(`- **${cand.nome}**: ${mine.length} checagens${summary.length ? ` (${summary.join(", ")})` : ""}`);
  }
  lines.push("");

  for (const c of published) {
    const r = c.resultado!;
    const hora = new Date(c.createdAt).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
    lines.push(
      `## ${VERDICT_LABELS[r.veredito].toUpperCase()} — ${names.get(c.speakerId) ?? "Orador não identificado"}`,
      "",
      `> "${c.trecho}"`,
      "",
      `*${CATEGORY_LABELS[c.categoria]} · ${hora}*`,
      "",
      `**${r.resumo}**`,
      "",
      r.explicacao,
      "",
      `**O que dizem os dados:** ${r.dados}`,
      "",
    );
    if (r.fontes.length) {
      lines.push("Fontes:");
      for (const f of r.fontes) lines.push(`- [${f.titulo}](${f.url})`);
      lines.push("");
    }
  }
  return lines.join("\n");
}
