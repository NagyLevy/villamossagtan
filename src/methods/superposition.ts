// Szuperpozíció: forrásonként külön részáramkör, a többi forrás kiiktatva
// (feszültségforrás → rövidzár, áramforrás → szakadás), majd a részeredmények előjelhelyes összege.

import type { Problem } from '../generator/generate';
import { valueLabel } from '../generator/questions';
import { allElements } from '../solver/model';
import { killSources, toNetlist } from '../solver/netlist';
import { simplificationStep, targetResistors } from './common';
import { solveAny, type Values } from './engine';
import { nodalSteps } from './nodal';
import { texElement, texOf, texQty } from './tex';
import type { MethodAnswer, MethodResult, Step } from './types';

const PRIMES = ["'", "''", "'''", '^{(4)}', '^{(5)}', '^{(6)}', '^{(7)}'];

function sym(q: 'U' | 'I', id: string, k: number): string {
  const p = PRIMES[k] ?? `^{(${k + 1})}`;
  return p.startsWith('^') ? `${q}${p}_{\\text{${id}}}` : `${q}${p}_{\\text{${id}}}`;
}

export function solveSuperposition(p: Problem): MethodResult {
  const map = toNetlist(p.circuit);
  const net = map.net;
  const sources = net.elements.filter((e) => e.kind !== 'R');
  if (sources.length < 2) return { ok: false, reason: 'Szuperpozícióhoz legalább két forrás kell.' };
  const targets = [...new Set([...targetResistors(p), ...p.questions.filter((q) => q.kind === 'Isup').map((q) => q.target!)])];
  if (targets.length === 0) return { ok: false, reason: 'Nincs olyan kérdéses ellenállás, amelynek áramát összegezni lehetne.' };
  const els = new Map(allElements(p.circuit).map((e) => [e.id, e]));

  const partials: { source: string; values: Values; derivation: Step[] }[] = [];
  for (const s of sources) {
    const k = killSources(net, [s.id]);
    // A kiiktatott feszültségforrás összevonja a csomópontokat: a levezetés kiemeléseit
    // a rajz eredeti csomópontjaira vezetjük vissza.
    const back = new Map<number, number>();
    for (const [orig, nw] of k.nodeMap) if (!back.has(nw)) back.set(nw, orig);
    const others = sources.filter((x) => x.id !== s.id);
    const marks = others.map((x) => ({ element: x.id, as: x.kind === 'V' ? ('short' as const) : ('open' as const) }));
    const d = nodalSteps(k.net, { toDrawing: (n) => back.get(n) ?? n, base: { killed: marks }, group: `Csak ${s.id} működik` });
    const values = d?.values ?? solveAny(k.net);
    if (!values) return { ok: false, reason: 'Egy részáramkör nem oldható meg.' };
    partials.push({ source: s.id, values, derivation: d?.steps ?? [] });
  }

  const steps: Step[] = [];
  const simp = simplificationStep(p, net);
  if (simp) steps.push(simp);
  steps.push({
    title: 'Részáramkörök',
    text: `${sources.length} forrás van, ezért ${sources.length} részáramkört oldunk meg: mindegyikben csak egy forrás működik. A többit kiiktatjuk: a feszültségforrás helyére rövidzár, az áramforrás helyére szakadás kerül.`,
    highlight: { elements: sources.map((s) => s.id) },
  });
  partials.forEach((part, k) => {
    const src = els.get(part.source)!;
    const others = sources.filter((s) => s.id !== part.source);
    const shorts = others.filter((s) => s.kind === 'V').map((s) => s.id);
    const opens = others.filter((s) => s.kind === 'I').map((s) => s.id);
    const killed = [...shorts.map((id) => ({ element: id, as: 'short' as const })), ...opens.map((id) => ({ element: id, as: 'open' as const }))];
    const group = `Csak ${part.source} működik`;
    steps.push({
      title: 'A részáramkör',
      text:
        `A(z) ${part.source} (${valueLabel(src)}) marad. ` +
        (shorts.length ? `${shorts.join(', ')} helyére rövidzár, ` : '') +
        (opens.length ? `${opens.join(', ')} helyére szakadás kerül. ` : '') +
        'Az így kapott egyforrású részáramkört csomóponti módszerrel oldjuk meg.',
      highlight: { elements: [part.source], killed },
      group,
    });
    steps.push(...part.derivation);
    steps.push({
      title: 'Részeredmény',
      text: 'A kérdéses ellenállás árama ebben a részáramkörben (a végpontjai potenciáljából, Ohm törvényével):',
      terms: targets.map((t, i) => `${sym('I', t, k)} = ${texQty(part.values.get(t)?.I ?? 0, 'A')}${i < targets.length - 1 ? ',\\quad' : ''}`),
      highlight: { elements: [part.source, ...targets], killed, arrows: targets.map((t) => ({ element: t, kind: 'I' as const, value: part.values.get(t)?.I ?? 0 })) },
      group,
    });
  });

  const values: Values = new Map();
  for (const t of targets) {
    const I = partials.reduce((s, part) => s + (part.values.get(t)?.I ?? 0), 0);
    const R = els.get(t)!.value;
    values.set(t, { U: R * I, I });
    steps.push({
      title: `Összegzés: ${t}`,
      group: 'Összegzés',
      text: 'A részáramok előjelhelyes összege adja a valódi áramot (mindegyik ugyanabban a referenciairányban).',
      terms: [`${texOf('I', t)} =`, partials.map((_, k) => sym('I', t, k)).join(' + ')],
      subst: `${texOf('I', t)} = ${partials.map((part) => texQty(part.values.get(t)?.I ?? 0, 'A', { paren: true })).join(' + ')}`,
      result: { symbol: texOf('I', t), value: I, unit: 'A' },
      highlight: { elements: [t], arrows: [{ element: t, kind: 'I', value: I }] },
    });
    if (p.questions.some((q) => q.target === t && (q.kind === 'U' || q.kind === 'P'))) {
      steps.push({
        title: `${t} feszültsége`,
        text: 'Ohm törvénye az összegzett áramra. (A teljesítmény nem szuperponálható: azt mindig az összegzett áramból és feszültségből számoljuk.)',
        terms: [`${texOf('U', t)} = ${texElement(t)} \\cdot ${texOf('I', t)}`],
        subst: `${texOf('U', t)} = ${texQty(R, 'Ω')} \\cdot ${texQty(I, 'A', { paren: true })}`,
        result: { symbol: texOf('U', t), value: R * I, unit: 'V' },
        highlight: { elements: [t], arrows: [{ element: t, kind: 'U', value: R * I }] },
      });
    }
  }

  const answers: MethodAnswer[] = [];
  for (const q of p.questions) {
    const v = q.target ? values.get(q.target) : undefined;
    let raw: number | undefined;
    if (q.kind === 'Isup' && q.source) raw = partials.find((x) => x.source === q.source)?.values.get(q.target!)?.I;
    else if (v && q.kind === 'I') raw = v.I;
    else if (v && q.kind === 'U') raw = v.U;
    else if (v && q.kind === 'P') raw = v.U * v.I;
    if (raw !== undefined) answers.push({ questionId: q.id, value: q.magnitudeOnly ? Math.abs(raw) : raw });
  }
  return { ok: true, solution: { method: 'szuperpozicio', title: 'Szuperpozíció', steps, answers, values } };
}
