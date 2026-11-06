import type { Circuit, NetElement, Netlist } from './model';

/** Egyszerű union-find a csomópontok összevonásához. */
export class UnionFind {
  private parent: number[];

  constructor(n: number) {
    this.parent = Array.from({ length: n }, (_, i) => i);
  }

  find(x: number): number {
    while (this.parent[x] !== x) {
      this.parent[x] = this.parent[this.parent[x]!]!;
      x = this.parent[x]!;
    }
    return x;
  }

  /** true, ha eddig külön halmazban voltak. */
  union(a: number, b: number): boolean {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra === rb) return false;
    this.parent[rb] = ra;
    return true;
  }
}

export interface NetlistMapping {
  net: Netlist<number>;
  /** Rácspont → csomópont. */
  pointNode: Map<number, number>;
  /** Elem → (a, b) csomópont, a Netlist irányában. */
  elementNodes: Map<string, { a: number; b: number }>;
  /** Ág → a from→to sorrendben bejárt csomópontok (elemszám + 1 darab). */
  branchNodes: Map<string, number[]>;
}

/**
 * Rajzolható áramkör → villamos netlista.
 * A vezetékkel (elem nélküli ággal) összekötött pontok egy csomópontot alkotnak;
 * egy ágon belül az egymás utáni elemek között belső csomópont keletkezik.
 * A csomópontok számozása determinisztikus: először a pontok sorrendjében, aztán a belső csomópontok.
 */
export function toNetlist(c: Circuit): NetlistMapping {
  const idx = new Map<number, number>();
  c.points.forEach((p, i) => idx.set(p.id, i));
  const uf = new UnionFind(c.points.length);
  for (const br of c.branches) {
    if (br.elements.length === 0) uf.union(idx.get(br.from)!, idx.get(br.to)!);
  }

  const rootNode = new Map<number, number>();
  const pointNode = new Map<number, number>();
  let next = 0;
  for (const p of c.points) {
    const r = uf.find(idx.get(p.id)!);
    if (!rootNode.has(r)) rootNode.set(r, next++);
    pointNode.set(p.id, rootNode.get(r)!);
  }

  const elements: NetElement<number>[] = [];
  const elementNodes = new Map<string, { a: number; b: number }>();
  const branchNodes = new Map<string, number[]>();
  for (const br of c.branches) {
    const k = br.elements.length;
    const nodes = [pointNode.get(br.from)!];
    for (let i = 1; i < k; i++) nodes.push(next++);
    nodes.push(pointNode.get(br.to)!);
    if (k === 0) nodes.splice(1); // vezeték: egyetlen csomópont
    branchNodes.set(br.id, k === 0 ? [nodes[0]!] : nodes);
    br.elements.forEach((el, i) => {
      const n1 = nodes[i]!;
      const n2 = nodes[i + 1]!;
      const [a, b] = (el.kind === 'V' || el.kind === 'I') && el.dir === -1 ? [n2, n1] : [n1, n2];
      elements.push({ id: el.id, kind: el.kind, value: el.value, a, b });
      elementNodes.set(el.id, { a, b });
    });
  }
  return { net: { nodeCount: next, elements }, pointNode, elementNodes, branchNodes };
}

/** Összefüggő komponensek a megadott elemeken át (alapból minden elem). */
export function components<T>(net: Netlist<T>, include: (e: NetElement<T>) => boolean = () => true): UnionFind {
  const uf = new UnionFind(net.nodeCount);
  for (const e of net.elements) if (include(e)) uf.union(e.a, e.b);
  return uf;
}

/** Csomópontok átszámozása 0..k-1-re, a kimaradó (elem nélküli) csomópontok elhagyásával. */
export function compact<T>(net: Netlist<T>, map?: (n: number) => number): { net: Netlist<T>; nodeMap: Map<number, number> } {
  const nodeMap = new Map<number, number>();
  const id = (n: number) => {
    const m = map ? map(n) : n;
    if (!nodeMap.has(m)) nodeMap.set(m, nodeMap.size);
    return nodeMap.get(m)!;
  };
  const elements = net.elements.map((e) => ({ ...e, a: id(e.a), b: id(e.b) }));
  // Az eredeti csomópontokból az új számozásba mutató térkép.
  const full = new Map<number, number>();
  for (let n = 0; n < net.nodeCount; n++) {
    const m = map ? map(n) : n;
    if (nodeMap.has(m)) full.set(n, nodeMap.get(m)!);
  }
  return { net: { nodeCount: nodeMap.size, elements }, nodeMap: full };
}

/** Két csomópont összevonása (rövidzár). Az eredeti → új csomópont térképet is visszaadja. */
export function mergeNodes<T>(net: Netlist<T>, a: number, b: number): { net: Netlist<T>; nodeMap: Map<number, number> } {
  return mergeMany(net, [[a, b]]);
}

export function mergeMany<T>(net: Netlist<T>, pairs: [number, number][]): { net: Netlist<T>; nodeMap: Map<number, number> } {
  const uf = new UnionFind(net.nodeCount);
  for (const [a, b] of pairs) uf.union(a, b);
  return compact(net, (n) => uf.find(n));
}

export function removeElements<T>(net: Netlist<T>, ids: Iterable<string>): Netlist<T> {
  const drop = new Set(ids);
  return { nodeCount: net.nodeCount, elements: net.elements.filter((e) => !drop.has(e.id)) };
}

/**
 * Források kiiktatása: feszültségforrás → rövidzár (csomópont-összevonás), áramforrás → szakadás (törlés).
 * `keep` azonosítójú források megmaradnak (szuperpozícióhoz).
 */
export function killSources<T>(net: Netlist<T>, keep: Iterable<string> = []): { net: Netlist<T>; nodeMap: Map<number, number> } {
  const keepSet = new Set(keep);
  const killed = net.elements.filter((e) => e.kind !== 'R' && !keepSet.has(e.id));
  const shorts = killed.filter((e) => e.kind === 'V').map((e) => [e.a, e.b] as [number, number]);
  const rest = removeElements(net, killed.map((e) => e.id));
  // A csomópontszámot megtartjuk, hogy az eredeti számozás leképezhető maradjon.
  return mergeMany({ nodeCount: net.nodeCount, elements: rest.elements }, shorts);
}
