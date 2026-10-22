import type { Priority } from "./shared/types.js";

const RANK: Record<Priority, number> = { alta: 0, media: 1, baixa: 2 };

interface Job {
  priority: Priority;
  seq: number;
  run: () => Promise<void>;
}

/** Fila com limite de concorrência; afirmações de prioridade alta passam na frente. */
export class PriorityQueue {
  private jobs: Job[] = [];
  private running = 0;
  private seq = 0;
  private idleResolvers: (() => void)[] = [];

  constructor(private readonly concurrency: number) {}

  get size() {
    return this.jobs.length;
  }

  get active() {
    return this.running;
  }

  add(priority: Priority, run: () => Promise<void>) {
    this.jobs.push({ priority, seq: this.seq++, run });
    this.jobs.sort((a, b) => RANK[a.priority] - RANK[b.priority] || a.seq - b.seq);
    this.next();
  }

  /** Descarta o que ainda não começou (o que já está rodando termina sozinho). */
  clear() {
    this.jobs = [];
  }

  /** Resolve quando não houver nada rodando nem esperando. */
  onIdle(): Promise<void> {
    if (this.running === 0 && this.jobs.length === 0) return Promise.resolve();
    return new Promise((resolve) => this.idleResolvers.push(resolve));
  }

  private next() {
    while (this.running < this.concurrency && this.jobs.length > 0) {
      const job = this.jobs.shift()!;
      this.running++;
      job
        .run()
        .catch((err) => console.error("[queue] tarefa falhou:", err))
        .finally(() => {
          this.running--;
          this.next();
          if (this.running === 0 && this.jobs.length === 0) {
            this.idleResolvers.splice(0).forEach((resolve) => resolve());
          }
        });
    }
  }
}
