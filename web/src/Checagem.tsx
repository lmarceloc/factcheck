import { AnimatePresence, motion } from "motion/react";
import { useEffect, useState, type CSSProperties } from "react";
import type { ChecagemPublica } from "../../src/shared/types";
import { AUTO_SPEAKER, VERDICT_LABELS } from "../../src/shared/types";
import { hostname } from "./Assistir";
import { Avatar } from "./components/Avatar";
import { Logo } from "./components/Logo";
import { VerdictBadge } from "./components/VerdictBadge";
import { Loading } from "./Painel";
import { VERDICT_STYLE } from "./theme";
import { formatarTempo } from "./useYouTube";

/**
 * Página de uma checagem: tudo o que o card resume, com calma — explicação,
 * dados, fontes e o vídeo no momento da fala. Link permanente e compartilhável.
 */
export function Checagem({ id }: { id: string }) {
  const [dados, setDados] = useState<ChecagemPublica | null>(null);
  const [erro, setErro] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/public/checagem/${encodeURIComponent(id)}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d: ChecagemPublica) => setDados(d))
      .catch(() => setErro(true));
  }, [id]);

  if (erro) {
    return (
      <div className="loading">
        <Logo big nome="Byte Fact Check" aoVivo={false} />
        <p>Checagem não encontrada.</p>
        <a className="btn" href="/">
          Ir para o debate
        </a>
      </div>
    );
  }
  if (!dados) return <Loading connected />;

  const { claim, debate, youtube, arquivoId } = dados;
  const r = claim.resultado!;
  const v = VERDICT_STYLE[r.veredito];
  const speaker = [...debate.candidatos, ...debate.outros_falantes].find((s) => s.id === claim.speakerId);
  const nome = speaker?.nome ?? (claim.speakerId === AUTO_SPEAKER ? "Não identificado" : claim.speakerId);
  const voltar = arquivoId ? `/arquivo/${arquivoId}` : "/";
  document.title = `${VERDICT_LABELS[r.veredito]}: ${nome} · ${debate.marca.nome}`;

  const compartilhar = async () => {
    const texto = `${VERDICT_LABELS[r.veredito].toUpperCase()} — ${nome}: “${claim.trecho}”. ${r.resumo}`;
    try {
      if (navigator.share) {
        await navigator.share({ title: debate.marca.nome, text: texto, url: location.href });
        return;
      }
      await navigator.clipboard.writeText(`${texto}\n${location.href}`);
      setAviso("Link copiado");
    } catch {
      /* compartilhamento cancelado */
    }
    window.setTimeout(() => setAviso(null), 2500);
  };

  return (
    <div className="assistir checagem" style={{ "--v": v.color, "--glow": v.glow, "--c": speaker?.cor ?? "#94a3b8" } as CSSProperties}>
      <div className="aurora" aria-hidden />
      <header className="assistir__top">
        <a href={voltar} aria-label="Voltar ao debate">
          <Logo nome={debate.marca.nome} aoVivo={false} />
        </a>
        <div className="assistir__titulo">
          <h1>{debate.titulo}</h1>
          <span>{new Date(`${debate.data}T12:00:00`).toLocaleDateString("pt-BR", { dateStyle: "long" })}</span>
        </div>
        <a className="aovivo" href={voltar}>
          ← {arquivoId ? "Ver o debate" : "Voltar ao debate"}
        </a>
      </header>

      <main className="checagem__main">
        <motion.article className="checagem__card" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ type: "spring", stiffness: 200, damping: 24 }}>
          <div className="checagem__quem">
            {speaker && <Avatar speaker={speaker} className="checagem__foto" />}
            <div>
              <strong>{nome}</strong>
              <span>
                {speaker?.partido ? `${speaker.partido} · ` : ""}
                {new Date(claim.createdAt).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
                {claim.videoTime !== undefined ? ` · ${formatarTempo(claim.videoTime)} do vídeo` : ""}
              </span>
            </div>
          </div>

          <VerdictBadge verdict={r.veredito} size="xl" />
          <blockquote className="checagem__fala">“{claim.trecho}”</blockquote>
          <p className="checagem__resumo">{r.resumo}</p>

          {youtube && (
            <div className="checagem__video">
              <iframe
                src={`https://www.youtube-nocookie.com/embed/${youtube}?rel=0&modestbranding=1&playsinline=1${
                  claim.videoTime !== undefined ? `&start=${Math.max(0, Math.floor(claim.videoTime) - 3)}` : ""
                }`}
                title="Momento da fala no debate"
                allow="encrypted-media; picture-in-picture"
                allowFullScreen
              />
            </div>
          )}

          <section className="checagem__secao">
            <h2>Por que {VERDICT_LABELS[r.veredito].toLowerCase()}</h2>
            <p>{r.explicacao}</p>
          </section>

          <section className="checagem__secao">
            <h2>O que dizem os dados</h2>
            <p>{r.dados}</p>
          </section>

          {r.fontes.length > 0 && (
            <section className="checagem__secao">
              <h2>Fontes</h2>
              <ul className="checagem__fontes">
                {r.fontes.map((f) => (
                  <li key={f.url}>
                    <a href={f.url} target="_blank" rel="noopener">
                      <strong>{f.titulo}</strong>
                      <span>{hostname(f.url)} ↗</span>
                    </a>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <footer className="checagem__rodape">
            <small>
              Checagem automática por IA com dados oficiais · confiança {r.confianca}
              {claim.editado ? " · revisada pela redação" : ""}
            </small>
            <div className="checagem__acoes">
              <motion.button className="btn btn--publish" onClick={compartilhar} whileTap={{ scale: 0.95 }}>
                Compartilhar
              </motion.button>
              <a className="btn btn--ghost" href={voltar}>
                {arquivoId ? "Ver o debate completo" : "Voltar ao debate ao vivo"}
              </a>
            </div>
            <AnimatePresence>
              {aviso && (
                <motion.span className="checagem__aviso" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
                  {aviso}
                </motion.span>
              )}
            </AnimatePresence>
          </footer>
        </motion.article>
      </main>

      <footer className="assistir__rodape">
        {debate.marca.url ? (
          <a href={debate.marca.url} target="_blank" rel="noopener">
            {debate.marca.rodape}
          </a>
        ) : (
          <span>{debate.marca.rodape}</span>
        )}
      </footer>
    </div>
  );
}
