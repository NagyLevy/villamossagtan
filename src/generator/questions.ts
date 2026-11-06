// Kérdések: magyar szöveg + a kód által (MNA-ból) számolt válasz. Soha nincs beégetett eredmény.

import type { Circuit, CircuitElement } from '../solver/model';
import { elementUnit, allElements } from '../solver/model';
import { articleFor, formatQuantity, unitSuffix, type Unit } from '../units';

export type QuestionKind =
  | 'U' // elem feszültsége
  | 'I' // elem árama
  | 'P' // elem teljesítménye (forrásnál előjelesen)
  | 'Uab' // két pont közti feszültség
  | 'Req' // eredő ellenállás
  | 'Uth'
  | 'Rth'
  | 'In'
  | 'IL' // terhelőáram a helyettesítő körből
  | 'Uk' // kapocsfeszültség
  | 'It' // terhelőáram (valódi generátor)
  | 'Rb' // belső ellenállás visszafejtése
  | 'U0' // forrásfeszültség visszafejtése
  | 'Imax'
  | 'Umax'
  | 'Isup' // szuperpozíció: egy forrás hozzájárulása egy elem áramához
  | 'SD' // csillag-delta átalakítás: egy új ellenállás értéke
  | 'table'; // minden elem U, I, P táblázatban

export interface GivenValue {
  target: string;
  quantity: 'U' | 'I';
  /** Előjeles érték az elem referenciairányában. */
  value: number;
}

export interface Question {
  id: string;
  kind: QuestionKind;
  text: string;
  unit: Unit | null;
  /** A számolt helyes válasz (táblázatos kérdésnél NaN). */
  answer: number;
  /** "…nagyságát": csak az abszolút érték számít. */
  magnitudeOnly: boolean;
  /** A kérdéses elem (az ábrán kiemelve). */
  target?: string;
  /** Szuperpozíciónál a működő forrás. */
  source?: string;
  /** Két pont közti mennyiségeknél a pontok (A, B). */
  points?: [number, number];
  /** A feladatban megadott (mért) adatok. */
  given?: GivenValue[];
  /** Kirchhoff-feladatnál a vizsgált csomópont (netlista-sorszám). */
  node?: number;
  /** Csillag-delta feladatnál a keresett új ellenállás neve (R1, R2, R3, R12, R23, R31). */
  sdName?: string;
  /** Kirchhoff-feladatnál a vizsgált hurok, körüljárási sorrendben. */
  loop?: { id: string; sign: 1 | -1 }[];
}

const NOUN = { R: 'ellenállás', V: 'feszültségforrás', I: 'áramforrás', L: 'tekercs', C: 'kondenzátor', K: 'kapcsoló' } as const;

export function valueLabel(el: CircuitElement): string {
  return formatQuantity(el.value, elementUnit(el.kind));
}

/**
 * Elem megnevezése a kérdésben: "a 6 Ω-os ellenállás" + toldalék; ha az érték nem egyedi,
 * "az R3 jelű (6 Ω-os) ellenállás". A `suffix` az ellenállás/forrás szó végére kerül (pl. "on").
 */
export function elementName(c: Circuit, el: CircuitElement, suffix = ''): string {
  const unit = elementUnit(el.kind);
  const label = valueLabel(el);
  const same = allElements(c).filter((e) => e.kind === el.kind && e.value === el.value && !e.unknown);
  const noun = NOUN[el.kind] + suffix;
  if (same.length === 1 && !el.unknown) return `${articleFor(label)} ${label}${unitSuffix(unit)} ${noun}`;
  return `az ${el.id} jelű ${noun}`;
}

export function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

let counter = 0;
export function questionId(): string {
  counter = (counter + 1) % 1_000_000;
  return `q${counter}`;
}

export function askElementU(c: Circuit, el: CircuitElement, U: number, magnitudeOnly: boolean): Question {
  const tail = magnitudeOnly ? 'eső feszültség nagyságát!' : 'eső feszültséget az ábrán jelölt referenciairány szerint, előjelesen!';
  return { id: questionId(), kind: 'U', text: `Számítsa ki ${elementName(c, el, 'on')} ${tail}`, unit: 'V', answer: magnitudeOnly ? Math.abs(U) : U, magnitudeOnly, target: el.id };
}

export function askElementI(c: Circuit, el: CircuitElement, I: number, magnitudeOnly: boolean): Question {
  const tail = magnitudeOnly ? 'folyó áram nagyságát!' : 'folyó áramot az ábrán jelölt referenciairány szerint, előjelesen!';
  return { id: questionId(), kind: 'I', text: `Számítsa ki ${elementName(c, el, 'on')} ${tail}`, unit: 'A', answer: magnitudeOnly ? Math.abs(I) : I, magnitudeOnly, target: el.id };
}

export function askElementP(c: Circuit, el: CircuitElement, P: number): Question {
  const text =
    el.kind === 'R'
      ? `Mekkora teljesítményt vesz fel ${elementName(c, el)}?`
      : `Mekkora ${elementName(c, el)} teljesítménye? Leadott teljesítmény negatív, felvett pozitív előjellel.`;
  return { id: questionId(), kind: 'P', text, unit: 'W', answer: P, magnitudeOnly: el.kind === 'R', target: el.id };
}
