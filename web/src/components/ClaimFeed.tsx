import { AnimatePresence, LayoutGroup, motion } from "motion/react";
import { useState } from "react";
import type { Claim, SpeakerInfo } from "../../../src/shared/types";
import { spring } from "../theme";
import { AnimatedNumber } from "./AnimatedNumber";
import { ClaimCard } from "./ClaimCard";

const isQ = (c: Claim) => c.tipo === "pergunta";
const TABS: { id: string; label: string; match: (c: Claim) => boolean }[] = [
  { id: "todas", label: "Todas", match: (c) => c.status !== "descartada" },
  { id: "checando", label: "Checando", match: (c) => !isQ(c) && (c.status === "na_fila" || c.status === "verificando") },
  { id: "revisar", label: "Revisar", match: (c) => !isQ(c) && (c.status === "rascunho" || c.status === "erro") },
  { id: "perguntas", label: "Perguntas", match: (c) => isQ(c) && c.status !== "descartada" },
  { id: "no-ar", label: "No ar", match: (c) => c.status === "publicada" },
  { id: "descartadas", label: "Descartadas", match: (c) => c.status === "descartada" },
];

interface Props {
  claims: Claim[];
  speakers: Map<string, SpeakerInfo>;
  /** Oradores reais, para identificar quem disse quando a transmissão não soube. */
  candidates: SpeakerInfo[];
}

export function ClaimFeed({ claims, speakers, candidates }: Props) {
  const [tab, setTab] = useState("todas");
  const active = TABS.find((t) => t.id === tab)!;
  const visible = claims
    .filter(active.match)
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, 80);

  return (
    <section className="feed">
      <LayoutGroup id="tabs">
        <nav className="tabs" role="tablist">
          {TABS.map((t) => {
            const count = claims.filter(t.match).length;
            return (
              <button key={t.id} role="tab" aria-selected={t.id === tab} className="tab" onClick={() => setTab(t.id)}>
                {t.id === tab && <motion.span layoutId="tab-bg" className="tab__bg" transition={spring} />}
                <span className="tab__label">{t.label}</span>
                <AnimatedNumber value={count} className="tab__count" />
              </button>
            );
          })}
        </nav>
      </LayoutGroup>

      <div className="feed__list">
        <AnimatePresence mode="popLayout" initial={false}>
          {visible.map((c) => (
            <ClaimCard
              key={c.id}
              claim={c}
              speaker={speakers.get(c.speakerId)}
              target={c.alvo ? speakers.get(c.alvo) : undefined}
              candidates={candidates}
            />
          ))}
        </AnimatePresence>
        {visible.length === 0 && (
          <motion.div className="empty" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
            <p>Nada por aqui ainda.</p>
            <small>As afirmações checáveis aparecem assim que forem ditas.</small>
          </motion.div>
        )}
      </div>
    </section>
  );
}
