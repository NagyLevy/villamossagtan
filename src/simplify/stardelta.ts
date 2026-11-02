// Csillag-delta (Y-Δ) átalakítás: képletek és a szükséges átalakítás megkeresése.
// Jelölés: a csillag ellenállásai R1, R2, R3 (az 1, 2, 3 kivezetéshez csatlakoznak),
// a delta ellenállásai R12, R23, R31 (az adott két kivezetés között).

import type { NetElement } from '../solver/model';
import { isSeriesParallelReducible } from './seriesParallel';

export interface Star {
  R1: number;
  R2: number;
  R3: number;
}

export interface Delta {
  R12: number;
  R23: number;
  R31: number;
}

/** Delta → csillag: minden csillag-ellenállás a kivezetésnél találkozó két delta-ellenállás szorzata / a három összege. */
export function deltaToStar(d: Delta): Star {
  const S = d.R12 + d.R23 + d.R31;
  return { R1: (d.R12 * d.R31) / S, R2: (d.R12 * d.R23) / S, R3: (d.R23 * d.R31) / S };
}

/** Csillag → delta: két csillag-ellenállás összege + a szorzatuk osztva a harmadikkal. */
export function starToDelta(s: Star): Delta {
  return {
    R12: s.R1 + s.R2 + (s.R1 * s.R2) / s.R3,
    R23: s.R2 + s.R3 + (s.R2 * s.R3) / s.R1,
    R31: s.R3 + s.R1 + (s.R3 * s.R1) / s.R2,
  };
}

export interface Transform {
  kind: 'delta-csillag' | 'csillag-delta';
  /** A három kivezetés (csomópont), 1, 2, 3 sorrendben. */
  terminals: [number, number, number];
  /** Az átalakítandó eredeti ellenállások. Delta: [R12, R23, R31]; csillag: [R1, R2, R3]. */
  removed: [NetElement, NetElement, NetElement];
  /** Csillagnál a középpont (eltűnik); deltánál az új középpont sorszáma. */
  center: number;
  /** Az új ellenállások (virtuális elemek, azonosítójuk "Y1"… vagy "D12"…). */
  added: NetElement[];
}

function key(a: number, b: number): string {
  return a < b ? `${a}-${b}` : `${b}-${a}`;
}

/**
 * Olyan delta vagy csillag keresése, amelynek átalakítása után a t1–t2 kapcsok felől nézett
 * ellenálláshálózat soros-párhuzamosan redukálható. `prefer` szerint előbb a deltákat vagy a csillagokat nézi.
 */
export function findTransform(resistors: NetElement[], nodeCount: number, t1: number, t2: number, prefer: 'delta-csillag' | 'csillag-delta' = 'delta-csillag'): Transform | null {
  const byPair = new Map<string, NetElement[]>();
  const nbrs = new Map<number, Set<number>>();
  for (const e of resistors) {
    if (e.a === e.b) continue;
    byPair.set(key(e.a, e.b), [...(byPair.get(key(e.a, e.b)) ?? []), e]);
    if (!nbrs.has(e.a)) nbrs.set(e.a, new Set());
    if (!nbrs.has(e.b)) nbrs.set(e.b, new Set());
    nbrs.get(e.a)!.add(e.b);
    nbrs.get(e.b)!.add(e.a);
  }
  const single = (a: number, b: number) => {
    const l = byPair.get(key(a, b));
    return l && l.length === 1 ? l[0]! : null;
  };
  const reducible = (list: NetElement[]) => isSeriesParallelReducible(list.map((e) => ({ a: e.a, b: e.b })), t1, t2);

  const deltas: Transform[] = [];
  const nodes = [...nbrs.keys()].sort((a, b) => a - b);
  for (const x of nodes) {
    for (const y of nbrs.get(x)!) {
      if (y <= x) continue;
      for (const z of nbrs.get(y)!) {
        if (z <= y || !nbrs.get(x)!.has(z)) continue;
        const r12 = single(x, y);
        const r23 = single(y, z);
        const r31 = single(z, x);
        if (!r12 || !r23 || !r31) continue;
        const s = deltaToStar({ R12: r12.value, R23: r23.value, R31: r31.value });
        const c = nodeCount;
        const added: NetElement[] = [
          { id: 'Y1', kind: 'R', value: s.R1, a: x, b: c },
          { id: 'Y2', kind: 'R', value: s.R2, a: y, b: c },
          { id: 'Y3', kind: 'R', value: s.R3, a: z, b: c },
        ];
        const rest = resistors.filter((e) => e !== r12 && e !== r23 && e !== r31);
        if (reducible([...rest, ...added])) deltas.push({ kind: 'delta-csillag', terminals: [x, y, z], removed: [r12, r23, r31], center: c, added });
      }
    }
  }
  const stars: Transform[] = [];
  for (const v of nodes) {
    if (v === t1 || v === t2) continue;
    const inc = resistors.filter((e) => e.a === v || e.b === v);
    if (inc.length !== 3) continue;
    const others = inc.map((e) => (e.a === v ? e.b : e.a));
    if (new Set(others).size !== 3) continue;
    const [p, q, r] = others as [number, number, number];
    const d = starToDelta({ R1: inc[0]!.value, R2: inc[1]!.value, R3: inc[2]!.value });
    const added: NetElement[] = [
      { id: 'D12', kind: 'R', value: d.R12, a: p, b: q },
      { id: 'D23', kind: 'R', value: d.R23, a: q, b: r },
      { id: 'D31', kind: 'R', value: d.R31, a: r, b: p },
    ];
    const rest = resistors.filter((e) => !inc.includes(e));
    if (reducible([...rest, ...added])) stars.push({ kind: 'csillag-delta', terminals: [p, q, r], removed: inc as [NetElement, NetElement, NetElement], center: v, added });
  }
  const order = prefer === 'csillag-delta' ? [...stars, ...deltas] : [...deltas, ...stars];
  return order[0] ?? null;
}

/** Kis egész csillagok, amelyekből a delta is egész (szép értékek a feladatokhoz). */
export function niceStars(max = 12): Star[] {
  const out: Star[] = [];
  for (let a = 1; a <= max; a++)
    for (let b = 1; b <= max; b++)
      for (let c = 1; c <= max; c++) {
        const d = starToDelta({ R1: a, R2: b, R3: c });
        if ([d.R12, d.R23, d.R31].every((v) => Number.isInteger(v) && v <= 40)) out.push({ R1: a, R2: b, R3: c });
      }
  return out;
}
