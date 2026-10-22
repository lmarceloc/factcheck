import { MotionConfig } from "motion/react";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Painel } from "./Painel";
import { Telao } from "./Telao";
import "./styles.css";

const isTelao = location.pathname.startsWith("/telao");

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <MotionConfig reducedMotion="user">{isTelao ? <Telao /> : <Painel />}</MotionConfig>
  </StrictMode>,
);
