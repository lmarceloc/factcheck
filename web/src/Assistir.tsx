import { AnimatePresence, motion } from "motion/react";
import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import type { Claim, PublicState, SpeakerInfo } from "../../src/shared/types";
import { AUTO_SPEAKER } from "../../src/shared/types";
import { Avatar } from "./components/Avatar";
import { Contador } from "./components/Contador";
import { Logo } from "./components/Logo";
import { VerdictBadge } from "./components/VerdictBadge";
import { Loading } from "./Painel";
import { VERDICT_STYLE, softSpring } from "./theme";
import { usePublicState } from "./usePublicState";
import { Player } from "./components/Player";
import { formatarTempo, useYouTube } from "./useYouTube";
import { usePresenca } from "./usePresenca";

/** Debate arquivado: carrega uma vez (não muda mais). */
function useArquivo(id: string | undefined) {
  const [data, setData] = useState<PublicState | null>(null);
  const [erro, setErro] = useState(false);
  useEffect(() => {
    if (!id) return;
    fetch(`/api/arquivos/${encodeURIComponent(id)}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d: PublicState) => setData(d))
      .catch(() => setErro(true));
  }, [id]);
  return { data, erro };
}

const tempo = (t: number) => {
  const s = Math.round((Date.now() - t) / 1000);
  if (s < 60) return "agora";
  if (s < 3600) return `há ${Math.floor(s / 60)} min`;
  return new Date(t).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
};

export function hostname(url: string) {
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
export function Assistir({ arquivoId }: { arquivoId?: string }) {
  const aoVivo = usePublicState(arquivoId ? 0 : 3000);
  const arquivo = useArquivo(arquivoId);
  const data = arquivoId ? arquivo.data : aoVivo.data;
  const online = arquivoId ? !arquivo.erro : aoVivo.online;
  const yt = useYouTube(data?.settings.youtube ?? null);
  usePresenca(!arquivoId);
  const playerArea = useRef<HTMLDivElement>(null);
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

  if (arquivoId && arquivo.erro) {
    return (
      <div className="loading">
        <Logo big aoVivo={false} />
        <p>Debate não encontrado.</p>
        <a className="btn" href="/arquivos">
          Debates anteriores
        </a>
      </div>
    );
  }
  if (!data) return <Loading connected={online} />;


  const { settings, debate } = data;
  document.title = arquivoId ? `${debate.titulo} · ${debate.marca.nome}` : debate.marca.nome;

  const irPara = (t: number) => {
    if (!settings.youtube) return;
    if (yt.controlavel()) {
      yt.irPara(t);
      playerArea.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    } else {
      window.open(`https://www.youtube.com/watch?v=${settings.youtube}&t=${Math.floor(t)}s`, "_blank", "noopener");
    }
  };
  return (
    <div className="assistir">
      <div className="aurora" aria-hidden />
      {settings.demo && <div className="demo-watermark">Simulação · não é checagem real</div>}

      <header className="assistir__top">
        <Logo nome={debate.marca.nome} aoVivo={!arquivoId && settings.captura} />
        <div className="assistir__titulo">
          <h1>{debate.titulo}</h1>
          <span>
            {debate.emissora ? `${debate.emissora} · ` : ""}
            {new Date(`${debate.data}T12:00:00`).toLocaleDateString("pt-BR", { dateStyle: "long" })}
          </span>
        </div>
        {arquivoId ? (
          <a className="aovivo" href="/arquivos">
            Debate encerrado · ver outros
          </a>
        ) : (
          <div className="assistir__status">
            <Plateia pessoas={data.audiencia?.online ?? 0} aoVivo={settings.captura} />
            <AoVivo ativo={settings.captura} online={online} />
          </div>
        )}
      </header>

      <main className="assistir__grid">
        <div className="assistir__esquerda">
          <div className="assistir__player" ref={playerArea}>
            {settings.youtube ? (
              <Player videoId={settings.youtube} yt={yt} />
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
                <CartaoPublico
                  key={c.id}
                  claim={c}
                  speaker={speakers.get(c.speakerId)}
                  nova={novas.has(c.id)}
                  quando={arquivoId ? new Date(c.createdAt).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }) : tempo(c.publishedAt ?? c.createdAt)}
                  irPara={settings.youtube && c.videoTime !== undefined ? () => irPara(c.videoTime!) : undefined}
                />
              ))}
            </AnimatePresence>
            {checagens.length === 0 && (
              <motion.div className="empty" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
                <p>{settings.captura ? "Ouvindo o debate…" : "Nenhuma checagem ainda."}</p>
                <small>As falas checadas aparecem aqui sozinhas, com o veredito e as fontes.</small>
              </motion.div>
            )}
          </div>
          <a className="assistir__arquivos" href="/arquivos">
            Debates anteriores →
          </a>
          <p className="assistir__nota">
            Checagens automáticas feitas por IA com dados oficiais (IBGE, Banco Central, TSE, Câmara, Senado e outros). Casos
            incertos ou exagerados passam pela revisão da redação antes de aparecer.
          </p>
        </section>
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

function AoVivo({ ativo, online }: { ativo: boolean; online: boolean }) {
  return (
    <div className={`aovivo ${ativo ? "aovivo--on" : ""}`}>
      <motion.i animate={ativo ? { scale: [1, 1.5, 1], opacity: [1, 0.4, 1] } : {}} transition={{ duration: 1.4, repeat: Infinity }} />
      {!online ? "Reconectando…" : ativo ? "Checando ao vivo" : "Aguardando a transmissão"}
    </div>
  );
}

/** Quantas pessoas estão com a tela aberta agora (some enquanto a contagem não chega). */
function Plateia({ pessoas, aoVivo }: { pessoas: number; aoVivo: boolean }) {
  if (pessoas < 1) return null;
  const n = pessoas.toLocaleString("pt-BR");
  return (
    <div className="plateia" title="Pessoas com esta página aberta agora">
      <svg viewBox="0 0 24 24" aria-hidden>
        <path
          d="M2.5 12s3.5-6.5 9.5-6.5S21.5 12 21.5 12s-3.5 6.5-9.5 6.5S2.5 12 2.5 12z"
          stroke="currentColor"
          strokeWidth="2"
          fill="none"
          strokeLinejoin="round"
        />
        <circle cx="12" cy="12" r="3" fill="currentColor" />
      </svg>
      <AnimatePresence mode="popLayout" initial={false}>
        <motion.strong key={n} initial={{ y: -8, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 8, opacity: 0 }}>
          {n}
        </motion.strong>
      </AnimatePresence>
      <span>{aoVivo ? "acompanhando" : "na sala"}</span>
    </div>
  );
}

/** Texto curto: corta no fim da palavra e põe reticências. */
export function curto(texto: string, max: number) {
  if (texto.length <= max) return texto;
  return `${texto.slice(0, texto.lastIndexOf(" ", max)).replace(/[,.;:]$/, "")}…`;
}

/** Nome curto da fonte principal para o dado-chave do card (ex.: ibge.gov.br). */
export function fontePrincipal(claim: Claim): string | null {
  const fontes = claim.resultado?.fontes ?? [];
  const f = fontes.find((x) => x.confirmada) ?? fontes[0];
  return f ? hostname(f.url) : null;
}

function CartaoPublico({
  claim,
  speaker,
  nova,
  quando,
  irPara,
}: {
  claim: Claim;
  speaker?: SpeakerInfo;
  nova: boolean;
  quando: string;
  irPara?: () => void;
}) {
  const r = claim.resultado!;
  const v = VERDICT_STYLE[r.veredito];
  const nome = speaker?.nome ?? (claim.speakerId === AUTO_SPEAKER ? "Não identificado" : claim.speakerId);
  const fonte = fontePrincipal(claim);

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
      {r.dados && (
        <p className="pub__dado">
          <svg viewBox="0 0 24 24" aria-hidden>
            <path d="M5 19V11M12 19V5M19 19v-6" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" fill="none" />
          </svg>
          <span>
            {curto(r.dados, 140)}
            {fonte && <em> · {fonte}</em>}
          </span>
        </p>
      )}
      <div className="pub__acoes">
        <a className="pub__entenda" href={`/checagem/${claim.id}`} target="_blank" rel="noopener">
          Entenda a checagem →
        </a>
        {irPara && (
          <motion.button className="pub__video" onClick={irPara} whileTap={{ scale: 0.94 }} title="Ir para este momento do vídeo">
            <svg viewBox="0 0 24 24" aria-hidden>
              <path d="M8 5.5v13l10.5-6.5z" fill="currentColor" />
            </svg>
            ver no vídeo · {formatarTempo(claim.videoTime!)}
          </motion.button>
        )}
      </div>
    </motion.article>
  );
}
