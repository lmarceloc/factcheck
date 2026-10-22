import type { Segment } from "./shared/types.js";

export interface Chunk {
  speakerId: string;
  text: string;
  segmentIds: string[];
}

export interface SegmenterOptions {
  /** Silêncio (ms) depois do qual o trecho acumulado é enviado para extração. */
  idleMs: number;
  /** Envia assim que o trecho tiver pelo menos isso e terminar em pontuação. */
  minChars: number;
  /** Envia de qualquer forma ao passar desse tamanho (fala longa sem pausa). */
  maxChars: number;
}

const DEFAULTS: SegmenterOptions = { idleMs: 2500, minChars: 120, maxChars: 600 };

/**
 * Junta as falas finais de quem está com a palavra em trechos com sentido
 * completo antes de mandar para a extração de afirmações. O reconhecimento de
 * voz entrega frases picadas e muitas vezes sem pontuação, então o corte usa
 * pontuação, tamanho, troca de orador e silêncio.
 */
export class Segmenter {
  private buffer: Segment[] = [];
  private timer: NodeJS.Timeout | null = null;
  private readonly opts: SegmenterOptions;

  constructor(
    private readonly onChunk: (chunk: Chunk) => void,
    opts: Partial<SegmenterOptions> = {},
  ) {
    this.opts = { ...DEFAULTS, ...opts };
  }

  push(segment: Segment) {
    const current = this.buffer[0];
    if (current && current.speakerId !== segment.speakerId) this.flush();

    this.buffer.push(segment);
    const text = this.text();
    const endsSentence = /[.!?…]["”')\]]?\s*$/.test(text);
    if (text.length >= this.opts.maxChars || (endsSentence && text.length >= this.opts.minChars)) {
      this.flush();
      return;
    }
    this.armTimer();
  }

  flush() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    if (this.buffer.length === 0) return;
    const chunk: Chunk = {
      speakerId: this.buffer[0].speakerId,
      text: this.text(),
      segmentIds: this.buffer.map((s) => s.id),
    };
    this.buffer = [];
    if (chunk.text.trim()) this.onChunk(chunk);
  }

  private text() {
    return this.buffer
      .map((s) => s.text.trim())
      .filter(Boolean)
      .join(" ");
  }

  private armTimer() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush(), this.opts.idleMs);
  }
}
