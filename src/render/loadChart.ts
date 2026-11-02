// A valódi generátor terhelési karakterisztikája SVG-ben (külső diagramkönyvtár nélkül):
// a kapocsfeszültség és a terhelőáram a terhelő ellenállás függvényében, a teljesítmény szaggatottan,
// a rövidzár (Rt = 0), az illesztés (Rt = Rb) és az aktuális terhelés jelölve.

import { loadPoint } from '../methods/realsource';
import { formatQuantity } from '../units';

export interface ChartOptions {
  width?: number;
  height?: number;
}

const f = (n: number) => Number(n.toFixed(2)).toString();

export function loadChartMax(Rb: number, Rt: number): number {
  return Math.max(10 * Rb, 2 * Rt);
}

export function renderLoadChart(U0: number, Rb: number, Rt: number, opts: ChartOptions = {}): string {
  const W = opts.width ?? 420;
  const H = opts.height ?? 220;
  const m = { l: 44, r: 44, t: 16, b: 34 };
  const xmax = loadChartMax(Rb, Rt);
  const Ik = U0 / Rb;
  const Pmax = (U0 * U0) / (4 * Rb);
  const X = (r: number) => m.l + (r / xmax) * (W - m.l - m.r);
  const Y = (frac: number) => H - m.b - frac * (H - m.t - m.b);
  const N = 120;
  const pts = Array.from({ length: N + 1 }, (_, i) => loadPoint(U0, Rb, (i / N) * xmax));
  const line = (sel: (p: ReturnType<typeof loadPoint>) => number) => pts.map((p, i) => `${i ? 'L' : 'M'}${f(X(p.Rt))} ${f(Y(sel(p)))}`).join('');
  const cur = loadPoint(U0, Rb, Rt);
  const grid = [0, 0.25, 0.5, 0.75, 1]
    .map((g) => `<line x1="${m.l}" x2="${W - m.r}" y1="${f(Y(g))}" y2="${f(Y(g))}" stroke="var(--hair-2)" stroke-width="1"/>`)
    .join('');
  const tick = (v: number, unit: 'V' | 'A', side: 'l' | 'r', frac: number) =>
    `<text x="${side === 'l' ? m.l - 6 : W - m.r + 6}" y="${f(Y(frac) + 4)}" text-anchor="${side === 'l' ? 'end' : 'start'}" font-size="10.5" fill="var(--ink-2)">${formatQuantity(v, unit, { sig: 3 })}</text>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" class="load-chart" role="img" aria-label="Terhelési karakterisztika" font-family="-apple-system, 'SF Pro Text', Inter, system-ui, sans-serif" style="font-variant-numeric:tabular-nums">
${grid}
<line x1="${f(X(Rb))}" x2="${f(X(Rb))}" y1="${m.t}" y2="${H - m.b}" stroke="var(--result)" stroke-dasharray="2 4" stroke-width="1"/>
<text x="${f(X(Rb) + 4)}" y="${m.t + 10}" font-size="10.5" fill="var(--result)">illesztés: Rt = Rb</text>
<path d="${line((p) => p.P / Pmax)}" fill="none" stroke="var(--result)" stroke-width="1.5" stroke-dasharray="5 4"/>
<path d="${line((p) => p.Uk / U0)}" fill="none" stroke="var(--accent)" stroke-width="2"/>
<path d="${line((p) => p.It / Ik)}" fill="none" stroke="var(--node)" stroke-width="2"/>
<line x1="${f(X(Rt))}" x2="${f(X(Rt))}" y1="${m.t}" y2="${H - m.b}" stroke="var(--ink-2)" stroke-width="1"/>
<circle cx="${f(X(Rt))}" cy="${f(Y(cur.Uk / U0))}" r="4.5" fill="var(--accent)" stroke="var(--surface)" stroke-width="2"/>
<circle cx="${f(X(Rt))}" cy="${f(Y(cur.It / Ik))}" r="4.5" fill="var(--node)" stroke="var(--surface)" stroke-width="2"/>
${tick(U0, 'V', 'l', 1)}${tick(U0 / 2, 'V', 'l', 0.5)}${tick(0, 'V', 'l', 0)}
${tick(Ik, 'A', 'r', 1)}${tick(Ik / 2, 'A', 'r', 0.5)}
<text x="${m.l}" y="${H - 12}" font-size="10.5" fill="var(--ink-2)">0 Ω (rövidzár)</text>
<text x="${W - m.r}" y="${H - 12}" text-anchor="end" font-size="10.5" fill="var(--ink-2)">${formatQuantity(xmax, 'Ω', { sig: 3 })} → üresjárás felé</text>
</svg>`;
}
