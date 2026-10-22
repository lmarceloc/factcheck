import { EventEmitter } from "node:events";
import type { ArquivoResumo, ChecagemPublica, Claim, DebateInfo, PublicState, Segment, ServerEvent } from "./shared/types.js";

export interface Meta {
  currentSpeaker: string | null;
  /** Vídeo do YouTube da transmissão, escolhido pela redação e mostrado a todos. */
  youtube: string | null;
  /** A redação ligou a transcrição e o último sinal de vida dela (o painel avisa a cada minuto). */
  captura?: boolean;
  capturaVistaEm?: number;
}

/** Sem sinal do painel por este tempo, a tela pública deixa de dizer "Checando ao vivo". */
export const CAPTURA_VALIDADE_MS = 3 * 60_000;

export type Persisted = Pick<PublicState, "segments" | "claims"> & Partial<Meta>;

/** Onde o estado do debate é gravado: arquivo JSON no Node, SQLite no Durable Object. */
export interface Persistence {
  load(): Persisted | null;
  saveSegment(segment: Segment): void;
  saveClaim(claim: Claim): void;
  saveMeta(meta: Meta): void;
  /** Grava o que estiver pendente (no desligamento). */
  flush?(): void;
  /** Apaga o debate atual (depois de arquivado). */
  clear(): void;
  saveArchive(resumo: ArquivoResumo, estado: PublicState): void;
  listArchives(): ArquivoResumo[];
  getArchive(id: string): PublicState | null;
}

/** Estado do debate em memória, com eventos para o SSE e gravação em disco. */
export class Store extends EventEmitter {
  segments: Segment[] = [];
  claims = new Map<string, Claim>();
  currentSpeaker: string | null = null;
  autoPublish: boolean;
  /** A redação está transcrevendo a transmissão agora (vale enquanto o painel der sinal de vida). */
  private capturaLigada = false;
  private capturaVistaEm = 0;
  youtube: string | null = null;
  readonly demo: boolean;
  private readonly persistence?: Persistence;

  constructor(
    readonly debate: DebateInfo,
    opts: { autoPublish: boolean; persistence?: Persistence; demo?: boolean },
  ) {
    super();
    this.setMaxListeners(0);
    this.autoPublish = opts.autoPublish;
    this.persistence = opts.persistence;
    this.demo = opts.demo ?? false;
    this.load();
  }

  snapshot(): PublicState {
    return {
      debate: this.debate,
      currentSpeaker: this.currentSpeaker,
      segments: this.segments,
      claims: [...this.claims.values()],
      settings: this.settings(),
    };
  }

  get captura() {
    return this.capturaLigada && Date.now() - this.capturaVistaEm < CAPTURA_VALIDADE_MS;
  }

  settings() {
    return { autoPublish: this.autoPublish, demo: this.demo, captura: this.captura, youtube: this.youtube };
  }

  emitEvent(event: ServerEvent) {
    this.emit("event", event);
  }

  setSpeaker(speakerId: string | null) {
    this.currentSpeaker = speakerId;
    this.emitEvent({ type: "speaker", speakerId });
    this.saveMeta();
  }

  setYoutube(videoId: string | null) {
    this.youtube = videoId;
    this.emitEvent({ type: "settings", settings: this.settings() });
    this.saveMeta();
  }

  private saveMeta() {
    this.persistence?.saveMeta({
      currentSpeaker: this.currentSpeaker,
      youtube: this.youtube,
      captura: this.capturaLigada,
      capturaVistaEm: this.capturaVistaEm,
    });
  }

  /**
   * Liga/desliga o "Checando ao vivo". Fica gravado (sobrevive a um reinício do
   * servidor) e repetir `true` renova o prazo: é o sinal de vida do painel.
   */
  setCaptura(value: boolean) {
    const antes = this.captura;
    this.capturaLigada = value;
    if (value) this.capturaVistaEm = Date.now();
    this.saveMeta();
    if (antes !== this.captura) this.emitEvent({ type: "settings", settings: this.settings() });
  }

  setAutoPublish(value: boolean) {
    this.autoPublish = value;
    this.emitEvent({ type: "settings", settings: this.settings() });
  }

  addSegment(speakerId: string, text: string, at = Date.now(), videoTime?: number): Segment {
    const segment: Segment = { id: crypto.randomUUID(), speakerId, text, at, ...(videoTime !== undefined ? { videoTime } : {}) };
    this.segments.push(segment);
    this.emitEvent({ type: "segment", segment });
    this.persistence?.saveSegment(segment);
    return segment;
  }

  addClaim(data: Omit<Claim, "id" | "createdAt" | "updatedAt" | "progresso" | "status"> & Partial<Pick<Claim, "status">>): Claim {
    const now = Date.now();
    const claim: Claim = { status: "na_fila", ...data, id: crypto.randomUUID(), createdAt: now, updatedAt: now, progresso: [] };
    this.claims.set(claim.id, claim);
    this.emitEvent({ type: "claim", claim });
    this.persistence?.saveClaim(claim);
    return claim;
  }

  updateClaim(id: string, patch: Partial<Claim>): Claim | undefined {
    const current = this.claims.get(id);
    if (!current) return undefined;
    const claim: Claim = { ...current, ...patch, id, updatedAt: Date.now() };
    this.claims.set(id, claim);
    this.emitEvent({ type: "claim", claim });
    this.persistence?.saveClaim(claim);
    return claim;
  }

  /**
   * Encerra o debate: guarda tudo num arquivo permanente e zera a sala para o
   * próximo (falas, checagens, vídeo e placar).
   */
  encerrar(): ArquivoResumo {
    const estado = this.snapshot();
    const resumo: ArquivoResumo = {
      id: `${this.debate.data}-${crypto.randomUUID().slice(0, 8)}`,
      titulo: this.debate.titulo,
      data: this.debate.data,
      encerradoEm: Date.now(),
      youtube: this.youtube,
      checagens: estado.claims.filter((c) => c.status === "publicada" && !c.repeteDe).length,
    };
    this.persistence?.saveArchive(resumo, { ...estado, settings: { ...estado.settings, captura: false } });
    this.persistence?.clear();
    this.segments = [];
    this.claims.clear();
    this.currentSpeaker = null;
    this.youtube = null;
    this.capturaLigada = false;
    this.emitEvent({ type: "snapshot", state: this.snapshot() });
    return resumo;
  }

  /** Checagem publicada pelo id: procura no debate atual e depois nos arquivados (link permanente). */
  findPublished(id: string): ChecagemPublica | null {
    const atual = this.claims.get(id);
    if (atual?.status === "publicada") return { claim: atual, debate: this.debate, youtube: this.youtube, arquivoId: null };
    for (const resumo of this.listArchives()) {
      const estado = this.getArchive(resumo.id);
      const claim = estado?.claims.find((c) => c.id === id && c.status === "publicada");
      if (claim && estado) return { claim, debate: estado.debate, youtube: estado.settings.youtube, arquivoId: resumo.id };
    }
    return null;
  }

  listArchives(): ArquivoResumo[] {
    return this.persistence?.listArchives() ?? [];
  }

  getArchive(id: string): PublicState | null {
    return this.persistence?.getArchive(id) ?? null;
  }

  recentSegments(limit: number): Segment[] {
    return this.segments.slice(-limit);
  }

  recentClaims(limit: number): Claim[] {
    return [...this.claims.values()].slice(-limit);
  }

  private load() {
    const data = this.persistence?.load();
    if (!data) return;
    this.segments = data.segments ?? [];
    this.currentSpeaker = data.currentSpeaker ?? null;
    this.youtube = data.youtube ?? null;
    this.capturaLigada = data.captura ?? false;
    this.capturaVistaEm = data.capturaVistaEm ?? 0;
    for (const claim of data.claims ?? []) {
      // Checagens interrompidas por um reinício voltam para a fila.
      if (claim.status === "verificando") claim.status = "na_fila";
      this.claims.set(claim.id, claim);
    }
    console.log(`[store] ${this.segments.length} falas e ${this.claims.size} afirmações restauradas`);
  }

  saveNow() {
    this.persistence?.flush?.();
  }
}
