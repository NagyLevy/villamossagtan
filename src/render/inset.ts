// Betétábra a csillag-delta átalakításhoz: a hagyományos tankönyvi Y és Δ alak rézsútos
// ellenállásokkal, az 1, 2, 3 kivezetésekkel és az értékekkel, köztük egy nyíllal.

import { formatQuantity } from '../units';

type P = { x: number; y: number };
const f = (n: number) => Number(n.toFixed(2)).toString();

/** Rézsútos ellenállás két pont között: vezeték + elforgatott téglalap + felirat. */
function resistor(a: P, b: P, label: string, labelSide: 1 | -1): string {
  const mx = (a.x + b.x) / 2;
  const my = (a.y + b.y) / 2;
  const ang = (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI;
  const len = Math.hypot(b.x - a.x, b.y - a.y);
  const nx = -(b.y - a.y) / len;
  const ny = (b.x - a.x) / len;
  // A felirat az ellenállás mellé kerül, a vonaltól elfelé igazítva (nem lóg rá a szomszédra).
  const side = nx * labelSide;
  const anchor = side < -0.3 ? 'end' : side > 0.3 ? 'start' : 'middle';
  const ox = anchor === 'middle' ? 0 : side * 13;
  return (
    `<line x1="${f(a.x)}" y1="${f(a.y)}" x2="${f(b.x)}" y2="${f(b.y)}" stroke="var(--circuit-ink)" stroke-width="1.4"/>` +
    `<rect x="${f(mx - 12)}" y="${f(my - 5)}" width="24" height="10" rx="1" fill="var(--surface)" stroke="var(--transform)" stroke-width="1.6" transform="rotate(${f(ang)} ${f(mx)} ${f(my)})"/>` +
    `<text x="${f(mx + ox)}" y="${f(my + ny * 13 * labelSide + 4)}" text-anchor="${anchor}" font-size="10.5" font-weight="600" fill="var(--transform)" paint-order="stroke" stroke="var(--surface)" stroke-width="3">${label}</text>`
  );
}

function terminal(p: P, name: string, dx: number, dy: number): string {
  return `<circle cx="${f(p.x)}" cy="${f(p.y)}" r="3.2" fill="var(--surface)" stroke="var(--circuit-ink)" stroke-width="1.4"/><text x="${f(p.x + dx)}" y="${f(p.y + dy)}" text-anchor="middle" font-size="11" font-weight="650" fill="var(--circuit-ink)">${name}</text>`;
}

function shape(kind: 'Y' | 'D', ox: number, vals: [number, number, number]): string {
  const t1 = { x: ox + 14, y: 22 };
  const t2 = { x: ox + 126, y: 22 };
  const t3 = { x: ox + 70, y: 126 };
  const fmt = (v: number) => formatQuantity(v, 'Ω', { sig: 3 });
  let body: string;
  if (kind === 'Y') {
    const c = { x: ox + 70, y: 62 };
    body =
      resistor(t1, c, `R1 = ${fmt(vals[0])}`, 1) +
      resistor(t2, c, `R2 = ${fmt(vals[1])}`, -1) +
      resistor(c, t3, `R3 = ${fmt(vals[2])}`, -1) +
      `<circle cx="${f(c.x)}" cy="${f(c.y)}" r="2.6" fill="var(--circuit-ink)"/>`;
  } else {
    body = resistor(t1, t2, `R12 = ${fmt(vals[0])}`, -1) + resistor(t2, t3, `R23 = ${fmt(vals[1])}`, -1) + resistor(t3, t1, `R31 = ${fmt(vals[2])}`, -1);
  }
  return body + terminal(t1, '1', -8, -6) + terminal(t2, '2', 8, -6) + terminal(t3, '3', 0, 16);
}

export function renderInset(kind: 'delta-csillag' | 'csillag-delta', before: [number, number, number], after: [number, number, number]): string {
  const from = kind === 'delta-csillag' ? 'D' : 'Y';
  const to = kind === 'delta-csillag' ? 'Y' : 'D';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-40 0 520 150" class="inset" role="img" aria-label="${kind === 'delta-csillag' ? 'Delta átalakítása csillaggá' : 'Csillag átalakítása deltává'}" font-family="-apple-system, 'SF Pro Text', Inter, system-ui, sans-serif" style="font-variant-numeric:tabular-nums">
${shape(from, 0, before)}
<path d="M178 74 L222 74 M214 68 L222 74 L214 80" fill="none" stroke="var(--transform)" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
<text x="200" y="62" text-anchor="middle" font-size="11" font-weight="650" fill="var(--transform)">${kind === 'delta-csillag' ? 'Δ → Y' : 'Y → Δ'}</text>
${shape(to, 290, after)}
</svg>`;
}
