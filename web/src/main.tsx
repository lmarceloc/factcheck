import { MotionConfig } from "motion/react";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Arquivos } from "./Arquivos";
import { Assistir } from "./Assistir";
import { Painel } from "./Painel";
import { Telao } from "./Telao";
import "./styles.css";

// /             → tela do público (vídeo, placar e checagens ao vivo)
// /arquivo/:id  → um debate encerrado, com "ver no vídeo" em cada checagem
// /arquivos     → lista de debates encerrados
// /painel       → painel da redação (pede a senha)
// /telao        → overlay para a transmissão de TV
const path = location.pathname;
const arquivo = path.match(/^\/arquivo\/([\w-]+)/)?.[1];

function Pagina() {
  if (path.startsWith("/telao")) return <Telao />;
  if (path.startsWith("/painel")) return <Painel />;
  if (path.startsWith("/arquivos")) return <Arquivos />;
  if (arquivo) return <Assistir arquivoId={arquivo} />;
  return <Assistir />;
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <MotionConfig reducedMotion="user">
      <Pagina />
    </MotionConfig>
  </StrictMode>,
);
