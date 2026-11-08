import { describe, expect, it } from 'vitest';
import { generateProblem, TEACHER_TYPES } from '../generator/generate';
import { methodFit } from '../methods/fit';
import type { Level } from '../generator/values';
import { solveWith } from '../methods';
import { solveThevenin } from '../methods/thevenin';

// A tanár úr füzetének menete: Rg üresjárásban, Uü osztókkal (forrásonként, iránnyal), In = Uü / Rg, Pmax.
describe('helyettesítő generátor a tanár úr módszerével', () => {
  it('Uü legtöbbször osztókkal, Pmax = Uü² / (4 Rg), és a válasz egyezik az MNA-val', () => {
    let total = 0;
    let byDividers = 0;
    for (const level of ['alapozo', 'konnyu', 'kozepes', 'nehez'] as Level[])
      for (let i = 0; i < 40; i++) {
        const p = generateProblem({ seed: `TC${i}`, topic: 'thevenin', level });
        const r = solveThevenin(p);
        if (!r.ok) throw new Error(r.reason);
        total++;
        if (!r.solution.steps.some((s) => s.title === 'Üresjárás')) byDividers++;
        for (const a of r.solution.answers) {
          const q = p.questions.find((x) => x.id === a.questionId)!;
          expect(a.value).toBeCloseTo(q.answer, 9);
        }
        expect(p.questions.some((q) => q.kind === 'Pmax')).toBe(true);
        expect(r.solution.steps.some((s) => s.title === 'Maximális teljesítmény')).toBe(true);
      }
    expect(byDividers / total).toBeGreaterThan(0.9);
  });

  it('szuperpozíció a Thevenin-témakörben: részfeszültségek (A→B / B→A) és előjeles összeg', () => {
    let n = 0;
    for (let i = 0; i < 60; i++) {
      const p = generateProblem({ seed: `TS${i}`, topic: 'thevenin', level: 'kozepes' });
      const r = solveWith(p, 'szuperpozicio');
      if (!r.ok) continue;
      n++;
      const steps = r.solution.steps;
      expect(steps.some((s) => s.title.startsWith('Részfeszültség'))).toBe(true);
      const sum = steps.find((s) => s.title === 'Összegzés')!;
      expect(sum.note).toMatch(/A→B|B→A/);
      expect(JSON.stringify(steps)).not.toMatch(/Csomóponti egyenlet/);
    }
    expect(n).toBeGreaterThan(10);
  });
});

describe('a tanár úr feladattípusai (generátor)', () => {
  const types = TEACHER_TYPES;
  for (const type of types)
    it(`${type}: generálható, a saját módszere megoldja, eredmény = MNA`, () => {
      for (const level of ['kozepes', 'nehez'] as Level[])
        for (let i = 0; i < 15; i++) {
          const p = generateProblem({ seed: `TT${type}${i}`, topic: 'tanari', level, teacherType: type });
          expect(p.teacherType).toBe(type);
          expect(methodFit(type, p).ok).toBe(true);
          const r = solveWith(p, type);
          if (!r.ok) throw new Error(`${type} ${level} ${i}: ${r.reason}`);
          for (const q of p.questions) {
            const a = r.solution.answers.find((x) => x.questionId === q.id);
            expect(a, `${type} ${q.kind}`).toBeDefined();
            expect(a!.value).toBeCloseTo(q.answer, 8);
          }
          const text = JSON.stringify(r.solution.steps);
          if (type === 'hurokaram') expect(text).toMatch(/saját, ismert hurka/);
          if (type === 'csomoponti') expect(r.solution.steps.filter((s) => s.title.startsWith('Csomóponti egyenlet')).length).toBeGreaterThanOrEqual(1);
          if (type === 'szuperpozicio') expect(p.questions.filter((q) => q.kind === 'Isup')).toHaveLength(3);
          if (type === 'thevenin') expect(p.questions.some((q) => q.kind === 'Pmax')).toBe(true);
        }
    });

  it('véletlen típus: mind a négy előfordul', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 40; i++) seen.add(generateProblem({ seed: `TR${i}`, topic: 'tanari', level: 'kozepes' }).teacherType!);
    expect(seen.size).toBe(4);
  });
});
