import { describe, expect, it } from 'vitest';
import { generateProblem } from '../generator/generate';
import { solveLoopCurrent } from '../methods/loopcurrent';
import { computeLayout } from '../render/layout';
import { loopGeometries } from '../render/overlay';
import { toNetlist } from '../solver/netlist';

// Levi hibajelzése (2026-11-09): átlóval kettévágott ablakban J1 és J2 felirata egymásra került.
describe('hurok-feliratok helye', () => {
  it('két hurok felirata sosem esik egymásra, és mindegyik a saját hurkán belül van', () => {
    let diagonal = 0;
    for (const topic of ['tanari', 'tobbforras', 'zh'] as const)
      for (const level of ['kozepes', 'nehez'] as const)
        for (let i = 0; i < 60; i++) {
          const p = generateProblem({ seed: `LL${i}`, topic, level, ...(topic === 'tanari' ? { teacherType: 'hurokaram' as const } : {}) });
          const r = solveLoopCurrent(p);
          if (!r.ok) continue;
          const loops = r.solution.steps.find((s) => s.title === 'Hurkok kijelölése')?.highlight?.loops ?? [];
          const ctx = { circuit: p.circuit, layout: computeLayout(p.circuit), map: toNetlist(p.circuit) };
          if (p.circuit.branches.some((b) => { const a = p.circuit.points.find((q) => q.id === b.from)!; const c = p.circuit.points.find((q) => q.id === b.to)!; return a.x !== c.x && a.y !== c.y; })) diagonal++;
          const cs = loopGeometries(ctx, loops).map((g) => g!.center);
          for (let a = 0; a < cs.length; a++)
            for (let b = a + 1; b < cs.length; b++) expect(Math.hypot(cs[a]!.x - cs[b]!.x, cs[a]!.y - cs[b]!.y), `${topic} ${level} ${i}`).toBeGreaterThan(30);
        }
    expect(diagonal).toBeGreaterThan(0);
  });
});
