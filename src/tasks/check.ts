// Beírt válaszok ellenőrzése mezőnként: szám mértékegységgel (±1%), szög (±1°, 360°-onként
// ugyanaz), kompenzáló elem (a mértékegység dönti el: H = tekercs, F = kondenzátor).

import { angleDiff } from '../ac/complex';
import { checkAnswer, parseQuantity, type CheckResult } from '../units';
import type { AnswerField } from './types';

export type FieldResult = CheckResult | { status: 'wrong-element'; value: number };

export function checkField(input: string, f: AnswerField): FieldResult {
  if (f.kind === 'phase') {
    const s = input.trim().replace(/°|fok|deg/g, '').trim();
    const parsed = parseQuantity(s, '');
    if (!parsed.ok) return { status: 'invalid', error: parsed.error };
    // Nulla nagyságú mennyiségnél a szög bármi lehet; különben ±1° tűrés.
    return angleDiff(parsed.value, f.answer) <= 1 ? { status: 'correct', value: parsed.value } : { status: 'wrong', value: parsed.value };
  }
  if (f.kind === 'element') {
    const asF = parseQuantity(input, 'F');
    const asH = parseQuantity(input, 'H');
    const hasUnit = /[a-zA-Zµμ]\s*$/.test(input.trim()) && /[HF]\s*$/.test(input.trim());
    if (!hasUnit) return { status: 'invalid', error: 'Írd mögé a mértékegységet: H (tekercs) vagy F (kondenzátor), pl. 100 nF.' };
    const isF = /F\s*$/.test(input.trim());
    const parsed = isF ? asF : asH;
    if (!parsed.ok) return { status: 'invalid', error: parsed.error };
    if ((isF ? 'C' : 'L') !== f.element) return { status: 'wrong-element', value: parsed.value };
    return checkAnswer(input, f.answer, f.unit, { magnitudeOnly: true });
  }
  return checkAnswer(input, f.answer, f.unit, { magnitudeOnly: f.magnitudeOnly });
}

export function verdictText(r: FieldResult): string {
  switch (r.status) {
    case 'correct':
      return 'Helyes';
    case 'wrong-sign':
      return 'Az előjel nem jó: figyeld a referenciairányt.';
    case 'wrong':
      return 'Nem ez az eredmény.';
    case 'wrong-element':
      return 'Nem ilyen fajta elem kell (tekercs helyett kondenzátor, vagy fordítva).';
    case 'invalid':
      return r.error;
  }
}
