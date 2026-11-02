import { describe, expect, it } from 'vitest';
import { generateProblem } from '../generator/generate';
import { STAR_DELTA_TOPICS } from '../generator/inject';
import { solveWith } from '../methods';

const topics = [...STAR_DELTA_TOPICS] as ('eredo' | 'oszto' | 'halozat')[];
const levels = ['alapozo', 'konnyu', 'kozepes', 'nehez'] as const;

describe('csillag-delta kapcsoló', () => {
  it('bekapcsolva: csak átalakítással oldható meg, és az eredmény egyezik az MNA-val', () => {
    for (const topic of topics)
      for (const level of levels)
        for (let i = 0; i < 6; i++) {
          for (const mode of ['delta-csillag', 'csillag-delta'] as const) {
            const p = generateProblem({ seed: `T${i}`, topic, level, starDelta: true, starDeltaMode: mode });
            expect(solveWith(p, 'redukcio').ok, `${topic} ${level} T${i}: redukcióval is megy`).toBe(false);
            const r = solveWith(p, 'csillag-delta');
            if (!r.ok) throw new Error(`${topic} ${level} T${i} ${mode}: ${r.reason}`);
            for (const a of r.solution.answers) {
              const q = p.questions.find((x) => x.id === a.questionId)!;
              expect(Math.abs(a.value - q.answer)).toBeLessThanOrEqual(1e-9 * Math.max(1, Math.abs(q.answer)));
            }
          }
        }
  });

  it('kikapcsolva: nincs benne csillag-delta', () => {
    for (const topic of topics)
      for (const level of levels)
        for (let i = 0; i < 6; i++) {
          const p = generateProblem({ seed: `T${i}`, topic, level });
          expect(solveWith(p, 'redukcio').ok, `${topic} ${level} T${i}`).toBe(true);
        }
  });
});
