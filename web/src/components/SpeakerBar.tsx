import { LayoutGroup, motion } from "motion/react";
import type { CSSProperties } from "react";
import type { SpeakerInfo } from "../../../src/shared/types";
import { spring } from "../theme";

interface Props {
  speakers: SpeakerInfo[];
  current: string | null;
  onSelect: (id: string | null) => void;
}

/** Quem está com a palavra. A moldura desliza entre os oradores (atalhos 1, 2, 3…). */
export function SpeakerBar({ speakers, current, onSelect }: Props) {
  return (
    <LayoutGroup id="speakers">
      <div className="speaker-bar" role="radiogroup" aria-label="Quem está falando">
        {speakers.map((s, i) => {
          const active = s.id === current;
          return (
            <motion.button
              key={s.id}
              role="radio"
              aria-checked={active}
              className={`speaker ${active ? "speaker--active" : ""}`}
              style={{ "--c": s.cor } as CSSProperties}
              onClick={() => onSelect(active ? null : s.id)}
              whileHover={{ y: -2 }}
              whileTap={{ scale: 0.97 }}
            >
              {active && (
                <motion.span layoutId="speaker-ring" className="speaker__ring" transition={spring}>
                  <motion.span
                    className="speaker__pulse"
                    animate={{ opacity: [0.55, 0, 0.55], scale: [1, 1.06, 1] }}
                    transition={{ duration: 1.8, repeat: Infinity, ease: "easeInOut" }}
                  />
                </motion.span>
              )}
              <span className="speaker__avatar">{initials(s.nome)}</span>
              <span className="speaker__text">
                <strong>{s.nome}</strong>
                <small>{s.partido ?? (active ? "com a palavra" : " ")}</small>
              </span>
              <kbd>{i + 1}</kbd>
            </motion.button>
          );
        })}
      </div>
    </LayoutGroup>
  );
}

export function initials(name: string) {
  return name
    .split(/\s+/)
    .filter((w) => w.length > 2 || /^[A-ZÀ-Ú]/.test(w))
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join("");
}
