import { describe, expect, it } from 'vitest';
import { streak, type ProgressData } from '../daily/progress';
import { DAILY_LEVELS, dailyChallenge, dayKey, msUntilNext } from '../daily/schedule';
import { tooManySourcesInMesh } from '../generator/generate';
import { solveWith } from '../methods';
import { dailyProblem } from '../daily/problem';
import { superpositionByDividers } from '../methods/superposition';
import { makeTask, examTasks, EXAMS } from '../tasks';
import { checkField } from '../tasks/check';
import type { AnswerField } from '../tasks/types';

const day = (s: string) => {
  const [y, m, d] = s.split('-').map(Number) as [number, number, number];
  return new Date(y, m - 1, d, 12);
};

describe('napi feladatsor: menetrend', () => {
  it('egyenáramnál minden típusból egy, szinuszosnál minden témából egy', () => {
    const dc = dailyChallenge(day('2026-11-10'), 'kozepes', 'dc');
    expect(dc.tasks.map((t) => t.dc!.method)).toEqual(['redukcio', 'redukcio', 'kirchhoff', 'hurokaram', 'csomoponti', 'szuperpozicio', 'thevenin', 'csillag-delta']);
    const ac = dailyChallenge(day('2026-11-10'), 'kozepes', 'ac');
    expect(ac.tasks.map((t) => t.ac!.topic)).toEqual(['ac-impedancia', 'ac-fazor', 'ac-teljesitmeny', 'ac-helyettesito', 'ac-rezonancia', 'tranziens']);
  });

  it('ugyanaz a nap ugyanazt adja, a következő nap mást', () => {
    const a = dailyChallenge(day('2026-11-05'), 'nehez').tasks.map((t) => t.seed);
    const b = dailyChallenge(day('2026-11-05'), 'nehez').tasks.map((t) => t.seed);
    const c = dailyChallenge(day('2026-11-06'), 'nehez').tasks.map((t) => t.seed);
    expect(a).toEqual(b);
    expect(a).not.toEqual(c);
  });

  it('éjfélkor vált', () => {
    expect(msUntilNext(new Date(2026, 10, 2, 23, 59, 0))).toBe(60_000);
    expect(dayKey(new Date(2026, 10, 3, 0, 0, 0))).toBe('2026-11-03');
  });
});

describe('napi feladatsor: 10 nap × 4 nehézség, minden feladat megoldható a kijelölt módszerrel', () => {
  it('egyenáram: egy hurokban legfeljebb egy forrás, a módszer egyezik az MNA-val', () => {
    let n = 0;
    for (let i = 0; i < 10; i++) {
      const date = new Date(2026, 10, 2 + i, 12);
      for (const lvl of DAILY_LEVELS) {
        for (const t of dailyChallenge(date, lvl.id, 'dc').tasks) {
          const p = dailyProblem(t);
          expect(tooManySourcesInMesh(p.circuit)).toBe(false);
          // Szuperpozíciónál minden részáramkör csak eredővel és osztókkal megoldható (nincs csomóponti módszer).
          if (t.dc!.method === 'szuperpozicio') expect(superpositionByDividers(p), `${t.id}: részáramkör osztókkal nem oldható meg`).toBe(true);
          const r = solveWith(p, t.dc!.method);
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
    expect(n).toBe(10 * 4 * 8);
  });

  it('szinuszos: minden napi feladat elkészül, van levezetése', () => {
    for (let i = 0; i < 10; i++)
      for (const lvl of DAILY_LEVELS)
        for (const t of dailyChallenge(new Date(2026, 10, 2 + i, 12), lvl.id, 'ac').tasks) {
          const task = makeTask({ domain: 'ac', topic: t.ac!.topic, level: t.ac!.level, seed: t.seed });
          expect(task.solution!.steps.length).toBeGreaterThan(1);
          expect(task.questions[0]!.fields.length).toBeGreaterThan(0);
        }
  });
});

describe('próbavizsga', () => {
  it('minden fajtából elkészül a feladatsor, és ugyanaz a seed ugyanazt adja', () => {
    for (const e of EXAMS)
      for (let i = 0; i < 6; i++) {
        const a = examTasks(e.kind, `V${i}`);
        const b = examTasks(e.kind, `V${i}`);
        expect(a.length).toBeGreaterThanOrEqual(5);
        expect(a.map((t) => t.title)).toEqual(b.map((t) => t.title));
        for (const t of a) expect(t.questions.length).toBeGreaterThan(0);
      }
  });
});

describe('válaszellenőrzés', () => {
  const f = (x: Partial<AnswerField>): AnswerField => ({ id: 'x', label: 'x', unit: 'V', answer: 0.5, ...x });
  it('szög: ±1° és 360°-onként ugyanaz', () => {
    const p = f({ unit: '°', kind: 'phase', answer: -116.6 });
    expect(checkField('-116,6', p).status).toBe('correct');
    expect(checkField('243,4°', p).status).toBe('correct');
    expect(checkField('-118', p).status).toBe('wrong');
  });
  it('kompenzáló elem: a mértékegység dönti el a fajtát', () => {
    const c = f({ unit: 'F', kind: 'element', element: 'C', answer: 169e-9 });
    expect(checkField('169 nF', c).status).toBe('correct');
    expect(checkField('0,169 µF', c).status).toBe('correct');
    expect(checkField('169 mH', c).status).toBe('wrong-element');
    expect(checkField('169', c).status).toBe('invalid');
  });
  it('új mértékegységek: mvar, mVA, µs, rad/s', () => {
    expect(checkField('34,2 mvar', f({ unit: 'var', answer: 0.0342 })).status).toBe('correct');
    expect(checkField('0,125 mVA', f({ unit: 'VA', answer: 0.125e-3 })).status).toBe('correct');
    expect(checkField('37,5 µs', f({ unit: 's', answer: 37.5e-6 })).status).toBe('correct');
    expect(checkField('4000 rad/s', f({ unit: 'rad/s', answer: 4000 })).status).toBe('correct');
    expect(checkField('4 k', f({ unit: 'rad/s', answer: 4000 })).status).toBe('correct');
  });
});

describe('sorozat', () => {
  it('egymás utáni napok, amelyeken legalább egy feladat kész', () => {
    const data: ProgressData = { '2026-11-04': { 'dc|kozepes': { a: { at: 1 } } }, '2026-11-05': { 'ac|nehez': { b: { at: 2 } } } };
    const keyOf = (today: string) => (offset: number) => dayKey(new Date(day(today).getTime() - offset * 86_400_000));
    expect(streak(data, '2026-11-05', keyOf('2026-11-05'))).toBe(2);
    expect(streak(data, '2026-11-06', keyOf('2026-11-06'))).toBe(2);
    expect(streak(data, '2026-11-08', keyOf('2026-11-08'))).toBe(0);
  });
});
