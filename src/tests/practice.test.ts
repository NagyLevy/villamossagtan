import { describe, expect, it } from 'vitest';
import { generateProblem } from '../generator/generate';
import { checkCell, tableTargets, verify } from '../methods/check';
import { trickHint } from '../simplify/hint';
import { formatQuantity } from '../units';

describe('táblázatkitöltés', () => {
  it('a helyes értékeket (előtaggal is) elfogadja, a rossz előjelet nem', () => {
    for (let i = 0; i < 30; i++) {
      const p = generateProblem({ seed: `TB${i}`, topic: 'halozat', level: 'konnyu' });
      for (const t of tableTargets(p)) {
        for (const k of ['U', 'I', 'P'] as const) {
          const unit = k === 'U' ? 'V' : k === 'I' ? 'A' : 'W';
          expect(checkCell(formatQuantity(t[k], unit), t, k).status).toBe('correct');
          if (Math.abs(t[k]) > 1e-9) expect(checkCell(formatQuantity(-t[k], unit), t, k).status).not.toBe('correct');
        }
      }
    }
  });
});

describe('trükk-tipp', () => {
  it('nem nevezi meg az elemet, csak jelzi, hogy van-e', () => {
    for (let i = 0; i < 50; i++) {
      const p = generateProblem({ seed: `TT${i}`, topic: 'zh' });
      const text = trickHint(p, false);
      expect(text.length).toBeGreaterThan(20);
      expect(text).not.toMatch(/\b(R|Ug|Ig)\d+\b/);
    }
  });

  it('csillag-delta opcióval jelzi, ha átalakítás kell', () => {
    const p = generateProblem({ seed: 'SDH1', topic: 'csillag-delta', level: 'kozepes', starDelta: true });
    expect(trickHint(p, true)).toMatch(/csillag-delta/);
  });
});

describe('ellenőrző nézet', () => {
  it('minden módszer eredménye egyezik a referenciával, a mérlegek nullák', () => {
    for (let i = 0; i < 40; i++) {
      const p = generateProblem({ seed: `VF${i}`, topic: i % 2 ? 'zh' : 'tobbforras', level: 'nehez' });
      const v = verify(p);
      expect(v.methods.length).toBeGreaterThan(1);
      expect(Math.abs(v.powerSum)).toBeLessThan(1e-9);
      expect(v.kirchhoffResidual).toBeLessThan(1e-9);
      for (const r of v.rows) for (const x of Object.values(r.byMethod)) expect(Math.abs(x! - r.reference)).toBeLessThanOrEqual(1e-9 * Math.max(1, Math.abs(r.reference)));
    }
  });
});
