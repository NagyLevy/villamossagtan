// A napi feladatsor haladása a böngészőben (localStorage): melyik feladat van kész, mennyi idő alatt.
// Pontozás nincs; ha a tároló nem elérhető, a haladás csak az oldal újratöltéséig él.

import type { Domain } from '../tasks/types';
import type { DailyLevel } from './schedule';

export interface DoneRecord {
  /** Mikor lett kész (ms). */
  at: number;
  /** Mennyi ideig tartott (másodperc), ha mértük. */
  seconds?: number;
}

/** nap → "terület|nehézség" → feladat → rekord */
export type ProgressData = Record<string, Record<string, Record<string, DoneRecord>>>;

const KEY = 'villamossagtan.napi.v2';
let memory: ProgressData = {};

export function loadProgress(): ProgressData {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) memory = JSON.parse(raw) as ProgressData;
  } catch {
    // A tárolás nem kötelező.
  }
  return memory;
}

function save(data: ProgressData): void {
  memory = data;
  try {
    localStorage.setItem(KEY, JSON.stringify(data));
  } catch {
    // A tárolás nem kötelező.
  }
}

export const bucketKey = (domain: Domain, level: DailyLevel) => `${domain}|${level}`;

export function isDone(day: string, domain: Domain, level: DailyLevel, taskId: string): DoneRecord | undefined {
  return loadProgress()[day]?.[bucketKey(domain, level)]?.[taskId];
}

export function markDone(day: string, domain: Domain, level: DailyLevel, taskId: string, seconds?: number): void {
  const data = loadProgress();
  const bucket = ((data[day] ??= {})[bucketKey(domain, level)] ??= {});
  if (!bucket[taskId]) bucket[taskId] = { at: Date.now(), ...(seconds !== undefined ? { seconds } : {}) };
  save(data);
}

/** Hány nap egymás után (mától visszafelé) van legalább egy kész feladat. Ma még nem kell késznek lennie. */
export function streak(data: ProgressData, today: string, dayKeys: (offset: number) => string): number {
  const any = (d: string) => Object.values(data[d] ?? {}).some((b) => Object.keys(b).length > 0);
  let n = any(today) ? 1 : 0;
  for (let i = 1; i < 400; i++) {
    if (!any(dayKeys(i))) break;
    n++;
  }
  return n;
}
