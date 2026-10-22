import { motion } from "motion/react";
import type { CSSProperties } from "react";
import type { Verdict } from "../../../src/shared/types";
import { VERDICT_LABELS } from "../../../src/shared/types";
import { VERDICT_STYLE } from "../theme";

/** Selo do veredito: entra como um carimbo e desenha o ícone. */
export function VerdictBadge({ verdict, size = "md" }: { verdict: Verdict; size?: "md" | "xl" }) {
  const style = VERDICT_STYLE[verdict];
  return (
    <motion.div
      className={`verdict-badge verdict-badge--${size}`}
      style={{ "--v": style.color, "--glow": style.glow } as CSSProperties}
      initial={{ scale: 1.8, rotate: -10, opacity: 0, filter: "blur(6px)" }}
      animate={{ scale: 1, rotate: 0, opacity: 1, filter: "blur(0px)" }}
      transition={{ type: "spring", stiffness: 500, damping: 22, mass: 0.8 }}
    >
      <svg viewBox="0 0 24 24" aria-hidden>
        <motion.path
          d={style.icon}
          fill="none"
          stroke="currentColor"
          strokeWidth={2.8}
          strokeLinecap="round"
          strokeLinejoin="round"
          initial={{ pathLength: 0 }}
          animate={{ pathLength: 1 }}
          transition={{ delay: 0.15, duration: 0.45, ease: "easeOut" }}
        />
      </svg>
      <span>{VERDICT_LABELS[verdict]}</span>
    </motion.div>
  );
}
