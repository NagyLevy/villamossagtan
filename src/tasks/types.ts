// Közös feladatformátum a felületnek: egyenáramú (a régi generátorból) és szinuszos / bekapcsolási
// feladat is ilyen alakban jut el a nézethez, a próbavizsgához és a napi feladatsorhoz.

import type { Problem } from '../generator/generate';
import type { Solution } from '../methods/types';
import type { Circuit } from '../solver/model';
import type { Unit } from '../units';

export type Domain = 'dc' | 'ac';

/** Egy beírandó érték. */
export interface AnswerField {
  id: string;
  /** Rövid felirat a mező előtt (pl. "csúcsérték", "kezdőfázis"). */
  label: string;
  unit: Unit;
  answer: number;
  /**
   * number: szám mértékegységgel (±1%); phase: szög fokban (±1°, 360°-onként ugyanaz);
   * element: kompenzáló elem – a beírt mértékegység (H vagy F) dönti el, tekercs vagy kondenzátor.
   */
  kind?: 'number' | 'phase' | 'element';
  magnitudeOnly?: boolean;
  /** element mezőnél a helyes elem fajtája. */
  element?: 'L' | 'C';
  /** Példa a mezőbe (helykitöltő). */
  example?: string;
}

export interface TaskQuestion {
  id: string;
  text: string;
  fields: AnswerField[];
  /** Az ábrán kiemelt elem. */
  target?: string;
  /** Táblázatkitöltős (egyenáramú teljes hálózatanalízis) kérdés. */
  table?: boolean;
}

export interface Task {
  domain: Domain;
  seed: string;
  topic: string;
  topicName: string;
  levelName: string;
  /** Rövid leírás a cím fölé (pl. "Szinuszos · Közepes · 1 forrás · 5 elem"). */
  meta: string;
  /** A feladat fő kérdése (cím). */
  title: string;
  /** Adatok, amik nem az ábrán vannak (LaTeX), pl. ω, u(t). */
  given?: string[];
  circuit: Circuit | null;
  questions: TaskQuestion[];
  /** Egyenáramú feladatnál a módszerek ezzel dolgoznak. */
  dc?: Problem;
  /** Szinuszos / bekapcsolási feladat kész levezetése. */
  solution?: Solution;
}
