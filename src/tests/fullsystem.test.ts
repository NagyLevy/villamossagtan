// Teljes hálózatanalízis egyenletrendszerrel: minden elem U, I értéke = MNA, a lépések érvényesek.
import katex from 'katex';
import { describe, expect, it } from 'vitest';
import { generateProblem } from '../generator/generate';
import type { Level } from '../generator/values';
import { applicableMethods, solveWith } from '../methods';
import { recommendMethod } from '../methods/fit';
import { solve } from '../solver/analysis';
import { toNetlist } from '../solver/netlist';

const LEVELS: Level[] = ['alapozo', 'konnyu', 'kozepes', 'nehez'];

describe('teljes hálózatanalízis egyenletrendszerrel', () => {
  it('Ohm + csomóponti + hurokegyenletek, eredmény = MNA, ez az ajánlott módszer', () => {
    let n = 0;
    let single = 0;
    for (const level of LEVELS)
      for (const starDelta of [false, true])
        for (let i = 0; i < 40; i++) {
          const p = generateProblem({ seed: `FS${i}`, topic: 'halozat', level, starDelta });
          const r = solveWith(p, 'kirchhoff');
          // Egyetlen hurok (néhány alapozó feladat): ott nincs mit egyenletrendszerrel megoldani.
          if (!r.ok) {
            expect(r.reason, `${level} FS${i}`).toMatch(/Egyetlen hurok/);
            single++;
            continue;
          }
          const s = r.solution;
          expect(applicableMethods(p)).toContain('kirchhoff');
          expect(recommendMethod(p).method).toBe('kirchhoff');
          const titles = s.steps.map((x) => x.title);
          expect(titles[0]).toBe('Ohm-törvény minden ellenállásra');
          expect(titles).toContain('Csomóponti egyenletek');
          expect(titles.some((t) => t.startsWith('Huroktörvény'))).toBe(true);
          const ref = solve(toNetlist(p.circuit).net)!;
          for (const [id, v] of s.values!) {
            const e = ref.elements.get(id)!;
            expect(Math.abs(v.U - e.U)).toBeLessThanOrEqual(1e-9 * Math.max(1, Math.abs(e.U)));
            expect(Math.abs(v.I - e.I)).toBeLessThanOrEqual(1e-9 * Math.max(1, Math.abs(e.I)));
          }
          for (const a of s.answers) expect(a.value).toBeCloseTo(p.questions.find((q) => q.id === a.questionId)!.answer, 8);
          expect(s.answers.length).toBe(p.questions.filter((q) => q.kind !== 'table').length);
          for (const st of s.steps) {
            for (const src of [...(st.terms ?? []), st.subst].filter((x): x is string => !!x)) expect(() => katex.renderToString(src, { throwOnError: true, strict: false })).not.toThrow();
            expect(st.text).not.toMatch(/[\\{}_^]/);
          }
          n++;
        }
    expect(n + single).toBe(320);
    expect(single).toBeLessThan(30);
  });
});
