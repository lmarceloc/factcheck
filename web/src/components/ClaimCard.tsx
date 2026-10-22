import { AnimatePresence, motion } from "motion/react";
import { forwardRef, useState, type CSSProperties } from "react";
import type { Claim, SpeakerInfo, Verdict } from "../../../src/shared/types";
import { AUTO_SPEAKER, CATEGORY_LABELS, VERDICTS, VERDICT_LABELS } from "../../../src/shared/types";
import { api } from "../api";
import { STATUS_LABEL, VERDICT_STYLE, softSpring } from "../theme";
import { VerdictBadge } from "./VerdictBadge";

interface Props {
  claim: Claim;
  speaker?: SpeakerInfo;
  target?: SpeakerInfo;
  candidates?: SpeakerInfo[];
}

const fmtSeconds = (ms: number) => `${(ms / 1000).toFixed(0)}s`;

function hostname(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

/** Cartão de uma afirmação: da fila até o veredito, com as buscas aparecendo ao vivo. */
export const ClaimCard = forwardRef<HTMLElement, Props>(function ClaimCard({ claim, speaker, target, candidates = [] }, ref) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const r = claim.resultado;
  const isQ = claim.tipo === "pergunta";
  const ctx = claim.contexto;
  const color = r ? VERDICT_STYLE[r.veredito].color : "rgba(148,163,184,.5)";

  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setErr(null);
    try {
      await fn();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <motion.article
      ref={ref}
      layout
      className={`claim claim--${claim.status}${isQ ? " claim--pergunta-card" : ""}`}
      style={{ "--c": speaker?.cor ?? "#94a3b8", "--v": color } as CSSProperties}
      initial={{ opacity: 0, y: -24, scale: 0.96 }}
      animate={{ opacity: claim.status === "descartada" ? 0.45 : 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, x: 60, scale: 0.95, transition: { duration: 0.25 } }}
      transition={softSpring}
    >
      <motion.div layout="position" className="claim__head">
        <span className="claim__who">
          <span className="dot" />
          {claim.speakerId === AUTO_SPEAKER ? (
            <select
              className="claim__who-pick"
              value=""
              aria-label="Quem disse"
              onChange={(e) => e.target.value && act(() => api.edit(claim.id, { speakerId: e.target.value }))}
            >
              <option value="">Quem disse? (não identificado)</option>
              {candidates.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.nome}
                </option>
              ))}
            </select>
          ) : (
            (speaker?.nome ?? claim.speakerId)
          )}
          {target && <span className="claim__target">{isQ ? "pergunta para" : "sobre"} {target.nome}</span>}
        </span>
        <span className="claim__meta">
          {isQ ? (
            <span className="chip chip--pergunta">Pergunta</span>
          ) : (
            <span className={`chip chip--${claim.prioridade}`}>{CATEGORY_LABELS[claim.categoria]}</span>
          )}
          <StatusPill claim={claim} />
        </span>
      </motion.div>

      <motion.blockquote layout="position" className="claim__quote">
        “{claim.trecho}”
      </motion.blockquote>
      {claim.afirmacao !== claim.trecho && (
        <motion.p layout="position" className="claim__normalized">
          {claim.afirmacao}
        </motion.p>
      )}

      <AnimatePresence mode="popLayout" initial={false}>
        {(claim.status === "verificando" || claim.status === "na_fila") && (
          <motion.div
            key="progress"
            className="claim__progress"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
          >
            <div className="scanner" data-active={claim.status === "verificando"} />
            <ul>
              <AnimatePresence initial={false}>
                {claim.progresso.map((q, i) => (
                  <motion.li
                    key={`${i}-${q}`}
                    initial={{ opacity: 0, x: -12 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ ...softSpring, delay: 0.04 * i }}
                  >
                    <svg viewBox="0 0 24 24" aria-hidden>
                      <circle cx="11" cy="11" r="6" stroke="currentColor" strokeWidth="2.2" fill="none" />
                      <path d="M16 16l4 4" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
                    </svg>
                    {q}
                  </motion.li>
                ))}
              </AnimatePresence>
              {claim.status === "na_fila" && <li className="muted">aguardando na fila…</li>}
              {claim.status === "verificando" && claim.progresso.length === 0 && (
                <li className="muted">analisando a afirmação…</li>
              )}
            </ul>
          </motion.div>
        )}

        {isQ && ctx && (
          <motion.div
            key="context"
            className="claim__context"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={softSpring}
          >
            <span className="claim__context-label">Contexto para acompanhar a resposta</span>
            <p className="claim__summary">{ctx.resumo}</p>
            <p className="claim__context-data">{ctx.dados}</p>
            {ctx.pontos.length > 0 && (
              <ul className="claim__points">
                {ctx.pontos.map((pt, i) => (
                  <motion.li key={i} initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.05 * i }}>
                    {pt}
                  </motion.li>
                ))}
              </ul>
            )}
            {ctx.fontes.length > 0 && (
              <ul className="sources">
                {ctx.fontes.map((f) => (
                  <li key={f.url} className={f.confirmada ? "" : "unconfirmed"}>
                    <a href={f.url} target="_blank" rel="noreferrer">
                      {f.titulo}
                    </a>
                    <span>{hostname(f.url)}</span>
                    {!f.confirmada && <em title="Esta URL não apareceu nos resultados da busca">não confirmada</em>}
                  </li>
                ))}
              </ul>
            )}
          </motion.div>
        )}

        {r && !editing && (
          <motion.div
            key="result"
            className="claim__result"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={softSpring}
          >
            <div className="claim__verdict-row">
              <VerdictBadge verdict={r.veredito} />
              <span className="claim__confidence">
                confiança {r.confianca}
                {claim.repeteDe ? " · repetida" : ` · ${fmtSeconds(r.duracaoMs)}`}
                {claim.editado && " · editada"}
              </span>
            </div>
            <p className="claim__summary">{r.resumo}</p>
            <button className="link" onClick={() => setOpen((o) => !o)}>
              {open ? "Menos detalhes" : "Ver explicação e fontes"}
            </button>
            <AnimatePresence initial={false}>
              {open && (
                <motion.div
                  className="claim__details"
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  exit={{ opacity: 0, height: 0 }}
                >
                  <p>{r.explicacao}</p>
                  <p>
                    <strong>O que dizem os dados: </strong>
                    {r.dados}
                  </p>
                  {r.nota_editor && <p className="note">⚑ {r.nota_editor}</p>}
                  <ul className="sources">
                    {r.fontes.map((f) => (
                      <li key={f.url} className={f.confirmada ? "" : "unconfirmed"}>
                        <a href={f.url} target="_blank" rel="noreferrer">
                          {f.titulo}
                        </a>
                        <span>{hostname(f.url)}</span>
                        {!f.confirmada && <em title="Esta URL não apareceu nos resultados da busca">não confirmada</em>}
                      </li>
                    ))}
                  </ul>
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>
        )}

        {r && editing && <EditForm key="edit" claim={claim} onDone={() => setEditing(false)} />}
      </AnimatePresence>

      {claim.status === "erro" && <p className="claim__error">{claim.erro}</p>}
      {err && <p className="claim__error">{err}</p>}

      <motion.div layout="position" className="claim__actions">
        {claim.status === "rascunho" && !isQ && (
          <motion.button
            className="btn btn--publish"
            disabled={busy}
            onClick={() => act(() => api.publish(claim.id))}
            whileTap={{ scale: 0.95 }}
          >
            Publicar no telão
          </motion.button>
        )}
        {claim.status === "publicada" && (
          <button className="btn" disabled={busy} onClick={() => act(() => api.unpublish(claim.id))}>
            Tirar do ar
          </button>
        )}
        {r && !editing && (
          <button className="btn btn--ghost" onClick={() => setEditing(true)}>
            Editar
          </button>
        )}
        {(claim.status === "erro" || claim.status === "rascunho" || claim.status === "descartada") && (
          <button className="btn btn--ghost" disabled={busy} onClick={() => act(() => api.recheck(claim.id))}>
            {isQ ? "Pesquisar de novo" : "Checar de novo"}
          </button>
        )}
        {claim.status !== "descartada" && (
          <button className="btn btn--ghost btn--danger" disabled={busy} onClick={() => act(() => api.discard(claim.id))}>
            Descartar
          </button>
        )}
      </motion.div>
    </motion.article>
  );
});

function StatusPill({ claim }: { claim: Claim }) {
  const label =
    claim.tipo === "pergunta" && claim.status === "rascunho"
      ? "Contexto pronto"
      : claim.tipo === "pergunta" && claim.status === "verificando"
        ? "Pesquisando"
        : STATUS_LABEL[claim.status];
  return (
    <motion.span key={claim.status} className={`status status--${claim.status}`} initial={{ scale: 0.7, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}>
      {claim.status === "verificando" && (
        <motion.i animate={{ rotate: 360 }} transition={{ duration: 1, repeat: Infinity, ease: "linear" }} />
      )}
      {claim.status === "publicada" && (
        <motion.i className="live" animate={{ opacity: [1, 0.3, 1] }} transition={{ duration: 1.4, repeat: Infinity }} />
      )}
      {label}
    </motion.span>
  );
}

function EditForm({ claim, onDone }: { claim: Claim; onDone: () => void }) {
  const r = claim.resultado!;
  const [veredito, setVeredito] = useState<Verdict>(r.veredito);
  const [resumo, setResumo] = useState(r.resumo);
  const [explicacao, setExplicacao] = useState(r.explicacao);
  const [saving, setSaving] = useState(false);

  return (
    <motion.form
      className="claim__edit"
      initial={{ opacity: 0, height: 0 }}
      animate={{ opacity: 1, height: "auto" }}
      exit={{ opacity: 0, height: 0 }}
      onSubmit={async (e) => {
        e.preventDefault();
        setSaving(true);
        try {
          await api.edit(claim.id, { veredito, resumo, explicacao });
          onDone();
        } finally {
          setSaving(false);
        }
      }}
    >
      <div className="verdict-picker">
        {VERDICTS.map((v) => (
          <button
            type="button"
            key={v}
            className={v === veredito ? "on" : ""}
            style={{ "--v": VERDICT_STYLE[v].color } as CSSProperties}
            onClick={() => setVeredito(v)}
          >
            {v === veredito && <motion.span layoutId={`pick-${claim.id}`} className="verdict-picker__bg" />}
            <span>{VERDICT_LABELS[v]}</span>
          </button>
        ))}
      </div>
      <label>
        Resumo para o telão
        <textarea value={resumo} rows={2} onChange={(e) => setResumo(e.target.value)} />
      </label>
      <label>
        Explicação
        <textarea value={explicacao} rows={3} onChange={(e) => setExplicacao(e.target.value)} />
      </label>
      <div className="claim__actions">
        <button className="btn btn--publish" disabled={saving}>
          Salvar
        </button>
        <button type="button" className="btn btn--ghost" onClick={onDone}>
          Cancelar
        </button>
      </div>
    </motion.form>
  );
}
