// SVG-rajzolás európai (IEC) jelekkel. A kimenet egy önálló SVG-szöveg (exportálható, nyomtatható);
// a színek CSS-változókból jönnek, alapértékkel, így a felület témája (világos/sötét) átszínezi.
//
// Jelek (IEC: a körön átmenő vonal azt mutatja, mivé válik a forrás kiiktatva):
//  - Ellenállás: téglalap, a vezeték a rövid oldalakba csatlakozik.
//  - Feszültségforrás: kör, rajta a vezeték irányában átmenő egyenes (kiiktatva rövidzár);
//    mellette vékony, nyitott hegyű nyíl a vezetékkel párhuzamosan, a magasabb potenciál felé. Nincs +/− jel.
//  - Áramforrás: kör, rajta a vezetékre merőleges egyenes (kiiktatva szakadás);
//    mellette nyíl tömör, kitöltött heggyel, az áram irányába.

import type { Circuit } from '../solver/model';
import { computeLayout, SIZE, type ElementGeom, type Layout, type Pt } from './layout';

export interface RenderOptions {
  /** A kérdéses elem(ek): megkülönböztetett kiemelés. */
  targets?: string[];
  /** Halványított elemek (pl. egyszerűsítésnél). */
  dimmed?: string[];
  /** Akadálymentes leírás. */
  title?: string;
}

const STYLE = `
.circuit{font-family:-apple-system,"SF Pro Text",Inter,system-ui,sans-serif;font-variant-numeric:tabular-nums}
.circuit .wire{fill:none;stroke:var(--circuit-ink,#1d1d1f);stroke-width:1.5;stroke-linecap:round;stroke-linejoin:round}
.circuit .sym{fill:var(--circuit-paper,#fff);stroke:var(--circuit-ink,#1d1d1f);stroke-width:1.6}
.circuit .sym-line{fill:none;stroke:var(--circuit-ink,#1d1d1f);stroke-width:1.6;stroke-linecap:round}
.circuit .head{fill:var(--circuit-ink,#1d1d1f);stroke:none}
.circuit .src-arrow{fill:none;stroke:var(--circuit-ink,#1d1d1f);stroke-width:1.2;stroke-linecap:round;stroke-linejoin:round}
.circuit .src-arrow-current{stroke-width:1.5}
.circuit .junction{fill:var(--circuit-ink,#1d1d1f)}
.circuit .terminal{fill:var(--circuit-paper,#fff);stroke:var(--circuit-ink,#1d1d1f);stroke-width:1.5}
.circuit .label{fill:var(--circuit-label,#3a3a3c);font-size:${SIZE.fontSize}px;font-weight:500;letter-spacing:-0.01em}
.circuit .terminal-label{fill:var(--circuit-ink,#1d1d1f);font-size:14px;font-weight:600}
.circuit .is-target .sym,.circuit .is-target .sym-line,.circuit .is-target .src-arrow{stroke:var(--circuit-accent,#0071e3);stroke-width:2.2}
.circuit .is-target .head{fill:var(--circuit-accent,#0071e3)}
.circuit .is-target .label{fill:var(--circuit-accent,#0071e3);font-weight:650}
.circuit .is-dimmed{opacity:.28}
.circuit .el{transition:opacity .35s cubic-bezier(.22,1,.36,1)}
.circuit .el .sym,.circuit .el .sym-line,.circuit .el .label{transition:stroke .3s,fill .3s,stroke-width .3s}
.circuit .is-hl .sym,.circuit .is-hl .sym-line,.circuit .is-hl .src-arrow{stroke:var(--circuit-accent,#0071e3);stroke-width:2.2}
.circuit .is-hl .head{fill:var(--circuit-accent,#0071e3)}
.circuit .is-hl .label{fill:var(--circuit-accent,#0071e3);font-weight:650}
.circuit .is-faint{opacity:.22}
`;

const f = (n: number) => Number(n.toFixed(2)).toString();

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** Nyílhegy háromszög csúcsa `tip`, irány `d` (egységvektor). */
function arrowHead(tip: Pt, d: Pt, len: number, halfW: number): string {
  const bx = tip.x - d.x * len;
  const by = tip.y - d.y * len;
  const nx = -d.y;
  const ny = d.x;
  return `M${f(tip.x)} ${f(tip.y)}L${f(bx + nx * halfW)} ${f(by + ny * halfW)}L${f(bx - nx * halfW)} ${f(by - ny * halfW)}Z`;
}

function resistorSvg(g: ElementGeom): string {
  const { body } = g;
  return `<rect class="sym" x="${f(body.x1)}" y="${f(body.y1)}" width="${f(body.x2 - body.x1)}" height="${f(body.y2 - body.y1)}" rx="1"/>`;
}

/** Kör egy átmenő egyenessel: `along` = true esetén a vezeték irányában, különben arra merőlegesen. */
function circleWithLine(g: ElementGeom, along: boolean): string {
  const { center: c, axis } = g;
  const r = SIZE.sourceRadius;
  const v = along ? axis : { x: -axis.y, y: axis.x };
  return (
    `<circle class="sym" cx="${f(c.x)}" cy="${f(c.y)}" r="${r}"/>` +
    `<path class="sym-line" d="M${f(c.x - v.x * r)} ${f(c.y - v.y * r)}L${f(c.x + v.x * r)} ${f(c.y + v.y * r)}"/>`
  );
}

function arrowDir(a: NonNullable<ElementGeom['arrow']>): Pt {
  const len = Math.hypot(a.to.x - a.from.x, a.to.y - a.from.y);
  return { x: (a.to.x - a.from.x) / len, y: (a.to.y - a.from.y) / len };
}

function voltageSourceSvg(g: ElementGeom): string {
  let out = circleWithLine(g, true);
  if (g.arrow) {
    const { from, to } = g.arrow;
    const d = arrowDir(g.arrow);
    const h = 6;
    const w = 3.6;
    const b = { x: to.x - d.x * h, y: to.y - d.y * h };
    // Vékony nyíl nyitott (vonalas) heggyel: két rövid szár.
    out += `<path class="src-arrow" d="M${f(from.x)} ${f(from.y)}L${f(to.x)} ${f(to.y)}M${f(b.x - d.y * w)} ${f(b.y + d.x * w)}L${f(to.x)} ${f(to.y)}L${f(b.x + d.y * w)} ${f(b.y - d.x * w)}"/>`;
  }
  return out;
}

function currentSourceSvg(g: ElementGeom): string {
  let out = circleWithLine(g, false);
  if (g.arrow) {
    const { from, to } = g.arrow;
    const d = arrowDir(g.arrow);
    const headLen = 9;
    const lineEnd = { x: to.x - d.x * (headLen - 1), y: to.y - d.y * (headLen - 1) };
    // Nyíl tömör, kitöltött heggyel.
    out += `<path class="src-arrow src-arrow-current" d="M${f(from.x)} ${f(from.y)}L${f(lineEnd.x)} ${f(lineEnd.y)}"/>`;
    out += `<path class="head" d="${arrowHead(to, d, headLen, 4.6)}"/>`;
  }
  return out;
}

export function renderCircuitSvg(c: Circuit, opts: RenderOptions = {}, layout: Layout = computeLayout(c)): string {
  const targets = new Set(opts.targets ?? []);
  const dimmed = new Set(opts.dimmed ?? []);
  const parts: string[] = [];
  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" class="circuit" viewBox="${f(layout.viewBox.x)} ${f(layout.viewBox.y)} ${f(layout.width)} ${f(layout.height)}" width="${f(layout.width)}" height="${f(layout.height)}" role="img">`,
  );
  parts.push(`<title>${esc(opts.title ?? 'Áramkör')}</title>`);
  parts.push(`<style>${STYLE}</style>`);

  // Vezetékek: a halványított elemek ágát nem halványítjuk, csak magát az elemet.
  const d = layout.wires
    .filter((w) => w.a.x !== w.b.x || w.a.y !== w.b.y)
    .map((w) => `M${f(w.a.x)} ${f(w.a.y)}L${f(w.b.x)} ${f(w.b.y)}`)
    .join('');
  parts.push(`<g class="wires"><path class="wire" d="${d}"/></g>`);
  // Lépésenkénti kiemelések rétege az elemek alatt (hurok, csomópont, csoportkeret).
  parts.push('<g class="ov-under"></g>');

  parts.push('<g class="elements">');
  for (const g of layout.elements) {
    const cls = ['el', `el-${g.el.kind}`, targets.has(g.el.id) ? 'is-target' : '', dimmed.has(g.el.id) ? 'is-dimmed' : ''].filter(Boolean).join(' ');
    const sym = g.el.kind === 'R' ? resistorSvg(g) : g.el.kind === 'V' ? voltageSourceSvg(g) : currentSourceSvg(g);
    const l = g.label;
    parts.push(
      `<g class="${cls}" data-id="${esc(g.el.id)}">${sym}<text class="label" x="${f(l.x)}" y="${f(l.y)}" text-anchor="${l.anchor}">${esc(l.text)}</text></g>`,
    );
  }
  parts.push('</g>');

  parts.push('<g class="junctions">');
  for (const j of layout.junctions) parts.push(`<circle class="junction" cx="${f(j.x)}" cy="${f(j.y)}" r="${SIZE.junctionRadius}"/>`);
  parts.push('</g>');

  parts.push('<g class="terminals">');
  for (const t of layout.terminals) {
    parts.push(
      `<g data-terminal="${t.name}"><circle class="terminal" cx="${f(t.at.x)}" cy="${f(t.at.y)}" r="${SIZE.terminalRadius}"/><text class="terminal-label" x="${f(t.label.x)}" y="${f(t.label.y)}" text-anchor="${t.label.anchor}">${t.name}</text></g>`,
    );
  }
  parts.push('</g>');
  // Lépésenkénti kiemelések rétege mindenek fölött (nyilak, feliratok).
  parts.push('<g class="ov-over"></g>');
  parts.push('</svg>');
  return parts.join('');
}
