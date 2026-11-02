import type { Field } from './field';

/**
 * A·x = b megoldása Gauss-eliminációval, részleges főelemkiválasztással.
 * Szinguláris (vagy numerikusan majdnem szinguláris) mátrixnál null.
 * A bemenetet nem módosítja.
 */
export function solveLinear<T>(A: readonly (readonly T[])[], b: readonly T[], F: Field<T>): T[] | null {
  const n = b.length;
  if (n === 0) return [];
  const M = A.map((row, i) => [...row, b[i]!]);

  let scale = 0;
  for (const row of A) for (const v of row) scale = Math.max(scale, F.abs(v));
  const eps = 1e-12 * (scale || 1);

  for (let col = 0; col < n; col++) {
    // Főelem: a legnagyobb abszolút értékű elem az oszlopban, az aktuális sortól lefelé.
    let pivot = col;
    for (let r = col + 1; r < n; r++) {
      if (F.abs(M[r]![col]!) > F.abs(M[pivot]![col]!)) pivot = r;
    }
    if (F.abs(M[pivot]![col]!) <= eps) return null;
    if (pivot !== col) [M[col], M[pivot]] = [M[pivot]!, M[col]!];

    const pivotRow = M[col]!;
    for (let r = col + 1; r < n; r++) {
      const row = M[r]!;
      if (F.abs(row[col]!) === 0) continue;
      const f = F.div(row[col]!, pivotRow[col]!);
      for (let c = col; c <= n; c++) row[c] = F.sub(row[c]!, F.mul(f, pivotRow[c]!));
    }
  }

  // Visszahelyettesítés.
  const x: T[] = new Array<T>(n).fill(F.zero);
  for (let r = n - 1; r >= 0; r--) {
    const row = M[r]!;
    let acc: T = row[n]!;
    for (let c = r + 1; c < n; c++) acc = F.sub(acc, F.mul(row[c]!, x[c]!));
    x[r] = F.div(acc, row[r]!);
  }
  return x;
}
