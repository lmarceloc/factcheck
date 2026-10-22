import { motion } from "motion/react";

/** nome: marca no lugar de "Checagem" (a tela do público usa a da configuração do debate). */
export function Logo({ big, nome }: { big?: boolean; nome?: string }) {
  return (
    <div className={`logo ${big ? "logo--big" : ""}`}>
      <motion.svg viewBox="0 0 32 32" className="logo__mark" initial={{ rotate: -90, scale: 0.6 }} animate={{ rotate: 0, scale: 1 }} transition={{ type: "spring", stiffness: 260, damping: 18 }}>
        <circle cx="16" cy="16" r="14" fill="url(#logo-g)" />
        <motion.path
          d="M10 16.5l4 4 8-9"
          stroke="white"
          strokeWidth="3.4"
          fill="none"
          strokeLinecap="round"
          strokeLinejoin="round"
          initial={{ pathLength: 0 }}
          animate={{ pathLength: 1 }}
          transition={{ delay: 0.25, duration: 0.5 }}
        />
        <defs>
          <linearGradient id="logo-g" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#ff5a5f" />
            <stop offset="1" stopColor="#c81e3a" />
          </linearGradient>
        </defs>
      </motion.svg>
      <div className="logo__text">
        <strong>{nome ?? "Checagem"}</strong>
        <span>
          <motion.i animate={{ opacity: [1, 0.25, 1] }} transition={{ duration: 1.4, repeat: Infinity }} />
          ao vivo
        </span>
      </div>
    </div>
  );
}
