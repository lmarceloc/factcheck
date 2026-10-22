import { AnimatePresence, motion } from "motion/react";
import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import type { Claim, SpeakerInfo } from "../../src/shared/types";
import { AUTO_SPEAKER } from "../../src/shared/types";
import { Avatar } from "./components/Avatar";
import { Contador } from "./components/Contador";
import { Logo } from "./components/Logo";
import { VerdictBadge } from "./components/VerdictBadge";
import { Loading } from "./Painel";
import { VERDICT_STYLE, softSpring } from "./theme";
import { usePublicState } from "./usePublicState";

const tempo = (t: number) => {
  const s = Math.round((Date.now() - t) / 1000);
  if (s < 60) return "agora";
  if (s < 3600) return `há ${Math.floor(s / 60)} min`;
  return new Date(t).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
};

function hostname(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

/**
 * Tela do público: o vídeo do debate, o placar de verdades e mentiras de cada
 * candidato e as checagens chegando sozinhas, sem precisar fazer nada.
 */
export function Assistir() {
  const { data, online } = usePublicState();
  const [, forceTick] = useState(0);
  useEffect(() => {
    const t = window.setInterval(() => forceTick((n) => n + 1), 30000);
    return () => window.clearInterval(t);
  }, []);

  const speakers = useMemo(
    () =>
      new Map<string, SpeakerInfo>(
        (data ? [...data.debate.candidatos, ...data.debate.outros_falantes] : []).map((s) => [s.id, s]),
      ),
    [data?.debate],
  );
  const checagens = useMemo(
    () =>
      (data?.claims ?? [])
        .filter((c) => c.status === "publicada" && c.resultado)
        .sort((a, b) => (b.publishedAt ?? b.createdAt) - (a.publishedAt ?? a.createdAt)),
    [data?.claims],
  );

  // Destaca por alguns segundos as checagens que chegam com a página aberta.
  const vistas = useRef<Set<string> | null>(null);
  const novas = useMemo(() => {
    if (!data) return new Set<string>();
    if (!vistas.current) {
      vistas.current = new Set(checagens.map((c) => c.id));
      return new Set<string>();
    }
    const n = new Set(checagens.filter((c) => !vistas.current!.has(c.id)).map((c) => c.id));
    n.forEach((id) => vistas.current!.add(id));
    return n;
  }, [checagens, data]);

  if (!data) return <Loading connected={online} />;
  const { settings, debate } = data;

  return (
    <div className="assistir">
      <div className="aurora" aria-hidden />
      {settings.demo && <div className="demo-watermark">Simulação · não é checagem real</div>}

      <header className="assistir__top">
        <Logo />
        <div className="assistir__titulo">
          <h1>{debate.titulo}</h1>
          <span>
            {debate.emissora ? `${debate.emissora} · ` : ""}
            {new Date(`${debate.data}T12:00:00`).toLocaleDateString("pt-BR", { dateStyle: "long" })}
          </span>
        </div>
        <AoVivo ativo={settings.captura} online={online} />
      </header>

      <main className="assistir__grid">
        <div className="assistir__esquerda">
          <div className="assistir__player">
            {settings.youtube ? (
              <iframe
                src={`https://www.youtube-nocookie.com/embed/${settings.youtube}?autoplay=1&rel=0&modestbranding=1`}
                title="Transmissão do debate"
                allow="autoplay; encrypted-media; picture-in-picture"
                allowFullScreen
              />
            ) : (
              <div className="assistir__espera">
                <motion.span animate={{ opacity: [0.4, 1, 0.4] }} transition={{ duration: 2, repeat: Infinity }}>
                  A transmissão aparece aqui quando o debate começar.
                </motion.span>
              </div>
            )}
          </div>
          <h2 className="assistir__secao">Placar da verdade</h2>
          <Contador candidates={debate.candidatos} claims={data.claims} />
        </div>

        <section className="assistir__feed" aria-live="polite">
          <h2 className="assistir__secao">
            Checagens <span>{checagens.length}</span>
          </h2>
          <div className="assistir__lista">
            <AnimatePresence initial={false} mode="popLayout">
              {checagens.map((c) => (
                <CartaoPublico key={c.id} claim={c} speaker={speakers.get(c.speakerId)} nova={novas.has(c.id)} quando={tempo(c.publishedAt ?? c.createdAt)} />
              ))}
            </AnimatePresence>
            {checagens.length === 0 && (
              <motion.div className="empty" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
                <p>{settings.captura ? "Ouvindo o debate…" : "Nenhuma checagem ainda."}</p>
                <small>As falas checadas aparecem aqui sozinhas, com o veredito e as fontes.</small>
              </motion.div>
            )}
          </div>
          <p className="assistir__nota">
            Checagens automáticas feitas por IA com dados oficiais (IBGE, Banco Central, TSE, Câmara, Senado e outros). Casos
            incertos ou exagerados passam pela revisão da redação antes de aparecer.
          </p>
        </section>
      </main>
    </div>
  );
}

function AoVivo({ ativo, online }: { ativo: boolean; online: boolean }) {
  return (
    <div className={`aovivo ${ativo ? "aovivo--on" : ""}`}>
      <motion.i animate={ativo ? { scale: [1, 1.5, 1], opacity: [1, 0.4, 1] } : {}} transition={{ duration: 1.4, repeat: Infinity }} />
      {!online ? "Reconectando…" : ativo ? "Checando ao vivo" : "Aguardando a transmissão"}
    </div>
  );
}

function CartaoPublico({ claim, speaker, nova, quando }: { claim: Claim; speaker?: SpeakerInfo; nova: boolean; quando: string }) {
  const [aberto, setAberto] = useState(false);
  const r = claim.resultado!;
  const v = VERDICT_STYLE[r.veredito];
  const nome = speaker?.nome ?? (claim.speakerId === AUTO_SPEAKER ? "Não identificado" : claim.speakerId);

  return (
    <motion.article
      layout
      className={`pub ${nova ? "pub--nova" : ""}`}
      style={{ "--v": v.color, "--glow": v.glow, "--c": speaker?.cor ?? "#94a3b8" } as CSSProperties}
      initial={{ opacity: 0, y: -30, scale: 0.94 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, scale: 0.95 }}
      transition={softSpring}
    >
      <header className="pub__head">
        {speaker && <Avatar speaker={speaker} className="pub__foto" />}
        <strong>{nome}</strong>
        <span className="pub__quando">{quando}</span>
      </header>
      <VerdictBadge verdict={r.veredito} />
      <blockquote className="pub__fala">“{claim.trecho}”</blockquote>
      <p className="pub__resumo">{r.resumo}</p>
      <button className="link" onClick={() => setAberto((a) => !a)}>
        {aberto ? "Fechar" : "Por quê? Ver dados e fontes"}
      </button>
      <AnimatePresence initial={false}>
        {aberto && (
          <motion.div className="pub__detalhe" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }}>
            <p>{r.explicacao}</p>
            <p>
              <strong>O que dizem os dados: </strong>
              {r.dados}
            </p>
            <ul className="sources">
              {r.fontes.map((f) => (
                <li key={f.url}>
                  <a href={f.url} target="_blank" rel="noreferrer">
                    {f.titulo}
                  </a>
                  <span>{hostname(f.url)}</span>
                </li>
              ))}
            </ul>
            <small className="pub__ia">
              Checagem automática por IA · confiança {r.confianca}
              {claim.editado ? " · revisada pela redação" : ""}
            </small>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.article>
  );
}
