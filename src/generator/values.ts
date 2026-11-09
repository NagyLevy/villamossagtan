// "Szép" értékkészletek nehézségi szintenként. Kerek számokra törekszünk.

import type { Rng } from './rng';

export type Level = 'alapozo' | 'konnyu' | 'kozepes' | 'nehez' | 'zh';

export const LEVEL_NAMES: Record<Level, string> = {
  alapozo: 'Alapozó',
  konnyu: 'Könnyű',
  kozepes: 'Közepes',
  nehez: 'Nehéz',
  zh: 'ZH-szint',
};

interface Pools {
  R: number[];
  V: number[];
  I: number[];
}

const POOLS: Record<Level, Pools> = {
  alapozo: {
    R: [2, 3, 4, 5, 6, 8, 10, 12, 15, 20, 24, 30, 40, 50, 60, 80, 100],
    V: [2, 4, 5, 6, 8, 10, 12, 15, 20, 24, 30, 40, 50],
    I: [0.5, 1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10],
  },
  konnyu: {
    R: [1, 2, 3, 4, 5, 6, 8, 10, 12, 15, 20, 30],
    V: [2, 4, 5, 6, 8, 10, 12, 15, 20, 24, 30],
    I: [0.5, 1, 1.5, 2, 3, 4, 5],
  },
  kozepes: {
    R: [1, 2, 3, 4, 5, 6, 8, 10, 12, 15, 20],
    V: [2, 3, 4, 5, 6, 8, 10, 12, 15, 20],
    I: [0.5, 1, 1.5, 2, 3, 4, 5],
  },
  nehez: {
    R: [1, 2, 3, 4, 5, 6, 8, 10, 12, 15],
    V: [1, 2, 3, 4, 5, 6, 8, 10, 12, 15],
    I: [1, 2, 3, 4, 5],
  },
  zh: {
    R: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
    V: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
    I: [1, 2, 3, 4, 5],
  },
};

/** Ellenállásértékek, ha egy feladatban minden ellenállás különböző értékű kell legyen: a szint készlete, utána tartalék. */
export function rCandidates(level: Level): number[] {
  return [...POOLS[level].R, ...[7, 9, 11, 14, 16, 18, 25, 22, 35, 45].filter((v) => !POOLS[level].R.includes(v))];
}

export function pickR(rng: Rng, level: Level): number {
  return rng.pick(POOLS[level].R);
}

export function pickV(rng: Rng, level: Level): number {
  return rng.pick(POOLS[level].V);
}

export function pickI(rng: Rng, level: Level): number {
  return rng.pick(POOLS[level].I);
}

/** Ohm-feladatokhoz: ellenállás akár kΩ-ban, hogy az előtagokat is gyakorolni lehessen. */
export function pickOhmR(rng: Rng): number {
  const base = rng.pick([1, 1.2, 1.5, 2.2, 3.3, 4.7, 5.6, 6.8, 10, 22, 47, 100, 220, 470]);
  return rng.chance(0.5) ? base * 1000 : base * 10;
}

/** Szabványos terhelhetőségek wattban. */
export const POWER_RATINGS = [0.125, 0.25, 0.5, 1, 2, 5, 10];
