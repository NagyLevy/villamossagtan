// Soros-párhuzamos redukálhatóság vizsgálata: megoldható-e egy ellenálláshálózat két kapocs felől
// pusztán soros és párhuzamos összevonással (csillag-delta átalakítás nélkül)?

import type { Netlist } from '../solver/model';
import { solve } from '../solver/analysis';
import { components, killSources, removeElements } from '../solver/netlist';

interface Edge {
  a: number;
  b: number;
}

/**
 * Multigráf-redukció a t1–t2 kapcsok felől:
 *  - önhurok (rövidre zárt ellenállás) elhagyása,
 *  - lógó ág elhagyása (1 fokú, nem kapocs csomópont),
 *  - soros összevonás (2 fokú, nem kapocs csomópont),
 *  - párhuzamos összevonás (azonos végpontú ágak).
 * Redukálható, ha a végén legfeljebb egyetlen t1–t2 ág marad.
 */
export function isSeriesParallelReducible(edgesIn: readonly Edge[], t1: number, t2: number): boolean {
  if (t1 === t2) return true;
  let edges = edgesIn.map((e) => ({ ...e }));
  let changed = true;
  while (changed) {
    changed = false;
    edges = edges.filter((e) => e.a !== e.b);

    // Párhuzamos ágak összevonása.
    const seen = new Set<string>();
    const merged: Edge[] = [];
    for (const e of edges) {
      const key = e.a < e.b ? `${e.a}-${e.b}` : `${e.b}-${e.a}`;
      if (seen.has(key)) {
        changed = true;
        continue;
      }
      seen.add(key);
      merged.push(e);
    }
    edges = merged;

    const degree = new Map<number, number>();
    for (const e of edges) {
      degree.set(e.a, (degree.get(e.a) ?? 0) + 1);
      degree.set(e.b, (degree.get(e.b) ?? 0) + 1);
    }
    for (const [node, d] of degree) {
      if (node === t1 || node === t2) continue;
      if (d === 1) {
        edges = edges.filter((e) => e.a !== node && e.b !== node);
        changed = true;
        break;
      }
      if (d === 2) {
        const [e1, e2] = edges.filter((e) => e.a === node || e.b === node) as [Edge, Edge];
        const o1 = e1.a === node ? e1.b : e1.a;
        const o2 = e2.a === node ? e2.b : e2.a;
        edges = edges.filter((e) => e !== e1 && e !== e2);
        edges.push({ a: o1, b: o2 });
        changed = true;
        break;
      }
    }
  }
  edges = edges.filter((e) => e.a !== e.b);
  if (edges.length === 0) return true;
  return edges.length === 1 && ((edges[0]!.a === t1 && edges[0]!.b === t2) || (edges[0]!.a === t2 && edges[0]!.b === t1));
}

/** Csak az ellenállásokból álló gráf egy netlistából. */
export function resistorEdges(net: Netlist): Edge[] {
  return net.elements.filter((e) => e.kind === 'R').map((e) => ({ a: e.a, b: e.b }));
}

/**
 * Kell-e csillag-delta átalakítás az a–b kapcsok felől nézett eredő meghatározásához?
 * A források kiiktatva. Ha szerkezetileg nem soros-párhuzamos, de kiegyenlített híd
 * (van árammentes ellenállás, amelynek elhagyása után redukálható), akkor nem kell.
 */
export function needsStarDeltaBetween(net: Netlist, a: number, b: number): boolean {
  const { net: k, nodeMap } = killSources(net);
  const ka = nodeMap.get(a);
  const kb = nodeMap.get(b);
  if (ka === undefined || kb === undefined || ka === kb) return false;
  const edges = resistorEdges(k);
  if (isSeriesParallelReducible(edges, ka, kb)) return false;

  // Kiegyenlített híd: 1 A próbaárammal megnézzük, mely ellenállások árammentesek.
  const uf = components(k);
  if (uf.find(ka) !== uf.find(kb)) return false;
  const sol = solve({ nodeCount: k.nodeCount, elements: [...k.elements, { id: '__test', kind: 'I', value: 1, a: kb, b: ka }] });
  if (!sol) return true;
  const zero = k.elements.filter((e) => e.kind === 'R' && Math.abs(sol.elements.get(e.id)!.I) < 1e-9);
  if (zero.length === 0) return true;
  const rest = k.elements.filter((e) => e.kind === 'R' && !zero.includes(e)).map((e) => ({ a: e.a, b: e.b }));
  return !isSeriesParallelReducible(rest, ka, kb);
}

/**
 * Kiegyenlített híd felismerése: a t1–t2 kapcsok felől 1 A próbaárammal megnézzük, mely ellenállásokon
 * nem folyik áram, és ha ezek elhagyásával a hálózat soros-párhuzamossá válik, visszaadjuk őket.
 * Csak az ellenállásokat nézi (a forrásokat a hívó hagyja el).
 */
export function zeroCurrentResistors(net: Netlist, t1: number, t2: number): string[] {
  const rs = net.elements.filter((e) => e.kind === 'R');
  const sol = solve({ nodeCount: net.nodeCount, elements: [...rs, { id: '__test', kind: 'I', value: 1, a: t2, b: t1 }] });
  if (!sol) return [];
  const zero = rs.filter((e) => Math.abs(sol.elements.get(e.id)!.I) < 1e-9).map((e) => e.id);
  if (zero.length === 0) return [];
  const rest = rs.filter((e) => !zero.includes(e.id)).map((e) => ({ a: e.a, b: e.b }));
  return isSeriesParallelReducible(rest, t1, t2) ? zero : [];
}

/**
 * Egyforrású hálózat: megoldható-e a forrás felől soros-párhuzamos redukcióval és osztással?
 * A forrás kapcsai felől nézett ellenálláshálózatot vizsgáljuk.
 */
export function singleSourceNeedsStarDelta(net: Netlist): boolean {
  const sources = net.elements.filter((e) => e.kind !== 'R');
  if (sources.length !== 1) throw new Error('singleSourceNeedsStarDelta: pontosan egy forrás kell');
  const s = sources[0]!;
  // A forrást elhagyjuk (nem kiiktatjuk): feszültségforrásnál a rövidzár összevonná a két kapcsot,
  // és minden hálózat "redukálhatónak" látszana.
  return needsStarDeltaBetween(removeElements(net, [s.id]), s.a, s.b);
}
