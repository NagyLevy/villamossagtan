// Kézzel írt mintaáramkörök (fix sablonok): a rajzoló és a megoldó kézi ellenőrzéséhez.
// Koordináták: rácsegységben, 2 egység = egy ág (két elem fér bele).

import type { Circuit } from '../solver/model';
import { makeElement as el, Sketch } from './sketch';

export interface Sample {
  name: string;
  circuit: Circuit;
}

const R = (v: number) => el('R', v);
/** Feszültségforrás; dir: +1 = a nyíl a megadott pontsorrend második pontja felé mutat. */
const U = (v: number, dir: 1 | -1 = 1) => el('V', v, dir);
const J = (v: number, dir: 1 | -1 = 1) => el('I', v, dir);

/** Soros-párhuzamos: 12 V-os forrás, létraszerű ellenálláshálózat. */
function seriesParallel(): Circuit {
  const s = new Sketch();
  s.branch(0, 2, 0, 0, [U(12)]); // alulról felfelé: a nyíl felfelé mutat
  s.branch(0, 0, 2, 0, [R(4)]);
  s.branch(2, 0, 2, 2, [R(6)]);
  s.branch(2, 0, 4, 0, [R(2), R(1)]);
  s.branch(4, 0, 4, 2, [R(3)]);
  s.wire(0, 2, 2, 2);
  s.wire(2, 2, 4, 2);
  return s.build();
}

/** ZH-szerű létra: fokokban váltakozva feszültség- és áramforrások, ellenállás nélküli forrásos ágak. */
function zhLadder(): Circuit {
  const s = new Sketch();
  s.branch(0, 2, 0, 0, [U(5)]);
  s.branch(2, 0, 2, 2, [J(2)]);
  s.branch(4, 2, 4, 0, [U(3), R(2)]);
  s.branch(6, 0, 6, 2, [J(1)]);
  s.branch(8, 0, 8, 2, [R(6)]);
  s.branch(0, 0, 2, 0, [R(4)]);
  s.branch(2, 0, 4, 0, [U(4, -1)]);
  s.branch(4, 0, 6, 0, [R(3)]);
  s.branch(6, 0, 8, 0, [R(5)]);
  s.branch(0, 2, 2, 2, [R(1)]);
  s.wire(2, 2, 4, 2);
  s.branch(4, 2, 6, 2, [R(8)]);
  s.wire(6, 2, 8, 2);
  return s.build();
}

/** Wheatstone-híd áramforrással, sönttel. */
function wheatstone(): Circuit {
  const s = new Sketch();
  s.branch(0, 0, 4, 0, [R(2)]);
  s.branch(4, 0, 8, 0, [R(4)]);
  s.branch(0, 4, 4, 4, [R(3)]);
  s.branch(4, 4, 8, 4, [R(7)]);
  s.branch(4, 0, 4, 4, [R(5)]);
  s.wire(0, 0, 0, 4);
  s.wire(8, 0, 8, 4);
  s.wire(0, 4, 0, 6);
  s.wire(8, 4, 8, 6);
  s.branch(0, 6, 4, 6, [J(3, -1)]);
  s.branch(4, 6, 8, 6, [R(1)]);
  s.wire(0, 6, 0, 8);
  s.wire(8, 6, 8, 8);
  s.branch(0, 8, 8, 8, [R(6)]);
  return s.build();
}

/** Külső gyűrű belső cellákkal: a forrás a gyűrűben, a belsejében ágak. */
function ringWithCells(): Circuit {
  const s = new Sketch();
  // külső gyűrű
  s.branch(0, 0, 2, 0, [R(2)]);
  s.branch(2, 0, 4, 0, [R(3)]);
  s.branch(4, 0, 6, 0, [R(6)]);
  s.branch(6, 0, 6, 2, [R(4)]);
  s.branch(6, 2, 6, 4, [R(1)]);
  s.branch(4, 4, 6, 4, [R(5)]);
  s.wire(2, 4, 4, 4);
  s.branch(0, 4, 2, 4, [R(8)]);
  s.branch(0, 4, 0, 2, [U(10)]);
  s.wire(0, 0, 0, 2);
  // belső ágak
  s.branch(2, 0, 2, 4, [R(6)]);
  s.branch(4, 0, 4, 2, [R(4)]);
  s.branch(4, 2, 6, 2, [R(2)]);
  s.branch(4, 2, 4, 4, [R(3)]);
  return s.build();
}

/** Eredő ellenállás A–B kapcsok között. */
function resistanceAB(): Circuit {
  const s = new Sketch();
  s.branch(0, 0, 2, 0, [R(5)]);
  s.branch(2, 0, 2, 2, [R(10)]);
  s.branch(2, 0, 4, 0, [R(4)]);
  s.branch(4, 0, 4, 2, [R(12), R(8)]);
  s.wire(0, 2, 2, 2);
  s.wire(2, 2, 4, 2);
  s.terminals = { a: s.pt(0, 0), b: s.pt(0, 2) };
  return s.build();
}

export function samples(): Sample[] {
  return [
    { name: 'Soros-párhuzamos', circuit: seriesParallel() },
    { name: 'Eredő ellenállás A–B között', circuit: resistanceAB() },
    { name: 'ZH-szerű létra', circuit: zhLadder() },
    { name: 'Wheatstone-híd', circuit: wheatstone() },
    { name: 'Külső gyűrű belső cellákkal', circuit: ringWithCells() },
  ];
}
