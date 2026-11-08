// A többforrásos módszerek közös számolómagja. Ez a módszerek SAJÁT számolása (nem az MNA):
// a tesztek ezt vetik össze a referenciamegoldóval.
//
//  - Összetett ágak: két lényeges (legalább háromágú) csomópont között sorban álló elemek.
//  - Hurkok (ablakok): a síkrajz belső tartományai, az óramutató járásával egyező körüljárással.
//  - Csomóponti megoldó: lényeges csomópontok potenciáljai, feszültségforrásos ágaknál
//    rögzített csomópont vagy szupercsomópont.

import { RealField } from '../solver/field';
import { solveLinear } from '../solver/linear';
import type { Circuit, ElementKind, NetElement, Netlist } from '../solver/model';
import { UnionFind, type NetlistMapping } from '../solver/netlist';

export type Values = Map<string, { U: number; I: number }>;

// ───────────────────────────── összetett ágak ─────────────────────────────

export interface PathElem {
  id: string;
  kind: ElementKind;
  value: number;
  /** +1, ha a bejárás (s → e) az elem a→b irányával egyezik. */
  d: 1 | -1;
}

export interface Path {
  id: number;
  /** Kezdő és vég csomópont (lényeges csomópontok). */
  s: number;
  e: number;
  elems: PathElem[];
  /** 'R': ellenállás(ok) és esetleg feszültségforrás(ok); 'I': áramforrás van benne; 'V': csak feszültségforrás(ok). */
  kind: 'R' | 'V' | 'I';
  /** Az ellenállások összege. */
  R: number;
  /** A feszültségforrások előjeles összege s → e irányban (potenciálemelkedés). */
  E: number;
  /** Áramforrásos ágban az ág árama s → e irányban. */
  J: number;
}

export interface Topology {
  essential: number[];
  paths: Path[];
}

/** Lényeges csomópontok és összetett ágak. null, ha nincs legalább két lényeges csomópont (egyetlen hurok). */
export function compoundPaths(net: Netlist, forceEssential: number[] = []): Topology | null {
  const incident = new Map<number, NetElement[]>();
  for (const e of net.elements) {
    incident.set(e.a, [...(incident.get(e.a) ?? []), e]);
    incident.set(e.b, [...(incident.get(e.b) ?? []), e]);
  }
  // Lényeges: nem kétfokú csomópont, vagy amit a hívó annak kér (pl. az A, B kapcsok).
  const essential = [...incident.keys()].filter((n) => incident.get(n)!.length !== 2 || forceEssential.includes(n)).sort((x, y) => x - y);
  if (essential.length < 1) return null;
  const isEss = new Set(essential);
  const used = new Set<string>();
  const paths: Path[] = [];
  for (const s of essential) {
    for (const first of incident.get(s)!) {
      if (used.has(first.id)) continue;
      const elems: PathElem[] = [];
      let cur = s;
      let el = first;
      for (;;) {
        used.add(el.id);
        const d: 1 | -1 = el.a === cur ? 1 : -1;
        elems.push({ id: el.id, kind: el.kind, value: el.value, d });
        cur = d === 1 ? el.b : el.a;
        if (isEss.has(cur)) break;
        const next = incident.get(cur)!.find((x) => x !== el);
        if (!next) break;
        el = next;
      }
      const hasI = elems.some((x) => x.kind === 'I');
      const hasR = elems.some((x) => x.kind === 'R');
      const isrc = elems.find((x) => x.kind === 'I');
      paths.push({
        id: paths.length,
        s,
        e: cur,
        elems,
        kind: hasI ? 'I' : hasR ? 'R' : 'V',
        R: elems.filter((x) => x.kind === 'R').reduce((acc, x) => acc + x.value, 0),
        E: elems.filter((x) => x.kind === 'V').reduce((acc, x) => acc + x.d * x.value, 0),
        J: isrc ? isrc.d * isrc.value : 0,
      });
    }
  }
  return { essential, paths };
}

/** Az összetett ág árama s → e irányban a végpontok potenciáljából (R-ágra). */
export function pathCurrent(p: Path, phi: Map<number, number>): number {
  if (p.kind === 'I') return p.J;
  return (phi.get(p.s)! - phi.get(p.e)! + p.E) / p.R;
}

// ───────────────────────────── csomóponti megoldó ─────────────────────────────

export interface NodalSystem {
  topo: Topology;
  ground: number;
  /** Ismeretlen potenciálú csomópontok (a referencia és a rögzítettek nélkül is lehetnek benne szupercsomópont-tagok). */
  unknowns: number[];
  /** Feszültségforrásos ágakkal összekötött csomópontcsoportok. */
  groups: number[][];
  /** Egyenletek: együtthatók az ismeretlenekre + jobb oldal; leírásuk a lépésekhez. */
  rows: { coeffs: number[]; rhs: number; kind: 'kcl' | 'fix'; nodes: number[]; path?: Path }[];
}

/** Referenciacsomópont: a legtöbb ághoz csatlakozó lényeges csomópont (döntetlennél a kisebb sorszám). */
export function chooseGround(topo: Topology): number {
  // A tanár úr szerint: a referencia (φ = 0) az a csomópont legyen, amelyik a legtöbb csomópont
  // potenciálját megadja, vagyis amelyikhez feszültségforrásokon át a legtöbb csomópont kapcsolódik.
  // Döntetlennél a több ághoz csatlakozó.
  const deg = (n: number) => topo.paths.filter((p) => p.s === n || p.e === n).length;
  const fixed = (g: number) => {
    const seen = new Set([g]);
    const queue = [g];
    while (queue.length) {
      const n = queue.shift()!;
      for (const p of topo.paths) {
        if (p.kind !== 'V' || p.s === p.e) continue;
        const m = p.s === n ? p.e : p.e === n ? p.s : null;
        if (m !== null && !seen.has(m)) {
          seen.add(m);
          queue.push(m);
        }
      }
    }
    return seen.size - 1;
  };
  return [...topo.essential].sort((a, b) => fixed(b) - fixed(a) || deg(b) - deg(a) || a - b)[0]!;
}

export function buildNodal(net: Netlist, ground?: number, forceEssential: number[] = []): NodalSystem | null {
  const topo = compoundPaths(net, forceEssential);
  if (!topo || topo.essential.length < 2) return null;
  const g = ground ?? chooseGround(topo);
  const unknowns = topo.essential.filter((n) => n !== g);
  const idx = new Map(unknowns.map((n, i) => [n, i]));
  const uf = new UnionFind(net.nodeCount);
  for (const p of topo.paths) if (p.kind === 'V') uf.union(p.s, p.e);
  const groupMap = new Map<number, number[]>();
  for (const n of topo.essential) groupMap.set(uf.find(n), [...(groupMap.get(uf.find(n)) ?? []), n]);
  const groups = [...groupMap.values()];
  const rows: NodalSystem['rows'] = [];
  const row = () => new Array<number>(unknowns.length).fill(0);
  const add = (r: number[], n: number, v: number) => {
    const i = idx.get(n);
    if (i !== undefined) r[i]! += v;
  };
  for (const grp of groups) {
    // Rögzítés / szupercsomópont: φ(e) − φ(s) = E minden feszültségforrásos ágra.
    for (const p of topo.paths.filter((x) => x.kind === 'V' && grp.includes(x.s))) {
      if (p.s === p.e) continue;
      const r = row();
      add(r, p.e, 1);
      add(r, p.s, -1);
      rows.push({ coeffs: r, rhs: p.E, kind: 'fix', nodes: [p.s, p.e], path: p });
    }
    if (grp.includes(g)) continue;
    // Csomóponti törvény a csoportra: a kifolyó áramok összege nulla.
    const r = row();
    let c = 0;
    for (const p of topo.paths) {
      if (p.kind === 'V' || p.s === p.e) continue;
      const sIn = grp.includes(p.s);
      const eIn = grp.includes(p.e);
      if (sIn === eIn) continue;
      const sign = sIn ? 1 : -1; // s-ből kifolyó áram pozitív
      if (p.kind === 'I') c += sign * p.J;
      else {
        add(r, p.s, sign / p.R);
        add(r, p.e, -sign / p.R);
        c += (sign * p.E) / p.R;
      }
    }
    rows.push({ coeffs: r, rhs: -c, kind: 'kcl', nodes: grp });
  }
  return { topo, ground: g, unknowns, groups, rows };
}

export interface NodalSolution {
  sys: NodalSystem;
  phi: Map<number, number>;
  currents: Map<number, number>;
  values: Values;
}

export function solveNodal(net: Netlist, ground?: number): NodalSolution | null {
  const sys = buildNodal(net, ground);
  if (!sys || sys.rows.length !== sys.unknowns.length) return null;
  const x = solveLinear(
    sys.rows.map((r) => r.coeffs),
    sys.rows.map((r) => r.rhs),
    RealField,
  );
  if (!x) return null;
  const phi = new Map<number, number>([[sys.ground, 0]]);
  sys.unknowns.forEach((n, i) => phi.set(n, x[i]!));
  const currents = new Map<number, number>();
  for (const p of sys.topo.paths) if (p.kind !== 'V') currents.set(p.id, p.s === p.e && p.kind === 'R' ? p.E / p.R : pathCurrent(p, phi));
  // Feszültségforrásos ágak árama a csomóponti törvényből (a fa leveleitől befelé).
  const vPaths = sys.topo.paths.filter((p) => p.kind === 'V');
  for (let guard = 0; guard < vPaths.length + 1; guard++) {
    const open = vPaths.filter((p) => !currents.has(p.id));
    if (open.length === 0) break;
    for (const n of sys.topo.essential) {
      const unknownHere = open.filter((p) => p.s === n || p.e === n);
      if (unknownHere.length !== 1) continue;
      const p = unknownHere[0]!;
      let out = 0;
      for (const q of sys.topo.paths) {
        if (q === p || !currents.has(q.id)) continue;
        if (q.s === n) out += currents.get(q.id)!;
        if (q.e === n) out -= currents.get(q.id)!;
      }
      // p árama s → e: ha n = s, kifolyó; Σ = 0.
      currents.set(p.id, p.s === n ? -out : out);
    }
  }
  const values = elementValues(sys.topo, phi, currents);
  return { sys, phi, currents, values };
}

/** Elemenkénti U, I az ágáramokból és a potenciálokból (az ágon végigsétálva). */
export function elementValues(topo: Topology, phi: Map<number, number>, currents: Map<number, number>): Values {
  const out: Values = new Map();
  for (const p of topo.paths) {
    const I = currents.get(p.id) ?? 0;
    const known = (el: PathElem): number | null => (el.kind === 'R' ? el.value * el.d * I : el.kind === 'V' ? -el.value : null);
    // Előre s-től, hátra e-től; az áramforrás feszültsége a kettő különbsége.
    const fwd: number[] = [phi.get(p.s)!];
    let i = 0;
    for (; i < p.elems.length; i++) {
      const U = known(p.elems[i]!);
      if (U === null) break;
      fwd.push(fwd[fwd.length - 1]! - p.elems[i]!.d * U);
    }
    let back = phi.get(p.e)!;
    for (let j = p.elems.length - 1; j > i; j--) {
      const U = known(p.elems[j]!)!;
      back = back + p.elems[j]!.d * U;
    }
    for (const el of p.elems) {
      const Iab = el.d * I;
      // Áramforrás: a belépési oldal potenciálja (előre) és a kilépésié (hátulról) adja a feszültségét.
      const U = el.kind === 'I' ? el.d * (fwd[fwd.length - 1]! - back) : known(el)!;
      out.set(el.id, { U, I: Iab });
    }
  }
  return out;
}

// ───────────────────────────── hurkok (ablakok) ─────────────────────────────

export interface Mesh {
  index: number;
  /** Az ablak elemei körüljárási sorrendben, előjellel (az óramutató járásával egyező körüljárás). */
  elements: { id: string; sign: 1 | -1 }[];
}

/**
 * A síkrajz belső tartományai. Minden ághoz két oldal tartozik; a lapokat a rácspontokban
 * a szomszédos ágak szög szerinti rendezésével járjuk körbe. A külső tartomány kimarad,
 * ahogy az elem nélküli (csupa vezeték) tartományok is.
 */
export function meshes(circuit: Circuit, map: NetlistMapping): Mesh[] {
  const pos = new Map(circuit.points.map((p) => [p.id, p]));
  type Half = { from: number; to: number; branch: (typeof circuit.branches)[number]; forward: boolean };
  const out = new Map<number, Half[]>();
  for (const b of circuit.branches) {
    out.set(b.from, [...(out.get(b.from) ?? []), { from: b.from, to: b.to, branch: b, forward: true }]);
    out.set(b.to, [...(out.get(b.to) ?? []), { from: b.to, to: b.from, branch: b, forward: false }]);
  }
  const angle = (h: Half) => {
    const p = pos.get(h.from)!;
    const q = pos.get(h.to)!;
    return Math.atan2(q.y - p.y, q.x - p.x);
  };
  for (const hs of out.values()) hs.sort((a, b) => angle(a) - angle(b));
  const visited = new Set<Half>();
  const faces: Half[][] = [];
  for (const hs of out.values()) {
    for (const start of hs) {
      if (visited.has(start)) continue;
      const face: Half[] = [];
      let h = start;
      for (let guard = 0; guard < 10000 && !visited.has(h); guard++) {
        visited.add(h);
        face.push(h);
        // A célpontban a visszafelé mutató fél-él utáni (szög szerint következő) fél-él.
        const around = out.get(h.to)!;
        const back = around.findIndex((x) => x.branch === h.branch && x.to === h.from);
        h = around[(back + 1) % around.length]!;
      }
      faces.push(face);
    }
  }
  const area = (f: Half[]) => {
    let s = 0;
    for (const h of f) {
      const p = pos.get(h.from)!;
      const q = pos.get(h.to)!;
      s += p.x * q.y - q.x * p.y;
    }
    return s / 2;
  };
  // A külső tartomány a legnagyobb abszolút területű; a belsők előjele ezzel ellentétes.
  const outer = faces.reduce((m, f) => (Math.abs(area(f)) > Math.abs(area(m)) ? f : m), faces[0]!);
  const inner = faces.filter((f) => f !== outer && Math.abs(area(f)) > 1e-9);
  const found: { elements: Mesh['elements']; cx: number; cy: number }[] = [];
  for (const f of inner) {
    // Képernyőn (y lefelé) a pozitív terület az óramutató járásával egyező körüljárás.
    const cw = area(f) > 0;
    const halves = cw ? f : [...f].reverse().map((h) => ({ from: h.to, to: h.from, branch: h.branch, forward: !h.forward }));
    const elements: Mesh['elements'] = [];
    for (const h of halves) {
      const els = h.forward ? h.branch.elements : [...h.branch.elements].reverse();
      for (const el of els) {
        // Az elem a→b iránya az ág from→to irányával egyezik-e.
        const aIsFrom = el.kind === 'R' || el.dir === 1;
        elements.push({ id: el.id, sign: h.forward === aIsFrom ? 1 : -1 });
      }
    }
    const pts = halves.map((h) => pos.get(h.from)!);
    const cx = pts.reduce((s, p) => s + p.x, 0) / pts.length;
    const cy = pts.reduce((s, p) => s + p.y, 0) / pts.length;
    if (elements.length && elements.every((e) => map.net.elements.some((x) => x.id === e.id))) found.push({ elements, cx, cy });
  }
  // Olvasási sorrend: fentről lefelé, balról jobbra a tartomány közepe szerint.
  found.sort((a, b) => a.cy - b.cy || a.cx - b.cx);
  return found.map((f, i) => ({ index: i + 1, elements: f.elements }));
}

// ───────────────────────────── bármilyen részáramkör ─────────────────────────────

/**
 * Elemértékek egy (rész)hálózatra a módszer saját számolásával: csomóponti megoldó, illetve
 * egyetlen hurok esetén a hurok árama közvetlenül. Különálló, forrás nélküli részek árama nulla.
 */
export function solveAny(net: Netlist): Values | null {
  const nodal = solveNodal(net);
  if (nodal) return nodal.values;
  // Egyetlen közös csomópontban érintkező hurkok ("nyolcas"): mindegyik hurok külön számolható.
  const topo = compoundPaths(net);
  if (topo && topo.essential.length === 1) {
    const n = topo.essential[0]!;
    const currents = new Map<number, number>();
    for (const p of topo.paths) {
      if (p.s !== p.e) return null;
      if (p.kind === 'I') currents.set(p.id, p.J);
      else if (p.kind === 'R') currents.set(p.id, p.E / p.R);
      else return null;
    }
    return elementValues(topo, new Map([[n, 0]]), currents);
  }
  // Egyetlen hurok (vagy hurok nélküli lánc): a forrás határozza meg az áramot.
  const els = net.elements;
  if (els.length === 0) return new Map();
  const isrc = els.find((e) => e.kind === 'I');
  // A hurkot a 0. elem a→b irányában járjuk körbe.
  const order: { el: NetElement; d: 1 | -1 }[] = [];
  let cur = els[0]!.a;
  const used = new Set<string>();
  for (let guard = 0; guard < els.length; guard++) {
    const el = els.find((e) => !used.has(e.id) && (e.a === cur || e.b === cur));
    if (!el) break;
    used.add(el.id);
    const d: 1 | -1 = el.a === cur ? 1 : -1;
    order.push({ el, d });
    cur = d === 1 ? el.b : el.a;
  }
  const closed = order.length === els.length && cur === els[0]!.a;
  if (!closed) {
    // Nyitott lánc (pl. szakadással kiiktatott áramforrás után): nem folyik áram.
    if (isrc) return null;
    return new Map(els.map((e) => [e.id, { U: e.kind === 'V' ? -e.value : 0, I: 0 }]));
  }
  const R = order.filter((x) => x.el.kind === 'R').reduce((s, x) => s + x.el.value, 0);
  let I: number;
  if (isrc) I = order.find((x) => x.el === isrc)!.d * isrc.value;
  else {
    const E = order.filter((x) => x.el.kind === 'V').reduce((s, x) => s + x.d * x.el.value, 0);
    if (R === 0) return null;
    I = E / R;
  }
  const out: Values = new Map();
  let sumKnown = 0;
  for (const x of order) {
    const Iab = x.d * I;
    if (x.el.kind === 'I') continue;
    const U = x.el.kind === 'R' ? x.el.value * Iab : -x.el.value;
    out.set(x.el.id, { U, I: Iab });
    sumKnown += x.d * U;
  }
  // A hurok mentén a feszültségek összege nulla: ebből az áramforrás feszültsége.
  if (isrc) {
    const x = order.find((y) => y.el === isrc)!;
    out.set(isrc.id, { U: -sumKnown / x.d, I: x.d * I });
  }
  return out;
}
