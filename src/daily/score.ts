// Versenypontozás a napi kihíváshoz. Tiszta függvények (tesztelhetők).
//
//  - Alappont nehézség szerint, időbónusz (a célidő felén belül ×2, a célidő kétszeresénél ×1),
//  - levonás: rossz válasz −15% (legfeljebb −60%), tipp-lépés −20%, trükk-tipp −10%,
//    a teljes megoldás megnézése nullázza a feladatot,
//  - a nap pontja a legjobb nehézségé, +20% ha a nap minden feladata kész,
//  - sorozatszorzó: minden egymás utáni nap +5%, legfeljebb +50%.

import { START_DAY, ZH_DAY, daysBetween, type DailyLevel } from './schedule';

export interface TaskRecord {
  /** Az első megnyitás ideje (ms) — innen indul az óra. */
  opened: number;
  /** A helyes megoldás ideje (ms), ha megvan. */
  solvedAt?: number;
  wrong: number;
  /** Felfedett tipp-lépések száma. */
  tips: number;
  trick: boolean;
  /** A teljes megoldást megnézte a megoldás előtt. */
  solution: boolean;
}

export const BASE_POINTS: Record<DailyLevel, number> = { free: 100, kozepes: 200, tryhard: 350, kurva: 600 };
/** Célidő feladatonként, percben. */
export const PAR_MINUTES: Record<DailyLevel, number> = { free: 4, kozepes: 6, tryhard: 10, kurva: 15 };

/** Időszorzó: a célidő felén belül 2, onnan lineárisan csökken, a célidő kétszeresétől 1. */
export function timeMultiplier(lvl: DailyLevel, ms: number): number {
  const par = PAR_MINUTES[lvl] * 60_000;
  const t = Math.max(0, ms);
  if (t <= par / 2) return 2;
  if (t >= 2 * par) return 1;
  return 2 - (t - par / 2) / (1.5 * par);
}

/** Levonások aránya (0..1). */
export function penalty(rec: Pick<TaskRecord, 'wrong' | 'tips' | 'trick'>): number {
  const p = Math.min(0.6, 0.15 * rec.wrong) + 0.2 * rec.tips + (rec.trick ? 0.1 : 0);
  return Math.min(1, p);
}

/** Egy feladat pontja (0, ha nincs megoldva vagy a teljes megoldást előre megnézte). */
export function taskPoints(lvl: DailyLevel, rec: TaskRecord | undefined): number {
  if (!rec?.solvedAt || rec.solution) return 0;
  return Math.round(BASE_POINTS[lvl] * timeMultiplier(lvl, rec.solvedAt - rec.opened) * (1 - penalty(rec)));
}

/** Ennyit érne a feladat, ha most oldanád meg (élő kijelzéshez). */
export function projectedPoints(lvl: DailyLevel, rec: TaskRecord | undefined, now = Date.now()): number {
  if (!rec) return Math.round(BASE_POINTS[lvl] * 2);
  if (rec.solution) return 0;
  const end = rec.solvedAt ?? now;
  return Math.round(BASE_POINTS[lvl] * timeMultiplier(lvl, end - rec.opened) * (1 - penalty(rec)));
}

export type DayRecords = Partial<Record<DailyLevel, Record<string, TaskRecord>>>;

/** Sorozatszorzó a nap sorozathossza szerint (az aznapi nappal együtt). */
export function streakMultiplier(streakDays: number): number {
  return 1 + 0.05 * Math.min(10, Math.max(0, streakDays - 1));
}

/** ZH-láz: minden nap ×2 a kezdéshez képest (a ZH napjáig nő). Így a hajrá napjai érnek a legtöbbet. */
export const HYPE_BASE = 2;

export function hypeMultiplier(day: string): number {
  const i = Math.min(daysBetween(START_DAY, ZH_DAY), Math.max(0, daysBetween(START_DAY, day)));
  return HYPE_BASE ** i;
}

const SUFFIXES: [number, string][] = [[1e15, 'Qa'], [1e12, 'T'], [1e9, 'B'], [1e6, 'M'], [1e3, 'k']];

/** Tömör szám: 950, 12,3k, 100k, 2,5M, 1,2B, 3T (legfeljebb 3 értékes jegy). */
export function formatCompact(n: number): string {
  const a = Math.abs(n);
  for (const [v, suf] of SUFFIXES) {
    if (a >= v * 0.9995) {
      const x = n / v;
      const digits = Math.abs(x) >= 100 ? 0 : Math.abs(x) >= 10 ? 1 : 2;
      return `${Number(x.toFixed(digits)).toLocaleString('hu-HU', { maximumFractionDigits: digits })}${suf}`;
    }
  }
  return a < 10 && !Number.isInteger(n) ? n.toLocaleString('hu-HU', { maximumFractionDigits: 2 }) : Math.round(n).toLocaleString('hu-HU');
}

export const formatPoints = formatCompact;

/** Szorzó: ×1,03, ×12,5, ×1,2k. */
export const formatMult = (x: number) => `×${formatCompact(x)}`;
