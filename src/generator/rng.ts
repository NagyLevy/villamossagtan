// Seed-alapú, determinisztikus véletlengenerátor: ugyanaz a seed mindig ugyanazt a feladatot adja.

/** Szöveges seed → 32 bites egész (FNV-1a). */
export function hashSeed(seed: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

const SEED_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // összetéveszthető karakterek nélkül

/** Új, olvasható seed (pl. "K7Q2-9FMX"). Ez az egyetlen nem determinisztikus függvény. */
export function randomSeed(random: () => number = Math.random): string {
  let s = '';
  for (let i = 0; i < 8; i++) {
    if (i === 4) s += '-';
    s += SEED_ALPHABET[Math.floor(random() * SEED_ALPHABET.length)];
  }
  return s;
}

export class Rng {
  private state: number;

  constructor(seed: string | number) {
    this.state = typeof seed === 'number' ? seed >>> 0 : hashSeed(seed);
  }

  /** Egyenletes eloszlás [0, 1)-en (mulberry32). */
  next(): number {
    let t = (this.state = (this.state + 0x6d2b79f5) >>> 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Egész szám [min, max] között, mindkét végpontot beleértve. */
  int(min: number, max: number): number {
    return min + Math.floor(this.next() * (max - min + 1));
  }

  chance(p: number): boolean {
    return this.next() < p;
  }

  pick<T>(items: readonly T[]): T {
    if (items.length === 0) throw new Error('Rng.pick: üres lista');
    return items[Math.floor(this.next() * items.length)]!;
  }

  /** Súlyozott választás: [érték, súly] párokból. */
  weighted<T>(items: readonly (readonly [T, number])[]): T {
    const total = items.reduce((s, [, w]) => s + w, 0);
    let r = this.next() * total;
    for (const [item, w] of items) {
      r -= w;
      if (r < 0) return item;
    }
    return items[items.length - 1]![0];
  }

  shuffle<T>(items: readonly T[]): T[] {
    const a = [...items];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(this.next() * (i + 1));
      [a[i], a[j]] = [a[j]!, a[i]!];
    }
    return a;
  }

  /** `k` különböző elem véletlen sorrendben. */
  sample<T>(items: readonly T[], k: number): T[] {
    return this.shuffle(items).slice(0, k);
  }
}
