// Egyenáramú próbavizsga: 5 véletlen, különböző típusú feladat a közös készletből; mindegyikhez van
// előírt módszer, amely a feladat minden kérdésére választ ad.
import { describe, expect, it } from 'vitest';
import { solveWith } from '../methods';
import { prescribedMethod } from '../methods/fit';
import { EXAMS, examTasks } from '../tasks';

describe('egyenáramú próbavizsga: véletlen sor a közös készletből', () => {
  it('5 feladat, változatos típusok, az előírt módszer megoldja', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 40; i++) {
      const ts = examTasks('dc', `EP${i}`);
      expect(ts).toHaveLength(5);
      for (const t of ts) {
        const p = t.dc!;
        seen.add(`${p.topic}/${p.teacherType ?? ''}`);
        const m = prescribedMethod(p);
        const r = solveWith(p, m);
        if (!r.ok) throw new Error(`EP${i} ${p.topic}: ${r.reason}`);
        const answered = new Set(r.solution.answers.map((a) => a.questionId));
        for (const q of p.questions) if (q.kind !== 'table') expect(answered.has(q.id), `EP${i} ${p.topic} ${m}`).toBe(true);
      }
    }
    // A készlet mindkét korábbi sor típusait adja (tanári típusok is).
    expect(seen.size).toBeGreaterThanOrEqual(10);
  });

  it('a választóban nincs külön „tanári formátum”, a váltóáramú vizsga neve Váltóáram', () => {
    expect(EXAMS.map((e) => e.kind)).toEqual(['dc', 'ac', 'vegyes']);
    expect(EXAMS.find((e) => e.kind === 'ac')!.name).toBe('Váltóáram');
    for (const e of EXAMS) expect(`${e.name} ${e.description}`).not.toMatch(/szinuszos|tanári formátum/i);
  });
});

describe('egyenáramú próbavizsga előre választott módszerrel', () => {
  it('minden módszerre 5 feladat jön, és a módszer mindegyik minden kérdésére választ ad', async () => {
    const { EXAM_METHODS } = await import('../tasks');
    const { methodCovers } = await import('../methods/fit');
    for (const m of EXAM_METHODS)
      for (let i = 0; i < 6; i++) {
        const ts = examTasks('dc', `EM${i}`, m);
        expect(ts).toHaveLength(5);
        for (const t of ts) expect(methodCovers(t.dc!, m), `${m} EM${i} ${t.dc!.topic}`).toBe(true);
        // Ugyanaz a seed ugyanazt a sort adja.
        expect(examTasks('dc', `EM${i}`, m).map((t) => t.seed)).toEqual(ts.map((t) => t.seed));
      }
  });
});

describe('a tanár úr feladattípusai nem külön témakör', () => {
  it('a vizsgafeladatok témaköre a tartalmuk szerinti (többforrásos, helyettesítő generátor)', () => {
    const names = new Set<string>();
    for (let i = 0; i < 30; i++) for (const t of examTasks('dc', `TN${i}`)) names.add(t.topicName);
    for (const m of ['hurokaram', 'csomoponti', 'szuperpozicio', 'thevenin'] as const) for (const t of examTasks('dc', 'TN', m)) names.add(t.topicName);
    expect([...names].some((n) => /tanár/i.test(n))).toBe(false);
    expect(names.has('Többforrásos hálózatok')).toBe(true);
    expect([...names].some((n) => n.startsWith('Helyettesítő generátorok'))).toBe(true);
  });
});
