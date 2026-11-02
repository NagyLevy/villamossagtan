// Ohm törvénye és a teljesítmény: egy forrás, egy ellenállás; felirat alapján terhelhetőség.

import type { Problem } from '../generator/generate';
import { valueLabel } from '../generator/questions';
import { allElements } from '../solver/model';
import { formatQuantity } from '../units';
import { texOf, texQty } from './tex';
import type { MethodAnswer, MethodResult, Step } from './types';

export function solveOhm(p: Problem): MethodResult {
  const els = allElements(p.circuit);
  const r = els.find((e) => e.kind === 'R');
  const src = els.find((e) => e.kind !== 'R');
  if (!r || !src || els.length !== 2) return { ok: false, reason: 'Ez a módszer egy forrás és egy ellenállás esetén alkalmazható.' };
  const steps: Step[] = [];
  const answers: MethodAnswer[] = [];
  const R = r.value;
  const I_ = texOf('I', r.id);
  const U_ = texOf('U', r.id);
  const P_ = `P_{\\text{${r.id}}}`;

  const qImax = p.questions.find((q) => q.kind === 'Imax');
  if (qImax) {
    const P = r.rating!;
    const Imax = Math.sqrt(P / R);
    const Umax = Math.sqrt(P * R);
    steps.push(
      {
        title: 'Mit jelent a felirat?',
        text: `Az ellenállás ${valueLabel(r)}, és legfeljebb ${formatQuantity(P, 'W')} teljesítményt bír el tartósan. Ebből a megengedett áram és feszültség is kiszámolható.`,
        highlight: { elements: [r.id] },
      },
      {
        title: 'Legnagyobb áram',
        text: 'A teljesítmény az áram négyzetével arányos: P = I² · R. Ezt átrendezve kapjuk a megengedett áramot.',
        terms: ['P = I^2 R', '\\;\\Rightarrow\\;', 'I_{max} = \\sqrt{\\frac{P}{R}}'],
        subst: `I_{max} = \\sqrt{\\frac{${texQty(P, 'W')}}{${texQty(R, 'Ω')}}}`,
        result: { symbol: 'I_{max}', value: Imax, unit: 'A' },
        highlight: { elements: [r.id] },
      },
      {
        title: 'Legnagyobb feszültség',
        text: 'Ugyanígy a feszültséggel: P = U² / R.',
        terms: ['P = \\frac{U^2}{R}', '\\;\\Rightarrow\\;', 'U_{max} = \\sqrt{P \\cdot R}'],
        subst: `U_{max} = \\sqrt{${texQty(P, 'W')} \\cdot ${texQty(R, 'Ω')}}`,
        result: { symbol: 'U_{max}', value: Umax, unit: 'V' },
        highlight: { elements: [r.id] },
        note: 'Ellenőrzés: Umax = Imax · R.',
      },
    );
    answers.push({ questionId: qImax.id, value: Imax });
    const qU = p.questions.find((q) => q.kind === 'Umax');
    if (qU) answers.push({ questionId: qU.id, value: Umax });
    return { ok: true, solution: { method: 'redukcio', title: 'Ohm-törvény', steps, answers } };
  }

  let U: number;
  let I: number;
  steps.push({
    title: 'A kör',
    text: `Egyetlen hurok: a ${src.kind === 'V' ? 'feszültségforrás' : 'áramforrás'} (${valueLabel(src)}) közvetlenül az ellenállásra (${valueLabel(r)}) kapcsolódik.`,
    highlight: { elements: [src.id, r.id] },
  });
  if (src.kind === 'V') {
    U = src.value;
    I = U / R;
    steps.push({
      title: 'Ohm törvénye',
      text: 'Az ellenálláson a teljes forrásfeszültség esik; az áram a feszültség és az ellenállás hányadosa.',
      terms: [`${I_} =`, `\\frac{U}{R}`],
      subst: `${I_} = \\frac{${texQty(U, 'V')}}{${texQty(R, 'Ω')}}`,
      result: { symbol: I_, value: I, unit: 'A' },
      highlight: { elements: [r.id] },
    });
  } else {
    I = src.value;
    U = I * R;
    steps.push({
      title: 'Ohm törvénye',
      text: 'Az ellenálláson a forrás árama folyik át; a feszültség az áram és az ellenállás szorzata.',
      terms: [`${U_} =`, `I \\cdot R`],
      subst: `${U_} = ${texQty(I, 'A')} \\cdot ${texQty(R, 'Ω')}`,
      result: { symbol: U_, value: U, unit: 'V' },
      highlight: { elements: [r.id] },
    });
  }
  const P = U * I;
  steps.push({
    title: 'Teljesítmény',
    text: 'Az ellenállás által felvett teljesítmény. Ugyanez adódik I² · R és U² / R alakban is.',
    terms: [`${P_} =`, 'U \\cdot I', '= I^2 R', '= \\frac{U^2}{R}'],
    subst: `${P_} = ${texQty(U, 'V')} \\cdot ${texQty(I, 'A')}`,
    result: { symbol: P_, value: P, unit: 'W' },
    highlight: { elements: [r.id], arrows: [{ element: r.id, kind: 'I', value: I }] },
  });
  for (const q of p.questions) {
    if (q.kind === 'I') answers.push({ questionId: q.id, value: I });
    if (q.kind === 'U') answers.push({ questionId: q.id, value: U });
    if (q.kind === 'P') answers.push({ questionId: q.id, value: P });
  }
  return { ok: true, solution: { method: 'redukcio', title: 'Ohm-törvény', steps, answers } };
}
