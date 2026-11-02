// A módszerek közös segédjei: válaszok az elemértékekből, egyszerűsítési lépés, jelölések.

import type { Problem } from '../generator/generate';
import { valueLabel } from '../generator/questions';
import { findTricks } from '../simplify/tricks';
import { allElements, type CircuitElement } from '../solver/model';
import type { Netlist } from '../solver/model';
import type { Values } from './engine';
import type { MethodAnswer, Step } from './types';

/** A kérdésekre adott válaszok az elemenkénti U, I értékekből (amit a módszer meg tud határozni). */
export function answersFromValues(p: Problem, values: Values): MethodAnswer[] {
  const out: MethodAnswer[] = [];
  const load = allElements(p.circuit).find((e) => e.role === 'load');
  for (const q of p.questions) {
    let raw: number | undefined;
    const v = q.target ? values.get(q.target) : undefined;
    if (v && q.kind === 'U') raw = v.U;
    if (v && q.kind === 'I') raw = v.I;
    if (v && q.kind === 'P') raw = v.U * v.I;
    if (load && values.get(load.id) && q.kind === 'Uk') raw = values.get(load.id)!.U;
    if (load && values.get(load.id) && q.kind === 'It') raw = values.get(load.id)!.I;
    if (raw === undefined) continue;
    out.push({ questionId: q.id, value: q.magnitudeOnly ? Math.abs(raw) : raw });
  }
  return out;
}

/** Görög index a felirathoz: 1 → ₁. */
export function sub(n: number): string {
  return String(n)
    .split('')
    .map((d) => '₀₁₂₃₄₅₆₇₈₉'[Number(d)])
    .join('');
}

/**
 * Egyszerűsítési lépés a módszer elején: elhalványítja azokat az elemeket, amelyek nem
 * befolyásolják a többit (a kérdéses elemet nem halványítja, hanem rámutat a trükkre).
 */
export function simplificationStep(p: Problem, net: Netlist): Step | null {
  const tricks = findTricks(net);
  const targets = new Set(p.questions.map((q) => q.target).filter(Boolean) as string[]);
  const dimmable = tricks.filter((t) => t.dim);
  if (dimmable.length === 0) return null;
  const dim = dimmable.flatMap((t) => t.elements).filter((id) => !targets.has(id));
  const trickOnTarget = dimmable.find((t) => t.elements.some((id) => targets.has(id)));
  const text = dimmable.map((t) => t.text).join(' ');
  return {
    title: 'Egyszerűsítés',
    text,
    highlight: { dim, elements: trickOnTarget ? trickOnTarget.elements.filter((id) => targets.has(id)) : [] },
    note: trickOnTarget
      ? trickOnTarget.kind === 'soros-aramforras'
        ? 'Trükk: a kérdéses elem árama közvetlenül a forrás árama.'
        : 'Trükk: a kérdéses elem feszültsége közvetlenül a forrás feszültsége.'
      : 'Az elhalványított elemek kihagyhatók a számolásból; az eredményt nem változtatják.',
  };
}

export function label(el: CircuitElement): string {
  return `${el.id} (${valueLabel(el)})`;
}

/** Az R típusú kérdéses elemek (amire a módszer végén rámutatunk). */
export function targetResistors(p: Problem): string[] {
  const els = new Map(allElements(p.circuit).map((e) => [e.id, e]));
  return [...new Set(p.questions.map((q) => q.target).filter((t): t is string => !!t && els.get(t)?.kind === 'R'))];
}
