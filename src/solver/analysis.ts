// Valós (DC) referenciaszámítások az MNA-ra építve: eredő ellenállás, Thevenin/Norton,
// szuperpozíciós részeredmény, Kirchhoff- és teljesítménymérleg-ellenőrzés.

import { RealField } from './field';
import type { Netlist } from './model';
import { solveMNA, type Solution } from './mna';
import { components, killSources, removeElements } from './netlist';

export type RealSolution = Solution<number>;

export function solve(net: Netlist): RealSolution | null {
  return solveMNA(net, RealField);
}

/** φ(a) − φ(b) egy megoldásból. */
export function voltageBetween(sol: RealSolution, a: number, b: number): number {
  return sol.nodeVoltage[a]! - sol.nodeVoltage[b]!;
}

/**
 * Eredő ellenállás az a–b csomópontok között, a források kiiktatásával
 * (feszültségforrás → rövidzár, áramforrás → szakadás). 1 A próbaáramot vezetünk be.
 * Rövidzárnál 0, ha a két pont nincs összekötve: Infinity.
 */
export function equivalentResistance(net: Netlist, a: number, b: number): number {
  const { net: k, nodeMap } = killSources(net);
  const ka = nodeMap.get(a);
  const kb = nodeMap.get(b);
  if (ka === undefined || kb === undefined) return Infinity;
  if (ka === kb) return 0;
  const uf = components(k);
  if (uf.find(ka) !== uf.find(kb)) return Infinity;
  // A próbaforrás b→a irányban hajt áramot, vagyis 1 A folyik be az a pontba.
  const test: Netlist = { nodeCount: k.nodeCount, elements: [...k.elements, { id: '__test', kind: 'I', value: 1, a: kb, b: ka }] };
  const sol = solve(test);
  if (!sol) return NaN;
  return voltageBetween(sol, ka, kb);
}

export interface TheveninResult {
  /** Üresjárási feszültség: φ(A) − φ(B), a terhelés lekötve. */
  Uth: number;
  /** A források kiiktatásával az A–B kapcsokról nézett ellenállás. */
  Rth: number;
  /** Rövidzárási áram A-ból B felé a külső rövidzáron át. */
  In: number;
  /** A kapcsok csomópontjai az eredeti netlistában. */
  a: number;
  b: number;
}

/**
 * Helyettesítő generátor egy (kétpólusú) terhelő elem kapcsaira.
 * A = a terhelés `a` kivezetése, B = a `b` kivezetése. null, ha valamelyik rész nem számolható.
 */
export function theveninAt(net: Netlist, loadId: string): TheveninResult | null {
  const load = net.elements.find((e) => e.id === loadId);
  if (!load) return null;
  return theveninBetween(removeElements(net, [loadId]), load.a, load.b);
}

/** Helyettesítő generátor az a–b csomópontok között (a hálózatban nincs terhelés). */
export function theveninBetween(open: Netlist, a: number, b: number): TheveninResult | null {
  const uf = components(open);
  if (uf.find(a) !== uf.find(b)) return null;
  const solOpen = solve(open);
  if (!solOpen) return null;
  const Uth = voltageBetween(solOpen, a, b);
  const Rth = equivalentResistance(open, a, b);
  const shorted: Netlist = { nodeCount: open.nodeCount, elements: [...open.elements, { id: '__short', kind: 'V', value: 0, a, b }] };
  const solShort = solve(shorted);
  if (!solShort) return null;
  const In = solShort.elements.get('__short')!.I;
  if (!Number.isFinite(Rth) || Number.isNaN(Rth)) return null;
  return { Uth, Rth, In, a, b };
}

/** A terhelés árama (A→B irányban a terhelésen át) a helyettesítő körből. */
export function loadCurrentFromThevenin(th: TheveninResult, RL: number): number {
  return th.Uth / (th.Rth + RL);
}

/**
 * Szuperpozíció: csak a `sourceId` forrás működik, a többi kiiktatva.
 * A kiiktatott források nem szerepelnek az eredményben; az elemek azonosítója megmarad.
 */
export function contribution(net: Netlist, sourceId: string): RealSolution | null {
  return solve(killSources(net, [sourceId]).net);
}

export interface ElementValues {
  U: number;
  I: number;
}

export interface KirchhoffReport {
  /** Csomópontonként a kifolyó áramok előjeles összege (ideálisan 0). */
  kcl: number[];
  /** Alapvető hurkonként a feszültségek előjeles összege (ideálisan 0). */
  kvl: { closingElement: string; residual: number }[];
  maxResidual: number;
}

/**
 * Kirchhoff-törvények ellenőrzése elemenkénti U és I értékekből (a csomóponti potenciáloktól függetlenül,
 * így módszerek eredményeire is használható). A hurkokat egy feszítőfa alapján képezzük.
 */
export function kirchhoffCheck(net: Netlist, values: Map<string, ElementValues>): KirchhoffReport {
  const kcl = new Array<number>(net.nodeCount).fill(0);
  for (const e of net.elements) {
    const v = values.get(e.id);
    if (!v) continue;
    kcl[e.a]! += v.I;
    kcl[e.b]! -= v.I;
  }

  // Feszítőfa BFS-sel; ψ = a fa mentén összegzett "potenciál" az elemfeszültségekből.
  const adj: { e: (typeof net.elements)[number]; other: number }[][] = Array.from({ length: net.nodeCount }, () => []);
  for (const e of net.elements) {
    adj[e.a]!.push({ e, other: e.b });
    adj[e.b]!.push({ e, other: e.a });
  }
  const psi = new Array<number | undefined>(net.nodeCount).fill(undefined);
  const treeEdges = new Set<string>();
  for (let root = 0; root < net.nodeCount; root++) {
    if (psi[root] !== undefined) continue;
    psi[root] = 0;
    const queue = [root];
    while (queue.length) {
      const n = queue.shift()!;
      for (const { e, other } of adj[n]!) {
        if (psi[other] !== undefined) continue;
        const U = values.get(e.id)?.U ?? 0;
        // U_ab = ψ(a) − ψ(b)
        psi[other] = e.a === n ? psi[n]! - U : psi[n]! + U;
        treeEdges.add(e.id);
        queue.push(other);
      }
    }
  }
  const kvl = net.elements
    .filter((e) => !treeEdges.has(e.id))
    .map((e) => ({ closingElement: e.id, residual: (values.get(e.id)?.U ?? 0) - (psi[e.a]! - psi[e.b]!) }));

  const maxResidual = Math.max(0, ...kcl.map(Math.abs), ...kvl.map((l) => Math.abs(l.residual)));
  return { kcl, kvl, maxResidual };
}

export interface Loop {
  /** A hurok elemei körüljárási sorrendben; sign = +1, ha a körüljárás az elem a→b irányával egyezik. */
  elements: { id: string; sign: 1 | -1 }[];
}

/** Alapvető hurkok egy feszítőfa alapján (minden fán kívüli elem egy hurkot zár). */
export function fundamentalLoops(net: Netlist): Loop[] {
  type Up = { node: number; elem: (typeof net.elements)[number] };
  const parent = new Array<Up | null | undefined>(net.nodeCount).fill(undefined);
  const depth = new Array<number>(net.nodeCount).fill(0);
  const adj: { e: (typeof net.elements)[number]; other: number }[][] = Array.from({ length: net.nodeCount }, () => []);
  for (const e of net.elements) {
    adj[e.a]!.push({ e, other: e.b });
    adj[e.b]!.push({ e, other: e.a });
  }
  const tree = new Set<string>();
  for (let root = 0; root < net.nodeCount; root++) {
    if (parent[root] !== undefined) continue;
    parent[root] = null;
    const queue = [root];
    while (queue.length) {
      const n = queue.shift()!;
      for (const { e, other } of adj[n]!) {
        if (parent[other] !== undefined) continue;
        parent[other] = { node: n, elem: e };
        depth[other] = depth[n]! + 1;
        tree.add(e.id);
        queue.push(other);
      }
    }
  }
  const loops: Loop[] = [];
  for (const e of net.elements) {
    if (tree.has(e.id)) continue;
    // a → b a záró elemen át, aztán b-ből a fán vissza a-ba (b felfelé az LCA-ig, onnan le a-ig).
    const up: Loop['elements'] = [];
    const down: Loop['elements'] = [];
    let x = e.b;
    let y = e.a;
    while (x !== y) {
      if (depth[x]! >= depth[y]!) {
        const p = parent[x]!;
        up.push({ id: p.elem.id, sign: p.elem.a === x ? 1 : -1 });
        x = p.node;
      } else {
        const p = parent[y]!;
        // A hurokban y felé haladunk lefelé: p.node → y.
        down.unshift({ id: p.elem.id, sign: p.elem.a === p.node ? 1 : -1 });
        y = p.node;
      }
    }
    loops.push({ elements: [{ id: e.id, sign: 1 }, ...up, ...down] });
  }
  return loops;
}

/** Teljesítménymérleg: az összes (felvett) teljesítmény összege, ideálisan 0. */
export function powerSum(sol: RealSolution): number {
  let s = 0;
  for (const r of sol.elements.values()) s += r.P;
  return s;
}

/** Független hurkok száma: ágak − csomópontok + komponensek (elemek mint ágak). */
export function meshCount(net: Netlist): number {
  const used = new Set<number>();
  for (const e of net.elements) {
    used.add(e.a);
    used.add(e.b);
  }
  const uf = components(net);
  const roots = new Set([...used].map((n) => uf.find(n)));
  return net.elements.length - used.size + roots.size;
}
