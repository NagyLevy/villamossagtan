// A napi kihívás haladása (időmérés, hibák, tippek) és a sorozat. Böngészőben tárolva.

import type { DayRecords, TaskRecord } from './score';
import { dayKey, type DailyLevel } from './schedule';

/** nap → nehézség → feladat → rekord. */
export type ProgressData = Record<string, DayRecords>;

// v3: a Start gomb bevezetésekor mindenki haladása egyszer nullázódott (a régi óra magától indult).
const KEY = 'villamossagtan.daily.v3';
let memory: ProgressData = {};
try {
  localStorage.removeItem('villamossagtan.daily.v2');
  localStorage.removeItem('villamossagtan.ach.seen');
} catch {
  // A tárolás nem kötelező.
}

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

/** A feladat rekordja; első megnyitáskor létrejön, és innen indul az óra (újratöltés nem nullázza). */
export function openTask(day: string, lvl: DailyLevel, task: string, now = Date.now()): TaskRecord {
  const data = loadProgress();
  const l = ((data[day] ??= {})[lvl] ??= {});
  if (!l[task]) {
    l[task] = { opened: now, wrong: 0, tips: 0, trick: false, solution: false };
    save(data);
  }
  return l[task]!;
}

export type TaskEvent = 'wrong' | 'tip' | 'trick' | 'solution' | 'solved';

/** Esemény rögzítése egy feladaton. Megoldás után már semmi sem változtat rajta. */
export function recordEvent(day: string, lvl: DailyLevel, task: string, ev: TaskEvent, now = Date.now()): TaskRecord {
  const data = loadProgress();
  const l = ((data[day] ??= {})[lvl] ??= {});
  const r = (l[task] ??= { opened: now, wrong: 0, tips: 0, trick: false, solution: false });
  if (r.solvedAt) return r;
  if (ev === 'wrong') r.wrong++;
  if (ev === 'tip') r.tips++;
  if (ev === 'trick') r.trick = true;
  if (ev === 'solution') r.solution = true;
  if (ev === 'solved') r.solvedAt = now;
  save(data);
  return r;
}

/** Egy nap kész, ha valamelyik nehézségen az összes feladat meg van oldva. */
export function dayDone(data: ProgressData, day: string, taskCount: (lvl: DailyLevel) => number): boolean {
  const d = data[day];
  if (!d) return false;
  return (Object.keys(d) as DailyLevel[]).some((lvl) => {
    const n = taskCount(lvl);
    return n > 0 && Object.values(d[lvl] ?? {}).filter((r) => r.solvedAt).length >= n;
  });
}

export function prevDay(key: string): string {
  const [y, m, d] = key.split('-').map(Number) as [number, number, number];
  return dayKey(new Date(y, m - 1, d - 1));
}

/** Sorozat a megadott napig bezárólag (ha az a nap nincs kész, az előző naptól számol). */
export function streakAt(data: ProgressData, key: string, taskCount: (day: string, lvl: DailyLevel) => number): number {
  let k = key;
  if (!dayDone(data, k, (l) => taskCount(k, l))) k = prevDay(k);
  let count = 0;
  for (let guard = 0; guard < 400 && dayDone(data, k, (l) => taskCount(k, l)); guard++) {
    count++;
    k = prevDay(k);
  }
  return count;
}

export function streak(data: ProgressData, today: Date, taskCount: (day: string, lvl: DailyLevel) => number): number {
  return streakAt(data, dayKey(today), taskCount);
}
