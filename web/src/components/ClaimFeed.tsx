import { AnimatePresence, LayoutGroup, motion } from "motion/react";
import { useState } from "react";
import type { Claim, ClaimStatus, SpeakerInfo } from "../../../src/shared/types";
import { spring } from "../theme";
import { AnimatedNumber } from "./AnimatedNumber";
import { ClaimCard } from "./ClaimCard";

const TABS: { id: string; label: string; statuses: ClaimStatus[] }[] = [
  { id: "todas", label: "Todas", statuses: ["na_fila", "verificando", "rascunho", "publicada", "erro"] },
  { id: "checando", label: "Checando", statuses: ["na_fila", "verificando"] },
  { id: "revisar", label: "Revisar", statuses: ["rascunho", "erro"] },
  { id: "no-ar", label: "No ar", statuses: ["publicada"] },
  { id: "descartadas", label: "Descartadas", statuses: ["descartada"] },
];

interface Props {
  claims: Claim[];
  speakers: Map<string, SpeakerInfo>;
}

export function ClaimFeed({ claims, speakers }: Props) {
  const [tab, setTab] = useState("todas");
  const active = TABS.find((t) => t.id === tab)!;
  const visible = claims
    .filter((c) => active.statuses.includes(c.status))
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, 80);

  return (
    <section className="feed">
      <LayoutGroup id="tabs">
        <nav className="tabs" role="tablist">
          {TABS.map((t) => {
            const count = claims.filter((c) => t.statuses.includes(c.status)).length;
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
