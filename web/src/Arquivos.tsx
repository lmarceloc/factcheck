import { motion } from "motion/react";
import { useEffect, useState } from "react";
import type { ArquivoResumo, PublicState } from "../../src/shared/types";
import { Logo } from "./components/Logo";

/** Debates encerrados, do mais recente para o mais antigo. */
export function Arquivos() {
  const [lista, setLista] = useState<ArquivoResumo[] | null>(null);
  const [marca, setMarca] = useState<PublicState["debate"]["marca"] | null>(null);
  useEffect(() => {
    fetch("/api/public/state")
      .then((r) => r.json())
      .then((d: PublicState) => {
        setMarca(d.debate.marca);
        document.title = `Debates anteriores · ${d.debate.marca.nome}`;
      })
      .catch(() => {});
    fetch("/api/arquivos")
      .then((r) => r.json())
      .then(setLista)
      .catch(() => setLista([]));
  }, []);

  return (
    <div className="assistir">
      <div className="aurora" aria-hidden />
      <header className="assistir__top">
        <a href="/" aria-label="Voltar ao debate ao vivo">
          <Logo nome={marca?.nome ?? "Byte Fact Check"} aoVivo={false} />
        </a>
        <div className="assistir__titulo">
          <h1>Debates anteriores</h1>
          <span>Todas as checagens publicadas, com o momento de cada fala no vídeo.</span>
        </div>
        <a className="aovivo" href="/">
          Ao vivo agora
        </a>
      </header>
      <main className="arquivos">
        {lista?.length === 0 && <p className="empty">Nenhum debate encerrado ainda.</p>}
        {lista?.map((a, i) => (
          <motion.a
            key={a.id}
            href={`/arquivo/${a.id}`}
            className="arquivo"
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: Math.min(i, 10) * 0.04 }}
            whileHover={{ y: -3 }}
          >
            {a.youtube && <img src={`https://i.ytimg.com/vi/${a.youtube}/mqdefault.jpg`} alt="" loading="lazy" />}
            <div>
              <strong>{a.titulo}</strong>
              <span>
                {new Date(`${a.data}T12:00:00`).toLocaleDateString("pt-BR", { dateStyle: "long" })} · {a.checagens} checagens
              </span>
            </div>
          </motion.a>
        ))}
      </main>
      {marca && (
        <footer className="assistir__rodape">
          {marca.url ? (
            <a href={marca.url} target="_blank" rel="noopener">
              {marca.rodape}
            </a>
          ) : (
            <span>{marca.rodape}</span>
          )}
        </footer>
      )}
    </div>
  );
}
