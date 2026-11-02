// Generált áramkör érvényességének ellenőrzése. Érvénytelen esetén a generátor újrapróbálkozik.

import { solve } from '../solver/analysis';
import type { Circuit, NetElement, Netlist } from '../solver/model';
import { UnionFind, components, toNetlist } from '../solver/netlist';

export type Issue =
  | 'feszultsegforras-hurok' // csak feszültségforrásokból álló hurok (párhuzamos források is)
  | 'aramforras-vagat' // csak áramforrásokon át csatlakozó rész (soros áramforrások is)
  | 'nem-osszefuggo' // lebegő, nem csatlakozó rész
  | 'rovidre-zart-ellenallas'
  | 'rovidre-zart-aramforras'
  | 'szingularis'
  | 'geometria';

/** Villamos érvényesség a netlistán. */
export function netlistIssues(net: Netlist, opts: { allowShortedResistor?: boolean } = {}): Issue[] {
  const issues = new Set<Issue>();

  const vuf = new UnionFind(net.nodeCount);
  for (const e of net.elements) {
    if (e.kind === 'V' && !vuf.union(e.a, e.b)) issues.add('feszultsegforras-hurok');
    if (e.kind === 'R' && e.a === e.b && !opts.allowShortedResistor) issues.add('rovidre-zart-ellenallas');
    if (e.kind === 'I' && e.a === e.b) issues.add('rovidre-zart-aramforras');
  }

  const used = new Set<number>();
  for (const e of net.elements) used.add(e.a).add(e.b);
  const all = components(net);
  const noI = components(net, (e) => e.kind !== 'I');
  const roots = new Set([...used].map((n) => all.find(n)));
  const rootsNoI = new Set([...used].map((n) => noI.find(n)));
  if (roots.size > 1) issues.add('nem-osszefuggo');
  else if (rootsNoI.size > 1) issues.add('aramforras-vagat');

  if (issues.size === 0 && !solve(net)) issues.add('szingularis');
  return [...issues];
}

/**
 * Sorba kötött források: olyan csomópont, ahol pontosan két elem találkozik, és mindkettő forrás
 * (egy ágon belül egymás után, vagy egy sarkon át). A generátor ilyet nem készít.
 */
export function seriesSourcePairs(net: Netlist): [string, string][] {
  const incident = new Map<number, NetElement[]>();
  for (const e of net.elements) {
    incident.set(e.a, [...(incident.get(e.a) ?? []), e]);
    if (e.b !== e.a) incident.set(e.b, [...(incident.get(e.b) ?? []), e]);
  }
  const pairs: [string, string][] = [];
  for (const els of incident.values()) {
    if (els.length === 2 && els.every((e) => e.kind !== 'R')) pairs.push([els[0]!.id, els[1]!.id]);
  }
  return pairs;
}

/**
 * Geometriai érvényesség: az ágak vízszintesek vagy függőlegesek, nem fedik és nem keresztezik egymást,
 * nincs pont egy másik ág belsejében, nincs lógó pont (kivéve a kijelölt kapcsokat).
 */
export function geometryIssues(c: Circuit): string[] {
  const out: string[] = [];
  const pos = new Map(c.points.map((p) => [p.id, p]));
  const keys = new Set<string>();
  for (const p of c.points) {
    const k = `${p.x},${p.y}`;
    if (keys.has(k)) out.push(`ismétlődő pont ${k}`);
    keys.add(k);
  }
  const segs = c.branches.map((b) => {
    const p = pos.get(b.from)!;
    const q = pos.get(b.to)!;
    return { id: b.id, x1: p.x, y1: p.y, x2: q.x, y2: q.y, from: b.from, to: b.to };
  });
  for (const s of segs) {
    if (s.x1 !== s.x2 && s.y1 !== s.y2) out.push(`ferde ág ${s.id}`);
    if (s.x1 > s.x2 || s.y1 > s.y2) out.push(`fordított irányú ág ${s.id}`);
    if (s.x1 === s.x2 && s.y1 === s.y2) out.push(`nulla hosszú ág ${s.id}`);
  }
  // Pont nem lehet másik ág belsejében.
  for (const p of c.points) {
    for (const s of segs) {
      if (p.id === s.from || p.id === s.to) continue;
      const inside =
        (s.x1 === s.x2 && p.x === s.x1 && p.y > s.y1 && p.y < s.y2) || (s.y1 === s.y2 && p.y === s.y1 && p.x > s.x1 && p.x < s.x2);
      if (inside) out.push(`pont (${p.x},${p.y}) a(z) ${s.id} ág belsejében`);
    }
  }
  // Ágak nem keresztezhetik és nem fedhetik egymást (közös végpont megengedett).
  for (let i = 0; i < segs.length; i++) {
    for (let j = i + 1; j < segs.length; j++) {
      const s = segs[i]!;
      const t = segs[j]!;
      const sH = s.y1 === s.y2;
      const tH = t.y1 === t.y2;
      if (sH !== tH) {
        const [h, v] = sH ? [s, t] : [t, s];
        const strictly = v.x1 > h.x1 && v.x1 < h.x2 && h.y1 > v.y1 && h.y1 < v.y2;
        if (strictly) out.push(`kereszteződés: ${s.id} × ${t.id}`);
      } else if (sH && s.y1 === t.y1 && Math.min(s.x2, t.x2) > Math.max(s.x1, t.x1)) {
        out.push(`átfedés: ${s.id} / ${t.id}`);
      } else if (!sH && s.x1 === t.x1 && Math.min(s.y2, t.y2) > Math.max(s.y1, t.y1)) {
        out.push(`átfedés: ${s.id} / ${t.id}`);
      }
    }
  }
  const degree = new Map<number, number>();
  for (const b of c.branches) {
    degree.set(b.from, (degree.get(b.from) ?? 0) + 1);
    degree.set(b.to, (degree.get(b.to) ?? 0) + 1);
  }
  const terminals = new Set([...(c.terminals ? [c.terminals.a, c.terminals.b] : []), ...(c.ports ?? []).map((x) => x.point)]);
  for (const p of c.points) {
    const d = degree.get(p.id) ?? 0;
    if (d === 0) out.push(`magányos pont (${p.x},${p.y})`);
    if (d === 1 && !terminals.has(p.id)) out.push(`lógó pont (${p.x},${p.y})`);
  }
  return out;
}

/** Teljes ellenőrzés egy rajzolható áramkörre. */
export function circuitIssues(c: Circuit, opts: { allowShortedResistor?: boolean } = {}): Issue[] {
  const issues = netlistIssues(toNetlist(c).net, opts);
  if (geometryIssues(c).length) issues.push('geometria');
  return issues;
}
