// A megoldó szám-típusa egy "test" (field) absztrakció mögött van.
// Most csak a valós számokat (DC) valósítjuk meg; egy későbbi AC-bővítésnél egy ComplexField
// kerülhet ide anélkül, hogy a Gauss-eliminációt vagy az MNA-t újra kellene írni.

export interface Field<T> {
  readonly zero: T;
  readonly one: T;
  add(a: T, b: T): T;
  sub(a: T, b: T): T;
  mul(a: T, b: T): T;
  div(a: T, b: T): T;
  neg(a: T): T;
  /** Nagyság (abszolút érték / modulus), a főelemkiválasztáshoz és a tűrésekhez. */
  abs(a: T): number;
  fromReal(x: number): T;
}

export const RealField: Field<number> = {
  zero: 0,
  one: 1,
  add: (a, b) => a + b,
  sub: (a, b) => a - b,
  mul: (a, b) => a * b,
  div: (a, b) => a / b,
  neg: (a) => -a,
  abs: (a) => Math.abs(a),
  fromReal: (x) => x,
};
