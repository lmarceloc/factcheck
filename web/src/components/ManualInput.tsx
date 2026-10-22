import { motion } from "motion/react";
import { useState } from "react";
import type { SpeakerInfo } from "../../../src/shared/types";
import { api } from "../api";

type Mode = "fala" | "afirmacao";

/**
 * Entrada manual: digitar a fala (passa pela triagem automática, como se viesse
 * do microfone) ou mandar uma afirmação direto para checagem.
 */
export function ManualInput({ speakers, current }: { speakers: SpeakerInfo[]; current: string | null }) {
  const [mode, setMode] = useState<Mode>("fala");
  const [text, setText] = useState("");
  const [who, setWho] = useState<string>("");
  const [err, setErr] = useState<string | null>(null);
  const speakerId = who || current || "";

  const submit = async () => {
    const value = text.trim();
    if (!value) return;
    if (!speakerId) return setErr("Escolha quem disse.");
    setErr(null);
    try {
      if (mode === "fala") {
        await api.transcript(value, true, speakerId);
        await api.flush();
      } else {
        await api.manualClaim(speakerId, value);
      }
      setText("");
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  return (
    <div className="manual">
      <div className="manual__modes">
        {(["fala", "afirmacao"] as Mode[]).map((m) => (
          <button key={m} className={m === mode ? "on" : ""} onClick={() => setMode(m)}>
            {m === mode && <motion.span layoutId="manual-mode" className="manual__mode-bg" />}
            <span>{m === "fala" ? "Digitar fala" : "Checar afirmação"}</span>
          </button>
        ))}
        <select value={who} onChange={(e) => setWho(e.target.value)} aria-label="Quem disse">
          <option value="">{current ? "Quem está falando" : "Quem disse?"}</option>
          {speakers.map((s) => (
            <option key={s.id} value={s.id}>
              {s.nome}
            </option>
          ))}
        </select>
      </div>
      <div className="manual__row">
        <textarea
          rows={2}
          value={text}
          placeholder={
            mode === "fala"
              ? "Cole ou digite o que foi dito — a triagem separa o que é checável…"
              : "Ex.: O desemprego caiu para 6% no último trimestre."
          }
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) submit();
          }}
        />
        <motion.button className="btn btn--publish" onClick={submit} whileTap={{ scale: 0.94 }}>
          Enviar
        </motion.button>
      </div>
      {err && <p className="claim__error">{err}</p>}
    </div>
  );
}
