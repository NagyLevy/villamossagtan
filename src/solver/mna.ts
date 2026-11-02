// Referenciamegoldó: módosított csomóponti analízis (MNA). Ez az igazság forrása;
// minden módszer eredményét ehhez hasonlítjuk.
//
// Ismeretlenek: a nem-referencia csomópontok potenciálja + minden feszültségforrás árama.
// Komponensenként egy referenciacsomópont (a legkisebb sorszámú), így a különálló részek sem
// tesznek szingulárissá egy egyébként megoldható feladatot.

import type { Field } from './field';
import { solveLinear } from './linear';
import type { Netlist } from './model';
import { components } from './netlist';

export interface ElementResult<T> {
  /** U_ab = φ(a) − φ(b), a netlista a→b referenciairányában. */
  U: T;
  /** I_ab: az elemen a→b irányban átfolyó áram. */
  I: T;
  /** Felvett teljesítmény P = U·I. Forrásnál negatív = lead, pozitív = felvesz. */
  P: T;
}

export interface Solution<T> {
  nodeVoltage: T[];
  elements: Map<string, ElementResult<T>>;
}

export function solveMNA<T>(net: Netlist<T>, F: Field<T>): Solution<T> | null {
  const uf = components(net);
  // Komponensenként a legkisebb csomópont a referencia.
  const groundOf = new Map<number, number>();
  for (let n = 0; n < net.nodeCount; n++) {
    const r = uf.find(n);
    if (!groundOf.has(r)) groundOf.set(r, n);
  }
  const unknownIndex = new Map<number, number>();
  for (let n = 0; n < net.nodeCount; n++) {
    if (groundOf.get(uf.find(n)) !== n) unknownIndex.set(n, unknownIndex.size);
  }
  const vSources = net.elements.filter((e) => e.kind === 'V');
  const size = unknownIndex.size + vSources.length;

  const A: T[][] = Array.from({ length: size }, () => new Array<T>(size).fill(F.zero));
  const z: T[] = new Array<T>(size).fill(F.zero);
  const addA = (r: number | undefined, c: number | undefined, v: T) => {
    if (r === undefined || c === undefined) return;
    A[r]![c] = F.add(A[r]![c]!, v);
  };
  const addZ = (r: number | undefined, v: T) => {
    if (r === undefined) return;
    z[r] = F.add(z[r]!, v);
  };

  for (const e of net.elements) {
    const ia = unknownIndex.get(e.a);
    const ib = unknownIndex.get(e.b);
    if (e.kind === 'R') {
      const g = F.div(F.one, e.value);
      addA(ia, ia, g);
      addA(ib, ib, g);
      addA(ia, ib, F.neg(g));
      addA(ib, ia, F.neg(g));
    } else if (e.kind === 'I') {
      // a→b irányú forrásáram: a b csomópontba befolyik, az a-ból kifolyik.
      addZ(ib, e.value);
      addZ(ia, F.neg(e.value));
    }
  }
  vSources.forEach((e, k) => {
    const m = unknownIndex.size + k;
    const ia = unknownIndex.get(e.a);
    const ib = unknownIndex.get(e.b);
    // A forrás árama (a→b) az a csomópontból kifolyik, a b-be befolyik.
    addA(ia, m, F.one);
    addA(ib, m, F.neg(F.one));
    // φ(b) − φ(a) = E
    addA(m, ib, F.one);
    addA(m, ia, F.neg(F.one));
    z[m] = e.value;
  });

  const x = solveLinear(A, z, F);
  if (!x) return null;

  const nodeVoltage = Array.from({ length: net.nodeCount }, (_, n) => {
    const i = unknownIndex.get(n);
    return i === undefined ? F.zero : x[i]!;
  });
  const elements = new Map<string, ElementResult<T>>();
  const vIndex = new Map(vSources.map((e, k) => [e.id, unknownIndex.size + k]));
  for (const e of net.elements) {
    const U = F.sub(nodeVoltage[e.a]!, nodeVoltage[e.b]!);
    let I: T;
    if (e.kind === 'R') I = F.div(U, e.value);
    else if (e.kind === 'V') I = x[vIndex.get(e.id)!]!;
    else I = e.value;
    elements.set(e.id, { U, I, P: F.mul(U, I) });
  }
  return { nodeVoltage, elements };
}
