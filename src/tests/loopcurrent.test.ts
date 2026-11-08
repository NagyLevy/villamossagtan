import { describe, expect, it } from 'vitest';
import { generateProblem } from '../generator/generate';
import { solveLoopCurrent } from '../methods/loopcurrent';
import { computeLayout } from '../render/layout';
import { loopGeometry } from '../render/overlay';
import { toNetlist } from '../solver/netlist';

describe('hurokáram a tanár úr módszerével', () => {
  it('l = b − n + 1 hurok, minden áramforrásnak ismert hurka, minden hurok kirajzolható', () => {
    let withSource = 0;
    for (const topic of ['tobbforras', 'zh', 'halozat'] as const)
      for (const level of ['konnyu', 'kozepes', 'nehez'] as const)
        for (let i = 0; i < 60; i++) {
          const p = generateProblem({ seed: `LM${i}`, topic, level });
          const r = solveLoopCurrent(p);
          if (!r.ok) continue;
          const steps = r.solution.steps;
          const pick = steps.find((s) => s.title === 'Hurkok kijelölése')!;
          const loops = pick.highlight!.loops!;
          expect(steps.find((s) => s.title === 'Hány hurok kell?')!.terms![0]).toMatch(new RegExp(`= ${loops.length}$`));
          const net = toNetlist(p.circuit).net;
          const nI = net.elements.filter((e) => e.kind === 'I').length;
          // Ismeretlen hurkonként egy huroktörvény; az áramforrásokéhoz nem kell egyenlet.
          expect(steps.filter((s) => s.title.startsWith('Huroktörvény')).length).toBe(loops.length - nI);
          if (nI) withSource++;
          const ctx = { circuit: p.circuit, layout: computeLayout(p.circuit), map: toNetlist(p.circuit) };
          for (const l of loops) expect(loopGeometry(ctx, l)).not.toBeNull();
          // Nincs szuperhurok.
          expect(JSON.stringify(steps)).not.toMatch(/szuperhurok/i);
        }
    expect(withSource).toBeGreaterThan(20);
  });
});
