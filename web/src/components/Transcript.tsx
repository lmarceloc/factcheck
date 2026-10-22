import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef, type CSSProperties } from "react";
import type { Segment, SpeakerInfo } from "../../../src/shared/types";

interface Props {
  segments: Segment[];
  interim: { speakerId: string; text: string } | null;
  speakers: Map<string, SpeakerInfo>;
}

const hora = (t: number) => new Date(t).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", second: "2-digit" });

/** Transcrição ao vivo; a fala parcial aparece com brilho até ser confirmada. */
export function Transcript({ segments, interim, speakers }: Props) {
  const scroller = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);
  const visible = segments.slice(-120);

  useEffect(() => {
    const el = scroller.current;
    if (el && pinned.current) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [segments.length, interim?.text]);

  return (
    <div
      className="transcript"
      ref={scroller}
      onScroll={(e) => {
        const el = e.currentTarget;
        pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
      }}
    >
      {visible.length === 0 && !interim && (
        <div className="empty">
          <p>A transcrição aparece aqui.</p>
          <small>Ligue o microfone, escolha quem está falando e o sistema separa sozinho o que dá para checar.</small>
        </div>
      )}
      <AnimatePresence initial={false}>
        {visible.map((s) => {
          const sp = speakers.get(s.speakerId);
          return (
            <motion.div
              key={s.id}
              className="line"
              style={{ "--c": sp?.cor ?? "#94a3b8" } as CSSProperties}
              initial={{ opacity: 0, y: 10, filter: "blur(3px)" }}
              animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
              transition={{ duration: 0.35, ease: "easeOut" }}
            >
              <span className="line__who">{sp?.nome ?? s.speakerId}</span>
              <span className="line__time">{hora(s.at)}</span>
              <p>{s.text}</p>
            </motion.div>
          );
        })}
        {interim && (
          <motion.div
            key="interim"
            className="line line--interim"
            style={{ "--c": speakers.get(interim.speakerId)?.cor ?? "#94a3b8" } as CSSProperties}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <span className="line__who">{speakers.get(interim.speakerId)?.nome ?? interim.speakerId}</span>
            <p className="shimmer">{interim.text}</p>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
