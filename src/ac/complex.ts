// Komplex számok a szinuszos (váltakozó áramú) hálózatokhoz. Tiszta függvények, nincs osztály.
// A könyv jelölése: algebrai alak a + jb, exponenciális (Euler-) alak z·e^{jφ}, a szög fokban.

import { formatNumber } from '../units';

export interface Cx {
  re: number;
  im: number;
}

export const cx = (re: number, im = 0): Cx => ({ re, im });
export const ZERO: Cx = { re: 0, im: 0 };
export const ONE: Cx = { re: 1, im: 0 };

export const add = (a: Cx, b: Cx): Cx => ({ re: a.re + b.re, im: a.im + b.im });
export const sub = (a: Cx, b: Cx): Cx => ({ re: a.re - b.re, im: a.im - b.im });
export const mul = (a: Cx, b: Cx): Cx => ({ re: a.re * b.re - a.im * b.im, im: a.re * b.im + a.im * b.re });
export const scale = (a: Cx, k: number): Cx => ({ re: a.re * k, im: a.im * k });
export const neg = (a: Cx): Cx => ({ re: -a.re, im: -a.im });
export const conj = (a: Cx): Cx => ({ re: a.re, im: -a.im });
export const abs = (a: Cx): number => Math.hypot(a.re, a.im);

export function div(a: Cx, b: Cx): Cx {
  const d = b.re * b.re + b.im * b.im;
  if (d === 0) return { re: Number.POSITIVE_INFINITY, im: 0 };
  return { re: (a.re * b.re + a.im * b.im) / d, im: (a.im * b.re - a.re * b.im) / d };
}

export const inv = (a: Cx): Cx => div(ONE, a);

/** Replusz (párhuzamos eredő): a·b / (a + b). */
export const par = (a: Cx, b: Cx): Cx => div(mul(a, b), add(a, b));

/** A szög fokban, (−180°, 180°] tartományban. */
export function argDeg(a: Cx): number {
  if (Math.abs(a.re) < 1e-300 && Math.abs(a.im) < 1e-300) return 0;
  const d = (Math.atan2(a.im, a.re) * 180) / Math.PI;
  return d <= -180 + 1e-12 ? 180 : d;
}

/** Exponenciális alakból: abs·e^{j·deg}. */
export function polar(magnitude: number, deg: number): Cx {
  const r = (deg * Math.PI) / 180;
  return { re: magnitude * Math.cos(r), im: magnitude * Math.sin(r) };
}

/** A szög normálása (−180°, 180°] közé. */
export function wrapDeg(d: number): number {
  let x = ((d % 360) + 360) % 360;
  if (x > 180) x -= 360;
  return x;
}

/** Két szög eltérése fokban (a legrövidebb úton). */
export function angleDiff(a: number, b: number): number {
  return Math.abs(wrapDeg(a - b));
}

export function nearlyEqual(a: Cx, b: Cx, rel = 1e-9): boolean {
  const scaleRef = Math.max(1e-15, abs(a), abs(b));
  return abs(sub(a, b)) <= rel * scaleRef;
}

/** A lebegőpontos zaj levágása (pl. 1e-17 → 0), a nagysághoz mérten. */
function clean(a: Cx): Cx {
  const m = abs(a);
  const tiny = Math.max(1e-15, m * 1e-10);
  return { re: Math.abs(a.re) < tiny ? 0 : a.re, im: Math.abs(a.im) < tiny ? 0 : a.im };
}

// ───────── Kiírás (szöveg és LaTeX) ─────────

/** Algebrai alak szövegként: "500 + j500", "−j1000", "2000". */
export function fmtAlg(a0: Cx, sig = 4): string {
  const a = clean(a0);
  const re = formatNumber(a.re, sig);
  const im = formatNumber(Math.abs(a.im), sig);
  if (a.im === 0) return re;
  const jPart = `j${im}`;
  if (a.re === 0) return a.im < 0 ? `−${jPart}` : jPart;
  return `${re} ${a.im < 0 ? '−' : '+'} ${jPart}`;
}

/** Exponenciális alak szövegként: "707,1·e^(j45°)". */
export function fmtExp(a0: Cx, sig = 4): string {
  const a = clean(a0);
  const d = argDeg(a);
  return `${formatNumber(abs(a), sig)}·e^(${d < 0 ? '−' : ''}j${formatNumber(Math.abs(d), sig)}°)`;
}

/** Szám LaTeX-be (tizedesvessző, mínuszjel). */
export function texNum(x: number, sig = 4): string {
  return formatNumber(x, sig).replace('−', '-').replace(',', '{,}');
}

/** Algebrai alak LaTeX-ben: "500 + j500". */
export function texAlg(a0: Cx, sig = 4): string {
  const a = clean(a0);
  if (a.im === 0) return texNum(a.re, sig);
  const im = texNum(Math.abs(a.im), sig);
  const jPart = `j${im}`;
  if (a.re === 0) return a.im < 0 ? `-${jPart}` : jPart;
  return `${texNum(a.re, sig)} ${a.im < 0 ? '-' : '+'} ${jPart}`;
}

/** Exponenciális alak LaTeX-ben: "707{,}1\,e^{j45^\circ}". */
export function texExp(a0: Cx, sig = 4): string {
  const a = clean(a0);
  return `${texNum(abs(a), sig)}\\,${texE(argDeg(a), sig)}`;
}

/** e^{jφ} LaTeX-ben, negatív szögnél e^{-jφ}. */
export function texE(deg: number, sig = 4): string {
  return `e^{${deg < 0 ? '-' : ''}j${texNum(Math.abs(deg), sig)}^\\circ}`;
}

/** Zárójelezett algebrai alak (szorzatban, összegben): "(500 + j500)". */
export function texAlgP(a: Cx, sig = 4): string {
  const s = texAlg(a, sig);
  return /[+-]/.test(s.slice(1)) || s.startsWith('-') ? `(${s})` : s;
}
