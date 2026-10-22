import { motion } from "motion/react";
import type { CSSProperties } from "react";
import type { Claim, SpeakerInfo, Verdict } from "../../../src/shared/types";
import { VERDICTS, VERDICT_LABELS } from "../../../src/shared/types";
import { VERDICT_STYLE, softSpring } from "../theme";
import { AnimatedNumber } from "./AnimatedNumber";
import { Avatar } from "./Avatar";

interface Props {
  candidates: SpeakerInfo[];
  claims: Claim[];
  /** Só conta o que foi publicado (telão) ou tudo que já tem veredito (painel). */
  onlyPublished?: boolean;
  compact?: boolean;
}

/** Placar por candidato: barra empilhada por veredito, que cresce a cada checagem. */
export function Scoreboard({ candidates, claims, onlyPublished, compact }: Props) {
  const counted = claims.filter(
    (c) => c.resultado && !c.repeteDe && (onlyPublished ? c.status === "publicada" : c.status !== "descartada"),
  );
  return (
    <div className={`scoreboard ${compact ? "scoreboard--compact" : ""}`}>
      {candidates.map((cand) => {
        const mine = counted.filter((c) => c.speakerId === cand.id);
        const tally = Object.fromEntries(VERDICTS.map((v) => [v, 0])) as Record<Verdict, number>;
        for (const c of mine) tally[c.resultado!.veredito]++;
        const total = mine.length;
        return (
          <div key={cand.id} className="score" style={{ "--c": cand.cor } as CSSProperties}>
            <div className="score__head">
              <Avatar speaker={cand} className="score__avatar" />
              <strong>{cand.nome}</strong>
              <span className="score__total">
                <AnimatedNumber value={total} /> checagens
              </span>
            </div>
            <div className="score__bar">
              {VERDICTS.map((v) =>
                tally[v] ? (
                  <motion.span
                    key={v}
                    layout
                    title={`${VERDICT_LABELS[v]}: ${tally[v]}`}
                    style={{ background: VERDICT_STYLE[v].color }}
                    initial={{ flexGrow: 0 }}
                    animate={{ flexGrow: tally[v] }}
                    transition={softSpring}
                  />
                ) : null,
              )}
              {total === 0 && <span className="score__empty" />}
            </div>
            {!compact && (
              <div className="score__legend">
                {VERDICTS.filter((v) => tally[v]).map((v) => (
                  <span key={v} style={{ color: VERDICT_STYLE[v].color }}>
                    <AnimatedNumber value={tally[v]} /> {VERDICT_LABELS[v].toLowerCase()}
                  </span>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
