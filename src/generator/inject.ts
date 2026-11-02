// Csillag-delta beépítése egy kész feladatba: a rajz felső vagy alsó szélén két csomópontot egy
// új ellenállással kötünk össze (kis kitérővel, így nem keresztez semmit). Ettől a hálózat hidassá
// válik, és csak csillag-delta átalakítással vonható össze. A feladat többi része változatlan.

import type { Circuit } from '../solver/model';
import { toNetlist } from '../solver/netlist';
import { isSeriesParallelReducible, needsStarDeltaBetween } from '../simplify/seriesParallel';
import { findTransform } from '../simplify/stardelta';
import type { Rng } from './rng';
import { finalize, makeElement } from './sketch';

/** Ezekben a témakörökben van értelme (összevonással megoldott feladatok). */
export const STAR_DELTA_TOPICS = new Set(['eredo', 'oszto', 'halozat']);

/** A kapcsok, ahonnan nézve a hálózatot össze kell vonni: a forrás két vége, vagy az A–B kapocspár. */
function terminalsOf(c: Circuit): [number, number] | null {
  const map = toNetlist(c);
  const src = map.net.elements.filter((e) => e.kind !== 'R');
  if (src.length === 1) return [src[0]!.b, src[0]!.a];
  if (src.length === 0 && c.terminals) return [map.pointNode.get(c.terminals.a)!, map.pointNode.get(c.terminals.b)!];
  return null;
}

/** Kell-e (és elég-e egy) csillag-delta átalakítás az összevonáshoz. */
export function needsOneTransform(c: Circuit, mode: 'delta-csillag' | 'csillag-delta'): boolean {
  const t = terminalsOf(c);
  if (!t) return false;
  const net = toNetlist(c).net;
  const rs = net.elements.filter((e) => e.kind === 'R');
  if (rs.some((e) => e.a === e.b)) return false;
  if (isSeriesParallelReducible(rs.map((e) => ({ a: e.a, b: e.b })), t[0], t[1])) return false;
  if (!needsStarDeltaBetween(net, t[0], t[1])) return false;
  return !!findTransform(rs, net.nodeCount, t[0], t[1], mode);
}

/**
 * Új ellenállás a rajz szélén két csomópont közé úgy, hogy csillag-delta kelljen. Ha a hálózat ehhez
 * túl kicsi (kevés a csomópont), előbb egy meglévő vezetékszakaszba is kerül egy ellenállás, ami új
 * csomópontot ad. null, ha így sem megy.
 */
export function injectStarDelta(c: Circuit, rng: Rng, mode: 'delta-csillag' | 'csillag-delta'): Circuit | null {
  if (!terminalsOf(c)) return null;
  const once = injectOnce(c, rng, mode);
  if (once) return once;
  const values = c.branches.flatMap((b) => b.elements.filter((e) => e.kind === 'R').map((e) => e.value));
  const wires = c.branches.filter((b) => b.elements.length === 0);
  for (let i = wires.length - 1; i > 0; i--) {
    const j = rng.int(0, i);
    [wires[i], wires[j]] = [wires[j]!, wires[i]!];
  }
  for (const w of wires) {
    const split: Circuit = { ...c, branches: c.branches.map((b) => (b === w ? { ...b, elements: [makeElement('R', rng.pick(values))] } : b)) };
    const done = injectOnce(split, rng, mode);
    if (done) return done;
  }
  return null;
}

function injectOnce(c: Circuit, rng: Rng, mode: 'delta-csillag' | 'csillag-delta'): Circuit | null {
  const xs = c.points.map((p) => p.x);
  const ys = c.points.map((p) => p.y);
  const values = c.branches.flatMap((b) => b.elements.filter((e) => e.kind === 'R').map((e) => e.value));
  if (!values.length) return null;
  // A négy szél: felül/alul vízszintes, balra/jobbra függőleges kitérővel.
  const candidates: { dx: number; dy: number; p: number; q: number }[] = [];
  const side = (on: (p: { x: number; y: number }) => boolean, dx: number, dy: number, key: 'x' | 'y') => {
    const pts = c.points.filter(on).sort((a, b) => a[key] - b[key]);
    for (let i = 0; i < pts.length; i++) for (let j = i + 1; j < pts.length; j++) candidates.push({ dx, dy, p: pts[i]!.id, q: pts[j]!.id });
  };
  side((p) => p.y === Math.min(...ys), 0, -2, 'x');
  side((p) => p.y === Math.max(...ys), 0, 2, 'x');
  side((p) => p.x === Math.min(...xs), -2, 0, 'y');
  side((p) => p.x === Math.max(...xs), 2, 0, 'y');
  // Véletlen sorrend (a seedből), hogy ne mindig ugyanott legyen.
  for (let i = candidates.length - 1; i > 0; i--) {
    const j = rng.int(0, i);
    [candidates[i], candidates[j]] = [candidates[j]!, candidates[i]!];
  }
  const pos = new Map(c.points.map((p) => [p.id, p]));
  const nextId = Math.max(...c.points.map((p) => p.id)) + 1;
  for (const cand of candidates) {
    const P = pos.get(cand.p)!;
    const Q = pos.get(cand.q)!;
    const value = rng.pick(values);
    const p2 = { id: nextId, x: P.x + cand.dx, y: P.y + cand.dy };
    const q2 = { id: nextId + 1, x: Q.x + cand.dx, y: Q.y + cand.dy };
    // Az ág mindig a bal oldali / felső végpontból indul.
    const outward = cand.dx < 0 || cand.dy < 0;
    const next: Circuit = {
      ...c,
      points: [...c.points, p2, q2],
      branches: [
        ...c.branches,
        { id: 'sd1', from: outward ? p2.id : P.id, to: outward ? P.id : p2.id, elements: [] },
        { id: 'sd2', from: p2.id, to: q2.id, elements: [makeElement('R', value)] },
        { id: 'sd3', from: outward ? q2.id : Q.id, to: outward ? Q.id : q2.id, elements: [] },
      ],
    };
    const done = finalize(next);
    if (needsOneTransform(done, mode)) return done;
  }
  return null;
}
