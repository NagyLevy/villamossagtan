// "Áramkör újrarajzolása": minden összevonás után egyszerűsített rajz. Soros összevonásnál az első
// ellenállás marad (az eredő értékével, Re′ néven), a többi helyén vezeték lesz; párhuzamosnál az
// egyik ág marad, a többi ág eltűnik. A végére egyetlen ellenállás marad a rajzon.

import { ePlain } from './tex';
import type { Circuit } from '../solver/model';
import type { Edge, Reduction } from './reduction';

function clone(c: Circuit): Circuit {
  return {
    points: c.points.map((p) => ({ ...p })),
    branches: c.branches.map((b) => ({ ...b, elements: b.elements.map((e) => ({ ...e })) })),
    terminals: c.terminals ? { ...c.terminals } : undefined,
    ports: c.ports?.map((x) => ({ ...x })),
  };
}

/** A lógó vezetékcsonkok eltávolítása (a kapcsok és kivezetések maradnak). */
function prune(c: Circuit): void {
  const keep = new Set<number>([...(c.terminals ? [c.terminals.a, c.terminals.b] : []), ...(c.ports ?? []).map((x) => x.point)]);
  for (let changed = true; changed; ) {
    changed = false;
    const deg = new Map<number, number>();
    for (const b of c.branches) for (const p of [b.from, b.to]) deg.set(p, (deg.get(p) ?? 0) + 1);
    const i = c.branches.findIndex((b) => b.elements.length === 0 && [b.from, b.to].some((p) => deg.get(p) === 1 && !keep.has(p)));
    if (i >= 0) {
      c.branches.splice(i, 1);
      changed = true;
    }
  }
}

/** Az összevonások utáni rajzok (red.order sorrendjében) és az eredőt képviselő elem azonosítója. */
export function redrawSequence(base: Circuit, red: Reduction): { circuit: Circuit; keep: string }[] {
  const cur = clone(base);
  const rep = new Map<Edge, string>();
  const repOf = (e: Edge) => (e.kind === 'leaf' ? e.key : rep.get(e)!);
  const find = (id: string) => cur.branches.find((b) => b.elements.some((x) => x.id === id));
  const out: { circuit: Circuit; keep: string }[] = [];
  for (const e of red.order) {
    const [first, ...rest] = e.children.map((c) => repOf(c.edge));
    const keepBranch = find(first!);
    const kept = keepBranch?.elements.find((x) => x.id === first);
    if (kept) {
      kept.value = e.R;
      kept.name = `R${ePlain(e.key)}`;
    }
    for (const id of rest) {
      const br = find(id);
      if (!br) continue;
      if (e.kind === 'series') br.elements = br.elements.filter((x) => x.id !== id);
      else cur.branches.splice(cur.branches.indexOf(br), 1);
    }
    if (e.kind === 'parallel') prune(cur);
    rep.set(e, first!);
    out.push({ circuit: clone(cur), keep: first! });
  }
  return out;
}
