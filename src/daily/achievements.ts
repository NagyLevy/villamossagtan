// Szorzós pontmodell és achievementek. A haladásból (tiszta függvény) számolva, így a barát
// pontkódjából is ugyanígy újraszámolható.
//
// A megoldott feladatokat időrendben "lejátsszuk":
//   pont = alappont × időbónusz × (1 − levonás) × sorozat × ZH-láz × a szorzód abban a pillanatban,
// majd a feladat maga is növeli a szorzót (nehézség szerint), és az ekkor teljesülő
// achievementek is ráteszik a saját szorzójukat. Minden achievement szorzót ad.

import { prevDay, type ProgressData } from './progress';
import { BASE_POINTS, PAR_MINUTES, hypeMultiplier, penalty, streakMultiplier, timeMultiplier, type TaskRecord } from './score';
import { MIXED_FROM, START_DAY, ZH_DAY, dayKey, daysBetween, type DailyLevel } from './schedule';

/** Minden megoldott feladat ennyivel növeli a szorzót, nehézség szerint. */
export const TASK_MULT: Record<DailyLevel, number> = { free: 1.01, kozepes: 1.03, tryhard: 1.06, kurva: 1.1 };

type Solved = TaskRecord & { solvedAt: number; lvl: DailyLevel; day: string; task: string };

/** A lejátszás állapota egy adott pillanatban (az achievementek ezt nézik). */
export interface Ctx {
  /** Az aktuális feladat napja és az aznap eddig megoldottak. */
  day: string;
  daySolved: Solved[];
  /** Aznap teljesített fokozatok; van-e köztük hiba, tipp és trükk nélküli. */
  complete: Set<DailyLevel>;
  cleanComplete: boolean;
  /** Összesen megoldott feladatok, fokozatonként is. */
  solved: number;
  counts: Record<DailyLevel, number>;
  /** A leghosszabb tiszta megoldássorozat eddig. */
  bestClean: number;
  doneDays: Set<string>;
  /** Sorozat a mai nappal együtt (ha ma kész). */
  streak: number;
  total: number;
}

export interface Achievement {
  id: string;
  name: string;
  desc: string;
  /** Ennyivel szorozza meg a szorzódat (véglegesen). */
  mult: number;
  check(c: Ctx): boolean;
  /** Számlálós achievementnél: [jelenlegi, cél]. */
  progress?(c: Ctx): [number, number];
}

const dur = (s: Solved) => s.solvedAt - s.opened;
const par = (s: Solved) => PAR_MINUTES[s.lvl] * 60_000;
const hour = (s: Solved) => new Date(s.solvedAt).getHours();
const isClean = (t: TaskRecord) => !!t.solvedAt && !t.solution && !t.wrong && !t.tips && !t.trick;

const shift = (key: string, n: number) => {
  const [y, m, d] = key.split('-').map(Number) as [number, number, number];
  return dayKey(new Date(y, m - 1, d + n));
};
const SUPER_DAYS = Array.from({ length: daysBetween(START_DAY, MIXED_FROM) }, (_, i) => shift(START_DAY, i));
const ZH_EVE = shift(ZH_DAY, -1);

const count = (id: string, name: string, n: number, lvl: DailyLevel | null, mult: number, what: string): Achievement => ({
  id,
  name,
  desc: `${n} megoldott ${what}.`,
  mult,
  check: (c) => (lvl ? c.counts[lvl] : c.solved) >= n,
  progress: (c) => [Math.min(n, lvl ? c.counts[lvl] : c.solved), n],
});

export const ACHIEVEMENTS: Achievement[] = [
  // Darabszám: a lényeg. Minél nehezebb a fokozat, annál kevesebb kell és annál többet ad.
  count('feladat-10', 'Tízes', 10, null, 1.5, 'napi feladat'),
  count('feladat-25', 'Negyedszázad', 25, null, 2, 'napi feladat'),
  count('feladat-50', 'Ötvenes', 50, null, 3, 'napi feladat'),
  count('feladat-100', 'Százas', 100, null, 5, 'napi feladat'),
  count('free-10', 'Bemelegítés', 10, 'free', 1.25, 'Free elo feladat'),
  count('free-25', 'Free elo veterán', 25, 'free', 1.5, 'Free elo feladat'),
  count('kozepes-10', 'Közepesen veszélyes', 10, 'kozepes', 1.5, 'Közepes feladat'),
  count('kozepes-25', 'Közepes mester', 25, 'kozepes', 2, 'Közepes feladat'),
  count('tryhard-5', 'Tryhard', 5, 'tryhard', 1.75, 'Tryhard feladat'),
  count('tryhard-15', 'Izzadságszag', 15, 'tryhard', 2.5, 'Tryhard feladat'),
  count('kurva-3', 'Kurva jó', 3, 'kurva', 2, 'Kurva nehéz feladat'),
  count('kurva-10', 'Kurva nagy arc', 10, 'kurva', 4, 'Kurva nehéz feladat'),
  // Ügyesség és kitartás.
  { id: 'elso-ver', name: 'Első vér', desc: 'Az első napi feladat.', mult: 1.1, check: (c) => c.solved >= 1 },
  { id: 'villam', name: 'Villám', desc: 'Egy feladat a célidő negyedén belül.', mult: 1.3, check: (c) => c.daySolved.some((s) => dur(s) <= par(s) / 4) },
  { id: 'villamhaboru', name: 'Villámháború', desc: 'Egy napon öt feladat a célidő felén belül.', mult: 1.5, check: (c) => c.daySolved.filter((s) => dur(s) <= par(s) / 2).length >= 5 },
  { id: 'feltamadas', name: 'Feltámadás', desc: 'Három rossz válasz után mégis megoldod.', mult: 1.1, check: (c) => c.daySolved.some((s) => s.wrong >= 3) },
  { id: 'ejfeli-lovas', name: 'Éjféli lovas', desc: 'Megoldás éjfél és hajnali 1 között.', mult: 1.15, check: (c) => c.daySolved.some((s) => hour(s) === 0) },
  { id: 'koran-kelo', name: 'Korán kelő', desc: 'Megoldás hajnali 4 és reggel 7 között.', mult: 1.15, check: (c) => c.daySolved.some((s) => hour(s) >= 4 && hour(s) < 7) },
  { id: 'hibatlan', name: 'Hibátlan nap', desc: 'Egy fokozat minden feladata hiba, tipp és trükk nélkül.', mult: 1.5, check: (c) => c.cleanComplete },
  { id: 'perfekcionista', name: 'Perfekcionista', desc: '10 tiszta megoldás egymás után.', mult: 2, check: (c) => c.bestClean >= 10, progress: (c) => [Math.min(10, c.bestClean), 10] },
  { id: 'grand-slam', name: 'Grand slam', desc: 'Egy napon mind a négy fokozat kész.', mult: 2.5, check: (c) => c.complete.size >= 4, progress: (c) => [c.complete.size, 4] },
  { id: 'lango', name: 'Lángoló', desc: '3 napos sorozat.', mult: 1.3, check: (c) => c.streak >= 3, progress: (c) => [Math.min(3, c.streak), 3] },
  { id: 'megallithatatlan', name: 'Megállíthatatlan', desc: '7 napos sorozat.', mult: 2, check: (c) => c.streak >= 7, progress: (c) => [Math.min(7, c.streak), 7] },
  { id: 'ket-het-pokol', name: 'Két hét pokol', desc: '14 napos sorozat.', mult: 5, check: (c) => c.streak >= 14, progress: (c) => [Math.min(14, c.streak), 14] },
  { id: 'szuper-mester', name: 'Szuperpozíció-mester', desc: 'A szuperpozíciós hét mind a 7 napja kész.', mult: 3, check: (c) => SUPER_DAYS.every((x) => c.doneDays.has(x)), progress: (c) => [SUPER_DAYS.filter((x) => c.doneDays.has(x)).length, SUPER_DAYS.length] },
  { id: 'zh-kesz', name: 'ZH-kész', desc: 'A ZH előtti nap Tryhard vagy Kurva nehéz fokozaton kész.', mult: 5, check: (c) => c.day === ZH_EVE && (c.complete.has('tryhard') || c.complete.has('kurva')) },
  { id: 'milliomos', name: 'Milliomos', desc: 'Átléped az 1M pontot.', mult: 1.5, check: (c) => c.total >= 1e6 },
  { id: 'milliardos', name: 'Milliárdos', desc: 'Átléped az 1B pontot.', mult: 2, check: (c) => c.total >= 1e9 },
];

export interface Unlocked {
  id: string;
  day: string;
  at: number;
  mult: number;
}

/** Egy megoldás pontjának teljes levezetése (ezt játssza le az animáció). */
export interface Step {
  day: string;
  lvl: DailyLevel;
  task: string;
  at: number;
  base: number;
  time: number;
  /** Levonás aránya (0..1). */
  penalty: number;
  streak: number;
  hype: number;
  /** A szorzód a megoldás pillanatában. */
  mult: number;
  points: number;
  /** A feladat saját szorzója (nehézség szerint). */
  taskMult: number;
  /** Az ezzel a megoldással feloldott achievementek. */
  unlocked: string[];
  multAfter: number;
  totalAfter: number;
}

export interface FullScore {
  total: number;
  /** nap → a nap feladatainak pontja. */
  perDay: Record<string, number>;
  /** Jelenlegi sorozat (ma vagy tegnap végződő). */
  streak: number;
  /** A jelenlegi szorzó (feladatok × achievementek). */
  mult: number;
  /** Ebből a feladatok része. */
  taskMult: number;
  achievements: Unlocked[];
  steps: Step[];
  ctx: Ctx;
  doneDays: string[];
}

/** Egymás utáni kész napok, amelyek a megadott nap ELŐTT végződnek. */
export function streakBefore(doneDays: Set<string>, day: string): number {
  let n = 0;
  for (let k = prevDay(day); doneDays.has(k) && n < 400; k = prevDay(k)) n++;
  return n;
}

/** A teljes pontszám a haladás lejátszásával. */
export function fullScore(data: ProgressData, today: Date, taskCount: (day: string, lvl: DailyLevel) => number): FullScore {
  const todayKey = dayKey(today);
  const all: Solved[] = [];
  for (const [day, levels] of Object.entries(data)) {
    if (daysBetween(day, todayKey) < 0) continue;
    for (const [lvl, tasks] of Object.entries(levels ?? {}) as [DailyLevel, Record<string, TaskRecord>][])
      for (const [task, r] of Object.entries(tasks ?? {})) if (r.solvedAt && !r.solution) all.push({ ...r, solvedAt: r.solvedAt, lvl, day, task });
  }
  all.sort((a, b) => a.solvedAt - b.solvedAt);

  const ctx: Ctx = { day: todayKey, daySolved: [], complete: new Set(), cleanComplete: false, solved: 0, counts: { free: 0, kozepes: 0, tryhard: 0, kurva: 0 }, bestClean: 0, doneDays: new Set(), streak: 0, total: 0 };
  const perDay: Record<string, number> = {};
  const unlocked: Unlocked[] = [];
  const steps: Step[] = [];
  const byDay = new Map<string, Solved[]>();
  let achMult = 1;
  let taskMult = 1;
  let clean = 0;

  for (const s of all) {
    const mult = achMult * taskMult;
    const time = timeMultiplier(s.lvl, dur(s));
    const pen = penalty(s);
    const streak = streakMultiplier(streakBefore(ctx.doneDays, s.day) + 1);
    const hype = hypeMultiplier(s.day);
    const points = Math.round(BASE_POINTS[s.lvl] * time * (1 - pen) * streak * hype * mult);
    ctx.total += points;
    perDay[s.day] = (perDay[s.day] ?? 0) + points;
    taskMult *= TASK_MULT[s.lvl];

    // Állapot frissítése a megoldás után.
    const list = byDay.get(s.day) ?? [];
    list.push(s);
    byDay.set(s.day, list);
    ctx.day = s.day;
    ctx.daySolved = list;
    ctx.solved++;
    ctx.counts[s.lvl]++;
    clean = isClean(s) ? clean + 1 : 0;
    ctx.bestClean = Math.max(ctx.bestClean, clean);
    ctx.complete = new Set();
    ctx.cleanComplete = false;
    for (const lvl of Object.keys(ctx.counts) as DailyLevel[]) {
      const mine = list.filter((x) => x.lvl === lvl);
      if (mine.length >= taskCount(s.day, lvl)) {
        ctx.complete.add(lvl);
        if (mine.every(isClean)) ctx.cleanComplete = true;
      }
    }
    if (ctx.complete.size) ctx.doneDays.add(s.day);
    ctx.streak = ctx.doneDays.has(s.day) ? streakBefore(ctx.doneDays, s.day) + 1 : 0;

    const newly: string[] = [];
    for (const a of ACHIEVEMENTS) {
      if (unlocked.some((u) => u.id === a.id) || !a.check(ctx)) continue;
      unlocked.push({ id: a.id, day: s.day, at: s.solvedAt, mult: a.mult });
      achMult *= a.mult;
      newly.push(a.id);
    }
    steps.push({ day: s.day, lvl: s.lvl, task: s.task, at: s.solvedAt, base: BASE_POINTS[s.lvl], time, penalty: pen, streak, hype, mult, points, taskMult: TASK_MULT[s.lvl], unlocked: newly, multAfter: achMult * taskMult, totalAfter: ctx.total });
  }

  // Jelenlegi sorozat: ma végződik, ha ma kész, különben tegnap.
  const current = ctx.doneDays.has(todayKey) ? streakBefore(ctx.doneDays, todayKey) + 1 : streakBefore(ctx.doneDays, todayKey);
  return { total: ctx.total, perDay, streak: current, mult: achMult * taskMult, taskMult, achievements: unlocked, steps, ctx: { ...ctx, streak: current }, doneDays: [...ctx.doneDays] };
}

/** Ennyit érne most a feladat a teljes szorzóval (élő kijelzéshez). */
export function projectedFull(score: FullScore, day: string, lvl: DailyLevel, rec: TaskRecord | undefined, now = Date.now()): number {
  if (rec?.solution) return 0;
  const time = rec ? timeMultiplier(lvl, (rec.solvedAt ?? now) - rec.opened) : 2;
  const pen = rec ? penalty(rec) : 0;
  const streak = streakMultiplier(streakBefore(new Set(score.doneDays), day) + 1);
  return Math.round(BASE_POINTS[lvl] * time * (1 - pen) * streak * hypeMultiplier(day) * score.mult);
}

const cache = new Map<string, FullScore>();

/** Ugyanaz, mint a `fullScore` mára, de változatlan naplóra nem számol újra (a sáv másodpercenként kérdezi). */
export function cachedScore(data: ProgressData, taskCount: (day: string, lvl: DailyLevel) => number): FullScore {
  const now = new Date();
  const key = `${dayKey(now)}|${JSON.stringify(data)}`;
  let s = cache.get(key);
  if (!s) {
    s = fullScore(data, now, taskCount);
    if (cache.size > 40) cache.clear();
    cache.set(key, s);
  }
  return s;
}
