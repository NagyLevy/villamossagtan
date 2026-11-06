// Független komplex MNA-megoldó szinuszos állandósult állapotra (és egyenáramra ω = 0 helyett
// a hívó által megadott impedanciákkal). Ez az "igazság", amihez a lépésenkénti levezetéseket a
// tesztek mérik. A levezetésben sosem jelenik meg: ott csak eredő, osztó és Ohm-törvény van.

import type { Circuit } from '../solver/model';
import { toNetlist, type NetlistMapping } from '../solver/netlist';
import { abs, add, cx, div, mul, neg, polar, sub, type Cx, ZERO } from './complex';

/** Egy elem impedanciája ω körfrekvencián (R, L, C). */
export function impedanceOf(kind: 'R' | 'L' | 'C', value: number, omega: number): Cx {
  if (kind === 'R') return cx(value);
  if (kind === 'L') return cx(0, omega * value);
  return cx(0, -1 / (omega * value));
}

export interface AcSolution {
  /** Csomóponti potenciálok (komplex csúcsérték), a 0. csomópont a referencia. */
  phi: Cx[];
  /** Elemenként U_ab = φ(a) − φ(b) és I_ab (a→b irányban az elemen át). */
  U: Map<string, Cx>;
  I: Map<string, Cx>;
  map: NetlistMapping;
}

/** Komplex lineáris egyenletrendszer (A·x = b) részleges főelem-kiválasztással. null, ha szinguláris. */
export function solveLinear(A: Cx[][], b: Cx[]): Cx[] | null {
  const n = b.length;
  const M = A.map((row, i) => [...row.map((v) => ({ ...v })), { ...b[i]! }]);
  for (let col = 0; col < n; col++) {
    let piv = col;
    for (let r = col + 1; r < n; r++) if (abs(M[r]![col]!) > abs(M[piv]![col]!)) piv = r;
    if (abs(M[piv]![col]!) < 1e-14) return null;
    [M[col], M[piv]] = [M[piv]!, M[col]!];
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const f = div(M[r]![col]!, M[col]![col]!);
      if (f.re === 0 && f.im === 0) continue;
      for (let k = col; k <= n; k++) M[r]![k] = sub(M[r]![k]!, mul(f, M[col]![k]!));
    }
  }
  return M.map((row, i) => div(row[n]!, row[i]!));
}

/**
 * A rajzolt áramkör megoldása ω körfrekvencián. A kapcsoló (K) zártnak számít.
 * Egyenáramú állandósult állapothoz (bekapcsolási feladatok vége) `dc: true`: a tekercs
 * rövidzár, a kondenzátor szakadás.
 */
export function solveAc(c: Circuit, omega: number, opts: { dc?: boolean } = {}): AcSolution | null {
  const map = toNetlist(c);
  const n = map.net.nodeCount;
  const phase = new Map(c.branches.flatMap((b) => b.elements).map((e) => [e.id, e.phase ?? 0]));
  // Ismeretlenek: φ1..φ(n−1), majd a feszültségforrás-szerű elemek árama (V, K, és DC-ben L).
  const vsrc = map.net.elements.filter((e) => e.kind === 'V' || e.kind === 'K' || (opts.dc && e.kind === 'L'));
  const size = n - 1 + vsrc.length;
  const A: Cx[][] = Array.from({ length: size }, () => Array.from({ length: size }, () => ZERO));
  const rhs: Cx[] = Array.from({ length: size }, () => ZERO);
  const idx = (node: number) => node - 1; // a 0. csomópont nem ismeretlen
  const stamp = (r: number, col: number, v: Cx) => {
    if (r < 0 || col < 0) return;
    A[r]![col] = add(A[r]![col]!, v);
  };
  for (const e of map.net.elements) {
    if (e.kind === 'R' || e.kind === 'L' || e.kind === 'C') {
      if (opts.dc && e.kind === 'C') continue; // szakadás
      if (opts.dc && e.kind === 'L') continue; // rövidzár: lent, forrásként
      const y = div(cx(1), impedanceOf(e.kind, e.value, omega));
      const a = idx(e.a);
      const b = idx(e.b);
      stamp(a, a, y);
      stamp(b, b, y);
      stamp(a, b, neg(y));
      stamp(b, a, neg(y));
    } else if (e.kind === 'I') {
      // A forrás árama a→b irányban folyik az elemen át: az a csomópontból kivesz, a b-be betáplál.
      const j = opts.dc ? cx(e.value) : polar(e.value, phase.get(e.id) ?? 0);
      if (e.a > 0) rhs[idx(e.a)] = sub(rhs[idx(e.a)]!, j);
      if (e.b > 0) rhs[idx(e.b)] = add(rhs[idx(e.b)]!, j);
    }
  }
  vsrc.forEach((e, k) => {
    const row = n - 1 + k;
    // Az elem árama a→b irányban: az a csomópontból kifolyik, a b-be befolyik.
    stamp(idx(e.a), row, cx(1));
    stamp(idx(e.b), row, cx(-1));
    // φ(b) − φ(a) = U (feszültségforrás); kapcsolónál és DC-tekercsnél 0.
    stamp(row, idx(e.b), cx(1));
    stamp(row, idx(e.a), cx(-1));
    const u = e.kind === 'V' ? (opts.dc ? cx(e.value) : polar(e.value, phase.get(e.id) ?? 0)) : ZERO;
    rhs[row] = u;
  });
  const x = solveLinear(A, rhs);
  if (!x) return null;
  const phi = [ZERO, ...x.slice(0, n - 1)];
  const U = new Map<string, Cx>();
  const I = new Map<string, Cx>();
  for (const e of map.net.elements) {
    const u = sub(phi[e.a]!, phi[e.b]!);
    U.set(e.id, u);
    const k = vsrc.indexOf(e);
    if (k >= 0) {
      // Az ismeretlen az a csomópontból az elembe kifolyó áram, vagyis éppen I_ab.
      I.set(e.id, x[n - 1 + k]!);
    } else if (e.kind === 'I') {
      I.set(e.id, opts.dc ? cx(e.value) : polar(e.value, phase.get(e.id) ?? 0));
    } else if (opts.dc && e.kind === 'C') {
      I.set(e.id, ZERO);
    } else {
      I.set(e.id, div(u, impedanceOf(e.kind as 'R' | 'L' | 'C', e.value, omega)));
    }
  }
  return { phi, U, I, map };
}
