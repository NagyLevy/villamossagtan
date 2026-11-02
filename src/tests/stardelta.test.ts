import katex from 'katex';
import { describe, expect, it } from 'vitest';
import { generateProblem } from '../generator/generate';
import type { Level } from '../generator/values';
import { solveWith } from '../methods';
import { isSeriesParallelReducible, needsStarDeltaBetween } from '../simplify/seriesParallel';
import { deltaToStar, niceStars, starToDelta } from '../simplify/stardelta';
import { equivalentResistance, solve } from '../solver/analysis';
import type { Netlist } from '../solver/model';
import { allElements } from '../solver/model';
import { toNetlist } from '../solver/netlist';

const par = (a: number, b: number) => (a * b) / (a + b);

describe('csillag-delta képletek', () => {
  it('Y → Δ → Y és Δ → Y → Δ oda-vissza az eredeti értékeket adja', () => {
    for (let i = 0; i < 500; i++) {
      const s = { R1: 0.5 + ((i * 7) % 23), R2: 1 + ((i * 11) % 17), R3: 0.25 + ((i * 5) % 13) };
      const back = deltaToStar(starToDelta(s));
      expect(back.R1).toBeCloseTo(s.R1, 9);
      expect(back.R2).toBeCloseTo(s.R2, 9);
      expect(back.R3).toBeCloseTo(s.R3, 9);
      const d = { R12: 1 + (i % 19), R23: 2 + ((i * 3) % 29), R31: 0.5 + ((i * 13) % 31) };
      const d2 = starToDelta(deltaToStar(d));
      expect(d2.R12).toBeCloseTo(d.R12, 9);
      expect(d2.R23).toBeCloseTo(d.R23, 9);
      expect(d2.R31).toBeCloseTo(d.R31, 9);
    }
  });

  it('a kivezetések közti eredő páronként ugyanaz (a harmadik kivezetés szabadon)', () => {
    for (let i = 0; i < 200; i++) {
      const s = { R1: 1 + (i % 7), R2: 2 + ((i * 3) % 11), R3: 1 + ((i * 5) % 9) };
      const d = starToDelta(s);
      expect(s.R1 + s.R2).toBeCloseTo(par(d.R12, d.R23 + d.R31), 9);
      expect(s.R2 + s.R3).toBeCloseTo(par(d.R23, d.R12 + d.R31), 9);
      expect(s.R3 + s.R1).toBeCloseTo(par(d.R31, d.R12 + d.R23), 9);
    }
  });

  it('szimmetrikus eset: RΔ = 3 · RY', () => {
    for (const r of [1, 2, 5, 7.5]) {
      const d = starToDelta({ R1: r, R2: r, R3: r });
      expect(d.R12).toBeCloseTo(3 * r, 12);
      expect(deltaToStar({ R12: 3 * r, R23: 3 * r, R31: 3 * r }).R1).toBeCloseTo(r, 12);
    }
  });

  it('a "szép" csillagokból egész delta lesz', () => {
    const list = niceStars(12);
    expect(list.length).toBeGreaterThan(20);
    for (const s of list) for (const v of Object.values(starToDelta(s))) expect(Number.isInteger(v)).toBe(true);
  });
});

describe('csillag-delta feladatok: 1000 feladat, átalakításos megoldás = MNA', () => {
  const levels: Level[] = ['alapozo', 'konnyu', 'kozepes', 'nehez'];
  const modes = ['delta-csillag', 'csillag-delta'] as const;
  it('a válaszok és a (visszahelyettesített) elemértékek egyeznek', () => {
    let n = 0;
    let backSub = 0;
    for (const level of levels) {
      for (const mode of modes) {
        for (let i = 0; i < 125; i++) {
          const p = generateProblem({ seed: `SD${i}`, topic: 'csillag-delta', level, starDelta: true, starDeltaMode: mode });
          const r = solveWith(p, 'csillag-delta', { prefer: mode });
          if (!r.ok) throw new Error(`${p.seed} ${level} ${mode}: ${r.reason}`);
          for (const q of p.questions) {
            const a = r.solution.answers.find((x) => x.questionId === q.id);
            expect(a, `${p.seed} ${q.kind}`).toBeDefined();
            expect(Math.abs(a!.value - q.answer)).toBeLessThanOrEqual(1e-9 * Math.max(1, Math.abs(q.answer)));
          }
          if (r.solution.values) {
            const sol = solve(toNetlist(p.circuit).net)!;
            for (const [id, v] of r.solution.values) {
              expect(Math.abs(v.U - sol.elements.get(id)!.U)).toBeLessThanOrEqual(1e-9 * Math.max(1, Math.abs(v.U)));
              expect(Math.abs(v.I - sol.elements.get(id)!.I)).toBeLessThanOrEqual(1e-9 * Math.max(1, Math.abs(v.I)));
            }
            if (r.solution.steps.some((s) => s.title === 'Visszahelyettesítés')) backSub++;
          }
          const ids = new Set(allElements(p.circuit).map((e) => e.id));
          for (const st of r.solution.steps) {
            for (const id of [...(st.highlight.elements ?? []), ...(st.highlight.groups ?? []).flatMap((g) => g.elements), ...(st.highlight.arrows ?? []).map((x) => x.element)]) expect(ids.has(id), id).toBe(true);
            for (const src of [...(st.terms ?? []), st.subst].filter((x): x is string => !!x)) expect(() => katex.renderToString(src, { throwOnError: true, strict: false })).not.toThrow();
          }
          n++;
        }
      }
    }
    expect(n).toBe(1000);
    // A visszahelyettesítés tényleg előfordul (a kérdés a belső ágra vonatkozik).
    expect(backSub).toBeGreaterThan(30);
  });

  it('hidas feladatnál az átalakítás tényleg szükséges (nem soros-párhuzamos, nem kiegyenlített)', () => {
    for (const level of ['kozepes', 'nehez'] as Level[]) {
      for (let i = 0; i < 150; i++) {
        const p = generateProblem({ seed: `NS${i}`, topic: 'csillag-delta', level, starDelta: true });
        const map = toNetlist(p.circuit);
        const rs = map.net.elements.filter((e) => e.kind === 'R');
        const src = map.net.elements.find((e) => e.kind !== 'R');
        const t1 = src ? src.b : map.pointNode.get(p.circuit.terminals!.a)!;
        const t2 = src ? src.a : map.pointNode.get(p.circuit.terminals!.b)!;
        expect(isSeriesParallelReducible(rs.map((e) => ({ a: e.a, b: e.b })), t1, t2)).toBe(false);
        const rnet: Netlist = { nodeCount: map.net.nodeCount, elements: rs };
        expect(needsStarDeltaBetween(rnet, t1, t2)).toBe(true);
        if (!src) expect(equivalentResistance(map.net, t1, t2)).toBeGreaterThan(0);
      }
    }
  });

  it('a hurokáram és a csomóponti módszer is megoldja a forrásos hidas feladatokat', () => {
    for (let i = 0; i < 100; i++) {
      const p = generateProblem({ seed: `HM${i}`, topic: 'csillag-delta', level: 'nehez', starDelta: true });
      for (const m of ['hurokaram', 'csomoponti'] as const) {
        const r = solveWith(p, m);
        if (!r.ok) throw new Error(r.reason);
        for (const a of r.solution.answers) {
          const q = p.questions.find((x) => x.id === a.questionId)!;
          expect(Math.abs(a.value - q.answer)).toBeLessThanOrEqual(1e-9 * Math.max(1, Math.abs(q.answer)));
        }
      }
    }
  });
});
