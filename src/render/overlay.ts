// Lépésenkénti kiemelések az ábrán: eredő csoport kerete felirattal, csomópont, hurok körüljárási
// nyíllal, ág- és feszültség-referencianyilak értékkel. A geometria tiszta függvény (tesztelhető);
// a kimenet SVG-szöveg két rétegben: az elemek alatt ("under") és fölött ("over").

import type { ArrowRef, GroupRef, Highlight, LoopRef } from '../methods/types';
import type { Circuit } from '../solver/model';
import type { NetlistMapping } from '../solver/netlist';
import { formatQuantity } from '../units';
import { textWidth, toPx, type Box, type Layout, type Pt } from './layout';

export interface OverlayContext {
  circuit: Circuit;
  layout: Layout;
  map: NetlistMapping;
}

const f = (n: number) => Number(n.toFixed(2)).toString();

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function union(boxes: Box[], pad: number): Box {
  return {
    x1: Math.min(...boxes.map((b) => b.x1)) - pad,
    y1: Math.min(...boxes.map((b) => b.y1)) - pad,
    x2: Math.max(...boxes.map((b) => b.x2)) + pad,
    y2: Math.max(...boxes.map((b) => b.y2)) + pad,
  };
}

/** Egy elemcsoport befoglaló téglalapja (testek és feliratok). */
export function groupBox(ctx: OverlayContext, ids: string[], pad = 8): Box | null {
  const gs = ctx.layout.elements.filter((g) => ids.includes(g.el.id));
  if (gs.length === 0) return null;
  return union(gs.flatMap((g) => [g.body, g.label.box]), pad);
}

export interface LoopGeometry {
  /** A hurok ágai szakaszokként (vezetékekkel együtt). */
  segments: { a: Pt; b: Pt }[];
  /** A hurok "belsejének" közepe (a körüljárási nyíl helye). */
  center: Pt;
  /** A körüljárás a képernyőn az óramutató járásával egyezik-e. */
  clockwise: boolean;
  /** A hurok pontjai körüljárási sorrendben (a körbefutó animációhoz). */
  poly: Pt[];
}

/** A hurok rajzolható alakja: az elemek ágai, a köztük futó vezetékek és a körüljárás iránya. */
export function loopGeometry(ctx: OverlayContext, loop: LoopRef): LoopGeometry | null {
  const px = toPx(ctx.circuit);
  const { circuit, layout } = ctx;
  const branchOf = new Map<string, (typeof circuit.branches)[number]>();
  for (const b of circuit.branches) for (const e of b.elements) branchOf.set(e.id, b);

  const used = new Set<(typeof circuit.branches)[number]>();
  const poly: Pt[] = [];
  const wiresByPoint = new Map<number, (typeof circuit.branches)[number][]>();
  for (const b of circuit.branches) {
    if (b.elements.length) continue;
    wiresByPoint.set(b.from, [...(wiresByPoint.get(b.from) ?? []), b]);
    wiresByPoint.set(b.to, [...(wiresByPoint.get(b.to) ?? []), b]);
  }
  /** Vezetékeken át a P pontból a Q pontba (szélességi kereséssel). */
  const wirePath = (P: number, Q: number): (typeof circuit.branches)[number][] | null => {
    if (P === Q) return [];
    const prev = new Map<number, { from: number; via: (typeof circuit.branches)[number] }>();
    const queue = [P];
    const seen = new Set([P]);
    while (queue.length) {
      const n = queue.shift()!;
      for (const w of wiresByPoint.get(n) ?? []) {
        const o = w.from === n ? w.to : w.from;
        if (seen.has(o)) continue;
        seen.add(o);
        prev.set(o, { from: n, via: w });
        if (o === Q) {
          const out: (typeof circuit.branches)[number][] = [];
          let c = Q;
          while (c !== P) {
            const s = prev.get(c)!;
            out.push(s.via);
            c = s.from;
          }
          return out.reverse();
        }
        queue.push(o);
      }
    }
    return null;
  };

  const steps = loop.elements.map((x) => {
    const br = branchOf.get(x.id);
    const g = layout.elements.find((e) => e.el.id === x.id);
    if (!br || !g) return null;
    const aIsFrom = g.el.kind === 'R' || g.el.dir === 1;
    const forward = (x.sign === 1) === aIsFrom;
    const idx = br.elements.findIndex((e) => e.id === x.id);
    const half = g.halfLen;
    const entry = { x: g.center.x - g.axis.x * half * (forward ? 1 : -1), y: g.center.y - g.axis.y * half * (forward ? 1 : -1) };
    const exit = { x: g.center.x + g.axis.x * half * (forward ? 1 : -1), y: g.center.y + g.axis.y * half * (forward ? 1 : -1) };
    const lastInDir = forward ? idx === br.elements.length - 1 : idx === 0;
    const firstInDir = forward ? idx === 0 : idx === br.elements.length - 1;
    return { br, entry, exit, exitPoint: forward ? br.to : br.from, entryPoint: forward ? br.from : br.to, lastInDir, firstInDir };
  });
  if (steps.some((s) => !s)) return null;
  const ss = steps as NonNullable<(typeof steps)[number]>[];

  ss.forEach((s, i) => {
    used.add(s.br);
    if (s.firstInDir) poly.push(px.get(s.entryPoint)!);
    poly.push(s.entry, s.exit);
    if (s.lastInDir) {
      poly.push(px.get(s.exitPoint)!);
      const next = ss[(i + 1) % ss.length]!;
      const path = wirePath(s.exitPoint, next.entryPoint);
      if (path === null) return;
      let cur = s.exitPoint;
      for (const w of path) {
        used.add(w);
        cur = w.from === cur ? w.to : w.from;
        poly.push(px.get(cur)!);
      }
    }
  });

  // Előjeles terület (képernyő-koordinátákban, y lefelé): pozitív = óramutató járásával egyező.
  let area = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i]!;
    const q = poly[(i + 1) % poly.length]!;
    area += p.x * q.y - q.x * p.y;
  }
  const xs = poly.map((p) => p.x);
  const ys = poly.map((p) => p.y);
  const center = { x: (Math.min(...xs) + Math.max(...xs)) / 2, y: (Math.min(...ys) + Math.max(...ys)) / 2 };
  const segments = [...used].map((b) => ({ a: px.get(b.from)!, b: px.get(b.to)! }));
  return { segments, center, clockwise: area > 0, poly };
}

/** Egy netlista-csomópont rajzolható részei: rácspontok, belső pontok és az őket összekötő vezetékek. */
export function nodeGeometry(ctx: OverlayContext, node: number): { points: Pt[]; segments: { a: Pt; b: Pt }[] } {
  const px = toPx(ctx.circuit);
  const points: Pt[] = [];
  for (const [pid, n] of ctx.map.pointNode) if (n === node) points.push(px.get(pid)!);
  // Ágon belüli csomópont: két egymás utáni elem között.
  for (const br of ctx.circuit.branches) {
    const nodes = ctx.map.branchNodes.get(br.id)!;
    for (let i = 1; i < nodes.length - 1; i++) {
      if (nodes[i] !== node) continue;
      const g1 = ctx.layout.elements.find((g) => g.el.id === br.elements[i - 1]!.id)!;
      const g2 = ctx.layout.elements.find((g) => g.el.id === br.elements[i]!.id)!;
      points.push({ x: (g1.center.x + g2.center.x) / 2, y: (g1.center.y + g2.center.y) / 2 });
    }
  }
  const segments = ctx.circuit.branches
    .filter((b) => b.elements.length === 0 && ctx.map.pointNode.get(b.from) === node)
    .map((b) => ({ a: px.get(b.from)!, b: px.get(b.to)! }));
  return { points, segments };
}

const TONE: Record<GroupRef['tone'], string> = { accent: 'var(--accent)', result: 'var(--result)', transform: 'var(--transform)' };

/** A felirat-buborék a rajz keretén belül marad (nincs nagyítás, ami kihozná a látótérbe). */
function chip(x0: number, y0: number, text: string, color: string, vb?: { x: number; y: number; width: number; height: number }): string {
  const w = textWidth(text, 12) + 14;
  let x = x0;
  let y = y0;
  if (vb) {
    x = Math.max(vb.x + 4, Math.min(x, vb.x + vb.width - w - 4));
    y = Math.max(vb.y + 22, y);
  }
  return `<g class="ov-chip"><rect x="${f(x)}" y="${f(y - 18)}" width="${f(w)}" height="20" rx="10" fill="var(--surface)" stroke="${color}" stroke-opacity="0.5"/><text x="${f(x + 7)}" y="${f(y - 4)}" fill="${color}" font-size="12" font-weight="600">${esc(text)}</text></g>`;
}

function groupSvg(ctx: OverlayContext, g: GroupRef): { under: string; over: string } {
  const b = groupBox(ctx, g.elements);
  if (!b) return { under: '', over: '' };
  const c = TONE[g.tone];
  return {
    under: `<rect class="ov-group" x="${f(b.x1)}" y="${f(b.y1)}" width="${f(b.x2 - b.x1)}" height="${f(b.y2 - b.y1)}" rx="14" fill="${c}" fill-opacity="0.07" stroke="${c}" stroke-opacity="0.45" stroke-width="1.5" stroke-dasharray="${g.tone === 'result' ? '4 4' : 'none'}"/>`,
    over: chip(b.x1, b.y1 - 4, g.label, c, ctx.layout.viewBox),
  };
}

function loopSvg(ctx: OverlayContext, loop: LoopRef): { under: string; over: string } {
  const geo = loopGeometry(ctx, loop);
  if (!geo) return { under: '', over: '' };
  const d = geo.segments.map((s) => `M${f(s.a.x)} ${f(s.a.y)}L${f(s.b.x)} ${f(s.b.y)}`).join('');
  const r = 16;
  const { x, y } = geo.center;
  // Körív kb. 300°-ban, a végén nyílheggyel a körüljárás irányába.
  const a0 = -Math.PI / 2 + 0.5;
  const a1 = a0 + (Math.PI * 5) / 3;
  const pt = (a: number) => ({ x: x + r * Math.cos(a), y: y + r * Math.sin(a) });
  const [s, e] = geo.clockwise ? [pt(a0), pt(a1)] : [pt(a1), pt(a0)];
  const sweep = geo.clockwise ? 1 : 0;
  const endAngle = geo.clockwise ? a1 : a0;
  const tangent = geo.clockwise ? { x: -Math.sin(endAngle), y: Math.cos(endAngle) } : { x: Math.sin(endAngle), y: -Math.cos(endAngle) };
  const h1 = { x: e.x - tangent.x * 7 + -tangent.y * 4, y: e.y - tangent.y * 7 + tangent.x * 4 };
  const h2 = { x: e.x - tangent.x * 7 - -tangent.y * 4, y: e.y - tangent.y * 7 - tangent.x * 4 };
  return {
    under:
      `<path class="ov-loop-path" d="${d}" fill="none" stroke="var(--loop)" stroke-opacity="0.18" stroke-width="12" stroke-linecap="round" stroke-linejoin="round"/>` +
      // Körbefutó pontsor a körüljárás irányában.
      `<path class="ov-loop-march" d="M${geo.poly.map((q) => `${f(q.x)} ${f(q.y)}`).join('L')}Z" fill="none" stroke="var(--loop)" stroke-width="4" stroke-linecap="round" stroke-linejoin="round" stroke-dasharray="0.1 16"/>`,
    over: `<g class="ov-loop-arrow" style="transform-origin:${f(x)}px ${f(y)}px"><path d="M${f(s.x)} ${f(s.y)}A${r} ${r} 0 1 ${sweep} ${f(e.x)} ${f(e.y)}" fill="none" stroke="var(--loop)" stroke-width="1.8" stroke-linecap="round"/><path d="M${f(h1.x)} ${f(h1.y)}L${f(e.x)} ${f(e.y)}L${f(h2.x)} ${f(h2.y)}" fill="none" stroke="var(--loop)" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>${loop.label ? `<text x="${f(x)}" y="${f(y + 4)}" text-anchor="middle" fill="var(--loop)" font-size="11" font-weight="600">${esc(loop.label)}</text>` : ''}</g>`,
  };
}

/**
 * A csomópont egyetlen pontja a rajzon (ahogy a füzetben): ahol a legtöbb ág találkozik, nem a
 * hozzá tartozó összes vezeték.
 */
export function nodeAnchor(ctx: OverlayContext, node: number): Pt | null {
  const px = toPx(ctx.circuit);
  let best: { p: Pt; deg: number } | null = null;
  for (const [pid, n] of ctx.map.pointNode) {
    if (n !== node) continue;
    const deg = ctx.circuit.branches.filter((b) => b.from === pid || b.to === pid).length;
    if (!best || deg > best.deg) best = { p: px.get(pid)!, deg };
  }
  return best?.p ?? nodeGeometry(ctx, node).points[0] ?? null;
}

function nodeSvg(ctx: OverlayContext, node: number): { under: string; over: string } {
  const p = nodeAnchor(ctx, node);
  if (!p) return { under: '', over: '' };
  return {
    under: `<circle cx="${f(p.x)}" cy="${f(p.y)}" r="13" fill="var(--node)" fill-opacity="0.18"/>`,
    over: `<circle class="ov-node" cx="${f(p.x)}" cy="${f(p.y)}" r="7" fill="var(--node)" fill-opacity="0.95" stroke="var(--surface)" stroke-width="2"/>`,
  };
}

const OPP = { above: 'below', below: 'above', left: 'right', right: 'left' } as const;

/**
 * Referencianyíl az elem mellett (a felirattal ellentétes oldalon): szaggatott, akcentusszínű,
 * hogy ne legyen összetéveszthető a forrásnyilakkal. A nyíl a referenciairányt (a→b) mutatja,
 * mellette az előjeles érték.
 */
function arrowSvg(ctx: OverlayContext, a: ArrowRef): string {
  const g = ctx.layout.elements.find((x) => x.el.id === a.element);
  if (!g) return '';
  // Forrásnál a saját forrásnyíl ugyanazon az oldalon fut: a referencianyíl azon túlra kerül.
  const side = OPP[g.label.side];
  const off = g.halfWidth + 12 + (g.el.kind === 'R' ? 0 : 22);
  const n = side === 'above' ? { x: 0, y: -off } : side === 'below' ? { x: 0, y: off } : side === 'left' ? { x: -off, y: 0 } : { x: off, y: 0 };
  const half = 16;
  const from = { x: g.center.x + n.x - g.axis.x * half, y: g.center.y + n.y - g.axis.y * half };
  const to = { x: g.center.x + n.x + g.axis.x * half, y: g.center.y + n.y + g.axis.y * half };
  const d = g.axis;
  const head = `M${f(to.x - d.x * 6 - d.y * 3.5)} ${f(to.y - d.y * 6 + d.x * 3.5)}L${f(to.x)} ${f(to.y)}L${f(to.x - d.x * 6 + d.y * 3.5)} ${f(to.y - d.y * 6 - d.x * 3.5)}`;
  const text = `${a.kind} = ${formatQuantity(a.value, a.kind === 'I' ? 'A' : 'V', { sig: 3 })}`;
  const tOff = 14;
  const tx = g.center.x + n.x + (side === 'left' ? -tOff : side === 'right' ? tOff : 0);
  const ty = g.center.y + n.y + (side === 'above' ? -tOff + 4 : side === 'below' ? tOff + 6 : 4);
  const anchor = side === 'left' ? 'end' : side === 'right' ? 'start' : 'middle';
  const color = a.kind === 'I' ? 'var(--accent)' : 'var(--node)';
  return `<g class="ov-arrow"><path d="M${f(from.x)} ${f(from.y)}L${f(to.x)} ${f(to.y)}" fill="none" stroke="${color}" stroke-width="1.5" stroke-dasharray="3 3" stroke-linecap="round"/><path d="${head}" fill="none" stroke="${color}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><text x="${f(tx)}" y="${f(ty)}" text-anchor="${anchor}" fill="${color}" font-size="11.5" font-weight="600" paint-order="stroke" stroke="var(--surface)" stroke-width="4" stroke-linejoin="round">${esc(text)}</text></g>`;
}

/** Kiiktatott forrás jelölése: rövidzár = vastag vezeték az elemen át; szakadás = rés és ×. */
function killedSvg(ctx: OverlayContext, id: string, as: 'short' | 'open'): string {
  const g = ctx.layout.elements.find((x) => x.el.id === id);
  if (!g) return '';
  const { center: c, axis, halfLen, halfWidth } = g;
  const a = { x: c.x - axis.x * (halfLen + 4), y: c.y - axis.y * (halfLen + 4) };
  const b = { x: c.x + axis.x * (halfLen + 4), y: c.y + axis.y * (halfLen + 4) };
  const n = { x: -axis.y, y: axis.x };
  const lbl = { x: c.x + n.x * (halfWidth + 16), y: c.y + n.y * (halfWidth + 16) + 4 };
  if (as === 'short') {
    return `<g class="ov-killed"><path d="M${f(a.x)} ${f(a.y)}L${f(b.x)} ${f(b.y)}" stroke="var(--accent)" stroke-width="3" stroke-linecap="round"/><text x="${f(lbl.x)}" y="${f(lbl.y)}" text-anchor="middle" fill="var(--accent)" font-size="11" font-weight="600" paint-order="stroke" stroke="var(--surface)" stroke-width="4">rövidzár</text></g>`;
  }
  const t = 6;
  const tick = (p: Pt) => `M${f(p.x - n.x * t)} ${f(p.y - n.y * t)}L${f(p.x + n.x * t)} ${f(p.y + n.y * t)}`;
  return `<g class="ov-killed"><rect x="${f(g.body.x1 - 3)}" y="${f(g.body.y1 - 3)}" width="${f(g.body.x2 - g.body.x1 + 6)}" height="${f(g.body.y2 - g.body.y1 + 6)}" fill="var(--surface)" opacity="0.85"/><path d="${tick(a)}${tick(b)}" stroke="var(--node)" stroke-width="2" stroke-linecap="round"/><path d="M${f(c.x - 5)} ${f(c.y - 5)}L${f(c.x + 5)} ${f(c.y + 5)}M${f(c.x + 5)} ${f(c.y - 5)}L${f(c.x - 5)} ${f(c.y + 5)}" stroke="var(--node)" stroke-width="2" stroke-linecap="round"/><text x="${f(lbl.x)}" y="${f(lbl.y)}" text-anchor="middle" fill="var(--node)" font-size="11" font-weight="600" paint-order="stroke" stroke="var(--surface)" stroke-width="4">szakadás</text></g>`;
}

function nodeLabelSvg(ctx: OverlayContext, node: number, text: string): string {
  const p = nodeAnchor(ctx, node);
  if (!p) return '';
  return chip(p.x + 8, p.y - 8, text, 'var(--node)');
}

/**
 * Az átalakított csillag / delta a főábrán: delta → csillag esetén a kivezetésekből a közös
 * középpontba futó új ágak, csillag → delta esetén a kivezetések közti új ágak, felirattal.
 */
function transformSvg(ctx: OverlayContext, t: NonNullable<Highlight['transform']>): string {
  const pts = t.terminals.map((n) => nodeGeometry(ctx, n).points[0]);
  if (pts.some((p) => !p)) return '';
  const [p1, p2, p3] = pts as [Pt, Pt, Pt];
  const color = 'var(--transform)';
  const line = (a: Pt, b: Pt, label: string) => {
    const mx = (a.x + b.x) / 2;
    const my = (a.y + b.y) / 2;
    return `<path class="ov-transform-line" d="M${f(a.x)} ${f(a.y)}L${f(b.x)} ${f(b.y)}" stroke="${color}" stroke-width="2.4" stroke-linecap="round" fill="none"/>${chip(mx - textWidth(label, 12) / 2 - 7, my + 10, label, color)}`;
  };
  if (t.kind === 'delta-csillag') {
    const c = { x: (p1.x + p2.x + p3.x) / 3, y: (p1.y + p2.y + p3.y) / 3 };
    return `<g class="ov-transform">${line(p1, c, t.labels[0])}${line(p2, c, t.labels[1])}${line(p3, c, t.labels[2])}<circle cx="${f(c.x)}" cy="${f(c.y)}" r="4" fill="${color}"/></g>`;
  }
  return `<g class="ov-transform">${line(p1, p2, t.labels[0])}${line(p2, p3, t.labels[1])}${line(p3, p1, t.labels[2])}</g>`;
}

function terminalsSvg(ctx: OverlayContext): string {
  return ctx.layout.terminals.map((t) => `<circle class="ov-node" cx="${f(t.at.x)}" cy="${f(t.at.y)}" r="9" fill="none" stroke="var(--accent)" stroke-width="2"/>`).join('');
}

export function overlaySvg(ctx: OverlayContext, h: Highlight): { under: string; over: string } {
  const parts = [...(h.groups ?? []).map((g) => groupSvg(ctx, g)), ...(h.loops ?? []).map((l) => loopSvg(ctx, l)), ...(h.nodes ?? []).map((n) => nodeSvg(ctx, n))];
  return {
    under: parts.map((p) => p.under).join(''),
    over:
      parts.map((p) => p.over).join('') +
      (h.killed ?? []).map((k) => killedSvg(ctx, k.element, k.as)).join('') +
      (h.transform ? transformSvg(ctx, h.transform) : '') +
      (h.arrows ?? []).map((a) => arrowSvg(ctx, a)).join('') +
      (h.nodeLabels ?? []).map((l) => nodeLabelSvg(ctx, l.node, l.label)).join('') +
      (h.terminals ? terminalsSvg(ctx) : ''),
  };
}

/** A lépés fókusza a kamerához: a kiemelt elemek, csoportok, hurkok, csomópontok együtt. */
export function focusBox(ctx: OverlayContext, h: Highlight): Box | null {
  const boxes: Box[] = [];
  const ids = [...(h.elements ?? []), ...(h.groups ?? []).flatMap((g) => g.elements), ...(h.arrows ?? []).map((a) => a.element)];
  const gb = groupBox(ctx, ids, 0);
  if (gb) boxes.push(gb);
  // A kiemelt elemek felirata is a képen maradjon (pl. a hosszú "Re2 = 3,158 Ω").
  for (const id of ids) {
    const lb = ctx.layout.elements.find((e) => e.el.id === id)?.label.box;
    if (lb) boxes.push(lb);
  }
  for (const l of h.loops ?? []) {
    const g = loopGeometry(ctx, l);
    if (g) for (const s of g.segments) boxes.push({ x1: Math.min(s.a.x, s.b.x), y1: Math.min(s.a.y, s.b.y), x2: Math.max(s.a.x, s.b.x), y2: Math.max(s.a.y, s.b.y) });
  }
  for (const n of h.nodes ?? []) for (const p of nodeGeometry(ctx, n).points) boxes.push({ x1: p.x, y1: p.y, x2: p.x, y2: p.y });
  if (boxes.length === 0) return null;
  return union(boxes, 0);
}
