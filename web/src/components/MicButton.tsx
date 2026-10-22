import { motion, useTransform, type MotionValue } from "motion/react";

interface Props {
  listening: boolean;
  level: MotionValue<number>;
  disabled?: boolean;
  onToggle: () => void;
}

const BARS = [0.55, 0.85, 1, 0.75, 0.5];

function Bar({ level, weight, i }: { level: MotionValue<number>; weight: number; i: number }) {
  const scaleY = useTransform(level, (v) => 0.18 + Math.min(1, v * weight * (1 + (i % 2) * 0.25)) * 0.82);
  return <motion.span className="mic__bar" style={{ scaleY }} />;
}

/** Botão do microfone com anéis pulsando e medidor de volume em tempo real. */
export function MicButton({ listening, level, disabled, onToggle }: Props) {
  return (
    <div className="mic">
      <motion.button
        className={`mic__button ${listening ? "mic__button--on" : ""}`}
        onClick={onToggle}
        disabled={disabled}
        whileHover={{ scale: 1.05 }}
        whileTap={{ scale: 0.92 }}
        aria-pressed={listening}
        aria-label={listening ? "Desligar microfone" : "Ligar microfone"}
      >
        {listening &&
          [0, 1].map((i) => (
            <motion.span
              key={i}
              className="mic__ring"
              initial={{ scale: 1, opacity: 0.6 }}
              animate={{ scale: 2.1, opacity: 0 }}
              transition={{ duration: 1.8, repeat: Infinity, delay: i * 0.9, ease: "easeOut" }}
            />
          ))}
        <svg viewBox="0 0 24 24" aria-hidden>
          <rect x="9" y="3" width="6" height="11" rx="3" fill="currentColor" />
          <path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" />
        </svg>
      </motion.button>
      <div className="mic__meter" aria-hidden>
        {BARS.map((w, i) => (
          <Bar key={i} level={level} weight={w} i={i} />
        ))}
      </div>
      <div className="mic__label">
        <strong>{listening ? "Ouvindo" : "Microfone"}</strong>
        <small>{listening ? "pt-BR · contínuo" : "clique ou tecle M"}</small>
      </div>
    </div>
  );
}
