import katex from 'katex';
import { describe, expect, it } from 'vitest';
import { solveSystemSteps } from '../methods/linsolve';

const hl = { elements: [] } as never;

function solve(A: number[][], b: number[]): number[] {
  // Egyszerű Gauss a várt értékekhez (a teszt maga ellenőrzi a levezetést).
  const n = b.length;
  const M = A.map((r, i) => [...r, b[i]!]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r]![c]!) > Math.abs(M[p]![c]!)) p = r;
    [M[c], M[p]] = [M[p]!, M[c]!];
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = M[r]![c]! / M[c]![c]!;
      for (let k = c; k <= n; k++) M[r]![k]! -= f * M[c]![k]!;
    }
  }
  return M.map((r, i) => r[n]! / r[i]!);
}

const cases: [string, number[][], number[]][] = [
  ['2 ismeretlen', [[0.75, -0.25], [-0.25, 0.5]], [2, -1]],
  ['3 ismeretlen', [[12, -4, 0], [-4, 10, -6], [0, -6, 9]], [20, 0, -15]],
  ['4 ismeretlen, nullás együtthatóval', [[5, -2, 0, 0], [-2, 7, -3, 0], [0, -3, 8, -4], [0, 0, -4, 6]], [10, 0, 5, -3]],
];

describe('egyenletrendszer: behelyettesítő levezetés', () => {
  for (const [name, A, b] of cases) {
    it(name, () => {
      const x = solve(A, b);
      const names = x.map((_, i) => `\\varphi_{${i + 1}}`);
      const steps = solveSystemSteps(A, b, names, x.map((_, i) => `φ${i + 1}`), x, 'V', hl);
      // Nincs mátrix, determináns vagy Gauss a levezetésben.
      const all = steps.map((s) => `${s.title} ${s.text} ${(s.terms ?? []).join(' ')}`).join(' ');
      expect(all).not.toMatch(/Gauss|Cramer|determináns|array|bmatrix/i);
      expect(steps[0]!.title).toBe('Az egyenletrendszer');
      expect(steps.at(-1)!.title).toBe('Visszahelyettesítés');
      // n−1 kifejezés + n−1 behelyettesítés + utolsó ismeretlen + visszahelyettesítés + rendszer.
      expect(steps).toHaveLength(2 * (x.length - 1) + 3);
      // Minden képlet hibátlanul megjelenik.
      for (const s of steps) for (const t of [...(s.terms ?? []), s.subst ?? '']) if (t) expect(() => katex.renderToString(t, { throwOnError: true })).not.toThrow();
    });
  }
});
