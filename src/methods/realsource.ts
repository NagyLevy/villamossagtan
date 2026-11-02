// Valódi feszültséggenerátor terhelése: kapocsfeszültség, terhelőáram, hiányzó adat visszafejtése,
// és a terhelési karakterisztika adatai (a felület ebből rajzol diagramot).

import type { Problem } from '../generator/generate';
import { allElements } from '../solver/model';
import { formatQuantity } from '../units';
import { texQty } from './tex';
import type { MethodAnswer, MethodResult, Step } from './types';

export interface LoadPoint {
  Rt: number;
  Uk: number;
  It: number;
  P: number;
}

/** A terhelési karakterisztika egy pontja: Uk = U0 · Rt / (Rt + Rb), It = U0 / (Rb + Rt). */
export function loadPoint(U0: number, Rb: number, Rt: number): LoadPoint {
  if (!Number.isFinite(Rt)) return { Rt, Uk: U0, It: 0, P: 0 };
  const It = U0 / (Rb + Rt);
  const Uk = It * Rt;
  return { Rt, Uk, It, P: Uk * It };
}

export function solveRealSource(p: Problem): MethodResult {
  const els = allElements(p.circuit);
  const src = els.find((e) => e.kind === 'V');
  const rb = els.find((e) => e.role === 'internal');
  const rt = els.find((e) => e.role === 'load');
  if (!src || !rb || !rt) return { ok: false, reason: 'Ez a módszer a valódi generátor terhelésére való.' };
  const steps: Step[] = [];
  const answers: MethodAnswer[] = [];
  const Rt = rt.value;
  steps.push({
    title: 'A valódi generátor',
    text: 'A valódi feszültséggenerátor egy ideális U0 forrás és vele sorosan az Rb belső ellenállás. A kimeneti kapcsokra (A–B) kötjük az Rt terhelést: egyetlen soros kör.',
    highlight: { elements: [src.id, rb.id], terminals: true },
  });

  const qRb = p.questions.find((q) => q.kind === 'Rb');
  const qU0 = p.questions.find((q) => q.kind === 'U0');
  let U0 = src.value;
  let Rb = rb.value;
  if (qRb) {
    const Uk = qRb.given![0]!.value;
    const It = Uk / Rt;
    Rb = (U0 - Uk) / It;
    steps.push(
      {
        title: 'Terhelőáram a mérésből',
        text: 'A kapocsfeszültség a terhelésen esik, így Ohm törvényéből a terhelőáram:',
        terms: ['I_t =', '\\frac{U_k}{R_t}'],
        subst: `I_t = \\frac{${texQty(Uk, 'V')}}{${texQty(Rt, 'Ω')}}`,
        result: { symbol: 'I_t', value: It, unit: 'A' },
        highlight: { elements: [rt.id] },
      },
      {
        title: 'Belső ellenállás',
        text: 'A forrásfeszültség és a kapocsfeszültség különbsége a belső ellenálláson esik.',
        terms: ['R_b =', '\\frac{U_0 - U_k}{I_t}'],
        subst: `R_b = \\frac{${texQty(U0, 'V')} - ${texQty(Uk, 'V')}}{${texQty(It, 'A')}}`,
        result: { symbol: 'R_b', value: Rb, unit: 'Ω' },
        highlight: { elements: [rb.id] },
      },
    );
    answers.push({ questionId: qRb.id, value: Rb });
  } else if (qU0) {
    const It = qU0.given![0]!.value;
    U0 = It * (Rb + Rt);
    steps.push({
      title: 'Forrásfeszültség a mérésből',
      text: 'A soros körben a terhelőáram mindkét ellenálláson átfolyik; a forrásfeszültség a két feszültségesés összege.',
      terms: ['U_0 =', 'I_t \\cdot (R_b + R_t)'],
      subst: `U_0 = ${texQty(It, 'A')} \\cdot (${texQty(Rb, 'Ω')} + ${texQty(Rt, 'Ω')})`,
      result: { symbol: 'U_0', value: U0, unit: 'V' },
      highlight: { elements: [src.id] },
    });
    answers.push({ questionId: qU0.id, value: U0 });
  } else {
    const pt = loadPoint(U0, Rb, Rt);
    steps.push(
      {
        title: 'Terhelőáram',
        text: 'A soros körben az áram a forrásfeszültség és a teljes ellenállás hányadosa.',
        terms: ['I_t =', '\\frac{U_0}{R_b + R_t}'],
        subst: `I_t = \\frac{${texQty(U0, 'V')}}{${texQty(Rb, 'Ω')} + ${texQty(Rt, 'Ω')}}`,
        result: { symbol: 'I_t', value: pt.It, unit: 'A' },
        highlight: { elements: [rt.id], arrows: [{ element: rt.id, kind: 'I', value: pt.It }] },
      },
      {
        title: 'Kapocsfeszültség',
        text: 'Feszültségosztás: a kapocsfeszültség a terhelésen eső rész. Terheléskor mindig kisebb, mint U0, mert a belső ellenálláson is esik feszültség.',
        terms: ['U_k =', 'U_0 \\cdot \\frac{R_t}{R_b + R_t}'],
        subst: `U_k = ${texQty(U0, 'V')} \\cdot \\frac{${texQty(Rt, 'Ω')}}{${texQty(Rb, 'Ω')} + ${texQty(Rt, 'Ω')}}`,
        result: { symbol: 'U_k', value: pt.Uk, unit: 'V' },
        highlight: { elements: [rt.id], terminals: true },
      },
    );
    for (const q of p.questions) {
      if (q.kind === 'Uk') answers.push({ questionId: q.id, value: pt.Uk });
      if (q.kind === 'It') answers.push({ questionId: q.id, value: pt.It });
    }
  }
  steps.push({
    title: 'Terhelési karakterisztika',
    text: `Üresjárásban (Rt → ∞) a kapocsfeszültség U0 = ${formatQuantity(U0, 'V')}, rövidzárban (Rt = 0) a rövidzárási áram U0 / Rb = ${formatQuantity(U0 / Rb, 'A')}. A terhelőn a teljesítmény Rt = Rb esetén a legnagyobb (teljesítményillesztés).`,
    terms: ['P_{max} =', '\\frac{U_0^2}{4 R_b}'],
    subst: `P_{max} = \\frac{(${texQty(U0, 'V')})^2}{4 \\cdot ${texQty(Rb, 'Ω')}}`,
    result: { symbol: 'P_{max}', value: (U0 * U0) / (4 * Rb), unit: 'W' },
    highlight: { terminals: true },
  });
  return { ok: true, solution: { method: 'redukcio', title: 'Valódi generátor', steps, answers } };
}
