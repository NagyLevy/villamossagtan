// LaTeX-formázás a lépésekhez: számok tizedesvesszővel, mennyiségek előtaggal.

import type { CircuitElement } from '../solver/model';
import { choosePrefix, formatNumber, type Unit } from '../units';

/** Szám LaTeX-ben (tizedesvessző KaTeX-barát alakban: 4{,}5). Negatívnál zárójelben, ha kérik. */
export function texNum(x: number, opts: { paren?: boolean; sig?: number } = {}): string {
  const s = formatNumber(x, opts.sig ?? 4).replace('−', '-').replace(',', '{,}');
  return opts.paren && x < 0 ? `(${s})` : s;
}

const UNIT_TEX: Record<Unit, string> = { V: '\\text{V}', A: '\\text{A}', Ω: '\\Omega', W: '\\text{W}' };

/** Mennyiség előtaggal: 0.0045 A → 4{,}5\,\text{mA}. */
export function texQty(x: number, unit: Unit, opts: { paren?: boolean } = {}): string {
  const p = choosePrefix(x, unit);
  // A µ görög betű matematikai módban, a többi előtag szövegként.
  const prefix = p.symbol === 'µ' ? '\\mu ' : p.symbol ? `\\text{${p.symbol}}` : '';
  const u = UNIT_TEX[unit];
  const body = `${texNum(x / p.factor)}\\,${prefix}${u}`;
  return opts.paren && x < 0 ? `(${body})` : body;
}

/** Elem jele LaTeX-ben: R3 → R_{3}, Ug1 → U_{g1}, Ig2 → I_{g2}. */
export function texElement(id: string): string {
  const m = /^(R|Ug|Ig)(\d+)$/.exec(id);
  if (!m) return `\\text{${id}}`;
  if (m[1] === 'R') return `R_{${m[2]}}`;
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
