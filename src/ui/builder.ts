// Áramkör-építő felület: rácsra húzható elemek (ellenállás, feszültség- és áramforrás), vezeték a pontok
// között húzva. Minden változás után újraszámol: táblázat minden elem U, I, P értékével, alatta a megoldás
// nézete, ahol a módszerek egyenként végignézhetők és össze vannak vetve. A modell: src/builder/model.ts.

import { buildProblem, crossingKey, DEFAULT_VALUE, edgeEnds, edgeKey, exampleBoard, nextNumber, numberParts, partName, renumber, type Board, type EdgeKey, type Part, type PartKind } from '../builder/model';
import { tableTargets } from '../methods/check';
import { dcTask } from '../tasks';
import { formatQuantity, type Unit } from '../units';
import { button, toggle } from './components';
import { h } from './dom';
import type { TaskViewer } from './viewer';

const CELL = 124;
const KEY = 'villamossagtan.epito.v1';
const NS = 'http://www.w3.org/2000/svg';

type Tool = 'wire' | 'R' | 'V' | 'I' | 'flip' | 'erase' | 'pan';

const TOOL_NAMES: Record<Tool, string> = { wire: 'Vezeték', R: 'Ellenállás', V: 'Feszültségforrás', I: 'Áramforrás', flip: 'Nyíl megfordítása', erase: 'Radír', pan: 'Mozgatás' };
/** Gyorsbillentyűk az eszközökhöz (a gombokon zárójelben látszanak). */
const TOOL_KEY: Record<Tool, string> = { wire: 'V', R: 'E', V: 'F', I: 'A', flip: 'Q', erase: 'R', pan: 'M' };
const UNIT_OF: Record<PartKind, Unit> = { W: '', R: 'Ω', V: 'V', I: 'A' };
const KIND_NAME: Record<PartKind, string> = { W: 'vezeték', R: 'ellenállás', V: 'feszültségforrás', I: 'áramforrás' };

/** Kis rajz az eszköztár gombjaira (ugyanazok a jelek, mint a rácson). */
const TOOL_ICON: Record<Tool, string> = {
  pan: '<path d="M14 3V21M5 12H23M14 3L11 6M14 3L17 6M14 21L11 18M14 21L17 18M5 12L8 9M5 12L8 15M23 12L20 9M23 12L20 15"/>',
  wire: '<path d="M3 12H25"/><circle cx="3" cy="12" r="2.2" fill="currentColor"/><circle cx="25" cy="12" r="2.2" fill="currentColor"/>',
  R: '<path d="M1 12H6M22 12H27"/><rect x="6" y="7" width="16" height="10" rx="1"/>',
  V: '<path d="M14 2V22"/><circle cx="14" cy="12" r="7"/>',
  I: '<path d="M14 2V5M14 19V22M7 12H21"/><circle cx="14" cy="12" r="7"/>',
  flip: '<path d="M4 8H23M19 4L23 8L19 12M24 16H5M9 12L5 16L9 20"/>',
  erase: '<path d="M9 19L4 14L14 4L22 12L15 19ZM9 19H24M10 8L18 16"/>',
};

function loadBoard(): Board {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const b = JSON.parse(raw) as Board;
      if (b && typeof b.parts === 'object' && b.cols && b.rows) return b;
    }
  } catch {
    // Nincs tároló vagy sérült adat: a példával indulunk.
  }
  // Keskeny képernyőn (telefon) kisebb, álló rács, hogy az elemek ujjal is eltalálhatók legyenek.
  return window.innerWidth < 640 ? exampleBoard(4, 5) : exampleBoard();
}

function saveBoard(b: Board): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(b));
  } catch {
    // A mentés nem kötelező.
  }
}

const svgEl = <K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number> = {}): SVGElementTagNameMap[K] => {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  return el;
};

/** Érték beolvasása a mezőből: tizedesvessző és k / m előtag is jó ("4,7k", "500m"). */
export function parseValue(text: string): number | null {
  const m = /^\s*(\d+(?:[.,]\d+)?)\s*([kKmM]?)\s*$/.exec(text);
  if (!m) return null;
  const mult = m[2] === 'k' || m[2] === 'K' ? 1000 : m[2] === 'm' ? 0.001 : m[2] === 'M' ? 1e6 : 1;
  const v = Number(m[1]!.replace(',', '.')) * mult;
  return Number.isFinite(v) && v > 0 ? v : null;
}

export function createBuilder(viewer: TaskViewer): HTMLElement {
  const board = loadBoard();
  let tool: Tool = 'wire';
  let selected: EdgeKey | null = null;
  let hoverEdge: EdgeKey | null = null;
  let hoverPart: EdgeKey | null = null;
  let names = new Map<EdgeKey, string>();
  let dangling = new Set<EdgeKey>();
  /**
   * Színkód (kapcsolható, alapból ki): bekapcsolva minden adattal bíró elem (ellenállás, forrás) saját színt kap,
   * és a felirata meg a táblázat sora is ilyen színű, így sűrű rajzon is látszik, melyik szám melyik elemé.
   */
  const COLORS = 10;
  const COLOR_KEY = 'villamossagtan.epito.szinkod';
  let colorCode = false;
  try {
    colorCode = localStorage.getItem(COLOR_KEY) === '1';
  } catch {
    // Tároló nélkül kikapcsolva marad.
  }
  let colorOf = new Map<EdgeKey, number>();

  // A tábla végtelen: a nézet (bal felső sarok világ-koordinátában és a nagyítás) szabadon mozgatható, mint egy
  // rajztáblán. A rácspont (x, y) helye a világban (x · CELL, y · CELL).
  const view = { x: -CELL, y: -CELL, zoom: 1 };
  const ZOOM_MIN = 0.3;
  const ZOOM_MAX = 2.5;
  const svg = svgEl('svg', { class: 'builder-svg' });
  const px = (p: [number, number]): [number, number] => [p[0] * CELL, p[1] * CELL];
  const viewSize = (): [number, number] => {
    const r = svg.getBoundingClientRect();
    return [r.width || 960, r.height || 560];
  };

  // ───────── Rajz ─────────

  type Box = { x1: number; y1: number; x2: number; y2: number };
  const overlap = (a: Box, b: Box) => Math.max(0, Math.min(a.x2, b.x2) - Math.max(a.x1, b.x1)) * Math.max(0, Math.min(a.y2, b.y2) - Math.max(a.y1, b.y1));
  const around = (x: number, y: number, r: number): Box => ({ x1: x - r, y1: y - r, x2: x + r, y2: y + r });

  /** Egy elem helye a rajzon: végpontok, közép, szög (0°, 90°, ±45°). */
  const geometry = (key: EdgeKey) => {
    const [a, b] = edgeEnds(key);
    const [x1, y1] = px(a);
    const [x2, y2] = px(b);
    const angle = y1 === y2 ? 0 : x1 === x2 ? 90 : y2 > y1 ? 45 : -45;
    return { x1, y1, x2, y2, cx: (x1 + x2) / 2, cy: (y1 + y2) / 2, angle };
  };
  type Geo = ReturnType<typeof geometry>;

  /**
   * A felirat helye: egy kiindulóponttól `dir` irányban (fok, a képernyőn). Ellenállásnál a kiindulópont az elem
   * közepe (közel vagy távolabb); forrásnál a nyíl közepe, mert az érték mindig a nyíl mellett áll.
   */
  interface Spot {
    dir: number;
    /** Távolság: 0 = közvetlenül mellette, 1–2 = távolabb (csak ellenállásnál). */
    far: 0 | 1 | 2;
    /** Forrásnál: a nyíl közepe és a felirat távolsága tőle. */
    from?: { x: number; y: number; near: number };
  }
  /** Ellenállás lehetséges felirathelyei: körben 45°-onként, három távolságban. */
  const SPOTS: Spot[] = [0, 45, 90, 135, 180, 225, 270, 315].flatMap((dir) => ([0, 1, 2] as const).map((far) => ({ dir, far })));
  const norm = (deg: number) => ((Math.round(deg / 45) * 45) % 360 + 360) % 360;

  /** A felirat sorai: fölötte / alatta egy sorban („R4 = 4 Ω”), oldalt két sorban (név, alatta az érték). */
  const labelLines = (key: EdgeKey, part: Part, spot: Spot): string[] => {
    const name = names.get(key);
    const value = formatQuantity(part.value, UNIT_OF[part.kind]);
    if (!name) return [value];
    return spot.dir === 90 || spot.dir === 270 ? [`${name} = ${value}`] : [name, value];
  };

  /** A felirat doboza és a szöveg igazítása az adott helyen. */
  const labelBox = (g: Geo, part: Part, lines: string[], spot: Spot) => {
    const rad = (spot.dir * Math.PI) / 180;
    const ux = Math.round(Math.cos(rad) * 100) / 100;
    const uy = Math.round(Math.sin(rad) * 100) / 100;
    const w = Math.max(...lines.map((t) => t.length)) * 8.4 + 4;
    const hgt = lines.length * 16 + 2;
    const near = spot.from?.near ?? (part.kind === 'R' ? 13 : 19) + 5;
    const dist = (near + [0, 20, 38][spot.far]!) * (ux !== 0 && uy !== 0 ? 0.92 : 1);
    const x = (spot.from?.x ?? g.cx) + Math.sign(ux) * dist;
    const y = (spot.from?.y ?? g.cy) + Math.sign(uy) * dist;
    const anchor = ux > 0.3 ? 'start' : ux < -0.3 ? 'end' : 'middle';
    const top = uy > 0.3 ? y : uy < -0.3 ? y - hgt : y - hgt / 2;
    const left = anchor === 'start' ? x : anchor === 'end' ? x - w : x - w / 2;
    return { x, top, anchor, box: { x1: left, y1: top, x2: left + w, y2: top + hgt } as Box };
  };

  /** A forrás nyilának közepe az elem egyik oldalán (side = ±1, az elem tengelyére merőlegesen 26 egységre). */
  const arrowAt = (g: Geo, side: 1 | -1) => {
    const rad = (g.angle * Math.PI) / 180;
    // A rajzban a nyíl a helyi (0, 26·side) pontban fut: ez a képernyőn (−sin, cos) · 26 · side.
    return { x: g.cx - Math.sin(rad) * 26 * side, y: g.cy + Math.cos(rad) * 26 * side };
  };
  const arrowBox = (g: Geo, side: 1 | -1): Box => {
    const c = arrowAt(g, side);
    return around(c.x, c.y, 13);
  };
  /** Forrás felirathelyei a nyíl mellett: a nyílon túl (kifelé), vagy a nyíl két vége mellett. */
  const sourceSpots = (g: Geo, side: 1 | -1): Spot[] => {
    const c = arrowAt(g, side);
    const out = norm((Math.atan2(c.y - g.cy, c.x - g.cx) * 180) / Math.PI);
    return [
      { dir: out, far: 0, from: { ...c, near: 9 } },
      { dir: norm(g.angle), far: 0, from: { ...c, near: 18 } },
      { dir: norm(g.angle + 180), far: 0, from: { ...c, near: 18 } },
    ];
  };

  interface Placement {
    spot: Spot;
    arrow: 1 | -1;
  }

  const partSvg = (key: EdgeKey, part: Part, place: Placement): SVGGElement => {
    const geo = geometry(key);
    const { x1, y1, x2, y2, cx, cy, angle } = geo;
    const cls = ['bp', `bp-${part.kind}`, key === selected ? 'is-selected' : '', key === hoverPart ? 'is-hover' : '', dangling.has(key) ? 'is-dangling' : ''].filter(Boolean).join(' ');
    const g = svgEl('g', { class: cls });
    g.dataset.key = key;
    if (colorOf.has(key)) g.style.setProperty('--c', `var(--bc-${colorOf.get(key)})`);
    // Széles, láthatatlan sáv: könnyebb eltalálni.
    g.append(svgEl('line', { x1, y1, x2, y2, class: 'bp-hit' }));
    g.append(svgEl('line', { x1, y1, x2, y2, class: 'bp-wire' }));
    // Az elem a saját tengelye mentén rajzolva (vízszintes alak), az él irányába forgatva.
    const body = svgEl('g', { transform: `translate(${cx} ${cy}) rotate(${angle})` });
    if (part.kind === 'R') body.append(svgEl('rect', { x: -24, y: -10, width: 48, height: 20, rx: 2, class: 'bp-body' }));
    if (part.kind === 'V' || part.kind === 'I') {
      body.append(svgEl('circle', { cx: 0, cy: 0, r: 16, class: 'bp-body' }));
      // Feszültségforrás: a vonal a vezeték mentén; áramforrás: a vezetékre merőlegesen.
      body.append(svgEl('line', part.kind === 'V' ? { x1: -16, y1: 0, x2: 16, y2: 0, class: 'bp-mark' } : { x1: 0, y1: -16, x2: 0, y2: 16, class: 'bp-mark' }));
      // Nyíl a kör mellett. Feszültség: a nagyobb potenciáltól a kisebb felé (dir = +1: a „to” vég a nagyobb,
      // a nyíl a „from” felé mutat). Áram: az áram irányába (dir = +1: from → to).
      const toward = part.kind === 'V' ? -part.dir : part.dir;
      const tip = 13 * toward;
      const ay = 26 * place.arrow;
      const arrow = svgEl('path', { d: `M${-tip} ${ay}H${tip}M${tip - 6 * toward} ${ay - 4}L${tip} ${ay}L${tip - 6 * toward} ${ay + 4}`, class: `bp-arrow${part.kind === 'I' ? ' is-solid' : ''}` });
      body.append(arrow);
    }
    g.append(body);
    if (part.kind !== 'W') {
      const lines = labelLines(key, part, place.spot);
      const at = labelBox(geo, part, lines, place.spot);
      const label = svgEl('text', { x: at.x, y: at.top + 13, 'text-anchor': at.anchor, class: 'bp-label' });
      lines.forEach((t, i) => {
        const ts = svgEl('tspan', { x: at.x, dy: i === 0 ? 0 : 16, class: i === 0 ? '' : 'bp-label-value' });
        ts.textContent = t;
        label.append(ts);
      });
      g.append(label);
    }
    return g;
  };

  /**
   * Feliratok és forrásnyilak helye. A rajz minden „tintája” (vezetékek, elemek teste) apró dobozokra bontva
   * akadály; minden felirat a lehetséges helyei közül oda kerül, ahol a legkevesebbet takar (tinta, a már
   * elhelyezett feliratok és nyilak). A forrás értéke mindig a nyíl mellett áll: a nyíl oldalát és a felirat
   * helyét (a nyílon túl vagy a nyíl valamelyik végénél) együtt választjuk.
   */
  const layoutLabels = (): Map<EdgeKey, Placement> => {
    const entries = Object.entries(board.parts);
    const geos = new Map(entries.map(([k]) => [k, geometry(k)]));
    const ink: Box[] = [];
    for (const [k, p] of entries) {
      const g = geos.get(k)!;
      const len = Math.hypot(g.x2 - g.x1, g.y2 - g.y1);
      // A vezeték (és az elem kivezetései) a vonal mentén mintavételezve.
      for (let t = 0; t <= len; t += 8) ink.push(around(g.x1 + ((g.x2 - g.x1) * t) / len, g.y1 + ((g.y2 - g.y1) * t) / len, 4));
      if (p.kind === 'R') for (let t = -20; t <= 20; t += 10) ink.push(around(g.cx + ((g.x2 - g.x1) * t) / len, g.cy + ((g.y2 - g.y1) * t) / len, 12));
      else if (p.kind !== 'W') ink.push(around(g.cx, g.cy, 18));
    }
    const taken: Box[] = [];
    const costOf = (b: Box) => {
      const pad: Box = { x1: b.x1 - 3, y1: b.y1 - 3, x2: b.x2 + 3, y2: b.y2 + 3 };
      let c = 0;
      for (const o of ink) c += overlap(pad, o) * 2;
      for (const o of taken) c += overlap(pad, o) * 3;
      return c;
    };
    /** A legkevesebbet takaró hely a jelöltek közül (az `extra` a hely saját, előnyben részesítési pontja). */
    const bestOf = (key: EdgeKey, part: Part, g: Geo, cands: { spot: Spot; extra: number }[]) => {
      let best = cands[0]!.spot;
      let bestCost = Infinity;
      for (const { spot, extra } of cands) {
        const c = costOf(labelBox(g, part, labelLines(key, part, spot), spot).box) + extra;
        if (c < bestCost) {
          bestCost = c;
          best = spot;
        }
      }
      return { spot: best, cost: bestCost };
    };
    const out = new Map<EdgeKey, Placement>();
    // Előbb a források (nyíl + érték együtt), utána az ellenállások feliratai.
    const order = [...entries.filter(([, p]) => p.kind === 'V' || p.kind === 'I'), ...entries.filter(([, p]) => p.kind === 'R')];
    for (const [key, part] of order) {
      const g = geos.get(key)!;
      if (part.kind === 'R') {
        // A szokásos hely az elem „fölött” (vízszintesnél fölötte, függőlegesnél jobbra). Előbb a két oldala, aztán
        // a sarkai (ugyanolyan közel), és csak végső esetben távolabb.
        const home = g.angle === 0 ? 270 : g.angle === 90 ? 0 : g.angle === 45 ? 315 : 225;
        const cands = SPOTS.map((spot) => {
          const turn = Math.min(Math.abs(spot.dir - home), 360 - Math.abs(spot.dir - home));
          return { spot, extra: (turn === 0 ? 0 : turn === 180 ? 0.5 : 1 + turn / 90) + spot.far * 25 };
        });
        const b = bestOf(key, part, g, cands);
        out.set(key, { spot: b.spot, arrow: 1 });
        taken.push(labelBox(g, part, labelLines(key, part, b.spot), b.spot).box);
        continue;
      }
      let pick: Placement | null = null;
      let pickCost = Infinity;
      for (const arrow of [1, -1] as const) {
        const ab = arrowBox(g, arrow);
        const arrowCost = costOf(ab);
        taken.push(ab);
        // A nyílon túl (kifelé) a legszebb; a nyíl végei mellett csak ha ott takarna.
        const b = bestOf(key, part, g, sourceSpots(g, arrow).map((spot, i) => ({ spot, extra: i === 0 ? 0 : 1 })));
        taken.pop();
        if (arrowCost + b.cost < pickCost) {
          pickCost = arrowCost + b.cost;
          pick = { arrow, spot: b.spot };
        }
      }
      out.set(key, pick!);
      taken.push(arrowBox(g, pick!.arrow), labelBox(g, part, labelLines(key, part, pick!.spot), pick!.spot).box);
    }
    return out;
  };

  const draw = () => {
    const kids: SVGElement[] = [];
    // A nézet: a látható világrész. A rácspontok csak a látható tartományra készülnek.
    const [vw, vh] = viewSize();
    const ww = vw / view.zoom;
    const wh = vh / view.zoom;
    svg.setAttribute('viewBox', `${view.x} ${view.y} ${ww} ${wh}`);
    for (let y = Math.floor(view.y / CELL); y <= Math.ceil((view.y + wh) / CELL); y++)
      for (let x = Math.floor(view.x / CELL); x <= Math.ceil((view.x + ww) / CELL); x++) {
        const [cx, cy] = px([x, y]);
        kids.push(svgEl('circle', { cx, cy, r: 2.5 / Math.min(1, view.zoom), class: 'bg-dot' }));
      }
    if (hoverEdge && !board.parts[hoverEdge]) {
      const [a, b] = edgeEnds(hoverEdge);
      const [x1, y1] = px(a);
      const [x2, y2] = px(b);
      kids.push(svgEl('line', { x1, y1, x2, y2, class: 'bg-hover' }));
    }
    const places = layoutLabels();
    const coded = colorCode
      ? Object.entries(board.parts)
          .filter(([, p]) => p.kind !== 'W')
          .map(([k]) => k)
          .sort((x, y) => (names.get(x) ?? x).localeCompare(names.get(y) ?? y, 'hu', { numeric: true }))
      : [];
    colorOf = new Map(coded.map((k, i) => [k, i % COLORS]));
    // Előbb a vezetékek, utána az elemek: a feliratok így mindig felül vannak.
    const sorted = Object.entries(board.parts).sort(([, p], [, q]) => Number(p.kind !== 'W') - Number(q.kind !== 'W'));
    for (const [key, part] of sorted) kids.push(partSvg(key, part, places.get(key) ?? { spot: SPOTS[0]!, arrow: 1 }));
    // Csomópont-pötty, ahol legalább három szakasz találkozik.
    const degree = new Map<string, number>();
    for (const key of Object.keys(board.parts)) for (const p of edgeEnds(key)) degree.set(p.join(','), (degree.get(p.join(',')) ?? 0) + 1);
    for (const [k, d] of degree) {
      if (d < 3) continue;
      const [cx, cy] = px(k.split(',').map(Number) as [number, number]);
      kids.push(svgEl('circle', { cx, cy, r: 4.5, class: 'bp-node' }));
    }
    svg.replaceChildren(...kids);
  };

  // ───────── Számolás ─────────

  const status = h('p', { class: 'builder-status', attrs: { role: 'status' } });
  const results = h('div', { class: 'builder-results' });
  const solution = h('div', { class: 'builder-solution' });

  // Visszavonás: minden változtatás előtti állapot egy veremben (a recompute veszi észre, hogy változott a rajz).
  const undoStack: string[] = [];
  const redoStack: string[] = [];
  let lastState = JSON.stringify(board.parts);
  let restoring = false;
  const restore = (from: string[], to: string[]) => {
    const state = from.pop();
    if (state === undefined) return;
    to.push(lastState);
    board.parts = JSON.parse(state) as Board['parts'];
    selected = null;
    restoring = true;
    recompute();
    restoring = false;
    renderEditor();
  };
  const undo = () => restore(undoStack, redoStack);
  const redo = () => restore(redoStack, undoStack);
  let syncHistory = () => {};

  const recompute = () => {
    const now = JSON.stringify(board.parts);
    if (now !== lastState) {
      if (!restoring) {
        undoStack.push(lastState);
        if (undoStack.length > 200) undoStack.shift();
        redoStack.length = 0;
      }
      lastState = now;
    }
    saveBoard(board);
    const r = buildProblem(board);
    dangling = new Set(r.dangling);
    syncHistory();
    // A név a letevés sorrendjéből jön (R1, R2 …), így akkor is látszik, ha a rajz még nem számolható.
    numberParts(board);
    names = new Map(Object.entries(board.parts).flatMap(([k, p]) => (partName(p) ? [[k, partName(p)!] as [EdgeKey, string]] : [])));
    draw();
    if (!r.ok) {
      status.textContent = r.reason;
      status.className = 'builder-status is-warn';
      results.replaceChildren();
      solution.replaceChildren();
      return;
    }
    const p = r.problem;
    status.textContent = `Kész: ${p.stats.resistors} ellenállás, ${p.stats.sources} forrás.${r.dangling.length ? ' A szaggatott (sehová nem vezető) szakaszokon nem folyik áram, azok kimaradtak.' : ''}`;
    status.className = 'builder-status is-ok';
    const cell = (v: number, u: Unit) => h('td', { class: v < -1e-12 ? 'is-neg' : '', text: formatQuantity(Math.abs(v) < 1e-12 ? 0 : v, u) });
    results.replaceChildren(
      h('h2', { class: 'builder-h', text: 'Eredmények' }),
      h(
        'div',
        { class: 'table-wrap' },
        h(
          'table',
          { class: 'value-table' },
          h('thead', {}, h('tr', {}, h('th', { text: 'Elem' }), h('th', { text: 'U' }), h('th', { text: 'I' }), h('th', { text: 'P' }))),
          h(
            'tbody',
            {},
            ...tableTargets(p).map((t) => {
              // Ugyanaz a szín, mint a rajzon.
              const key = [...names].find(([, id]) => id === t.element)?.[0];
              const colored = key !== undefined && colorOf.has(key);
              const dot = colored ? h('i', { class: 'builder-dot' }) : null;
              dot?.style.setProperty('--c', `var(--bc-${colorOf.get(key!)})`);
              return h('tr', {}, h('td', {}, dot, t.label), cell(t.U, 'V'), cell(t.I, 'A'), cell(t.P, 'W'));
            }),
          ),
        ),
      ),
      h('p', { class: 'builder-note', text: 'Az áram és a feszültség pozitív iránya balról jobbra, illetve fentről lefelé mutat; a negatív érték ellentétes irányt jelent. A forrás teljesítménye negatív, ha teljesítményt ad le.' }),
    );
    const task = dcTask(p);
    task.topicName = 'Saját áramkör';
    task.meta = `${p.stats.sources} forrás · ${p.stats.resistors} ellenállás`;
    task.title = 'A megépített áramkör megoldása';
    solution.replaceChildren(viewer.el);
    viewer.load(task, { mode: 'practice', solved: true });
  };

  // ───────── Szerkesztés ─────────

  const zoomCtl = h('div', { class: 'builder-zoom', attrs: { role: 'group', 'aria-label': 'Nézet' } });
  const canvasWrap = h('div', { class: 'builder-canvas' }, svg as unknown as HTMLElement, zoomCtl);

  /** Érték átírása helyben: beviteli mező a felirat helyén (Enter vagy kikattintás ment, Esc elvet). */
  const editInline = (key: EdgeKey, labelEl: SVGTextElement) => {
    const part = board.parts[key];
    if (!part || part.kind === 'W') return;
    canvasWrap.querySelector('.builder-inline')?.remove();
    const lr = labelEl.getBoundingClientRect();
    const wr = canvasWrap.getBoundingClientRect();
    const input = h('input', { class: 'builder-inline', attrs: { type: 'text', inputmode: 'decimal', value: String(part.value).replace('.', ','), 'aria-label': `Érték (${UNIT_OF[part.kind]})` } });
    const width = 92;
    input.style.left = `${Math.max(4, Math.min(wr.width - width - 4, lr.left - wr.left + lr.width / 2 - width / 2))}px`;
    input.style.top = `${lr.top - wr.top + lr.height / 2 - 17}px`;
    input.style.width = `${width}px`;
    let done = false;
    const finish = (save: boolean) => {
      if (done) return;
      const v = parseValue(input.value);
      if (save && v === null) {
        input.classList.add('is-bad');
        return;
      }
      done = true;
      input.remove();
      if (save && v !== null && v !== part.value) {
        part.value = v;
        recompute();
      }
      renderEditor();
    };
    input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') finish(true);
      else if (e.key === 'Escape') finish(false);
    });
    input.addEventListener('blur', () => (parseValue(input.value) === null ? finish(false) : finish(true)));
    canvasWrap.append(input);
    selected = key;
    draw();
    renderEditor();
    input.focus();
    input.select();
  };

  const editor = h('div', { class: 'builder-editor' });

  const renderEditor = () => {
    const part = selected ? board.parts[selected] : null;
    if (!selected || !part) {
      editor.replaceChildren(
        h('span', {
          class: 'builder-help',
          text:
            tool === 'wire'
              ? 'Vezeték: kattints egy rácsvonalra vagy egy négyzet átlójára (a kék sáv mutatja, hová kerül), vagy húzd pontról pontra. Az értéket a számra kattintva írhatod át.'
              : tool === 'erase'
                ? 'Radír: tartsd lenyomva és húzd végig azon, amit törölni szeretnél (kattintani is lehet). Ctrl + Z visszahozza.'
                : tool === 'pan'
                  ? 'Mozgatás: húzd a táblát bármerre. Görgővel (vagy két ujjal) nagyíthatsz és kicsinyíthetsz; a tábla végtelen.'
                : `${TOOL_NAMES[tool]}: kattints egy rácsvonalra vagy egy négyzet átlójára (keresztbe), vagy húzd oda a gombot az eszköztárról.`,
        }),
      );
      return;
    }
    const key = selected;
    const title = h('strong', { text: `${names.get(key) ?? ''} ${KIND_NAME[part.kind]}`.trim() });
    const del = button('Törlés', () => remove(key), 'quiet');
    if (part.kind === 'W') {
      editor.replaceChildren(title, del);
      return;
    }
    const input = h('input', { class: 'builder-input', attrs: { type: 'text', inputmode: 'decimal', value: String(part.value).replace('.', ','), 'aria-label': 'Érték' } });
    const apply = () => {
      const v = parseValue(input.value);
      input.classList.toggle('is-bad', v === null);
      if (v === null || v === part.value) return;
      part.value = v;
      recompute();
      renderEditor();
    };
    input.addEventListener('change', apply);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        apply();
        input.blur();
      }
    });
    const flip =
      part.kind === 'R'
        ? null
        : button('Nyíl megfordítása (Q)', () => flipSource(key), 'quiet');
    // Sorszám kézzel: a név (R3, Ug1 …) száma átírható; ha már foglalt, a két elem számot cserél.
    const prefix = part.kind === 'R' ? 'R' : part.kind === 'V' ? 'Ug' : 'Ig';
    const num = h('input', { class: 'builder-input builder-num', attrs: { type: 'text', inputmode: 'numeric', value: String(part.n ?? ''), 'aria-label': 'Sorszám' } });
    const applyNum = () => {
      const n = /^\s*\d+\s*$/.test(num.value) ? Number(num.value) : NaN;
      const same = n === part.n;
      const ok = same || renumber(board, key, n);
      num.classList.toggle('is-bad', !ok);
      if (!ok || same) return;
      recompute();
      renderEditor();
    };
    num.addEventListener('change', applyNum);
    num.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        applyNum();
        num.blur();
      }
    });
    editor.replaceChildren(
      title,
      h('label', { class: 'builder-value' }, h('span', { class: 'builder-field-name', text: 'Sorszám' }), h('span', { text: prefix }), num),
      h('label', { class: 'builder-value' }, h('span', { class: 'builder-field-name', text: 'Érték' }), input, h('span', { text: UNIT_OF[part.kind] })),
      ...(flip ? [flip] : []),
      del,
    );
  };

  const select = (key: EdgeKey | null) => {
    selected = key;
    draw();
    renderEditor();
  };

  const remove = (key: EdgeKey) => {
    delete board.parts[key];
    if (selected === key) selected = null;
    recompute();
    renderEditor();
  };

  /** Egy négyzetben csak az egyik átló lehet foglalt (a két átló keresztezné egymást): a másik kikerül. */
  const clearCrossing = (key: EdgeKey) => {
    const cross = crossingKey(key);
    if (cross && board.parts[cross]) {
      delete board.parts[cross];
      if (selected === cross) selected = null;
    }
  };

  const place = (key: EdgeKey, kind: PartKind) => {
    const old = board.parts[key];
    // Ugyanolyan elemre ejtve megmarad az érték; különben az alapérték jön.
    if (!(old && old.kind === kind)) {
      // Új elem: a fajtájából a következő sorszámot kapja (a régi elem helyére téve előbb az kikerül).
      delete board.parts[key];
      board.parts[key] = { kind, value: DEFAULT_VALUE[kind], dir: kind === 'V' || kind === 'I' ? -1 : 1, ...(kind === 'W' ? {} : { n: nextNumber(board, kind) }) };
    }
    clearCrossing(key);
    selected = kind === 'W' ? null : key;
    recompute();
    renderEditor();
  };

  // Egér / ujj helye rácskoordinátában.
  const gridPos = (e: { clientX: number; clientY: number }): [number, number] => {
    const r = svg.getBoundingClientRect();
    return [(view.x + (e.clientX - r.left) / view.zoom) / CELL, (view.y + (e.clientY - r.top) / view.zoom) / CELL];
  };
  const inside = (e: PointerEvent) => {
    const r = svg.getBoundingClientRect();
    return e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
  };
  /** A legközelebbi rácsvonal (él). */
  const nearestEdge = ([gx, gy]: [number, number]): EdgeKey | null => {
    const hy = Math.round(gy);
    const hx = Math.floor(gx);
    const vx = Math.round(gx);
    const vy = Math.floor(gy);
    const hd = Math.abs(gy - hy);
    const vd = Math.abs(gx - vx);
    // A négyzet két átlója: a négyzet belsejében, az átló vonalához közel (a sarkoknál a rácsvonalak nyernek).
    const cx = Math.floor(gx);
    const cy = Math.floor(gy);
    const fx = gx - cx;
    const fy = gy - cy;
    const dd = Math.abs(fx - fy) / Math.SQRT2;
    const ud = Math.abs(fx + fy - 1) / Math.SQRT2;
    const orth = Math.min(hd, vd);
    const diag = Math.min(dd, ud);
    if (diag < 0.16 && diag < orth) return dd <= ud ? `d:${cx}:${cy}` : `u:${cx}:${cy}`;
    if (orth > 0.5) return null;
    return hd <= vd ? `h:${hx}:${hy}` : `v:${vx}:${vy}`;
  };
  const nearestNode = ([gx, gy]: [number, number]): [number, number] | null => {
    const x = Math.round(gx);
    const y = Math.round(gy);
    return Math.hypot(gx - x, gy - y) < 0.38 ? [x, y] : null;
  };

  // Húzás a rácson: vezeték rajzolása pontról pontra, vagy meglévő elem áthelyezése.
  let wireFrom: [number, number] | null = null;
  /** Húzás közben került-e le vezeték (ha nem, a lenyomás sima kattintásnak számít). */
  let wireDrew = false;
  let moving: { key: EdgeKey; moved: boolean; x: number; y: number } | null = null;

  // ───────── Nézet: mozgatás és nagyítás (végtelen tábla) ─────────

  const clampZoom = (z: number) => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z));
  /** Nagyítás úgy, hogy a mutató alatti pont a helyén marad. */
  const zoomAt = (clientX: number, clientY: number, factor: number) => {
    const r = svg.getBoundingClientRect();
    const z = clampZoom(view.zoom * factor);
    const wx = view.x + (clientX - r.left) / view.zoom;
    const wy = view.y + (clientY - r.top) / view.zoom;
    view.zoom = z;
    view.x = wx - (clientX - r.left) / z;
    view.y = wy - (clientY - r.top) / z;
    draw();
  };
  /** A teljes rajz a nézet közepére (ha üres a tábla, az origó környéke). */
  const fitView = () => {
    const [vw, vh] = viewSize();
    const pts = Object.keys(board.parts).flatMap((k) => edgeEnds(k));
    if (!pts.length) {
      view.zoom = 1;
      view.x = -CELL;
      view.y = -CELL;
    } else {
      const x1 = (Math.min(...pts.map((q) => q[0])) - 1.2) * CELL;
      const y1 = (Math.min(...pts.map((q) => q[1])) - 1.2) * CELL;
      const x2 = (Math.max(...pts.map((q) => q[0])) + 1.2) * CELL;
      const y2 = (Math.max(...pts.map((q) => q[1])) + 1.2) * CELL;
      view.zoom = clampZoom(Math.min(1, vw / (x2 - x1), vh / (y2 - y1)));
      view.x = (x1 + x2) / 2 - vw / view.zoom / 2;
      view.y = (y1 + y2) / 2 - vh / view.zoom / 2;
    }
    draw();
  };
  svg.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      zoomAt(e.clientX, e.clientY, Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0018)));
    },
    { passive: false },
  );
  svg.addEventListener('contextmenu', (e) => e.preventDefault());

  /** A forrás irányának (nyilának) megfordítása; ellenállásnál és vezetéknél nincs mit fordítani. */
  const flipSource = (key: EdgeKey): boolean => {
    const part = board.parts[key];
    if (!part || (part.kind !== 'V' && part.kind !== 'I')) return false;
    part.dir = part.dir === 1 ? -1 : 1;
    recompute();
    renderEditor();
    return true;
  };
  /** A mutató legutóbbi helye a rácson (a Q billentyű az alatta lévő forrást fordítja). */
  let pointerAt: [number, number] | null = null;
  /** Az elem, amelyik fölött a mutató áll: kiemelve látszik. Csak az osztályt cseréljük, nem rajzolunk újra. */
  const setHoverPart = (key: EdgeKey | null) => {
    if (key === hoverPart) return;
    hoverPart = key;
    for (const el of svg.querySelectorAll<SVGGElement>('.bp')) el.classList.toggle('is-hover', el.dataset.key === key);
  };

  // Radírozás húzva: ami a mutató közelébe kerül (az elem vonalától kb. egy ötöd rácsnyira), törlődik.
  let erasing = false;
  let lastErase: [number, number] | null = null;
  const eraseAt = (pos: [number, number]): boolean => {
    lastErase = pos;
    let changed = false;
    for (const key of Object.keys(board.parts)) {
      const [a, b] = edgeEnds(key);
      // A pont távolsága a szakasztól (rácsegységben).
      const dx = b[0] - a[0];
      const dy = b[1] - a[1];
      const t = Math.max(0, Math.min(1, ((pos[0] - a[0]) * dx + (pos[1] - a[1]) * dy) / (dx * dx + dy * dy)));
      if (Math.hypot(pos[0] - (a[0] + t * dx), pos[1] - (a[1] + t * dy)) < 0.2) {
        delete board.parts[key];
        changed = true;
      }
    }
    return changed;
  };

  /** Lenyomott mutatók (két ujjnál nagyítás és mozgatás). */
  const touches = new Map<number, { x: number; y: number }>();
  let panning: { x: number; y: number; vx: number; vy: number } | null = null;
  let pinch: { dist: number; zoom: number; wx: number; wy: number } | null = null;
  const pinchState = () => {
    const [a, b] = [...touches.values()];
    return { dist: Math.hypot(a!.x - b!.x, a!.y - b!.y) || 1, mx: (a!.x + b!.x) / 2, my: (a!.y + b!.y) / 2 };
  };

  svg.addEventListener('pointerdown', (e) => {
    touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (touches.size === 2) {
      // Második ujj: a folyamatban lévő rajzolás megszakad, innen nagyítás / mozgatás.
      wireFrom = null;
      moving = null;
      panning = null;
      if (erasing) {
        erasing = false;
        lastErase = null;
        recompute();
      }
      const r = svg.getBoundingClientRect();
      const st = pinchState();
      pinch = { dist: st.dist, zoom: view.zoom, wx: view.x + (st.mx - r.left) / view.zoom, wy: view.y + (st.my - r.top) / view.zoom };
      return;
    }
    // Mozgatás eszközzel, vagy bármikor Shift + húzással, illetve a középső / jobb egérgombbal húzva.
    if (tool === 'pan' || e.button === 1 || e.button === 2 || e.shiftKey) {
      e.preventDefault();
      svg.setPointerCapture(e.pointerId);
      panning = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y };
      return;
    }
    const pos = gridPos(e);
    const edge = nearestEdge(pos);
    const hit = (e.target as Element).closest<SVGGElement>('.bp')?.dataset.key ?? null;
    // Az értékre (feliratra) kattintva helyben átírható.
    const labelEl = (e.target as Element).closest<SVGTextElement>('.bp-label');
    if (labelEl && hit && tool !== 'erase') {
      e.preventDefault();
      editInline(hit, labelEl);
      return;
    }
    svg.setPointerCapture(e.pointerId);
    if (tool === 'erase') {
      // Radír, mint a rajzprogramokban: lenyomva húzható, és amin áthalad, az törlődik (egy visszavonási lépés).
      erasing = true;
      const key = hit ?? (edge && board.parts[edge] ? edge : null);
      if (key) delete board.parts[key];
      eraseAt(pos);
      selected = null;
      draw();
      return;
    }
    if (tool === 'R' || tool === 'V' || tool === 'I') {
      if (edge) place(edge, tool);
      return;
    }
    const node = nearestNode(pos);
    // Rácspontról indulva vezeték húzása; egy elem (vagy vezeték) közepén kijelölés / áthelyezés.
    if (node) {
      wireFrom = node;
      wireDrew = false;
      return;
    }
    if (hit && board.parts[hit]) moving = { key: hit, moved: false, x: e.clientX, y: e.clientY };
    // Üres rácsvonalra kattintva vezeték kerül oda (húzni nem kötelező).
    else if (edge && !board.parts[edge]) place(edge, 'W');
    else select(null);
  });

  svg.addEventListener('pointermove', (e) => {
    pointerAt = gridPos(e);
    // Kiemelés rámutatásra (kattintás nélkül): az az elem vagy vezeték, amelyik fölött a mutató áll.
    setHoverPart(wireFrom || moving || panning || erasing || pinch ? null : ((e.target as Element).closest<SVGGElement>('.bp')?.dataset.key ?? null));
    if (touches.has(e.pointerId)) touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pinch && touches.size === 2) {
      const r = svg.getBoundingClientRect();
      const st = pinchState();
      view.zoom = clampZoom((pinch.zoom * st.dist) / pinch.dist);
      view.x = pinch.wx - (st.mx - r.left) / view.zoom;
      view.y = pinch.wy - (st.my - r.top) / view.zoom;
      draw();
      return;
    }
    if (panning) {
      view.x = panning.vx - (e.clientX - panning.x) / view.zoom;
      view.y = panning.vy - (e.clientY - panning.y) / view.zoom;
      draw();
      return;
    }
    const pos = gridPos(e);
    if (erasing) {
      // Gyors húzásnál a két esemény között is törlünk, hogy ne maradjon ki semmi.
      const from = lastErase ?? pos;
      const steps = Math.max(1, Math.ceil(Math.hypot(pos[0] - from[0], pos[1] - from[1]) / 0.1));
      let changed = false;
      for (let i = 1; i <= steps; i++) changed = eraseAt([from[0] + ((pos[0] - from[0]) * i) / steps, from[1] + ((pos[1] - from[1]) * i) / steps]) || changed;
      if (changed) draw();
      return;
    }
    if (wireFrom) {
      const node = nearestNode(pos);
      if (node && (node[0] !== wireFrom[0] || node[1] !== wireFrom[1])) {
        const key = edgeKey(wireFrom, node);
        if (key) {
          if (!board.parts[key]) {
            board.parts[key] = { kind: 'W', value: 0, dir: 1 };
            clearCrossing(key);
          }
          wireDrew = true;
          wireFrom = node;
          recompute();
        }
      }
      return;
    }
    if (moving) {
      if (!moving.moved && Math.hypot(e.clientX - moving.x, e.clientY - moving.y) > 6) moving.moved = true;
      if (moving.moved) {
        const edge = nearestEdge(pos);
        if (edge !== hoverEdge) {
          hoverEdge = edge;
          draw();
        }
      }
      return;
    }
    const edge = tool === 'erase' || tool === 'pan' || tool === 'flip' ? null : nearestEdge(pos);
    if (edge !== hoverEdge) {
      hoverEdge = edge;
      draw();
    }
  });

  const endDrag = (e: PointerEvent) => {
    touches.delete(e.pointerId);
    if (pinch) {
      if (touches.size < 2) pinch = null;
      return;
    }
    if (panning) {
      panning = null;
      return;
    }
    if (erasing) {
      erasing = false;
      lastErase = null;
      recompute();
      renderEditor();
      return;
    }
    if (moving) {
      const m = moving;
      moving = null;
      hoverEdge = null;
      if (!m.moved) select(m.key === selected ? null : m.key);
      else {
        const edge = nearestEdge(gridPos(e));
        if (edge && edge !== m.key && inside(e)) {
          board.parts[edge] = board.parts[m.key]!;
          delete board.parts[m.key];
          clearCrossing(edge);
          selected = edge;
          recompute();
          renderEditor();
        } else draw();
      }
    }
    // Rácspont közelében lenyomva, de húzás nélkül felengedve: sima kattintás, mint a többi elemnél
    // (üres vonalra vezeték kerül, meglévő elem kijelölődik).
    if (wireFrom && !wireDrew && e.type === 'pointerup') {
      const edge = nearestEdge(gridPos(e));
      if (edge && !board.parts[edge]) place(edge, 'W');
      else if (edge) select(edge === selected ? null : edge);
    }
    wireFrom = null;
  };
  svg.addEventListener('pointerup', endDrag);
  svg.addEventListener('pointercancel', endDrag);
  svg.addEventListener('pointerleave', () => {
    setHoverPart(null);
    if (hoverEdge && !moving) {
      hoverEdge = null;
      draw();
    }
  });

  // ───────── Eszköztár: kattintásra kiválaszt, húzva a rácsra ejthető ─────────

  const toolBtns = new Map<Tool, HTMLButtonElement>();
  const setTool = (t: Tool) => {
    tool = t;
    for (const [id, b] of toolBtns) b.setAttribute('aria-pressed', String(id === t));
    svg.style.cursor = t === 'pan' ? 'grab' : '';
    selected = null;
    hoverEdge = null;
    draw();
    renderEditor();
  };
  const palette = h('div', { class: 'builder-tools', attrs: { role: 'toolbar', 'aria-label': 'Eszközök' } });
  let flipHint: HTMLElement | null = null;
  for (const t of ['wire', 'R', 'V', 'I', 'flip', 'erase', 'pan'] as Tool[]) {
    const b = h('button', {
      class: 'builder-tool',
      attrs: { type: 'button', 'aria-pressed': String(t === tool), title: `${TOOL_NAMES[t]} (${TOOL_KEY[t]} billentyű)`, 'aria-keyshortcuts': TOOL_KEY[t] },
      html: `<svg width="28" height="24" viewBox="0 0 28 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${TOOL_ICON[t]}</svg><span>${TOOL_NAMES[t]}</span><kbd>(${TOOL_KEY[t]})</kbd>`,
    });
    toolBtns.set(t, b);
    if (t === 'flip') {
      // Nem eszköz, csak emlékeztető: a nyilat a Q billentyű fordítja meg (a forrás fölött állva vagy kijelölve).
      b.classList.add('is-hint');
      b.setAttribute('aria-disabled', 'true');
      b.removeAttribute('aria-pressed');
      b.title = 'Állj az egérrel egy forrás fölé (vagy jelöld ki), és nyomd meg a Q-t: megfordul a nyila.';
      toolBtns.delete(t);
      flipHint = b;
      continue;
    }
    b.addEventListener('click', () => setTool(t));
    if (t !== 'erase' && t !== 'pan') {
      const kind: PartKind = t === 'wire' ? 'W' : t;
      // Húzás az eszköztárról: a gomb képe követi a mutatót, a rácson a legközelebbi vonalra kerül.
      let ghost: HTMLElement | null = null;
      b.addEventListener('pointerdown', (e) => {
        const sx = e.clientX;
        const sy = e.clientY;
        const move = (ev: PointerEvent) => {
          if (!ghost && Math.hypot(ev.clientX - sx, ev.clientY - sy) > 8) {
            ghost = b.cloneNode(true) as HTMLElement;
            ghost.classList.add('builder-ghost');
            document.body.append(ghost);
            setTool(t);
          }
          if (!ghost) return;
          ghost.style.left = `${ev.clientX}px`;
          ghost.style.top = `${ev.clientY}px`;
          const edge = inside(ev) ? nearestEdge(gridPos(ev)) : null;
          if (edge !== hoverEdge) {
            hoverEdge = edge;
            draw();
          }
        };
        const up = (ev: PointerEvent) => {
          window.removeEventListener('pointermove', move);
          window.removeEventListener('pointerup', up);
          if (!ghost) return;
          ghost.remove();
          ghost = null;
          const edge = inside(ev) ? nearestEdge(gridPos(ev)) : null;
          hoverEdge = null;
          if (edge) place(edge, kind);
          else draw();
        };
        window.addEventListener('pointermove', move);
        window.addEventListener('pointerup', up);
      });
    }
    palette.append(b);
  }
  // A szürke emlékeztető a sor végére kerül, az eszközök után.
  if (flipHint) palette.append(flipHint);

  const colorToggle = toggle('Színkód', colorCode, (v) => {
    colorCode = v;
    try {
      localStorage.setItem(COLOR_KEY, v ? '1' : '0');
    } catch {
      // A mentés nem kötelező.
    }
    recompute();
  });
  colorToggle.el.title = 'Minden elem és a hozzá tartozó szám saját színt kap.';
  const actions = h(
    'div',
    { class: 'builder-actions' },
    colorToggle.el,
    button('Példa', () => {
      board.parts = exampleBoard().parts;
      selected = null;
      recompute();
      renderEditor();
      fitView();
    }, 'quiet'),
    button('Mindent töröl', () => {
      board.parts = {};
      selected = null;
      recompute();
      renderEditor();
    }, 'quiet'),
  );
  // Visszavonás és a kósza (semmihez nem kötött, áramkörön kívüli) elemek törlése.
  const undoBtn = button('Visszavonás', () => undo(), 'quiet');
  undoBtn.title = 'Az utolsó változtatás visszavonása (Ctrl + Z)';
  const strayBtn = button('Kósza elemek törlése', () => {
    for (const k of dangling) delete board.parts[k];
    selected = null;
    recompute();
    renderEditor();
  }, 'quiet');
  strayBtn.title = 'Minden olyan elem és vezeték törlése, amely nincs zárt körbe kötve (a rajzon szaggatott).';
  actions.prepend(undoBtn);
  actions.insertBefore(strayBtn, actions.lastElementChild);
  syncHistory = () => {
    undoBtn.disabled = undoStack.length === 0;
    strayBtn.hidden = dangling.size === 0;
    strayBtn.textContent = `Kósza elemek törlése (${dangling.size})`;
  };
  syncHistory();
  const guide = h('p', {
    class: 'builder-guide',
    text: 'Ctrl + Z (Macen ⌘ + Z): visszavonás · Ctrl + Shift + Z: újra · eszközök: a gombokon zárójelben álló betű (V, E, F, A, R, M) · Q: megfordítja annak a forrásnak a nyilát, amelyik fölött az egér áll (vagy a kijelöltét) · Shift + húzás vagy jobb egérgomb: a tábla mozgatása · görgő: nagyítás · Delete: a kijelölt elem törlése · elemre kattintva alul átírható a sorszáma (R1, R2 …) és az értéke',
  });

  const root = h(
    'div',
    { class: 'builder' },
    h(
      'div',
      { class: 'builder-head' },
      h('h1', { class: 'problem-title', text: 'Építs áramkört' }),
      h('p', { class: 'gate-info', text: 'Húzd az elemeket a rácsra, kösd össze őket vezetékkel, és állítsd be az értékeket. A program azonnal kiszámolja, és minden alkalmazható módszerrel megmutatja a levezetést.' }),
    ),
    h('section', { class: 'card builder-card', attrs: { 'aria-label': 'Áramkör-szerkesztő' } }, h('div', { class: 'builder-bar' }, palette, actions), canvasWrap, editor, guide),
    status,
    h('section', { class: 'card builder-results-card' }, results),
    solution,
  );

  // Törlés billentyűvel (amíg az építő látszik).
  const onKey = (e: KeyboardEvent) => {
    if (!root.isConnected) {
      document.removeEventListener('keydown', onKey);
      return;
    }
    if ((e.target as HTMLElement).closest('input, select, textarea, dialog')) return;
    // Visszavonás / újra: Ctrl + Z, Ctrl + Shift + Z vagy Ctrl + Y (Macen ⌘).
    if ((e.ctrlKey || e.metaKey) && (e.key === 'z' || e.key === 'Z' || e.key === 'y')) {
      e.preventDefault();
      if (e.shiftKey || e.key === 'y') redo();
      else undo();
      return;
    }
    if ((e.key === 'Delete' || e.key === 'Backspace') && selected) {
      e.preventDefault();
      remove(selected);
    } else if (e.key === 'Escape') setTool('wire');
    else if (!e.ctrlKey && !e.metaKey && !e.altKey) {
      // Eszközváltás gyorsbillentyűvel: V vezeték, E ellenállás, F feszültségforrás, A áramforrás, R radír, M mozgatás.
      const t = (Object.keys(TOOL_KEY) as Tool[]).find((k) => TOOL_KEY[k] === e.key.toUpperCase());
      // Q: annak a forrásnak a nyila fordul meg, amelyik fölött a mutató áll (ha nincs ilyen, a kijelöltté).
      // Eszközt nem vált.
      if (t === 'flip') {
        e.preventDefault();
        const under = hoverPart ?? (pointerAt ? nearestEdge(pointerAt) : null);
        if (!(under && flipSource(under)) && selected) flipSource(selected);
        return;
      }
      if (t) {
        e.preventDefault();
        setTool(t);
      }
    }
  };
  document.addEventListener('keydown', onKey);

  // Nézetvezérlők a tábla sarkában: kicsinyítés, nagyítás, a rajz középre igazítása.
  const center = () => {
    const r = svg.getBoundingClientRect();
    return [r.left + r.width / 2, r.top + r.height / 2] as const;
  };
  const zoomBtn = (text: string, label: string, fn: () => void) => h('button', { class: 'builder-zoom-btn', attrs: { type: 'button', 'aria-label': label, title: label }, text, on: { click: fn } });
  zoomCtl.append(
    zoomBtn('−', 'Kicsinyítés', () => zoomAt(...center(), 1 / 1.25)),
    zoomBtn('+', 'Nagyítás', () => zoomAt(...center(), 1.25)),
    zoomBtn('Középre', 'A rajz középre igazítása', () => fitView()),
  );

  recompute();
  renderEditor();
  // A tábla mérete csak megjelenítés után ismert: akkor igazítjuk középre a rajzot, és követjük az átméretezést.
  requestAnimationFrame(() => fitView());
  new ResizeObserver(() => root.isConnected && draw()).observe(svg);
  return root;
}
