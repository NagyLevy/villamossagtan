// Váz kitöltése elemekkel: források (egyedül, ellenállással, egymás mellé sorolva) és ellenállások.

import type { CircuitElement } from '../solver/model';
import type { Rng } from './rng';
import { makeElement, type Slot, type SlotRole } from './sketch';
import { pickI, pickR, pickV, type Level } from './values';

export interface FillSpec {
  nR: number;
  nV: number;
  nI: number;
  level: Level;
  /** Forrás kerülhet ellenállás nélküli ágba. */
  allowSourceOnly: boolean;
  /** Szerepenkénti súly a források elhelyezéséhez (0 = oda nem kerülhet forrás). */
  sourceWeights: Partial<Record<SlotRole, number>>;
  /** Mely ablakokat (cellákat) határolja az ág; ha megadott, egy ablakba legfeljebb egy forrás kerül. */
  cellsOf?: (s: Slot) => string[];
}

const DEFAULT_R_WEIGHT: Record<SlotRole, number> = {
  rung: 3,
  'rail-top': 3,
  'rail-bottom': 1,
  inner: 3,
  outer: 2,
  arm: 3,
  bridge: 3,
  feed: 1,
  shunt: 3,
};

/** Egy forráscsoport: egy forrás (és esetleg egy vele soros ellenállás). Két forrás sosem kerül sorba. */
type Group = ('V' | 'I' | 'R')[];

/** Kitöltés helyben. false, ha a megadott számok nem férnek el a vázban. */
export function fillSlots(slots: Slot[], spec: FillSpec, rng: Rng): boolean {
  for (const s of slots) s.branch.elements = [];
  let nV = spec.nV;
  let nI = spec.nI;
  let nR = spec.nR;

  // 1. Forráscsoportok (forrásonként egy).
  const groups: Group[] = [];
  while (nV + nI > 0) {
    if (nV > 0 && (nI === 0 || rng.chance(nV / (nV + nI)))) {
      groups.push(['V']);
      nV--;
    } else {
      groups.push(['I']);
      nI--;
    }
  }
  for (const g of groups) {
    if (g.length > 1 || nR === 0) continue;
    if (!spec.allowSourceOnly || rng.chance(0.35)) {
      g.push('R');
      nR--;
    }
  }

  // 2. Csoportok elhelyezése a súlyok szerint, mindegyik külön ágba. Egy ablakba (hurokba)
  // legfeljebb egy forrás kerülhet: a már forrást tartalmazó ablakokat határoló ágak kiesnek.
  const free = new Set(slots);
  const usedCells = new Set<string>();
  for (const g of groups) {
    const candidates = [...free]
      .filter((s) => (spec.sourceWeights[s.role] ?? 0) > 0 && s.capacity >= g.length)
      .filter((s) => !spec.cellsOf || spec.cellsOf(s).every((c) => !usedCells.has(c)))
      .map((s) => [s, spec.sourceWeights[s.role]!] as const);
    if (candidates.length === 0) return false;
    const slot = rng.weighted(candidates);
    slot.branch.elements = rng.shuffle(g).map((k) => newElement(k, spec.level, rng));
    free.delete(slot);
    for (const c of spec.cellsOf?.(slot) ?? []) usedCells.add(c);
  }

  // 3. Ellenállások: először a kötelezően kitöltendő ágakba, aztán a többi üresbe, végül sorosan.
  const mustEmpty = rng.shuffle([...free].filter((s) => s.mustFill));
  for (const s of mustEmpty) {
    if (nR === 0) return false;
    s.branch.elements = [newElement('R', spec.level, rng)];
    free.delete(s);
    nR--;
  }
  while (nR > 0 && free.size > 0) {
    const s = rng.weighted([...free].map((x) => [x, DEFAULT_R_WEIGHT[x.role]] as const));
    s.branch.elements = [newElement('R', spec.level, rng)];
    free.delete(s);
    nR--;
  }
  while (nR > 0) {
    const roomy = slots.filter((s) => s.branch.elements.length > 0 && s.branch.elements.length < s.capacity);
    if (roomy.length === 0) return false;
    const s = rng.pick(roomy);
    const el = newElement('R', spec.level, rng);
    s.branch.elements = rng.chance(0.5) ? [el, ...s.branch.elements] : [...s.branch.elements, el];
    nR--;
  }
  return true;
}

export function newElement(kind: 'V' | 'I' | 'R', level: Level, rng: Rng): CircuitElement {
  const dir = rng.chance(0.5) ? 1 : -1;
  if (kind === 'R') return makeElement('R', pickR(rng, level));
  if (kind === 'V') return makeElement('V', pickV(rng, level), dir);
  return makeElement('I', pickI(rng, level), dir);
}
