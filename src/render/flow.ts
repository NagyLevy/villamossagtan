// Az áramlás-animáció adatai: minden kirajzolt vezetékszakaszra az ott folyó áram (előjelesen,
// a szakasz a→b irányában). Elemes ágban az elem árama; elem nélküli vezetékekben a
// rácspontokra felírt csomóponti törvényből (a vezetékfa leveleitől befelé).

import type { Highlight } from '../methods/types';
import { RealField } from '../solver/field';
import { solveMNA } from '../solver/mna';
import type { Circuit, NetElement } from '../solver/model';
import { toNetlist } from '../solver/netlist';
import type { Layout, Pt } from './layout';

export interface FlowSegment {
  a: Pt;
  b: Pt;
  /** Áram a→b irányban (A). */
  I: number;
}

/**
 * Az ábra adott állapotához tartozó elemáramok (MNA): a kiiktatott feszültségforrás 0 V,
 * a kiiktatott áramforrás 0 A; a "szakadás" jelű elem nem vezet, a "rövidzár" jelű 0 Ω.
 */
export function stateCurrents(c: Circuit, h: Highlight): Map<string, number> {
  const { net } = toNetlist(c);
  const killed = new Map((h.killed ?? []).map((k) => [k.element, k.as]));
  const elements: NetElement[] = net.elements.map((e) => {
    const k = killed.get(e.id);
    if (!k) return e;
    if (e.kind === 'V') return { ...e, value: 0 };
    if (e.kind === 'I') return { ...e, value: 0 };
    return k === 'open' ? { ...e, kind: 'I', value: 0 } : { ...e, kind: 'V', value: 0 };
  });
  const sol = solveMNA({ nodeCount: net.nodeCount, elements }, RealField);
  const out = new Map<string, number>();
  if (!sol) return out;
  for (const e of net.elements) out.set(e.id, sol.elements.get(e.id)!.I);
  return out;
}

export function flowSegments(c: Circuit, layout: Layout, current: Map<string, number>): FlowSegment[] {
  // Ágáram from→to irányban.
  const branchI = new Map<string, number>();
  const inj = new Map<number, number>();
  const addInj = (p: number, v: number) => inj.set(p, (inj.get(p) ?? 0) + v);
  for (const br of c.branches) {
    const el = br.elements[0];
    if (!el) continue;
    const I = current.get(el.id) ?? 0;
    const aIsFrom = el.kind === 'R' || el.dir === 1;
    const ft = aIsFrom ? I : -I;
    branchI.set(br.id, ft);
    addInj(br.from, -ft);
    addInj(br.to, ft);
  }
  // Vezetékek: a csomóponti törvény rácspontonként, levelektől befelé.
  const wires = c.branches.filter((b) => b.elements.length === 0);
  const flow = new Map<string, number>();
  for (let guard = 0; guard <= wires.length; guard++) {
    let progressed = false;
    for (const p of c.points) {
      const open = wires.filter((w) => !flow.has(w.id) && (w.from === p.id || w.to === p.id));
      if (open.length !== 1) continue;
      const w = open[0]!;
      let inflow = inj.get(p.id) ?? 0;
      for (const v of wires) {
        if (!flow.has(v.id)) continue;
        if (v.to === p.id) inflow += flow.get(v.id)!;
        if (v.from === p.id) inflow -= flow.get(v.id)!;
      }
      // A hiányzó vezeték befolyása −inflow kell legyen.
      flow.set(w.id, w.to === p.id ? -inflow : inflow);
      progressed = true;
    }
    if (!progressed) break;
  }
  for (const w of wires) if (!flow.has(w.id)) flow.set(w.id, 0);
  return layout.wires
    .filter((s) => Math.hypot(s.b.x - s.a.x, s.b.y - s.a.y) > 2)
    .map((s) => ({ a: s.a, b: s.b, I: branchI.get(s.branchId) ?? flow.get(s.branchId) ?? 0 }));
}
