import { describe, expect, it } from 'vitest';
import { generateProblem, type Topic } from '../generator/generate';
import { methodFit } from '../methods/fit';
import type { MethodId } from '../methods/types';

const pairs: [MethodId, Topic][] = [
  ['redukcio', 'oszto'],
  ['kirchhoff', 'kirchhoff'],
  ['hurokaram', 'tobbforras'],
  ['csomoponti', 'tobbforras'],
  ['szuperpozicio', 'tobbforras'],
  ['thevenin', 'thevenin'],
];

describe('módszerhez illő feladat', () => {
  for (const level of ['kozepes', 'nehez'] as const)
    it(`${level}: minden módszerhez van olyan feladat, amit azzal a legkönnyebb megoldani`, () => {
      for (const [m, topic] of pairs) {
        let found = false;
        for (let i = 0; i < 60 && !found; i++) {
          try {
            found = methodFit(m, generateProblem({ seed: `M${i}`, topic, level }), true).ok;
          } catch {
            // érvénytelen seed
          }
        }
        expect(found, `${m} (${topic}, ${level})`).toBe(true);
      }
    });

  it('hurokáram és csomóponti: szigorúan csak a kevesebb egyenlet számít', () => {
    for (let i = 0; i < 20; i++) {
      const p = generateProblem({ seed: `M${i}`, topic: 'tobbforras', level: 'kozepes' });
      expect(methodFit('hurokaram', p).ok && methodFit('csomoponti', p).ok).toBe(false);
    }
  });
});
