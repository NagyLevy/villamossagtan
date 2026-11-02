// Trükk-tipp: csak azt árulja el, VAN-E egyszerűsíthető elem (illetve kell-e csillag-delta),
// azt nem, hogy melyik / hol.

import type { Problem } from '../generator/generate';
import { toNetlist } from '../solver/netlist';
import { isSeriesParallelReducible } from './seriesParallel';
import { findTricks } from './tricks';

export function trickHint(p: Problem, starDelta: boolean): string {
  const map = toNetlist(p.circuit);
  const net = map.net;
  const parts: string[] = [];
  const tricks = findTricks(net).filter((t) => t.dim);
  if (tricks.length) {
    parts.push(
      tricks.length === 1
        ? 'Van egy elem, amely nem befolyásolja a többi elem áramát és feszültségét. Keresd meg: egy áramforrással sorba kötött vagy egy feszültségforrással közvetlenül párhuzamos ellenállás.'
        : `Van ${tricks.length} olyan elemcsoport, amely nem befolyásolja a többit. Áramforrással sorba kötött vagy feszültségforrással közvetlenül párhuzamos ellenállást keress.`,
    );
  } else {
    parts.push('Nincs olyan elem, amelyet a többi elem szempontjából egyszerűen el lehetne hagyni.');
  }
  if (starDelta) {
    const sources = net.elements.filter((e) => e.kind !== 'R');
    const rs = net.elements.filter((e) => e.kind === 'R').map((e) => ({ a: e.a, b: e.b }));
    let t: [number, number] | null = null;
    if (sources.length === 1) t = [sources[0]!.b, sources[0]!.a];
    else if (sources.length === 0 && p.circuit.terminals) t = [map.pointNode.get(p.circuit.terminals.a)!, map.pointNode.get(p.circuit.terminals.b)!];
    if (t && rs.length && !isSeriesParallelReducible(rs, t[0], t[1])) {
      parts.push('A hálózat soros-párhuzamos összevonással nem redukálható: csillag-delta átalakításra lesz szükség (hogy hol, azt neked kell megtalálnod).');
    }
  }
  return parts.join(' ');
}
