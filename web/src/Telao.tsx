import { AnimatePresence, LayoutGroup, motion } from "motion/react";
import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import type { Claim, SpeakerInfo } from "../../src/shared/types";
import { VERDICT_LABELS } from "../../src/shared/types";
import { Logo } from "./components/Logo";
import { Scoreboard } from "./components/Scoreboard";
import { VerdictBadge } from "./components/VerdictBadge";
import { Loading } from "./Painel";
import { VERDICT_STYLE } from "./theme";
import { useDebate } from "./useDebate";

/**
 * Telão para a transmissão. Parâmetros da URL:
 *   ?modo=tarja (padrão, tarja inferior uma a uma) | mural (todas, em grade)
 *   ?fundo=escuro (padrão) | transparente (OBS/vMix) | verde (chroma key)
 *   ?tempo=14  segundos que cada checagem fica no ar no modo tarja
 */
export function Telao() {
  const params = new URLSearchParams(location.search);
  const modo = params.get("modo") === "mural" ? "mural" : "tarja";
  const fundo = params.get("fundo") ?? "escuro";
  const tempo = Math.max(4, Number(params.get("tempo")) || 14);

  const { data, claims, connected } = useDebate("public");
  const speakers = useMemo(
    () =>
      new Map(
        (data ? [...data.debate.candidatos, ...data.debate.outros_falantes, { id: "auto", nome: "Não identificado", cor: "#94a3b8" }] : []).map(
          (s) => [s.id, s],
        ),
      ),
    [data?.debate],
  );
  const published = useMemo(
    () => [...claims.values()].filter((c) => c.status === "publicada" && c.resultado),
    [claims],
  );

  useEffect(() => {
    document.body.dataset.fundo = fundo;
  }, [fundo]);

  if (!data) return fundo === "escuro" ? <Loading connected={connected} /> : null;

  return (
    <div className={`telao telao--${modo}`}>
      {data.settings.demo && <div className="demo-watermark">Simulação · não é checagem real</div>}
      {modo === "mural" ? (
        <Mural claims={published} speakers={speakers} candidates={data.debate.candidatos} title={data.debate.titulo} />
      ) : (
        <Tarja claims={published} speakers={speakers} seconds={tempo} candidates={data.debate.candidatos} />
      )}
    </div>
  );
}

/** Fila de exibição: cada checagem nova entra, fica `seconds` no ar e dá lugar à próxima. */
function Tarja({
  claims,
  speakers,
  seconds,
  candidates,
}: {
  claims: Claim[];
  speakers: Map<string, SpeakerInfo>;
  seconds: number;
  candidates: SpeakerInfo[];
}) {
  const seen = useRef<Set<string> | null>(null);
  const [queue, setQueue] = useState<Claim[]>([]);
  const [showing, setShowing] = useState<Claim | null>(null);

  // O que já estava publicado ao abrir o telão não é reprisado.
  useEffect(() => {
    if (!seen.current) {
      seen.current = new Set(claims.map((c) => c.id));
      return;
    }
    const fresh = claims
      .filter((c) => !seen.current!.has(c.id))
      .sort((a, b) => (a.publishedAt ?? 0) - (b.publishedAt ?? 0));
    if (fresh.length) {
      fresh.forEach((c) => seen.current!.add(c.id));
      setQueue((q) => [...q, ...fresh]);
    }
    // Se o editor tirar do ar, sai da tela na hora.
    const ids = new Set(claims.map((c) => c.id));
    setShowing((s) => (s && !ids.has(s.id) ? null : s));
    setQueue((q) => q.filter((c) => ids.has(c.id)));
  }, [claims]);

  useEffect(() => {
    if (showing || queue.length === 0) return;
    setShowing(queue[0]);
    setQueue((q) => q.slice(1));
  }, [showing, queue]);

  useEffect(() => {
    if (!showing) return;
    const t = window.setTimeout(() => setShowing(null), seconds * 1000);
    return () => window.clearTimeout(t);
  }, [showing, seconds]);

  const live = showing ? claims.find((c) => c.id === showing.id) ?? showing : null;

  return (
    <>
      <motion.div className="bug" initial={{ opacity: 0, x: 30 }} animate={{ opacity: live ? 0 : 1, x: live ? 30 : 0 }}>
        <Logo />
        <Scoreboard candidates={candidates} claims={claims} onlyPublished compact />
      </motion.div>
      <AnimatePresence mode="wait">
        {live && <LowerThird key={live.id} claim={live} speaker={speakers.get(live.speakerId)} seconds={seconds} pending={queue.length} />}
      </AnimatePresence>
    </>
  );
}

function LowerThird({ claim, speaker, seconds, pending }: { claim: Claim; speaker?: SpeakerInfo; seconds: number; pending: number }) {
  const r = claim.resultado!;
  const v = VERDICT_STYLE[r.veredito];
  const host = r.fontes.find((f) => f.confirmada) ?? r.fontes[0];

  return (
    <motion.section
      className="lower"
      style={{ "--v": v.color, "--glow": v.glow, "--c": speaker?.cor ?? "#94a3b8" } as CSSProperties}
      initial={{ y: 160, opacity: 0, filter: "blur(10px)" }}
      animate={{ y: 0, opacity: 1, filter: "blur(0px)" }}
      exit={{ y: 120, opacity: 0, filter: "blur(8px)", transition: { duration: 0.45, ease: "easeIn" } }}
      transition={{ type: "spring", stiffness: 160, damping: 22 }}
    >
      <motion.div
        className="lower__flash"
        initial={{ opacity: 0.9, scaleX: 0 }}
        animate={{ opacity: 0, scaleX: 1 }}
        transition={{ duration: 0.9, ease: "easeOut" }}
      />
      <div className="lower__verdict">
        <motion.span className="lower__kicker" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.3 }}>
          Checagem
        </motion.span>
        <VerdictBadge verdict={r.veredito} size="xl" />
      </div>
      <div className="lower__body">
        <motion.div className="lower__who" initial={{ x: -20, opacity: 0 }} animate={{ x: 0, opacity: 1 }} transition={{ delay: 0.2 }}>
          <span className="lower__bar" />
          <strong>{speaker?.nome ?? claim.speakerId}</strong>
          {speaker?.partido && <span>{speaker.partido}</span>}
        </motion.div>
        <motion.blockquote initial={{ y: 12, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ delay: 0.35 }}>
          “{claim.trecho}”
        </motion.blockquote>
        <motion.p
          className="lower__summary"
          initial={{ y: 12, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ delay: 0.55 }}
        >
          {r.resumo}
        </motion.p>
        {host && (
          <motion.span className="lower__source" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.8 }}>
            Fonte: {host.titulo}
          </motion.span>
        )}
      </div>
      <motion.div
        className="lower__timer"
        initial={{ scaleX: 1 }}
        animate={{ scaleX: 0 }}
        transition={{ duration: seconds, ease: "linear" }}
      />
      {pending > 0 && <span className="lower__pending">+{pending} na fila</span>}
    </motion.section>
  );
}

function Mural({
  claims,
  speakers,
  candidates,
  title,
}: {
  claims: Claim[];
  speakers: Map<string, SpeakerInfo>;
  candidates: SpeakerInfo[];
  title: string;
}) {
  const sorted = [...claims].sort((a, b) => (b.publishedAt ?? b.createdAt) - (a.publishedAt ?? a.createdAt));
  return (
    <div className="mural">
      <div className="aurora" aria-hidden />
      <header className="mural__head">
        <Logo />
        <h1>{title}</h1>
      </header>
      <Scoreboard candidates={candidates} claims={claims} onlyPublished />
      <LayoutGroup>
        <div className="mural__grid">
          <AnimatePresence mode="popLayout">
            {sorted.map((c, i) => {
              const sp = speakers.get(c.speakerId);
              const r = c.resultado!;
              return (
                <motion.article
                  key={c.id}
                  layout
                  className="mural__card"
                  style={{ "--v": VERDICT_STYLE[r.veredito].color, "--c": sp?.cor ?? "#94a3b8" } as CSSProperties}
                  initial={{ opacity: 0, scale: 0.85, y: 30 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.9 }}
                  transition={{ type: "spring", stiffness: 260, damping: 24, delay: Math.min(i, 8) * 0.03 }}
                >
                  <VerdictBadge verdict={r.veredito} />
                  <span className="mural__who">{sp?.nome ?? c.speakerId}</span>
                  <blockquote>“{c.trecho}”</blockquote>
                  <p>{r.resumo}</p>
                  <footer>
                    {r.fontes.slice(0, 2).map((f) => (
                      <a key={f.url} href={f.url} target="_blank" rel="noreferrer">
                        {f.titulo}
                      </a>
                    ))}
                  </footer>
                  <span className="sr-only">{VERDICT_LABELS[r.veredito]}</span>
                </motion.article>
              );
            })}
          </AnimatePresence>
        </div>
      </LayoutGroup>
      {sorted.length === 0 && <p className="mural__empty">As checagens publicadas aparecem aqui.</p>}
    </div>
  );
}
