// Áramkör-építő felület: rácsra húzható elemek (ellenállás, feszültség- és áramforrás), vezeték a pontok
// között húzva. Minden változás után újraszámol: táblázat minden elem U, I, P értékével, alatta a megoldás
// nézete, ahol a módszerek egyenként végignézhetők és össze vannak vetve. A modell: src/builder/model.ts.

import { buildProblem, crossingKey, DEFAULT_VALUE, edgeEnds, edgeKey, exampleBoard, type Board, type EdgeKey, type Part, type PartKind } from '../builder/model';
import { tableTargets } from '../methods/check';
import { dcTask } from '../tasks';
import { formatQuantity, type Unit } from '../units';
import { button } from './components';
import { h } from './dom';
import type { TaskViewer } from './viewer';

const CELL = 124;
const PAD = 84;
const KEY = 'villamossagtan.epito.v1';
const NS = 'http://www.w3.org/2000/svg';

type Tool = 'wire' | 'R' | 'V' | 'I' | 'erase';

const TOOL_NAMES: Record<Tool, string> = { wire: 'Vezeték', R: 'Ellenállás', V: 'Feszültségforrás', I: 'Áramforrás', erase: 'Radír' };
const UNIT_OF: Record<PartKind, Unit> = { W: '', R: 'Ω', V: 'V', I: 'A' };
const KIND_NAME: Record<PartKind, string> = { W: 'vezeték', R: 'ellenállás', V: 'feszültségforrás', I: 'áramforrás' };

/** Kis rajz az eszköztár gombjaira (ugyanazok a jelek, mint a rácson). */
const TOOL_ICON: Record<Tool, string> = {
  wire: '<path d="M3 12H25"/><circle cx="3" cy="12" r="2.2" fill="currentColor"/><circle cx="25" cy="12" r="2.2" fill="currentColor"/>',
  R: '<path d="M1 12H6M22 12H27"/><rect x="6" y="7" width="16" height="10" rx="1"/>',
  V: '<path d="M14 2V22"/><circle cx="14" cy="12" r="7"/>',
  I: '<path d="M14 2V5M14 19V22M7 12H21"/><circle cx="14" cy="12" r="7"/>',
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
  let names = new Map<EdgeKey, string>();
  let dangling = new Set<EdgeKey>();

  const W = board.cols * CELL + PAD * 2;
  const H = board.rows * CELL + PAD * 2;
  const svg = svgEl('svg', { viewBox: `0 0 ${W} ${H}`, class: 'builder-svg' });
  const px = (p: [number, number]): [number, number] => [PAD + p[0] * CELL, PAD + p[1] * CELL];

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

  /** A felirat helye: az elem közepétől `dir` irányban (fok, a képernyőn), közel vagy távolabb. */
  interface Spot {
    dir: number;
    /** Távolság: 0 = közvetlenül az elem mellett, 1 = kicsit távolabb, 2 = a forrás nyilán is túl. */
    far: 0 | 1 | 2;
  }
  /** A lehetséges helyek: körben 45°-onként, három távolságban. */
  const SPOTS: Spot[] = [0, 45, 90, 135, 180, 225, 270, 315].flatMap((dir) => ([0, 1, 2] as const).map((far) => ({ dir, far })));

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
    const near = (part.kind === 'R' ? 13 : 19) + 5;
    const dist = (near + [0, 20, 38][spot.far]!) * (ux !== 0 && uy !== 0 ? 0.8 : 1);
    const x = g.cx + Math.sign(ux) * dist;
    const y = g.cy + Math.sign(uy) * dist;
    const anchor = ux > 0.3 ? 'start' : ux < -0.3 ? 'end' : 'middle';
    const top = uy > 0.3 ? y : uy < -0.3 ? y - hgt : y - hgt / 2;
    const left = anchor === 'start' ? x : anchor === 'end' ? x - w : x - w / 2;
    return { x, top, anchor, box: { x1: left, y1: top, x2: left + w, y2: top + hgt } as Box };
  };

  /** A forrás nyilának doboza az elem egyik oldalán (side = ±1, az elem saját tengelyére merőlegesen). */
  const arrowBox = (g: Geo, side: 1 | -1): Box => {
    const rad = (g.angle * Math.PI) / 180;
    // A rajzban a nyíl a helyi (0, 26·side) pontban fut: ez a képernyőn (−sin, cos) · 26 · side.
    return around(g.cx - Math.sin(rad) * 26 * side, g.cy + Math.cos(rad) * 26 * side, 13);
  };

  const partSvg = (key: EdgeKey, part: Part, place: { spot: Spot; arrow: 1 | -1 }): SVGGElement => {
    const geo = geometry(key);
    const { x1, y1, x2, y2, cx, cy, angle } = geo;
    const cls = ['bp', `bp-${part.kind}`, key === selected ? 'is-selected' : '', dangling.has(key) ? 'is-dangling' : ''].filter(Boolean).join(' ');
    const g = svgEl('g', { class: cls });
    g.dataset.key = key;
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
   * akadály; minden felirat a 16 lehetséges hely közül oda kerül, ahol a legkevesebbet takar (tinta, a már
   * elhelyezett feliratok és nyilak, a rajz széle). Így sűrű, átlós elemekkel teli rajzon sem csúsznak egymásra.
   */
  const layoutLabels = (): Map<EdgeKey, { spot: Spot; arrow: 1 | -1 }> => {
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
      for (const o of ink) c += overlap(pad, o);
      for (const o of taken) c += overlap(pad, o) * 3;
      if (b.x1 < 2 || b.y1 < 2 || b.x2 > W - 2 || b.y2 > H - 2) c += 1e6;
      return c;
    };
    const out = new Map<EdgeKey, { spot: Spot; arrow: 1 | -1 }>();
    // Előbb a forrásnyilak (csak két helyük lehet), utána a feliratok.
    for (const [key, part] of entries) {
      if (part.kind !== 'V' && part.kind !== 'I') continue;
      const g = geos.get(key)!;
      const arrow: 1 | -1 = costOf(arrowBox(g, 1)) <= costOf(arrowBox(g, -1)) ? 1 : -1;
      out.set(key, { spot: SPOTS[0]!, arrow });
      taken.push(arrowBox(g, arrow));
    }
    for (const [key, part] of entries) {
      if (part.kind === 'W') continue;
      const g = geos.get(key)!;
      // A szokásos hely az elem „fölött” (vízszintesnél fölötte, függőlegesnél jobbra); a többi csak ha ott takarna.
      const home = g.angle === 0 ? 270 : g.angle === 90 ? 0 : g.angle === 45 ? 315 : 225;
      let best: Spot = SPOTS[0]!;
      let bestCost = Infinity;
      for (const spot of SPOTS) {
        const turn = Math.min(Math.abs(spot.dir - home), 360 - Math.abs(spot.dir - home));
        // Az elem két oldala (a tengelyére merőlegesen) a természetes hely; a sarkok csak végszükségben.
        const bias = (turn === 0 ? 0 : turn === 180 ? 1 : 3 + turn / 45) + spot.far * 1.2;
        const c = costOf(labelBox(g, part, labelLines(key, part, spot), spot).box) + bias;
        if (c < bestCost) {
          bestCost = c;
          best = spot;
        }
      }
      out.set(key, { spot: best, arrow: out.get(key)?.arrow ?? 1 });
      taken.push(labelBox(g, part, labelLines(key, part, best), best).box);
    }
    return out;
  };

  const draw = () => {
    const kids: SVGElement[] = [];
    // Rácspontok.
    for (let y = 0; y <= board.rows; y++)
      for (let x = 0; x <= board.cols; x++) {
        const [cx, cy] = px([x, y]);
        kids.push(svgEl('circle', { cx, cy, r: 2.5, class: 'bg-dot' }));
      }
    if (hoverEdge && !board.parts[hoverEdge]) {
      const [a, b] = edgeEnds(hoverEdge);
      const [x1, y1] = px(a);
      const [x2, y2] = px(b);
      kids.push(svgEl('line', { x1, y1, x2, y2, class: 'bg-hover' }));
    }
    const places = layoutLabels();
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

  const recompute = () => {
    saveBoard(board);
    const r = buildProblem(board);
    dangling = new Set(r.dangling);
    names = r.ok ? r.names : new Map();
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
          h('tbody', {}, ...tableTargets(p).map((t) => h('tr', {}, h('td', { text: t.label }), cell(t.U, 'V'), cell(t.I, 'A'), cell(t.P, 'W')))),
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

  const canvasWrap = h('div', { class: 'builder-canvas' }, svg as unknown as HTMLElement);

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
                ? 'Radír: kattints arra az elemre vagy vezetékre, amit törölni szeretnél.'
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
      // Az ellenállás neve az értékéből jön (R8): a szerkesztő fejléce is frissül.
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
        : button('Megfordítás', () => {
            part.dir = part.dir === 1 ? -1 : 1;
            recompute();
          }, 'quiet');
    editor.replaceChildren(title, h('label', { class: 'builder-value' }, input, h('span', { text: UNIT_OF[part.kind] })), ...(flip ? [flip] : []), del);
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
    board.parts[key] = old && old.kind === kind ? old : { kind, value: DEFAULT_VALUE[kind], dir: kind === 'V' || kind === 'I' ? -1 : 1 };
    clearCrossing(key);
    selected = kind === 'W' ? null : key;
    recompute();
    renderEditor();
  };

  // Egér / ujj helye rácskoordinátában.
  const gridPos = (e: PointerEvent): [number, number] => {
    const r = svg.getBoundingClientRect();
    const sx = ((e.clientX - r.left) / r.width) * W;
    const sy = ((e.clientY - r.top) / r.height) * H;
    return [(sx - PAD) / CELL, (sy - PAD) / CELL];
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
    const hOk = hx >= 0 && hx < board.cols && hy >= 0 && hy <= board.rows;
    const vOk = vy >= 0 && vy < board.rows && vx >= 0 && vx <= board.cols;
    const hd = hOk ? Math.abs(gy - hy) : Infinity;
    const vd = vOk ? Math.abs(gx - vx) : Infinity;
    // A négyzet két átlója: a négyzet belsejében, az átló vonalához közel (a sarkoknál a rácsvonalak nyernek).
    const cx = Math.floor(gx);
    const cy = Math.floor(gy);
    const fx = gx - cx;
    const fy = gy - cy;
    const cellOk = cx >= 0 && cx < board.cols && cy >= 0 && cy < board.rows;
    const dd = cellOk ? Math.abs(fx - fy) / Math.SQRT2 : Infinity;
    const ud = cellOk ? Math.abs(fx + fy - 1) / Math.SQRT2 : Infinity;
    const orth = Math.min(hd, vd);
    const diag = Math.min(dd, ud);
    if (diag < 0.16 && diag < orth) return dd <= ud ? `d:${cx}:${cy}` : `u:${cx}:${cy}`;
    if (orth > 0.5) return null;
    return hd <= vd ? `h:${hx}:${hy}` : `v:${vx}:${vy}`;
  };
  const nearestNode = ([gx, gy]: [number, number]): [number, number] | null => {
    const x = Math.round(gx);
    const y = Math.round(gy);
    if (x < 0 || y < 0 || x > board.cols || y > board.rows) return null;
    return Math.hypot(gx - x, gy - y) < 0.38 ? [x, y] : null;
  };

  // Húzás a rácson: vezeték rajzolása pontról pontra, vagy meglévő elem áthelyezése.
  let wireFrom: [number, number] | null = null;
  /** Húzás közben került-e le vezeték (ha nem, a lenyomás sima kattintásnak számít). */
  let wireDrew = false;
  let moving: { key: EdgeKey; moved: boolean; x: number; y: number } | null = null;

  svg.addEventListener('pointerdown', (e) => {
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
      const key = hit ?? (edge && board.parts[edge] ? edge : null);
      if (key) remove(key);
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
    const pos = gridPos(e);
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
    const edge = tool === 'erase' ? null : nearestEdge(pos);
    if (edge !== hoverEdge) {
      hoverEdge = edge;
      draw();
    }
  });

  const endDrag = (e: PointerEvent) => {
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
    selected = null;
    hoverEdge = null;
    draw();
    renderEditor();
  };
  const palette = h('div', { class: 'builder-tools', attrs: { role: 'toolbar', 'aria-label': 'Eszközök' } });
  for (const t of ['wire', 'R', 'V', 'I', 'erase'] as Tool[]) {
    const b = h('button', {
      class: 'builder-tool',
      attrs: { type: 'button', 'aria-pressed': String(t === tool), title: TOOL_NAMES[t] },
      html: `<svg width="28" height="24" viewBox="0 0 28 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${TOOL_ICON[t]}</svg><span>${TOOL_NAMES[t]}</span>`,
    });
    toolBtns.set(t, b);
    b.addEventListener('click', () => setTool(t));
    if (t !== 'erase') {
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

  const actions = h(
    'div',
    { class: 'builder-actions' },
    button('Példa', () => {
      board.parts = exampleBoard().parts;
      selected = null;
      recompute();
      renderEditor();
    }, 'quiet'),
    button('Mindent töröl', () => {
      board.parts = {};
      selected = null;
      recompute();
      renderEditor();
    }, 'quiet'),
  );

  const root = h(
    'div',
    { class: 'builder' },
    h(
      'div',
      { class: 'builder-head' },
      h('h1', { class: 'problem-title', text: 'Építs áramkört' }),
      h('p', { class: 'gate-info', text: 'Húzd az elemeket a rácsra, kösd össze őket vezetékkel, és állítsd be az értékeket. A program azonnal kiszámolja, és minden alkalmazható módszerrel megmutatja a levezetést.' }),
    ),
    h('section', { class: 'card builder-card', attrs: { 'aria-label': 'Áramkör-szerkesztő' } }, h('div', { class: 'builder-bar' }, palette, actions), canvasWrap, editor),
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
    if ((e.key === 'Delete' || e.key === 'Backspace') && selected) {
      e.preventDefault();
      remove(selected);
    } else if (e.key === 'Escape') setTool('wire');
  };
  document.addEventListener('keydown', onKey);

  recompute();
  renderEditor();
  return root;
}
