// A lépésenkénti megoldás adatmodellje. Minden módszer ilyen lépéslistát állít elő; a felület
// (panel, ábra-kiemelés, lejátszó) csak ezt olvassa. Tiszta adat: nincs benne DOM.

import type { Circuit } from '../solver/model';
import type { Unit } from '../units';

export type MethodId = 'redukcio' | 'kirchhoff' | 'hurokaram' | 'szuperpozicio' | 'thevenin' | 'csillag-delta' | 'csomoponti';

export interface Quantity {
  /** A mennyiség jele LaTeX-ben, pl. "I_{R3}" vagy "R_{e1}". */
  symbol: string;
  value: number;
  unit: Unit;
}

export interface LoopRef {
  /** A hurok elemei körüljárási sorrendben; sign = +1, ha a körüljárás az elem a→b irányával egyezik. */
  elements: { id: string; sign: 1 | -1 }[];
  label?: string;
}

export interface GroupRef {
  /** Az összevont (eredő) csoport eredeti elemei. */
  elements: string[];
  /** A csoport felirata az ábrán, pl. "Re1 = 12 Ω". */
  label: string;
  tone: 'accent' | 'result' | 'transform';
}

export interface ArrowRef {
  element: string;
  kind: 'I' | 'U';
  /** Előjeles érték az elem referenciairányában (a→b). */
  value: number;
}

/** Mit emeljen ki az ábrán az adott lépés. */
export interface Highlight {
  /** Kiemelt elemek (akcentusszín). */
  elements?: string[];
  /** Halványított elemek (pl. egyszerűsítésnél kieső elemek). */
  dim?: string[];
  /** Körbekerített, felirattal ellátott csoportok (eredő ellenállások). */
  groups?: GroupRef[];
  /** Kiemelt csomópontok (netlista-csomópont sorszáma). */
  nodes?: number[];
  /** Kiemelt hurkok körüljárási nyíllal. */
  loops?: LoopRef[];
  /** Ág- és feszültség-referencianyilak értékkel (a forrásnyilaktól eltérő stílusban). */
  arrows?: ArrowRef[];
  /** Kiiktatott források: feszültségforrás → rövidzár, áramforrás → szakadás. */
  killed?: { element: string; as: 'short' | 'open' }[];
  /** Csomópontok felirata (pl. φ₁), a csomópont mellé írva. */
  nodeLabels?: { node: number; label: string }[];
  /** Kapcsok kiemelése (A, B pont-azonosítók). */
  terminals?: boolean;
  /**
   * Csillag-delta átalakítás az ábrán: delta → csillag esetén a középpontba futó új ágak,
   * csillag → delta esetén a kivezetések közti új ágak, felirattal.
   */
  transform?: { kind: 'delta-csillag' | 'csillag-delta'; terminals: [number, number, number]; labels: [string, string, string] };
}

export interface TableRow {
  element: string;
  /** Felirat a táblázatban, pl. "R3 (6 Ω)". */
  label: string;
  U: number;
  I: number;
  P: number;
}

export interface Step {
  /** Rövid cím a lépéslistában. */
  title: string;
  /** Magyar nyelvű magyarázat (sima szöveg). */
  text: string;
  /** Tagonkénti, egyszerű magyarázat (felsorolásként jelenik meg a szöveg alatt). */
  bullets?: string[];
  /** Az egyenlet tagonként (LaTeX); a felület egyenként, áttűnéssel építi fel. */
  terms?: string[];
  /** Behelyettesítés számokkal (LaTeX). */
  subst?: string;
  /** Részeredmény mértékegységgel. */
  result?: Quantity;
  highlight: Highlight;
  /** Rövid megjegyzés (pl. miért nem számít egy elem). */
  note?: string;
  /** A lépés végén megjelenő táblázat (teljes hálózatanalízis). */
  table?: TableRow[];
  /** Más áramkör rajzolódik erre a lépésre (pl. szuperpozíció részáramköre). */
  circuit?: Circuit;
  /**
   * "Áramkör újrarajzolása" beállításnál: az összevonás utáni, egyszerűsített rajz (az összevont
   * ellenállások helyén egyetlen eredő) és a hozzá illő kiemelés.
   */
  redraw?: { circuit: Circuit; highlight: Highlight };
  /** Fejezet a lépéslistában (pl. "Uth: üresjárás"); az első lépés előtt címként jelenik meg. */
  group?: string;
  /** Betétábra: a hagyományos (rézsútos) Y és Δ alak a kivezetésekkel és az értékekkel. */
  inset?: { kind: 'delta-csillag' | 'csillag-delta'; before: [number, number, number]; after: [number, number, number] };
}

export interface MethodAnswer {
  questionId: string;
  value: number;
}

export interface Solution {
  method: MethodId;
  title: string;
  steps: Step[];
  /** A módszer saját számolásával kapott válaszok a feladat kérdéseire. */
  answers: MethodAnswer[];
  /** Minden elem módszerrel számolt értéke, ha a módszer mindet meghatározza (ellenőrzéshez). */
  values?: Map<string, { U: number; I: number }>;
}

export type MethodResult = { ok: true; solution: Solution } | { ok: false; reason: string };
