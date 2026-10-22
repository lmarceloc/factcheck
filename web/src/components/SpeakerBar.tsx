import { LayoutGroup, motion } from "motion/react";
import type { CSSProperties } from "react";
import { AUTO_SPEAKER, type SpeakerInfo } from "../../../src/shared/types";
import { spring } from "../theme";
import { Avatar } from "./Avatar";

interface Props {
  speakers: SpeakerInfo[];
  current: string | null;
  onSelect: (id: string | null) => void;
  /** Modo transmissão: primeiro botão é "Automático" (tecla 0), e é para ele que se volta ao desmarcar. */
  auto?: boolean;
}

const AUTOMATICO: SpeakerInfo = { id: AUTO_SPEAKER, nome: "Automático", partido: "a IA identifica", cor: "#94a3b8" };

/** Quem está com a palavra. A moldura desliza entre os oradores (atalhos 1, 2, 3…). */
export function SpeakerBar({ speakers, current, onSelect, auto }: Props) {
  const lista = auto ? [AUTOMATICO, ...speakers] : speakers;
  const vazio = auto ? AUTO_SPEAKER : null;
  return (
    <LayoutGroup id="speakers">
      <div className="speaker-bar" role="radiogroup" aria-label="Quem está falando">
        {lista.map((s, idx) => {
          const i = auto ? idx - 1 : idx;
          const active = s.id === current || (auto && s.id === AUTO_SPEAKER && !current);
          return (
            <motion.button
              key={s.id}
              role="radio"
              aria-checked={active}
              className={`speaker ${active ? "speaker--active" : ""}`}
              style={{ "--c": s.cor } as CSSProperties}
              onClick={() => onSelect(active ? vazio : s.id)}
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
              {s.id === AUTO_SPEAKER ? (
                <span className="speaker__avatar">IA</span>
              ) : (
                <Avatar speaker={s} className="speaker__avatar" />
              )}
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

export { initials } from "./Avatar";
