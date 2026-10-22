import { MotionConfig } from "motion/react";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Assistir } from "./Assistir";
import { Painel } from "./Painel";
import { Telao } from "./Telao";
import "./styles.css";

// /        → tela do público (vídeo, placar e checagens)
// /painel  → painel da redação (exige ?token=)
// /telao   → overlay para a transmissão de TV
const path = location.pathname;
const Pagina = path.startsWith("/telao") ? Telao : path.startsWith("/painel") ? Painel : Assistir;

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <MotionConfig reducedMotion="user">
      <Pagina />
    </MotionConfig>
  </StrictMode>,
);
