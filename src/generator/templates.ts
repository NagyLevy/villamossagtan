// Topológia-sablonok. Mindegyik egy üres vázat ad (pontok, vezetékek, kitölthető slotok);
// az elemeket a kitöltő (fill.ts) teszi bele. A rács lépésköze 2 egység: így egy ágba két elem fér,
// és a felezőpontok kapocsnak / kitérőnek használhatók.

import type { Rng } from './rng';
import { Sketch, type Slot } from './sketch';

export type Topology = 'soros-parhuzamos' | 'letra' | 'racs' | 'hid' | 'gyuru';

export const TOPOLOGY_NAMES: Record<Topology, string> = {
  'soros-parhuzamos': 'Soros-párhuzamos',
  letra: 'Létra',
  racs: 'Rács',
  hid: 'Híd',
  gyuru: 'Külső gyűrű belső cellákkal',
};

const S = 2; // rácslépés

/**
 * Létra: felső és alsó sín, n cella, n+1 fok. A fokok kötelezően kitöltendők (különben rövidzár).
 * Ha `openFirstRung`, a 0. fok helyén nincs ág (ott lesznek a kapcsok vagy a külön forrás).
 */
export function ladder(n: number, opts: { openFirstRung?: boolean } = {}): Sketch {
  const s = new Sketch();
  for (let i = 0; i <= n; i++) {
    if (!(i === 0 && opts.openFirstRung)) s.slot(i * S, 0, i * S, S, 'rung', true);
  }
  for (let i = 0; i < n; i++) {
    s.slot(i * S, 0, (i + 1) * S, 0, 'rail-top');
    s.slot(i * S, S, (i + 1) * S, S, 'rail-bottom');
  }
  return s;
}

/** Rács: rows × cols cella, minden ág kitölthető (külső / belső szereppel). */
export function grid(rows: number, cols: number): Sketch {
  const s = new Sketch();
  for (let j = 0; j <= rows; j++) {
    for (let i = 0; i < cols; i++) {
      const outer = j === 0 || j === rows;
      s.slot(i * S, j * S, (i + 1) * S, j * S, outer ? 'outer' : 'inner');
    }
  }
  for (let i = 0; i <= cols; i++) {
    for (let j = 0; j < rows; j++) {
      const outer = i === 0 || i === cols;
      s.slot(i * S, j * S, i * S, (j + 1) * S, outer ? 'outer' : 'inner', !outer);
    }
  }
  return s;
}

/**
 * Külső gyűrű belső cellákkal: rows × cols rács, amelyből `remove` darab belső ágat elhagyunk úgy,
 * hogy egyetlen pont se maradjon lógva. null, ha ez nem sikerül.
 */
export function ring(rows: number, cols: number, remove: number, rng: Rng): Sketch | null {
  type E = { x1: number; y1: number; x2: number; y2: number; outer: boolean };
  const edges: E[] = [];
  for (let j = 0; j <= rows; j++)
    for (let i = 0; i < cols; i++) edges.push({ x1: i, y1: j, x2: i + 1, y2: j, outer: j === 0 || j === rows });
  for (let i = 0; i <= cols; i++)
    for (let j = 0; j < rows; j++) edges.push({ x1: i, y1: j, x2: i, y2: j + 1, outer: i === 0 || i === cols });

  const degree = new Map<string, number>();
  const bump = (x: number, y: number, d: number) => degree.set(`${x},${y}`, (degree.get(`${x},${y}`) ?? 0) + d);
  for (const e of edges) {
    bump(e.x1, e.y1, 1);
    bump(e.x2, e.y2, 1);
  }
  const kept = new Set(edges);
  for (const e of rng.shuffle(edges.filter((e) => !e.outer))) {
    if (edges.length - kept.size >= remove) break;
    const d1 = degree.get(`${e.x1},${e.y1}`)!;
    const d2 = degree.get(`${e.x2},${e.y2}`)!;
    // Egy pont foka 0 lehet (eltűnik) vagy legalább 2; 1 nem.
    if (d1 - 1 === 1 || d2 - 1 === 1) continue;
    kept.delete(e);
    bump(e.x1, e.y1, -1);
    bump(e.x2, e.y2, -1);
  }
  if (edges.length - kept.size < remove) return null;

  const s = new Sketch();
  for (const e of edges) {
    if (!kept.has(e)) continue;
    const vertical = e.x1 === e.x2;
    s.slot(e.x1 * S, e.y1 * S, e.x2 * S, e.y2 * S, e.outer ? 'outer' : 'inner', !e.outer && vertical);
  }
  return s;
}

/**
 * Híd (Wheatstone):
 *
 *   A ──kar1── C ──kar2── B
 *   │          │          │
 *   │        átló         │
 *   │          │          │
 *   A ──kar3── D ──kar4── B
 *   │                     │
 *   └──táp1────┴───táp2───┘      (két soros slot: forrás és esetleg ellenállás)
 *   └───────(sönt)────────┘      (opcionális, a táppal párhuzamos ág)
 */
export function bridge(opts: { shunt?: boolean } = {}): Sketch {
  const s = new Sketch();
  const W = 2 * S; // karhossz
  s.slot(0, 0, W, 0, 'arm', true);
  s.slot(W, 0, 2 * W, 0, 'arm', true);
  s.slot(0, W, W, W, 'arm', true);
  s.slot(W, W, 2 * W, W, 'arm', true);
  s.slot(W, 0, W, W, 'bridge', true);
  s.wire(0, 0, 0, W);
  s.wire(2 * W, 0, 2 * W, W);
  s.wire(0, W, 0, W + S);
  s.wire(2 * W, W, 2 * W, W + S);
  s.slot(0, W + S, W, W + S, 'feed');
  s.slot(W, W + S, 2 * W, W + S, 'feed');
  if (opts.shunt) {
    s.wire(0, W + S, 0, W + 2 * S);
    s.wire(2 * W, W + S, 2 * W, W + 2 * S);
    s.slot(0, W + 2 * S, 2 * W, W + 2 * S, 'shunt', true);
  }
  return s;
}

/** Egyetlen hurok: bal oldalon a forrás, jobb oldalon a fogyasztó (Ohm-feladatokhoz). */
export function singleLoop(): Sketch {
  const s = new Sketch();
  s.slot(0, 0, 0, 2 * S, 'rung', true);
  s.slot(2 * S, 0, 2 * S, 2 * S, 'rung', true);
  s.slot(0, 0, 2 * S, 0, 'rail-top');
  s.slot(0, 2 * S, 2 * S, 2 * S, 'rail-bottom');
  return s;
}

/**
 * Valódi feszültséggenerátor terheléssel:
 *   ┌─ Rb ─ A ───────┐
 *   U0              Rt
 *   └────── B ───────┘
 */
export function realSource(): { sketch: Sketch; source: ReturnType<Sketch['slot']>; internal: ReturnType<Sketch['slot']>; load: ReturnType<Sketch['slot']> } {
  const s = new Sketch();
  const source = s.slot(0, 0, 0, 2 * S, 'rung', true);
  const internal = s.slot(0, 0, 2 * S, 0, 'rail-top', true);
  s.wire(2 * S, 0, 4 * S, 0);
  s.wire(0, 2 * S, 2 * S, 2 * S);
  s.wire(2 * S, 2 * S, 4 * S, 2 * S);
  const load = s.slot(4 * S, 0, 4 * S, 2 * S, 'rung', true);
  s.terminals = { a: s.pt(2 * S, 0), b: s.pt(2 * S, 2 * S) };
  return { sketch: s, source, internal, load };
}

/**
 * Rácsszerű vázaknál (létra, rács, gyűrű) az ág melletti cellák: vízszintes ágnál a felette és
 * alatta lévő, függőlegesnél a tőle balra és jobbra lévő cella (a vázon belül).
 */
export function gridCellsOf(sketch: Sketch): (s: Slot) => string[] {
  const xs = sketch.points.map((p) => p.x);
  const ys = sketch.points.map((p) => p.y);
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const pos = new Map(sketch.points.map((p) => [p.id, p]));
  return (s) => {
    const a = pos.get(s.branch.from)!;
    const b = pos.get(s.branch.to)!;
    const out: string[] = [];
    if (a.y === b.y) {
      const cx = Math.min(a.x, b.x);
      if (a.y > y0) out.push(`${cx},${a.y - S}`);
      if (a.y < y1) out.push(`${cx},${a.y}`);
    } else {
      const cy = Math.min(a.y, b.y);
      if (a.x > x0) out.push(`${a.x - S},${cy}`);
      if (a.x < x1) out.push(`${a.x},${cy}`);
    }
    return out;
  };
}

/** Lehetséges hurokszámok topológiánként (a generátor ebből választ). */
export function meshOptions(t: Topology): number[] {
  switch (t) {
    case 'soros-parhuzamos':
    case 'letra':
      return [1, 2, 3, 4, 5, 6];
    case 'racs':
      return [2, 3, 4, 6];
    case 'gyuru':
      return [2, 3, 4, 5];
    case 'hid':
      return [3, 4];
  }
}

/** A sablon váza adott hurokszámra (a soros-párhuzamosat a generátor külön építi). */
export function skeletonFor(t: Topology, meshes: number, rng: Rng): Sketch | null {
  switch (t) {
    case 'soros-parhuzamos':
    case 'letra':
      return ladder(meshes);
    case 'racs':
      return meshes >= 4 ? grid(2, meshes / 2) : grid(1, meshes);
    case 'gyuru': {
      // 2 × cols rács, ebből (2·cols − meshes) belső ág hiányzik.
      const cols = meshes <= 3 ? 2 : 3;
      return ring(2, cols, 2 * cols - meshes, rng);
    }
    case 'hid':
      return bridge({ shunt: meshes === 4 });
  }
}
