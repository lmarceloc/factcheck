import { motion } from "motion/react";
import type { CSSProperties } from "react";
import type { Claim, SpeakerInfo } from "../../../src/shared/types";
import { GRUPOS_CONTADOR } from "../../../src/shared/types";
import { softSpring } from "../theme";
import { AnimatedNumber } from "./AnimatedNumber";
import { Avatar } from "./Avatar";

const CORES: Record<(typeof GRUPOS_CONTADOR)[number]["id"], string> = {
  verdades: "#22c55e",
  mentiras: "#ef4444",
  distorcoes: "#fb923c",
  sem_dados: "#a78bfa",
};

const ICONES: Record<(typeof GRUPOS_CONTADOR)[number]["id"], string> = {
  verdades: "M5 12.5l4.5 4.5L19 7.5",
  mentiras: "M6 6l12 12M18 6L6 18",
  distorcoes: "M4 12c3-5 5 5 8 0s5 5 8 0",
  sem_dados: "M9 9a3 3 0 1 1 4 2.8c-.7.3-1 .9-1 1.7V15M12 18.5v.01",
};

/** Placar por candidato: quantas verdades, mentiras e distorções ao longo do debate. */
export function Contador({ candidates, claims }: { candidates: SpeakerInfo[]; claims: Claim[] }) {
  const publicadas = claims.filter((c) => c.status === "publicada" && c.resultado && !c.repeteDe);

  return (
    <div className="contador">
      {candidates.map((cand) => {
        const mine = publicadas.filter((c) => c.speakerId === cand.id);
        const total = mine.length;
        const grupos = GRUPOS_CONTADOR.map((g) => ({
          ...g,
          n: mine.filter((c) => g.vereditos.includes(c.resultado!.veredito)).length,
        }));
        return (
          <motion.section key={cand.id} layout className="contador__cand" style={{ "--c": cand.cor } as CSSProperties}>
            <header>
              <Avatar speaker={cand} className="contador__foto" />
              <div>
                <strong>{cand.nome}</strong>
                <span>
                  {cand.partido ? `${cand.partido} · ` : ""}
                  <AnimatedNumber value={total} /> {total === 1 ? "checagem" : "checagens"}
                </span>
              </div>
            </header>
            <div className="contador__barra" aria-hidden>
              {grupos.map((g) =>
                g.n ? (
                  <motion.span
                    key={g.id}
                    layout
                    style={{ background: CORES[g.id] }}
                    initial={{ flexGrow: 0 }}
                    animate={{ flexGrow: g.n }}
                    transition={softSpring}
                  />
                ) : null,
              )}
              {total === 0 && <span className="contador__vazio" />}
            </div>
            <div className="contador__grupos">
              {grupos.map((g) => (
                <div key={g.id} className="contador__grupo" style={{ "--g": CORES[g.id] } as CSSProperties}>
                  <svg viewBox="0 0 24 24" aria-hidden>
                    <path d={ICONES[g.id]} fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                  <AnimatedNumber value={g.n} className="contador__n" />
                  <small>{g.label}</small>
                </div>
              ))}
            </div>
          </motion.section>
        );
      })}
    </div>
  );
}
