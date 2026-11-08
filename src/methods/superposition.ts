// Szuperpozíció: forrásonként külön részáramkör, a többi forrás kiiktatva
// (feszültségforrás → rövidzár, áramforrás → szakadás), majd a részeredmények előjelhelyes összege.

import type { Problem } from '../generator/generate';
import { valueLabel } from '../generator/questions';
import { allElements } from '../solver/model';
import { killSources, toNetlist } from '../solver/netlist';
import { simplificationStep, targetResistors } from './common';
import type { Values } from './engine';
import { singleSourceSteps } from './reduction';
import { solveThevenin } from './thevenin';
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
  // Helyettesítő generátoros feladat (a tanár úr füzete szerint): az A–B kapcsok üresjárási feszültsége
  // forrásonként osztókkal, (A→B) / (B→A) iránnyal, majd előjeles összeg; Rg a források kiiktatásával.
  if ((p.topic === 'thevenin' || p.teacherType === 'thevenin') && p.questions.some((q) => q.kind === 'Uth')) {
    const r = solveThevenin(p);
    if (!r.ok) return r;
    if (!r.solution.steps.some((s) => s.group === 'Uü: összegzés'))
      return { ok: false, reason: 'Valamelyik részáramkör nem bontható soros és párhuzamos részekre, így osztókkal nem oldható meg' };
    return { ok: true, solution: { ...r.solution, method: 'szuperpozicio', title: 'Szuperpozíció: helyettesítő generátor' } };
  }
  const targets = [...new Set([...targetResistors(p), ...p.questions.filter((q) => q.kind === 'Isup').map((q) => q.target!)])];
  if (targets.length === 0) return { ok: false, reason: 'Nincs olyan kérdéses ellenállás, amelynek áramát összegezni lehetne.' };
  const els = new Map(allElements(p.circuit).map((e) => [e.id, e]));

  const partials: { source: string; values: Values; derivation: Step[]; dividers: boolean; transformed: boolean }[] = [];
  for (const s of sources) {
    const k = killSources(net, [s.id]);
    const others = sources.filter((x) => x.id !== s.id);
    const marks = others.map((x) => ({ element: x.id, as: x.kind === 'V' ? ('short' as const) : ('open' as const) }));
    const group = `Csak ${s.id} működik`;
    // Csak eredővel, feszültség- és áramosztással (így tanuljuk); ha egy részáramkör nem bontható
    // soros-párhuzamos részekre, erre a feladatra a szuperpozíció nem való.
    // A kiiktatott feszültségforrás összevonja a csomópontokat: a kiemeléseket a rajz csomópontjaira vezetjük vissza.
    const back = new Map<number, number>();
    for (const [orig, nw] of k.nodeMap) if (!back.has(nw)) back.set(nw, orig);
    const r = singleSourceSteps(k.net, targets, { group, base: { killed: marks }, circuit: p.circuit, starDelta: p.starDelta, toDrawing: (n) => back.get(n) ?? n });
    if (!r) return { ok: false, reason: `Csak ${s.id} működésekor a részáramkör nem bontható soros és párhuzamos részekre, így osztókkal nem oldható meg` };
    partials.push({ source: s.id, values: r.values, derivation: r.steps, dividers: true, transformed: r.transformed });
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
        (part.transformed
          ? 'Ez a részáramkör hidas: előbb csillag-delta átalakítással összevonhatóvá tesszük, aztán ugyanúgy megy, mint egy egyszerű hálózat: eredő ellenállás a forrás felől, majd feszültség- és áramosztás a kérdéses ellenállásig.'
          : part.dividers
          ? 'Az így kapott egyforrású részáramkört úgy oldjuk meg, mint egy egyszerű hálózatot: eredő ellenállás a forrás felől, aztán feszültség- és áramosztással jutunk el a kérdéses ellenállásig.'
          : 'Ez a részáramkör nem bontható soros és párhuzamos részekre (nem kiegyenlített híd), ezért itt kivételesen csomóponti módszerrel számolunk.'),
      highlight: { elements: [part.source], killed },
      group,
    });
    steps.push(...part.derivation);
    steps.push({
      title: 'Részeredmény',
      text: part.dividers
        ? 'A kérdéses ellenállás árama ebben a részáramkörben, a referenciairány szerinti előjellel (ha a részáram a nyíllal szemben folyik, negatív):'
        : 'A kérdéses ellenállás árama ebben a részáramkörben (a végpontjai potenciáljából, Ohm törvényével):',
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

/** Minden részáramkör megoldható-e csak eredővel és osztókkal (csomóponti módszer nélkül). */
export function superpositionByDividers(p: Problem): boolean {
  const net = toNetlist(p.circuit).net;
  const sources = net.elements.filter((e) => e.kind !== 'R');
  if (sources.length < 2) return false;
  return sources.every((s) => singleSourceSteps(killSources(net, [s.id]).net, [], {}) !== null);
}
