// Egyszerűsítési trükkök felismerése: olyan elemek, amelyek nem befolyásolják a többi elem
// áramát / feszültségét, és olyan csoportok, amelyek összevonhatók.

import { compoundPaths } from '../methods/engine';
import type { Netlist } from '../solver/model';

export type TrickKind = 'soros-aramforras' | 'parhuzamos-feszultsegforras' | 'soros-ellenallasok' | 'parhuzamos-ellenallasok' | 'parhuzamos-aramforrasok';

export interface Trick {
  kind: TrickKind;
  /** Az érintett elemek. */
  elements: string[];
  /** Elhalványítható-e (nem befolyásolja a többi elemet). */
  dim: boolean;
  /** Rövid magyar magyarázat. */
  text: string;
}

export function findTricks(net: Netlist): Trick[] {
  const topo = compoundPaths(net);
  if (!topo) return [];
  const tricks: Trick[] = [];
  const key = (s: number, e: number) => (s < e ? `${s}-${e}` : `${e}-${s}`);

  for (const p of topo.paths) {
    const rs = p.elems.filter((x) => x.kind === 'R').map((x) => x.id);
    if (p.kind === 'I' && rs.length) {
      tricks.push({
        kind: 'soros-aramforras',
        elements: rs,
        dim: true,
        text: `${rs.join(', ')} az áramforrással sorban van: az ágban mindenképp a forrás árama folyik, az ellenállás értéke a többi elem áramát és feszültségét nem befolyásolja.`,
      });
    } else if (p.kind === 'R' && rs.length >= 2) {
      tricks.push({ kind: 'soros-ellenallasok', elements: rs, dim: false, text: `${rs.join(' és ')} sorosan kapcsolódik, összevonható egyetlen ellenállássá.` });
    }
  }

  const byEnds = new Map<string, typeof topo.paths>();
  for (const p of topo.paths) if (p.s !== p.e) byEnds.set(key(p.s, p.e), [...(byEnds.get(key(p.s, p.e)) ?? []), p]);
  for (const group of byEnds.values()) {
    const vOnly = group.filter((p) => p.kind === 'V');
    const rOnly = group.filter((p) => p.kind === 'R' && p.elems.every((x) => x.kind === 'R'));
    const iOnly = group.filter((p) => p.kind === 'I' && p.elems.every((x) => x.kind === 'I'));
    if (vOnly.length && rOnly.length) {
      const rs = rOnly.flatMap((p) => p.elems.map((x) => x.id));
      tricks.push({
        kind: 'parhuzamos-feszultsegforras',
        elements: rs,
        dim: true,
        text: `${rs.join(', ')} közvetlenül egy feszültségforrással párhuzamos: a feszültsége a forrás feszültsége, és a többi elem feszültségét nem befolyásolja (csak a forrás áramát).`,
      });
    } else if (rOnly.length >= 2) {
      const rs = rOnly.flatMap((p) => p.elems.map((x) => x.id));
      tricks.push({ kind: 'parhuzamos-ellenallasok', elements: rs, dim: false, text: `${rs.join(' és ')} párhuzamosan kapcsolódik, összevonható.` });
    }
    if (iOnly.length >= 2) {
      const is = iOnly.flatMap((p) => p.elems.map((x) => x.id));
      tricks.push({ kind: 'parhuzamos-aramforrasok', elements: is, dim: false, text: `${is.join(' és ')} párhuzamos áramforrás: egyetlen, az áramok előjeles összegével egyenlő forrássá vonható össze.` });
    }
  }
  return tricks;
}
