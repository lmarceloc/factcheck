import { z } from "zod";

/** A tela do público avisa que está aberta a cada 30 s. */
export const PRESENCA_INTERVALO_MS = 30_000;
/** Sem aviso por este tempo, a pessoa saiu (abas em segundo plano avisam só uma vez por minuto). */
export const PRESENCA_VALIDADE_MS = 90_000;
/** De quanto em quanto tempo a contagem é fechada e enviada ao debate. */
export const PRESENCA_CICLO_MS = 10_000;

export const PresencaBody = z.object({
  /** Identificador aleatório do navegador (não identifica a pessoa). */
  id: z.string().regex(/^[\w-]{8,64}$/),
  /** A pessoa fechou a página: sai da contagem na hora. */
  saindo: z.boolean().optional(),
});

/**
 * Contagem de quem está com a tela aberta, em memória (servidor Node). No
 * Cloudflare a mesma conta é feita em SQLite pelas fatias (Durable Object Plateia).
 */
export class Presenca {
  private readonly vivos = new Map<string, number>();
  /** Quem já passou pelo debate (para contar visitantes diferentes). */
  private readonly vistos = new Set<string>();
  /** Visitantes novos ainda não informados ao debate, e os informados no último ciclo. */
  private pendentes = new Set<string>();
  private ultimos = new Set<string>();

  bater(id: string, saindo = false) {
    if (saindo) {
      this.vivos.delete(id);
      return;
    }
    if (!this.vistos.has(id)) {
      this.vistos.add(id);
      this.pendentes.add(id);
    }
    this.vivos.set(id, Date.now());
  }

  /** Tira quem sumiu e devolve quantos estão online e quantos visitantes novos chegaram desde o último ciclo. */
  ciclo(agora = Date.now()) {
    for (const [id, visto] of this.vivos) if (agora - visto > PRESENCA_VALIDADE_MS) this.vivos.delete(id);
    this.ultimos = this.pendentes;
    this.pendentes = new Set();
    return { online: this.vivos.size, novos: this.ultimos.size };
  }

  /**
   * Começou outro debate (percebido no último ciclo): quem já está na sala conta
   * como visitante dele também, menos quem acabou de ser contado para ele.
   */
  novaSessao() {
    this.vistos.clear();
    for (const id of this.ultimos) this.vistos.add(id);
    for (const id of this.vivos.keys()) {
      if (!this.vistos.has(id)) this.pendentes.add(id);
      this.vistos.add(id);
    }
  }
}
