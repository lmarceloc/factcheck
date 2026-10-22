import { AnimatePresence, motion, useTransform, type MotionValue } from "motion/react";
import { useState } from "react";

/** Aceita links de vídeo, live, shorts, youtu.be e embed; devolve o id do vídeo. */
export function youtubeId(url: string): string | null {
  const s = url.trim();
  if (/^[\w-]{11}$/.test(s)) return s;
  try {
    const u = new URL(s);
    if (u.hostname === "youtu.be") return u.pathname.slice(1, 12) || null;
    if (!/(^|\.)youtube(-nocookie)?\.com$/.test(u.hostname)) return null;
    const v = u.searchParams.get("v");
    if (v) return v;
    const m = u.pathname.match(/^\/(?:live|embed|shorts)\/([\w-]{11})/);
    return m ? m[1] : null;
  } catch {
    return null;
  }
}

interface Props {
  /** Vídeo atual da transmissão (definido no servidor e mostrado a todos). */
  youtube: string | null;
  onLoad: (videoId: string) => Promise<unknown>;
  available: boolean;
  listening: boolean;
  level: MotionValue<number>;
  onStart: () => void;
  onStop: () => void;
}

/**
 * Modo transmissão: o player do YouTube fica na própria página; ao começar, o
 * Chrome compartilha o áudio desta aba com o AssemblyAI e as checagens vão saindo.
 */
export function Transmissao({ youtube, onLoad, available, listening, level, onStart, onStop }: Props) {
  const [url, setUrl] = useState(() => (youtube ? `https://www.youtube.com/watch?v=${youtube}` : ""));
  const loaded = youtube;
  const [erro, setErro] = useState<string | null>(null);
  const width = useTransform(level, (v) => `${Math.round(8 + v * 92)}%`);

  const carregar = () => {
    const id = youtubeId(url);
    if (!id) return setErro("Link do YouTube não reconhecido.");
    setErro(null);
    onLoad(id).catch((e) => setErro((e as Error).message));
  };

  return (
    <div className="tx">
      <form
        className="tx__form"
        onSubmit={(e) => {
          e.preventDefault();
          carregar();
        }}
      >
        <input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="Link da transmissão no YouTube: vai para a tela de todos os espectadores"
          aria-label="Link do YouTube"
          disabled={listening}
        />
        <button className="btn" disabled={listening}>
          {loaded ? "Trocar" : "Carregar"}
        </button>
      </form>
      {erro && <p className="claim__error">{erro}</p>}

      <div className="tx__player">
        <AnimatePresence mode="wait">
          {loaded ? (
            <motion.iframe
              key={loaded}
              initial={{ opacity: 0, scale: 0.98 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0 }}
              src={`https://www.youtube-nocookie.com/embed/${loaded}?autoplay=1&rel=0&modestbranding=1`}
              title="Transmissão do debate"
              allow="autoplay; encrypted-media; picture-in-picture"
              allowFullScreen
            />
          ) : (
            <motion.div key="vazio" className="tx__empty" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
              <svg viewBox="0 0 24 24" aria-hidden>
                <rect x="2" y="5" width="20" height="14" rx="4" fill="currentColor" opacity=".25" />
                <path d="M10 9.5v5l4.5-2.5z" fill="currentColor" />
              </svg>
              <span>O player aparece aqui</span>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <div className="tx__controls">
        {listening ? (
          <motion.button className="btn tx__stop" onClick={onStop} whileTap={{ scale: 0.96 }}>
            <motion.i animate={{ opacity: [1, 0.3, 1] }} transition={{ duration: 1.2, repeat: Infinity }} />
            Checando ao vivo · parar
          </motion.button>
        ) : (
          <motion.button
            className="btn btn--publish tx__start"
            onClick={onStart}
            disabled={!available || !loaded}
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.96 }}
          >
            ▶ Começar checagem
          </motion.button>
        )}
        <div className="tx__meter" aria-hidden>
          <motion.span style={{ width: listening ? width : "0%" }} />
        </div>
      </div>
      <p className="tx__hint">
        {!available
          ? "O modo transmissão usa o AssemblyAI: configure ASSEMBLYAI_API_KEY no servidor."
          : listening
            ? "Ouvindo o áudio desta aba. Deixe o volume do player ligado (pode baixar o som do computador)."
            : "Ao começar, o Chrome pergunta o que compartilhar: escolha Esta aba e deixe “Compartilhar áudio da aba” marcado. Quem fala é identificado automaticamente."}
      </p>
    </div>
  );
}
