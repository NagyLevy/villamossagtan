// Az ábra geometriája: hol áll minden elem, merre néz, hová kerül a felirata és a forrásnyíl.
// Tiszta függvény (nincs DOM), így tesztelhető: a feliratok nem takarhatják egymást és a vezetékeket.

import type { Circuit, CircuitElement } from '../solver/model';
import { elementUnit } from '../solver/model';
import { formatQuantity } from '../units';

/** Egy rácsegység pixelben (a sablonok lépésköze 2 egység = 140 px). */
export const UNIT = 70;
/** Egy ágon belül egymás után álló elemek középpontjainak távolsága. */
const ELEMENT_PITCH = 54;
export const MARGIN = 72;

export const SIZE = {
  /** Ellenállás téglalapja: hossz a vezeték mentén, szélesség rá merőlegesen. */
  resistorLen: 40,
  resistorWidth: 16,
  sourceRadius: 15,
  /** Tekercs: négy félkörív a vezeték mentén. */
  inductorLen: 40,
  inductorWidth: 12,
  /** Kondenzátor: két lemez, köztük rés. */
  capGap: 8,
  capPlate: 24,
  /** Kapcsoló: ferde kar két kivezetés között. */
  switchLen: 32,
  switchWidth: 16,
  /** A forrásnyíl ilyen messze fut a vezeték vonalától. */
  arrowOffset: 25,
  arrowLen: 26,
  labelGap: 7,
  fontSize: 13,
  labelHeight: 15,
  junctionRadius: 3.2,
  terminalRadius: 4.5,
};

export interface Pt {
  x: number;
  y: number;
}

export interface Box {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export type Side = 'above' | 'below' | 'left' | 'right';

export interface LabelGeom {
  text: string;
  /** A szöveg horgonypontja (alapvonal). */
  x: number;
  y: number;
  anchor: 'start' | 'middle' | 'end';
  side: Side;
  box: Box;
}

export interface ElementGeom {
  el: CircuitElement;
  branchId: string;
  center: Pt;
  /** Vízszintes, függőleges vagy átlós (keresztbe kötött) ág. */
  orient: 'h' | 'v' | 'd';
  /** Az ág from→to iránya egységvektorként (jobbra vagy lefelé). */
  axis: Pt;
  /** Fél hossz a vezeték mentén és fél szélesség rá merőlegesen. */
  halfLen: number;
  halfWidth: number;
  body: Box;
  label: LabelGeom;
  /**
   * A forrás nyila a kör mellett, a vezetékkel párhuzamosan.
   * Feszültségforrás: a magasabb potenciál felé mutat. Áramforrás: az áram irányába mutat.
   */
  arrow?: { from: Pt; to: Pt; box: Box };
}

export interface WireSeg {
  a: Pt;
  b: Pt;
  branchId: string;
}

export interface TerminalGeom {
  name: string;
  pointId: number;
  at: Pt;
  label: LabelGeom;
}

export interface Layout {
  width: number;
  height: number;
  /** A rajz befoglaló téglalapja (SVG viewBox). */
  viewBox: { x: number; y: number; width: number; height: number };
  wires: WireSeg[];
  elements: ElementGeom[];
  junctions: Pt[];
  terminals: TerminalGeom[];
  /** Feloldhatatlan átfedések leírása (ideálisan üres; a tesztek ezt ellenőrzik). */
  collisions: string[];
}

export function toPx(c: Circuit): Map<number, Pt> {
  const minX = Math.min(...c.points.map((p) => p.x));
  const minY = Math.min(...c.points.map((p) => p.y));
  return new Map(c.points.map((p) => [p.id, { x: MARGIN + (p.x - minX) * UNIT, y: MARGIN + (p.y - minY) * UNIT }]));
}

/** Becsült szövegszélesség (rendszer-betűtípus, tabuláris számjegyek). */
export function textWidth(s: string, fontSize = SIZE.fontSize): number {
  let w = 0;
  for (const ch of s) w += /[0-9]/.test(ch) ? 0.6 : /[  ,.]/.test(ch) ? 0.3 : /[ΩMmW]/.test(ch) ? 0.85 : 0.62;
  return w * fontSize;
}

/** Az elem felirata: érték előtaggal; ismeretlennél "?"; ha van neve, "név = érték". */
export function elementLabelText(el: CircuitElement): string {
  if (el.label) return el.label;
  if (el.kind === 'K') return el.name ?? '';
  const value = el.unknown ? '?' : formatQuantity(el.value, elementUnit(el.kind));
  return el.name ? `${el.name} = ${value}` : value;
}

export function boxesOverlap(a: Box, b: Box, pad = 0): boolean {
  return a.x1 < b.x2 + pad && b.x1 < a.x2 + pad && a.y1 < b.y2 + pad && b.y1 < a.y2 + pad;
}

/** Átlós vezetékszakasz akadályként: kis dobozok sora a vonal mentén (nem egy nagy téglalap). */
function segBoxes(s: WireSeg): Box[] {
  if (s.a.x === s.b.x || s.a.y === s.b.y) return [segBox(s)];
  const len = Math.hypot(s.b.x - s.a.x, s.b.y - s.a.y);
  const n = Math.max(1, Math.ceil(len / 8));
  return Array.from({ length: n + 1 }, (_, i) => {
    const x = s.a.x + ((s.b.x - s.a.x) * i) / n;
    const y = s.a.y + ((s.b.y - s.a.y) * i) / n;
    return { x1: x - 3, y1: y - 3, x2: x + 3, y2: y + 3 };
  });
}

function segBox(s: WireSeg, pad = 1): Box {
  return { x1: Math.min(s.a.x, s.b.x) - pad, y1: Math.min(s.a.y, s.b.y) - pad, x2: Math.max(s.a.x, s.b.x) + pad, y2: Math.max(s.a.y, s.b.y) + pad };
}

function labelAt(text: string, center: Pt, side: Side, clearance: number): LabelGeom {
  const w = textWidth(text);
  const h = SIZE.labelHeight;
  const g = clearance + SIZE.labelGap;
  switch (side) {
    case 'above': {
      const y = center.y - g;
      return { text, x: center.x, y: y - 3, anchor: 'middle', side, box: { x1: center.x - w / 2, y1: y - h, x2: center.x + w / 2, y2: y } };
    }
    case 'below': {
      const y = center.y + g;
      return { text, x: center.x, y: y + h - 3, anchor: 'middle', side, box: { x1: center.x - w / 2, y1: y, x2: center.x + w / 2, y2: y + h } };
    }
    case 'left': {
      const x = center.x - g;
      return { text, x, y: center.y + 4.5, anchor: 'end', side, box: { x1: x - w, y1: center.y - h / 2, x2: x, y2: center.y + h / 2 } };
    }
    case 'right': {
      const x = center.x + g;
      return { text, x, y: center.y + 4.5, anchor: 'start', side, box: { x1: x, y1: center.y - h / 2, x2: x + w, y2: center.y + h / 2 } };
    }
  }
}

/** Kapocsbetű lehetséges helyei: a négy oldal, aztán a négy átlós sarok (vezetékek közti szabad negyed). */
function terminalLabelCandidates(name: string, at: Pt): LabelGeom[] {
  const sides = (['left', 'above', 'right', 'below'] as Side[]).map((side) => labelAt(name, at, side, SIZE.terminalRadius));
  const w = textWidth(name, 14);
  const h = SIZE.labelHeight;
  const d = 8;
  const diag = ([
    [-1, -1],
    [1, -1],
    [-1, 1],
    [1, 1],
  ] as const).map(([sx, sy]): LabelGeom => {
    const x1 = sx < 0 ? at.x - d - w : at.x + d;
    const y1 = sy < 0 ? at.y - d - h : at.y + d;
    return { text: name, x: x1 + w / 2, y: y1 + h - 3, anchor: 'middle', side: sy < 0 ? 'above' : 'below', box: { x1, y1, x2: x1 + w, y2: y1 + h } };
  });
  return [...sides, ...diag];
}

const OPPOSITE: Record<Side, Side> = { above: 'below', below: 'above', left: 'right', right: 'left' };

function arrowFor(geom: Pick<ElementGeom, 'center' | 'axis' | 'orient' | 'el'>, side: Side): ElementGeom['arrow'] {
  const { center, axis, el } = geom;
  const off = SIZE.arrowOffset;
  const n = side === 'above' ? { x: 0, y: -off } : side === 'below' ? { x: 0, y: off } : side === 'left' ? { x: -off, y: 0 } : { x: off, y: 0 };
  const half = SIZE.arrowLen / 2;
  const d = el.dir; // +1: a nyíl az ág irányába (from→to) mutat
  const from = { x: center.x + n.x - axis.x * half * d, y: center.y + n.y - axis.y * half * d };
  const to = { x: center.x + n.x + axis.x * half * d, y: center.y + n.y + axis.y * half * d };
  const pad = 5;
  return { from, to, box: { x1: Math.min(from.x, to.x) - pad, y1: Math.min(from.y, to.y) - pad, x2: Math.max(from.x, to.x) + pad, y2: Math.max(from.y, to.y) + pad } };
}

/** Az elem jelének fél hossza (a vezeték mentén) és fél szélessége (rá merőlegesen). */
export function symbolHalfSize(kind: CircuitElement['kind']): [number, number] {
  switch (kind) {
    case 'R':
      return [SIZE.resistorLen / 2, SIZE.resistorWidth / 2];
    case 'L':
      return [SIZE.inductorLen / 2, SIZE.inductorWidth / 2];
    case 'C':
      return [SIZE.capGap / 2 + 1, SIZE.capPlate / 2];
    case 'K':
      return [SIZE.switchLen / 2, SIZE.switchWidth / 2];
    default:
      return [SIZE.sourceRadius, SIZE.sourceRadius];
  }
}

export function computeLayout(c: Circuit): Layout {
  const px = toPx(c);
  const xs = [...px.values()].map((p) => p.x);
  const ys = [...px.values()].map((p) => p.y);
  const bounds = { x1: Math.min(...xs), y1: Math.min(...ys), x2: Math.max(...xs), y2: Math.max(...ys) };

  // 1. Elemek és vezetékszakaszok.
  const wires: WireSeg[] = [];
  const pending: Omit<ElementGeom, 'label' | 'arrow'>[] = [];
  for (const br of c.branches) {
    const p = px.get(br.from)!;
    const q = px.get(br.to)!;
    const orient = p.y === q.y ? 'h' : p.x === q.x ? 'v' : 'd';
    const len = Math.hypot(q.x - p.x, q.y - p.y);
    const axis = { x: (q.x - p.x) / len, y: (q.y - p.y) / len };
    const k = br.elements.length;
    let cursor = p;
    br.elements.forEach((el, i) => {
      // Az elemek az ág közepe köré tömörülnek, a sarkoktól (és a merőleges ágaktól) távol.
      const pitch = Math.min(ELEMENT_PITCH, len / k);
      const t = len / 2 + (i - (k - 1) / 2) * pitch;
      const center = { x: p.x + axis.x * t, y: p.y + axis.y * t };
      const [halfLen, halfWidth] = symbolHalfSize(el.kind);
      const start = { x: center.x - axis.x * halfLen, y: center.y - axis.y * halfLen };
      const end = { x: center.x + axis.x * halfLen, y: center.y + axis.y * halfLen };
      wires.push({ a: cursor, b: start, branchId: br.id });
      cursor = end;
      // Átlós elemnél a befoglaló téglalap az elforgatott jel sarkaiból adódik.
      const hx = orient === 'h' ? halfLen : orient === 'v' ? halfWidth : Math.abs(axis.x) * halfLen + Math.abs(axis.y) * halfWidth;
      const hy = orient === 'h' ? halfWidth : orient === 'v' ? halfLen : Math.abs(axis.y) * halfLen + Math.abs(axis.x) * halfWidth;
      pending.push({ el, branchId: br.id, center, orient, axis, halfLen, halfWidth, body: { x1: center.x - hx, y1: center.y - hy, x2: center.x + hx, y2: center.y + hy } });
    });
    wires.push({ a: cursor, b: q, branchId: br.id });
  }

  // 2. Csomópontok: legalább három ág találkozik.
  const degree = new Map<number, number>();
  for (const b of c.branches) {
    degree.set(b.from, (degree.get(b.from) ?? 0) + 1);
    degree.set(b.to, (degree.get(b.to) ?? 0) + 1);
  }
  const terminalIds = new Set([...(c.terminals ? [c.terminals.a, c.terminals.b] : []), ...(c.ports ?? []).map((x) => x.point)]);
  const junctions = c.points.filter((p) => (degree.get(p.id) ?? 0) >= 3 && !terminalIds.has(p.id)).map((p) => px.get(p.id)!);

  // 3. Feliratok és nyilak: a kedvelt oldal a külső perem felé néz; ütközésnél a másik oldal.
  const obstacles: Box[] = [
    ...wires.flatMap((w) => segBoxes(w)),
    ...pending.map((g) => g.body),
    ...junctions.map((j) => ({ x1: j.x - 5, y1: j.y - 5, x2: j.x + 5, y2: j.y + 5 })),
  ];
  const placed: Box[] = [];
  const collisions: string[] = [];
  const elements: ElementGeom[] = [];
  for (const g of pending) {
    const text = elementLabelText(g.el);
    const preferred: Side =
      g.orient === 'h' ? (g.center.y >= bounds.y2 ? 'below' : 'above') : g.orient === 'v' ? (g.center.x <= bounds.x1 ? 'left' : 'right') : 'right';
    // Jelöltek: a felirat a kedvelt / ellentétes oldalon, a forrásnyíl a másikon; ha egyik sem fér el,
    // a nyíl és a felirat ugyanarra az oldalra kerül (a nyíl közelebb, a felirat a nyílon túl).
    const isSource = g.el.kind === 'V' || g.el.kind === 'I';
    let chosen: { label: LabelGeom; arrow?: ElementGeom['arrow'] } | null = null;
    const candidates: { side: Side; arrowSide: Side; clearance: number }[] = [
      { side: preferred, arrowSide: OPPOSITE[preferred], clearance: g.halfWidth },
      { side: OPPOSITE[preferred], arrowSide: preferred, clearance: g.halfWidth },
    ];
    if (isSource) {
      const beyondArrow = SIZE.arrowOffset + 4;
      candidates.push({ side: preferred, arrowSide: preferred, clearance: beyondArrow }, { side: OPPOSITE[preferred], arrowSide: OPPOSITE[preferred], clearance: beyondArrow });
    }
    // Átlós elemnél a felirat az elem mellé kerül, a vonalra merőlegesen eltolva (jobbra vagy balra).
    if (g.orient === 'd') {
      const n = { x: -g.axis.y, y: g.axis.x };
      for (const sgn of [1, -1]) {
        const off = g.halfWidth + 10;
        const at = { x: g.center.x + n.x * off * sgn, y: g.center.y + n.y * off * sgn };
        const side: Side = n.x * sgn >= 0 ? 'right' : 'left';
        const label = labelAt(text, at, side, 0);
        if (!obstacles.some((o) => o !== g.body && boxesOverlap(label.box, o)) && !placed.some((o) => boxesOverlap(label.box, o, 2))) {
          chosen = { label };
          break;
        }
      }
    }
    for (const cand of chosen ? [] : candidates) {
      const label = labelAt(text, g.center, cand.side, cand.clearance);
      const arrow = isSource ? arrowFor(g, cand.arrowSide) : undefined;
      const mine = [label.box, ...(arrow ? [arrow.box] : [])];
      const free = mine.every((b) => !obstacles.some((o) => o !== g.body && boxesOverlap(b, o)) && !placed.some((o) => boxesOverlap(b, o, 2)));
      if (free) {
        chosen = { label, arrow };
        break;
      }
    }
    if (!chosen) {
      const label = labelAt(text, g.center, preferred, g.halfWidth);
      chosen = { label, arrow: isSource ? arrowFor(g, OPPOSITE[preferred]) : undefined };
      collisions.push(`${g.el.id} felirata nem fér el ütközés nélkül`);
    }
    placed.push(chosen.label.box);
    if (chosen.arrow) placed.push(chosen.arrow.box);
    elements.push({ ...g, label: chosen.label, arrow: chosen.arrow });
  }

  // 4. Kapcsok (A, B): kis kör és betű, a betű szabad helyre kerül.
  const terminals: TerminalGeom[] = [];
  const named: [string, number][] = [...(c.terminals ? ([['A', c.terminals.a], ['B', c.terminals.b]] as [string, number][]) : []), ...(c.ports ?? []).map((x) => [x.name, x.point] as [string, number])];
  {
    for (const [name, pointId] of named) {
      const at = px.get(pointId)!;
      let label: LabelGeom | null = null;
      for (const l of terminalLabelCandidates(name, at)) {
        if (!obstacles.some((o) => boxesOverlap(l.box, o)) && !placed.some((o) => boxesOverlap(l.box, o, 2))) {
          label = l;
          break;
        }
      }
      if (!label) {
        label = labelAt(name, at, 'left', SIZE.terminalRadius);
        collisions.push(`${name} kapocs betűje nem fér el`);
      }
      placed.push(label.box);
      terminals.push({ name, pointId, at, label });
    }
  }

  // A vászon a tényleges tartalomhoz igazodik, egyenletes margóval minden oldalon.
  const all = [...placed, ...obstacles];
  const pad = 28;
  const minX = Math.min(...all.map((b) => b.x1)) - pad;
  const minY = Math.min(...all.map((b) => b.y1)) - pad;
  const viewBox = { x: minX, y: minY, width: Math.max(...all.map((b) => b.x2)) + pad - minX, height: Math.max(...all.map((b) => b.y2)) + pad - minY };
  return { width: viewBox.width, height: viewBox.height, viewBox, wires, elements, junctions, terminals, collisions };
}
