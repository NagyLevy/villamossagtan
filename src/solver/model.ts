// Az áramkör két szintje:
//  1. Circuit: rajzolható, rácsra illesztett elrendezés (pontok + egyenes ágak, ágonként sorban álló elemekkel).
//  2. Netlist: tisztán villamos nézet (csomópontok + kétpólusú elemek), ezt kapja a megoldó.
// Az elemmodell általános (kind + érték), AC-bővítésnél új `kind`-ok (L, C) és komplex érték jöhet.

export type ElementKind = 'R' | 'V' | 'I';

export interface CircuitElement {
  /** Azonosító: R1, R2…, Ug1… (feszültséggenerátor), Ig1… (áramgenerátor). */
  id: string;
  kind: ElementKind;
  /** Ω, V vagy A. */
  value: number;
  /**
   * Irány az ág from→to irányához képest.
   * V: +1 → a nyíl a `to` felé mutat, vagyis a `to` oldali kivezetés potenciálja `value`-val nagyobb.
   * I: +1 → a forrás árama from→to irányban folyik.
   * R: a referenciairány mindig from→to (balról jobbra, fentről lefelé); a dir itt nem számít.
   */
  dir: 1 | -1;
  /** Ellenállás terhelhetősége wattban (pl. "470 Ω, 2 W"). */
  rating?: number;
  /** Különleges szerep: belső ellenállás, terhelés. */
  role?: 'internal' | 'load';
  /** A feladatban ismeretlen érték ("?"), pl. visszafejtendő belső ellenállás. */
  unknown?: boolean;
  /** Megjelenített név a felirat előtt (pl. "Rb", "Uth"): "Rb = 2 Ω". */
  name?: string;
}

export interface GridPoint {
  id: number;
  /** Rácskoordináta (egész). A rajzoló skálázza. */
  x: number;
  y: number;
}

export interface Branch {
  id: string;
  /** Mindig a bal oldali / felső végpont. */
  from: number;
  to: number;
  /** A from→to sorrendben egymás után következő elemek; üres lista = vezeték. */
  elements: CircuitElement[];
}

export interface Circuit {
  points: GridPoint[];
  branches: Branch[];
  /** Kijelölt kapcsok (A, B) pont-azonosítókkal. */
  terminals?: { a: number; b: number };
  /** További megnevezett kivezetések (pl. csillag-delta 1, 2, 3). */
  ports?: { point: number; name: string }[];
}

export interface NetElement<T = number> {
  id: string;
  kind: ElementKind;
  value: T;
  /**
   * Kivezetések. Referenciairány minden elemnél a→b:
   * I_ab az a→b irányban (az elemen át) folyó áram, U_ab = φ(a) − φ(b).
   * V forrás: φ(b) − φ(a) = value (a nyíl b felé, a magasabb potenciál felé mutat).
   * I forrás: value áram folyik a→b irányban az elemen át.
   */
  a: number;
  b: number;
}

export interface Netlist<T = number> {
  nodeCount: number;
  elements: NetElement<T>[];
}

export function elementUnit(kind: ElementKind): 'Ω' | 'V' | 'A' {
  return kind === 'R' ? 'Ω' : kind === 'V' ? 'V' : 'A';
}

export function allElements(c: Circuit): CircuitElement[] {
  return c.branches.flatMap((b) => b.elements);
}

export function findElement(c: Circuit, id: string): CircuitElement | undefined {
  return allElements(c).find((e) => e.id === id);
}
