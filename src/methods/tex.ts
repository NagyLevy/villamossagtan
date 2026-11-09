// LaTeX-formázás a lépésekhez: számok tizedesvesszővel, mennyiségek előtaggal.

import type { CircuitElement } from '../solver/model';
import { choosePrefix, formatNumber, type Unit } from '../units';

/** Szám LaTeX-ben (tizedesvessző KaTeX-barát alakban: 4{,}5). Negatívnál zárójelben, ha kérik. */
export function texNum(x: number, opts: { paren?: boolean; sig?: number } = {}): string {
  const s = formatNumber(x, opts.sig ?? 4).replace('−', '-').replace(',', '{,}');
  return opts.paren && x < 0 ? `(${s})` : s;
}

const UNIT_TEX: Record<Unit, string> = {
  V: '\\text{V}',
  A: '\\text{A}',
  Ω: '\\Omega',
  W: '\\text{W}',
  VA: '\\text{VA}',
  var: '\\text{var}',
  S: '\\text{S}',
  H: '\\text{H}',
  F: '\\text{F}',
  s: '\\text{s}',
  'rad/s': '\\tfrac{\\text{rad}}{\\text{s}}',
  '°': '^\\circ',
  '': '',
};

/** Mennyiség előtaggal: 0.0045 A → 4{,}5\,\text{mA}. */
export function texQty(x: number, unit: Unit, opts: { paren?: boolean } = {}): string {
  const p = choosePrefix(x, unit);
  // A µ görög betű matematikai módban, a többi előtag szövegként.
  const prefix = p.symbol === 'µ' ? '\\mu ' : p.symbol ? `\\text{${p.symbol}}` : '';
  const u = UNIT_TEX[unit];
  const body = unit === '°' ? `${texNum(x)}^\\circ` : unit === '' ? texNum(x) : `${texNum(x / p.factor)}\\,${prefix}${u}`;
  return opts.paren && x < 0 ? `(${body})` : body;
}

/** Elem jele LaTeX-ben: R3 → R_{3}, Ug1 → U_{g1}, Ig2 → I_{g2}. */
export function texElement(id: string): string {
  const m = /^(R|L|C|Ug|Ig)(\d+)$/.exec(id);
  if (!m) return `\\text{${id}}`;
  if (m[1] === 'R' || m[1] === 'L' || m[1] === 'C') return `${m[1]}_{${m[2]}}`;
  return `${m[1]![0]}_{g${m[2]}}`;
}

/** Elem feszültségének / áramának jele: U_{R3}, I_{Ug1}. */
export function texOf(q: 'U' | 'I', id: string): string {
  return `${q}_{\\text{${id}}}`;
}

/** Elem rövid felirata szövegben: "R3 (6 Ω)". */
export function elementText(el: CircuitElement, value: string): string {
  return `${el.id} (${value})`;
}

/**
 * Az összevont ellenállás neve (Levi döntése, 2026-11-09): az eredő Re, minden újabb összevonás egy vesszővel több:
 * Re′, Re″, Re‴, utána Re⁽⁴⁾, Re⁽⁵⁾ … (képletben R_e^{(4)}). A belső kulcs továbbra is e1, e2, …
 */
export function eTex(key: string): string {
  const n = Number(key.slice(1));
  return n >= 1 && n <= 3 ? `e${"'".repeat(n)}` : `e^{(${n})}`;
}
export function ePlain(key: string): string {
  const n = Number(key.slice(1));
  return n >= 1 && n <= 3 ? `e${'′″‴'[n - 1]}` : `e⁽${[...String(n)].map((d) => '⁰¹²³⁴⁵⁶⁷⁸⁹'[Number(d)]).join('')}⁾`;
}
