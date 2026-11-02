import { describe, expect, it } from 'vitest';
import { dayDone, mergeProgress, streak, type ProgressData } from '../daily/progress';
import { BASE_POINTS, formatCompact, formatMult, hypeMultiplier, penalty, taskPoints, timeMultiplier, type TaskRecord } from '../daily/score';
import { TASK_MULT, fullScore, type Step } from '../daily/achievements';
import { addFriend, decodeScore, encodeScore, type League } from '../daily/share';
import { DAILY_LEVELS, dailyChallenge, dayKey, daysUntilZh, msUntilNext } from '../daily/schedule';
import { tooManySourcesInMesh } from '../generator/generate';
import { solveWith } from '../methods';
import { dailyProblem } from '../daily/problem';
import { superpositionByDividers } from '../methods/superposition';

const day = (s: string) => {
  const [y, m, d] = s.split('-').map(Number) as [number, number, number];
  return new Date(y, m - 1, d, 15, 30);
};

describe('napi kihívás: menetrend', () => {
  it('az első héten csak szuperpozíció, utána minden típusból egy', () => {
    for (const d of ['2026-11-02', '2026-11-05', '2026-11-08']) {
      const c = dailyChallenge(day(d), 'kozepes');
      expect(c.theme).toBe('Szuperpozíció hét');
      expect(c.tasks.every((t) => t.method === 'szuperpozicio')).toBe(true);
    }
    const mixed = dailyChallenge(day('2026-11-09'), 'kozepes');
    expect(mixed.theme).toBe('Vegyes nap');
    expect(new Set(mixed.tasks.map((t) => t.method))).toEqual(new Set(['redukcio', 'kirchhoff', 'hurokaram', 'csomoponti', 'szuperpozicio', 'thevenin']));
    expect(mixed.tasks).toHaveLength(7);
  });

  it('ugyanaz a nap ugyanazt adja, a következő nap mást', () => {
    const a = dailyChallenge(day('2026-11-03'), 'tryhard');
    const b = dailyChallenge(new Date(2026, 10, 3, 23, 59), 'tryhard');
    expect(b.tasks.map((t) => t.seed)).toEqual(a.tasks.map((t) => t.seed));
    expect(dailyChallenge(new Date(2026, 10, 4, 0, 0), 'tryhard').tasks[0]!.seed).not.toBe(a.tasks[0]!.seed);
  });

  it('éjfélkor vált: visszaszámlálás és ZH-ig hátralévő napok', () => {
    expect(msUntilNext(new Date(2026, 10, 2, 23, 59, 0))).toBe(60_000);
    expect(dayKey(new Date(2026, 10, 2, 23, 59, 59))).toBe('2026-11-02');
    expect(dayKey(new Date(2026, 10, 3, 0, 0, 0))).toBe('2026-11-03');
    expect(daysUntilZh(day('2026-11-02'))).toBe(14);
  });
});

describe('napi kihívás: 14 nap × 4 nehézség, minden feladat megoldható a kijelölt módszerrel', () => {
  it('generálható, egy hurokban legfeljebb egy forrás, a módszer egyezik az MNA-val', () => {
    let n = 0;
    for (let i = 0; i < 14; i++) {
      const date = new Date(2026, 10, 2 + i, 12);
      for (const lvl of DAILY_LEVELS) {
        for (const t of dailyChallenge(date, lvl.id).tasks) {
          const p = dailyProblem(t);
          expect(tooManySourcesInMesh(p.circuit)).toBe(false);
          // Szuperpozíciónál minden részáramkör csak eredővel és osztókkal megoldható (nincs csomóponti módszer).
          if (t.method === 'szuperpozicio') expect(superpositionByDividers(p), `${t.id}: részáramkör osztókkal nem oldható meg`).toBe(true);
          const r = solveWith(p, t.method);
          if (!r.ok) throw new Error(`${dayKey(date)} ${lvl.id} ${t.id}: ${r.reason}`);
          expect(r.solution.answers.length, `${t.id}: a módszer nem válaszol`).toBeGreaterThan(0);
          for (const a of r.solution.answers) {
            const q = p.questions.find((x) => x.id === a.questionId)!;
            expect(Math.abs(a.value - q.answer)).toBeLessThanOrEqual(1e-9 * Math.max(1, Math.abs(q.answer)));
          }
          n++;
        }
      }
    }
    expect(n).toBe(7 * 4 * 3 + 7 * 4 * 7);
  });
});

const rec = (minutes: number, extra: Partial<TaskRecord> = {}): TaskRecord => ({ opened: 0, solvedAt: minutes * 60_000, wrong: 0, tips: 0, trick: false, solution: false, ...extra });

describe('versenypontozás', () => {
  it('időbónusz: a célidő felén belül ×2, a kétszeresénél ×1, közte lineáris', () => {
    expect(timeMultiplier('kozepes', 0)).toBe(2);
    expect(timeMultiplier('kozepes', 3 * 60_000)).toBe(2);
    expect(timeMultiplier('kozepes', 12 * 60_000)).toBe(1);
    expect(timeMultiplier('kozepes', 60 * 60_000)).toBe(1);
    const mid = timeMultiplier('kozepes', 7.5 * 60_000);
    expect(mid).toBeGreaterThan(1);
    expect(mid).toBeLessThan(2);
  });

  it('levonások: rossz válasz, tipp, trükk-tipp; a teljes megoldás nulláz', () => {
    expect(taskPoints('tryhard', rec(1))).toBe(2 * BASE_POINTS.tryhard);
    expect(taskPoints('tryhard', rec(1, { wrong: 1 }))).toBe(Math.round(2 * 350 * 0.85));
    expect(penalty({ wrong: 10, tips: 0, trick: false })).toBeCloseTo(0.6, 12);
    expect(taskPoints('tryhard', rec(1, { tips: 2, trick: true }))).toBe(Math.round(2 * 350 * 0.5));
    expect(taskPoints('tryhard', rec(1, { solution: true }))).toBe(0);
    expect(taskPoints('tryhard', { opened: 0, wrong: 0, tips: 0, trick: false, solution: false })).toBe(0);
  });
});

describe('haladás és sorozat', () => {
  it('a nap kész, ha egy nehézségen minden feladat megoldva; a sorozat napközben nem nullázódik', () => {
    const data: ProgressData = {
      '2026-11-02': { kozepes: { a: rec(2), b: rec(2), c: rec(2) } },
      '2026-11-03': { free: { a: rec(2), b: rec(2), c: rec(2) } },
      '2026-11-04': { tryhard: { a: rec(2), b: { opened: 0, wrong: 1, tips: 0, trick: false, solution: false } } },
    };
    const count = () => 3;
    expect(dayDone(data, '2026-11-02', count)).toBe(true);
    expect(dayDone(data, '2026-11-04', count)).toBe(false);
    expect(streak(data, day('2026-11-04'), count)).toBe(2);
    expect(streak(data, day('2026-11-06'), count)).toBe(0);
  });
});

describe('szorzós pontozás és achievementek', () => {
  const at = (d: string, h: number, min: number) => new Date(`${d}T${String(h).padStart(2, '0')}:00:00`).getTime() + min * 60_000;
  const t = (d: string, h: number, min: number, extra: Partial<TaskRecord> = {}): TaskRecord => ({ opened: at(d, h, 0), solvedAt: at(d, h, min), wrong: 0, tips: 0, trick: false, solution: false, ...extra });

  it('ZH-láz ×2 naponta, a ZH napján megáll; tömör számformátum', () => {
    expect(hypeMultiplier('2026-11-02')).toBe(1);
    expect(hypeMultiplier('2026-11-03')).toBe(2);
    expect(hypeMultiplier('2026-11-16')).toBe(2 ** 14);
    expect(hypeMultiplier('2026-12-01')).toBe(2 ** 14);
    expect(formatCompact(950)).toBe('950');
    expect(formatCompact(100_000)).toBe('100k');
    expect(formatCompact(12_345)).toBe('12,3k');
    expect(formatCompact(2_500_000)).toBe('2,5M');
    expect(formatCompact(1_230_000_000)).toBe('1,23B');
    expect(formatCompact(999_999)).toBe('1M');
    expect(formatMult(1.03)).toBe('×1,03');
  });

  it('minden feladat a nehézségétől függő szorzót ad, és a következő feladat már azzal számol', () => {
    const data: ProgressData = { '2026-11-02': { free: { a: t('2026-11-02', 15, 3) }, kozepes: { a: t('2026-11-02', 16, 5) } } };
    const s = fullScore(data, new Date(2026, 10, 2, 20), () => 3);
    const [first, second] = s.steps as [Step, Step];
    expect(first.mult).toBe(1);
    expect(first.taskMult).toBe(TASK_MULT.free);
    // Első vér (×1,1) az első feladat után; a második feladat szorzója: 1,01 × 1,1.
    expect(first.unlocked).toEqual(['elso-ver']);
    expect(second.mult).toBeCloseTo(1.01 * 1.1, 12);
    expect(TASK_MULT.kozepes).toBeGreaterThan(TASK_MULT.free);
    expect(s.mult).toBeCloseTo(1.01 * 1.03 * 1.1, 12);
    expect(s.total).toBe(first.points + second.points);
  });

  it('a darabszámos achievementek szorzót adnak (10 feladat, 3 Kurva nehéz)', () => {
    const tasks: Record<string, TaskRecord> = {};
    for (let i = 0; i < 10; i++) tasks[`k${i}`] = t('2026-11-02', 8, 20 + i);
    const data: ProgressData = { '2026-11-02': { kurva: tasks } };
    const s = fullScore(data, new Date(2026, 10, 2, 22), () => 99);
    const ids = s.achievements.map((u) => u.id);
    expect(ids).toContain('kurva-3');
    expect(ids).toContain('feladat-10');
    expect(ids).toContain('kurva-10');
    const third = s.steps[2]!;
    expect(third.unlocked).toContain('kurva-3');
    const achProduct = s.achievements.reduce((p, u) => p * u.mult, 1);
    expect(s.mult).toBeCloseTo(achProduct * TASK_MULT.kurva ** 10, 9);
  });

  it('a megnézett megoldás 0 pont és nem ad szorzót', () => {
    const data: ProgressData = { '2026-11-02': { free: { a: t('2026-11-02', 15, 3, { solution: true }) } } };
    const s = fullScore(data, new Date(2026, 10, 2, 20), () => 3);
    expect(s.total).toBe(0);
    expect(s.mult).toBe(1);
  });
});

describe('pontkód', () => {
  const now = Date.now();
  const today = dayKey(new Date(now));
  const opened = now - 5 * 60_000;
  const rec = (solveMs: number): TaskRecord => ({ opened, solvedAt: opened + solveMs, wrong: 1, tips: 0, trick: false, solution: false });
  const tid = dailyChallenge(new Date(now), 'kozepes').tasks[0]!.id;

  it('oda-vissza a naplóval, a pontot a fogadó számolja; a módosított kódot elutasítja', () => {
    const data: ProgressData = { [today]: { kozepes: { [tid]: rec(3 * 60_000) } } };
    const code = encodeScore({ name: 'Levi', id: 'abc123', at: now, data });
    const back = decodeScore(code);
    expect(back.ok).toBe(true);
    if (!back.ok) return;
    expect(back.score.dropped).toBe(0);
    expect(back.score.data[today]!.kozepes![tid]!.solvedAt).toBe(Math.round(opened / 1000) * 1000 + 180_000);
    expect(decodeScore(`https://claude.ai/artifact/x#${code}`).ok).toBe(true);
    const tampered = code.replace(/\.([^.]+)\./, (_m, b: string) => `.${b.slice(0, -2)}AA.`);
    expect(decodeScore(tampered).ok).toBe(false);
    expect(decodeScore('valami').ok).toBe(false);
  });

  it('kiszűri a lehetetlen rekordokat', () => {
    const data = {
      [today]: { kozepes: { [tid]: rec(3_000), 'nincs-ilyen': rec(60_000) }, isten: { [tid]: rec(60_000) } },
      '2099-01-01': { kozepes: { [tid]: rec(60_000) } },
    } as unknown as ProgressData;
    const back = decodeScore(encodeScore({ name: 'Csaló', id: 'x', at: now, data }));
    expect(back.ok && back.score.dropped).toBe(4);
    expect(back.ok && Object.keys(back.score.data)).toEqual([]);
  });

  it('ugyanattól a játékostól az újabb kód felülírja a régit, a saját kód nem kerül be', () => {
    let l: League = { me: { name: 'Én', id: 'me' }, friends: [] };
    l = addFriend(l, { name: 'Bence', id: 'b', at: 1, data: {}, dropped: 0 });
    l = addFriend(l, { name: 'Bence', id: 'b', at: 3, data: {}, dropped: 0 });
    l = addFriend(l, { name: 'Bence', id: 'b', at: 2, data: {}, dropped: 0 });
    l = addFriend(l, { name: 'Én', id: 'me', at: 4, data: {}, dropped: 0 });
    expect(l.friends).toHaveLength(1);
    expect(l.friends[0]!.at).toBe(3);
  });
});

describe('fiókhoz kötött haladás', () => {
  it('összefésüléskor a megoldott, illetve a korábban megnyitott rekord marad', () => {
    const r = (opened: number, solvedAt?: number): TaskRecord => ({ opened, ...(solvedAt ? { solvedAt } : {}), wrong: 0, tips: 0, trick: false, solution: false });
    const server: ProgressData = { '2026-11-02': { kozepes: { a: r(100, 200), b: r(300) } } };
    const local: ProgressData = { '2026-11-02': { kozepes: { a: r(50), b: r(250, 400), c: r(10) } } };
    const m = mergeProgress(server, local);
    expect(m['2026-11-02']!.kozepes!.a!.solvedAt).toBe(200);
    expect(m['2026-11-02']!.kozepes!.b!.solvedAt).toBe(400);
    expect(m['2026-11-02']!.kozepes!.c!.opened).toBe(10);
    expect(server['2026-11-02']!.kozepes!.c).toBeUndefined();
  });
});
