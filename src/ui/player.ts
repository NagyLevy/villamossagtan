// A lépésenkénti megoldás lejátszója: aktuális lépés, lejátszás/szünet, sebesség, időzítés.
// Nincs benne DOM: a felület a visszahívásokon keresztül frissül.

import type { Step } from '../methods/types';

export interface PlayerEvents {
  /** Új lépés lett az aktuális (index; -1 = még semmi). */
  onStep(index: number): void;
  /** A lépésen belüli előrehaladás 0..1 (a lépéssávhoz). */
  onProgress(index: number, progress: number): void;
  onPlaying(playing: boolean): void;
}

/** Egy lépés felépülésének időrendje ezredmásodpercben (1× sebességnél). */
export function stepTimeline(step: Step): { terms: number[]; subst: number; result: number; end: number } {
  const n = step.terms?.length ?? 0;
  const terms = Array.from({ length: n }, (_, i) => 300 + i * 380);
  let t = n ? terms[n - 1]! + 380 : 300;
  const subst = step.subst ? t + 200 : t;
  if (step.subst) t = subst + 600;
  const result = step.result ? t + 150 : t;
  if (step.result) t = result + 500;
  // Olvasási idő a szöveghez.
  const reading = Math.min(4000, 900 + step.text.length * 18);
  return { terms, subst, result, end: Math.max(t + 900, reading) };
}

export class Player {
  private steps: Step[] = [];
  private index = -1;
  private playing = false;
  private speed = 1;
  private startedAt = 0;
  private elapsed = 0;
  private raf = 0;

  constructor(private readonly ev: PlayerEvents) {}

  get current(): number {
    return this.index;
  }

  get count(): number {
    return this.steps.length;
  }

  get isPlaying(): boolean {
    return this.playing;
  }

  load(steps: Step[]): void {
    this.pause();
    this.steps = steps;
    this.go(steps.length ? 0 : -1);
  }

  setSpeed(v: number): void {
    // Az eddig eltelt időt átskálázzuk, hogy a sáv ne ugorjon.
    const now = performance.now();
    if (this.playing) this.elapsed += (now - this.startedAt) * this.speed;
    this.startedAt = now;
    this.speed = v;
  }

  getSpeed(): number {
    return this.speed;
  }

  go(i: number): void {
    if (i < -1 || i >= this.steps.length) return;
    this.index = i;
    this.elapsed = 0;
    this.startedAt = performance.now();
    this.ev.onStep(i);
    this.tick();
  }

  next(): void {
    if (this.index < this.steps.length - 1) this.go(this.index + 1);
    else this.pause();
  }

  prev(): void {
    if (this.index > 0) this.go(this.index - 1);
  }

  restart(): void {
    this.go(0);
    this.play();
  }

  play(): void {
    if (!this.steps.length) return;
    if (this.index >= this.steps.length - 1 && this.progress() >= 1) this.go(0);
    this.playing = true;
    this.startedAt = performance.now();
    this.ev.onPlaying(true);
    this.loop();
  }

  pause(): void {
    if (this.playing) this.elapsed += (performance.now() - this.startedAt) * this.speed;
    this.playing = false;
    cancelAnimationFrame(this.raf);
    this.ev.onPlaying(false);
    this.tick();
  }

  toggle(): void {
    if (this.playing) this.pause();
    else this.play();
  }

  private progress(): number {
    const step = this.steps[this.index];
    if (!step) return 0;
    if (!this.playing) return 1;
    const t = this.elapsed + (performance.now() - this.startedAt) * this.speed;
    return Math.min(1, t / stepTimeline(step).end);
  }

  private tick(): void {
    this.ev.onProgress(this.index, this.progress());
  }

  private loop = () => {
    if (!this.playing) return;
    const p = this.progress();
    this.ev.onProgress(this.index, p);
    if (p >= 1) {
      if (this.index < this.steps.length - 1) {
        this.go(this.index + 1);
      } else {
        this.pause();
        return;
      }
    }
    this.raf = requestAnimationFrame(this.loop);
  };
}
