import { useState } from "react";
import type { SpeakerInfo } from "../../../src/shared/types";

export function initials(name: string) {
  return name
    .split(/\s+/)
    .filter((w) => w.length > 2 || /^[A-ZÀ-Ú]/.test(w))
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join("");
}

/** Foto oficial do candidato (quando houver) ou as iniciais. */
export function Avatar({ speaker, className }: { speaker: Pick<SpeakerInfo, "nome" | "foto">; className: string }) {
  const [falhou, setFalhou] = useState(false);
  return (
    <span className={className}>
      {speaker.foto && !falhou ? (
        <img src={speaker.foto} alt="" loading="lazy" onError={() => setFalhou(true)} />
      ) : (
        initials(speaker.nome)
      )}
    </span>
  );
}
