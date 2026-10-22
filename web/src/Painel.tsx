import { AnimatePresence, motion } from "motion/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AUTO_SPEAKER, type SpeakerInfo } from "../../src/shared/types";
import { api, operatorToken } from "./api";
import { ClaimFeed } from "./components/ClaimFeed";
import { Logo } from "./components/Logo";
import { ManualInput } from "./components/ManualInput";
import { MicButton } from "./components/MicButton";
import { Scoreboard } from "./components/Scoreboard";
import { SpeakerBar } from "./components/SpeakerBar";
import { Transcript } from "./components/Transcript";
import { Transmissao } from "./components/Transmissao";
import { useDebate } from "./useDebate";
import { useAssembly, type AudioSource } from "./useAssembly";
import { speechSupported, useMicLevel, useSpeech } from "./useSpeech";

export function Painel() {
  const { data, claims, interim, connected } = useDebate("operator");
  const [toast, setToast] = useState<string | null>(null);
  const current = data?.currentSpeaker ?? null;
  const currentRef = useRef(current);
  currentRef.current = current;

  const speakers: SpeakerInfo[] = useMemo(
    () => (data ? [...data.debate.candidatos, ...data.debate.outros_falantes] : []),
    [data?.debate],
  );
  const byId = useMemo(
    () => new Map([...speakers, { id: AUTO_SPEAKER, nome: "Não identificado", cor: "#94a3b8" }].map((s) => [s.id, s])),
    [speakers],
  );

  // Modo manual (operador escolhe quem fala) ou transmissão (link do YouTube, orador automático).
  const [modo, setModoState] = useState<"manual" | "transmissao">(() => {
    try {
      return localStorage.getItem("factcheck.modo") === "manual" ? "manual" : "transmissao";
    } catch {
      return "transmissao";
    }
  });
  const setModo = (m: "manual" | "transmissao") => {
    setModoState(m);
    try {
      localStorage.setItem("factcheck.modo", m);
    } catch {
      /* só não lembra a escolha */
    }
  };
  const [verTranscricao, setVerTranscricao] = useState(false);
  const [confirmarEncerrar, setConfirmarEncerrar] = useState(false);
  const [encerrando, setEncerrando] = useState(false);
  const encerrar = async () => {
    setEncerrando(true);
    try {
      const arq = await api.encerrar();
      setConfirmarEncerrar(false);
      notify(`Debate arquivado em /arquivo/${arq.id} (${arq.checagens} checagens). A tela foi zerada para o próximo.`);
    } catch (e) {
      notify((e as Error).message);
    } finally {
      setEncerrando(false);
    }
  };
  const claimList = useMemo(() => [...claims.values()], [claims]);

  const notify = useCallback((msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast((t) => (t === msg ? null : t)), 4000);
  }, []);

  const lastInterim = useRef(0);
  // Relógio do player do YouTube (modo transmissão): cada fala leva o minuto do vídeo.
  const videoClock = useRef<(() => number | undefined) | null>(null);
  const setVideoClock = useCallback((fn: () => number | undefined) => {
    videoClock.current = fn;
  }, []);
  const onFinal = (text: string, startedAt?: number) => {
    if (!currentRef.current) return notify("Escolha quem está falando para a fala entrar na checagem.");
    const agora = videoClock.current?.();
    const videoTime =
      agora !== undefined && startedAt !== undefined ? Math.max(0, agora - (performance.now() - startedAt) / 1000) : undefined;
    api.transcript(text, true, undefined, videoTime).catch((e) => notify(e.message));
  };
  const onInterim = (text: string) => {
    const now = Date.now();
    if (!currentRef.current || (text && now - lastInterim.current < 350)) return;
    lastInterim.current = now;
    api.transcript(text, false).catch(() => {});
  };

  // Motor de transcrição: AssemblyAI quando o servidor tem a chave; senão, o do navegador.
  const [assemblyOn, setAssemblyOn] = useState(false);
  const [source, setSource] = useState<AudioSource>("microfone");
  useEffect(() => {
    api.sttConfig().then((c) => setAssemblyOn(c.assemblyai)).catch(() => setAssemblyOn(false));
  }, []);
  const browser = useSpeech(onFinal, onInterim);
  const assembly = useAssembly(onFinal, onInterim);
  const browserLevel = useMicLevel(browser.listening);
  const speech = assemblyOn
    ? { listening: assembly.listening, start: () => assembly.start(source), stop: assembly.stop }
    : browser;
  const level = assemblyOn ? assembly.level : browserLevel;

  useEffect(() => {
    if (browser.error) notify(browser.error);
  }, [browser.error, notify]);
  useEffect(() => {
    if (assembly.error) notify(assembly.error);
  }, [assembly.error, notify]);

  const selectSpeaker = useCallback(
    (id: string | null) => api.setSpeaker(id).catch((e) => notify(e.message)),
    [notify],
  );
  const toggleMic = useCallback(() => (speech.listening ? speech.stop() : speech.start()), [speech]);
  const startTransmissao = async () => {
    await api.setSpeaker(AUTO_SPEAKER).catch((e) => notify(e.message));
    await assembly.start("esta_aba");
  };
  const stopTransmissao = () => {
    assembly.stop();
  };
  // Avisa o público quando a transcrição liga ou desliga ("Checando ao vivo").
  // Só nas mudanças: abrir o painel não pode desligar a transcrição de outro operador.
  const capturaAnterior = useRef(assembly.listening);
  useEffect(() => {
    if (capturaAnterior.current === assembly.listening) return;
    capturaAnterior.current = assembly.listening;
    api.transmissao({ captura: assembly.listening }).catch(() => {});
  }, [assembly.listening]);
  // Sinal de vida: se este navegador fechar ou cair, o "ao vivo" do público se apaga sozinho em minutos.
  useEffect(() => {
    if (!assembly.listening) return;
    const t = window.setInterval(() => api.transmissao({ captura: true }).catch(() => {}), 60_000);
    return () => window.clearInterval(t);
  }, [assembly.listening]);

  // Atalhos: 1–9 escolhe o orador, 0 ninguém, M liga/desliga o microfone.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (el.closest("input, textarea, select") || e.metaKey || e.ctrlKey || e.altKey) return;
      if ((e.key === "m" || e.key === "M") && modo === "manual") return toggleMic();
      if (e.key === "0") return void selectSpeaker(modo === "transmissao" ? AUTO_SPEAKER : null);
      const n = Number(e.key);
      if (n >= 1 && n <= speakers.length) selectSpeaker(speakers[n - 1].id);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [speakers, selectSpeaker, toggleMic, modo]);

  if (!data) return operatorToken() ? <Loading connected={connected} /> : <Acesso />;

  const checking = claimList.filter((c) => c.status === "verificando" || c.status === "na_fila").length;
  const review = claimList.filter((c) => c.status === "rascunho" && c.tipo !== "pergunta").length;

  return (
    <div className="painel">
      <div className="aurora" aria-hidden />
      <header className="topbar">
        <Logo />
        <div className="topbar__title">
          <h1>
            {data.debate.titulo}
            {data.settings.demo && <span className="demo-tag">Simulação</span>}
          </h1>
          <span>
            {data.debate.emissora ? `${data.debate.emissora} · ` : ""}
            {new Date(`${data.debate.data}T12:00:00`).toLocaleDateString("pt-BR", { dateStyle: "long" })}
          </span>
        </div>
        <div className="topbar__stats">
          <Stat label="online" value={data.audiencia?.online ?? 0} pulse={(data.audiencia?.online ?? 0) > 0} />
          <Stat label="pico" value={data.audiencia?.pico ?? 0} />
          <Stat label="visitantes" value={data.audiencia?.visitantes ?? 0} />
          <Stat label="checando" value={checking} pulse={checking > 0} />
          <Stat label="para revisar" value={review} highlight={review > 0} />
        </div>
        <div className="mode-toggle" role="radiogroup" aria-label="Modo de operação">
          {(["transmissao", "manual"] as const).map((m) => (
            <button
              key={m}
              role="radio"
              aria-checked={modo === m}
              className={modo === m ? "on" : ""}
              disabled={speech.listening || assembly.listening}
              onClick={() => setModo(m)}
            >
              {modo === m && <motion.span layoutId="mode-bg" className="mode-toggle__bg" />}
              <span>{m === "transmissao" ? "Transmissão" : "Manual"}</span>
            </button>
          ))}
        </div>
        <div className="topbar__actions">
          <label className="switch" title="Publica direto na tela do público; incertas e exageradas sempre esperam revisão">
            <input
              type="checkbox"
              checked={data.settings.autoPublish}
              onChange={(e) => api.settings(e.target.checked).catch((err) => notify(err.message))}
            />
            <span className="switch__track">
              <motion.span className="switch__thumb" layout transition={{ type: "spring", stiffness: 600, damping: 32 }} />
            </span>
            Publicar direto
          </label>
          <a className="btn btn--ghost" href="/" target="_blank" rel="noreferrer">
            Página pública ↗
          </a>
          <a className="btn btn--ghost" href="/telao" target="_blank" rel="noreferrer">
            Telão ↗
          </a>
          <a className="btn btn--ghost" href="/api/report.md" target="_blank" rel="noreferrer">
            Relatório
          </a>
          <button className="btn btn--ghost btn--danger" onClick={() => setConfirmarEncerrar(true)} disabled={speech.listening || assembly.listening}>
            Encerrar debate
          </button>
          <span className={`conn ${connected ? "conn--on" : ""}`} title={connected ? "Conectado" : "Reconectando…"} />
        </div>
      </header>

      {modo === "transmissao" && (
        <section className="stage stage--tx">
          <SpeakerBar speakers={speakers} current={current} onSelect={selectSpeaker} auto />
          <p className="stage__hint">
            Quem está falando? Deixe em <strong>Automático</strong> e a IA identifica; se souber, marque (teclas 1, 2, 3… e 0
            para voltar ao automático).
          </p>
        </section>
      )}

      {modo === "manual" && (
      <section className="stage">
        <SpeakerBar speakers={speakers} current={current} onSelect={selectSpeaker} />
        <MicButton
          listening={speech.listening}
          level={level}
          onToggle={toggleMic}
          disabled={!assemblyOn && !speechSupported}
          engine={assemblyOn ? "AssemblyAI" : "navegador · pt-BR"}
          source={assemblyOn ? { value: source, onChange: setSource } : undefined}
        />
      </section>
      )}

      <main className={`grid grid--${modo}`}>
        <section className="panel panel--transcript">
          {modo === "transmissao" ? (
            <>
              <h2>
                Transmissão <span className="badge">ao vivo</span>
              </h2>
              <Transmissao
                youtube={data.settings.youtube}
                onLoad={(id) => api.transmissao({ youtube: id })}
                onClock={setVideoClock}
                available={assemblyOn}
                listening={assembly.listening}
                level={assembly.level}
                onStart={startTransmissao}
                onStop={stopTransmissao}
              />
              <button className="link tx__toggle" onClick={() => setVerTranscricao((v) => !v)}>
                {verTranscricao ? "Esconder transcrição" : `Mostrar transcrição (${data.segments.length} falas)`}
              </button>
              <AnimatePresence initial={false}>
                {verTranscricao && (
                  <motion.div
                    className="tx__transcript"
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: "auto" }}
                    exit={{ opacity: 0, height: 0 }}
                  >
                    <Transcript segments={data.segments} interim={interim} speakers={byId} />
                  </motion.div>
                )}
              </AnimatePresence>
            </>
          ) : (
            <>
              <h2>
                Transcrição <span className="badge">ao vivo</span>
              </h2>
              <Transcript segments={data.segments} interim={interim} speakers={byId} />
              <ManualInput speakers={speakers} current={current} />
            </>
          )}
        </section>
        <section className="panel panel--checks">
          <Scoreboard candidates={data.debate.candidatos} claims={claimList} />
          <ClaimFeed claims={claimList} speakers={byId} candidates={speakers} />
        </section>
      </main>

      <AnimatePresence>
        {confirmarEncerrar && (
          <motion.div className="modal" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setConfirmarEncerrar(false)}>
            <motion.div
              className="modal__box"
              role="dialog"
              aria-modal="true"
              aria-labelledby="encerrar-titulo"
              initial={{ scale: 0.92, y: 20 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.95, opacity: 0 }}
              transition={{ type: "spring", stiffness: 400, damping: 30 }}
              onClick={(e) => e.stopPropagation()}
            >
              <h2 id="encerrar-titulo">Encerrar o debate?</h2>
              <p>
                Tudo fica guardado num arquivo permanente, com página própria para o público ({claimList.filter((c) => c.status === "publicada").length}{" "}
                checagens publicadas). Depois disso, a tela do público, o placar e a fila são zerados para o próximo debate.
              </p>
              <div className="claim__actions">
                <button className="btn btn--publish" onClick={encerrar} disabled={encerrando}>
                  {encerrando ? "Arquivando…" : "Encerrar e arquivar"}
                </button>
                <button className="btn btn--ghost" onClick={() => setConfirmarEncerrar(false)}>
                  Cancelar
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {toast && (
          <motion.div
            className="toast"
            initial={{ opacity: 0, y: 30, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 20, scale: 0.95 }}
            onClick={() => setToast(null)}
          >
            {toast}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function Stat({ label, value, pulse, highlight }: { label: string; value: number; pulse?: boolean; highlight?: boolean }) {
  return (
    <div className={`stat ${highlight ? "stat--hl" : ""}`}>
      <motion.strong key={value} initial={{ y: -10, opacity: 0 }} animate={{ y: 0, opacity: 1 }}>
        {value.toLocaleString("pt-BR")}
      </motion.strong>
      <span>
        {pulse && <motion.i animate={{ scale: [1, 1.6, 1], opacity: [1, 0.4, 1] }} transition={{ duration: 1.2, repeat: Infinity }} />}
        {label}
      </span>
    </div>
  );
}

export function Loading({ connected }: { connected: boolean }) {
  return (
    <div className="loading">
      <Logo big />
      <motion.p animate={{ opacity: [0.4, 1, 0.4] }} transition={{ duration: 1.6, repeat: Infinity }}>
        {connected ? "Carregando o debate…" : "Conectando ao servidor…"}
      </motion.p>
    </div>
  );
}

/** Painel da redação sem senha: pede o OPERATOR_TOKEN e guarda neste navegador. */
function Acesso() {
  const [token, setToken] = useState("");
  return (
    <div className="loading">
      <Logo big />
      <form
        className="acesso"
        onSubmit={(e) => {
          e.preventDefault();
          if (token.trim()) location.href = `/painel?token=${encodeURIComponent(token.trim())}`;
        }}
      >
        <label htmlFor="token">Painel da redação</label>
        <input id="token" type="password" value={token} onChange={(e) => setToken(e.target.value)} placeholder="Senha (OPERATOR_TOKEN)" autoFocus />
        <button className="btn btn--publish">Entrar</button>
      </form>
    </div>
  );
}
