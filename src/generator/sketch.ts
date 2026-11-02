// Rácsra rajzolt áramkör-váz építése. A sablonok ezzel rakják le a pontokat és az ágakat;
// a "slotok" azok az ágak, amelyekbe a kitöltő elemeket tehet.

import type { Branch, Circuit, CircuitElement, ElementKind, GridPoint } from '../solver/model';

export type SlotRole =
  | 'rung' // létrafok / függőleges ág két sín között
  | 'rail-top'
  | 'rail-bottom'
  | 'inner' // rács belső ága
  | 'outer' // rács / gyűrű külső ága
  | 'arm' // híd karja
  | 'bridge' // híd átlója
  | 'feed' // hídat tápláló ág
  | 'shunt'; // a forrással párhuzamos ág

export interface Slot {
  branch: Branch;
  role: SlotRole;
  /** Ha true, nem maradhat vezeték (pl. létrafok: rövidzár lenne). */
  mustFill: boolean;
  /** Legfeljebb ennyi elem fér az ágba. */
  capacity: number;
}

export class Sketch {
  readonly points: GridPoint[] = [];
  readonly branches: Branch[] = [];
  readonly slots: Slot[] = [];
  private byPos = new Map<string, number>();
  terminals?: { a: number; b: number };
  ports?: { point: number; name: string }[];

  pt(x: number, y: number): number {
    const key = `${x},${y}`;
    let id = this.byPos.get(key);
    if (id === undefined) {
      id = this.points.length;
      this.points.push({ id, x, y });
      this.byPos.set(key, id);
    }
    return id;
  }

  /**
   * Egyenes ág két rácspont között. Az elemeket (x1,y1)→(x2,y2) sorrendben kell megadni;
   * a tárolt ág mindig balról jobbra / fentről lefelé mutat, ehhez szükség esetén megfordítjuk.
   */
  branch(x1: number, y1: number, x2: number, y2: number, elements: CircuitElement[] = []): Branch {
    if (x1 !== x2 && y1 !== y2) throw new Error('Csak vízszintes vagy függőleges ág lehet');
    let els = elements;
    if (x1 > x2 || y1 > y2) {
      [x1, y1, x2, y2] = [x2, y2, x1, y1];
      els = reverseElements(els);
    }
    const br: Branch = { id: `b${this.branches.length}`, from: this.pt(x1, y1), to: this.pt(x2, y2), elements: els };
    this.branches.push(br);
    return br;
  }

  wire(x1: number, y1: number, x2: number, y2: number): Branch {
    return this.branch(x1, y1, x2, y2);
  }

  slot(x1: number, y1: number, x2: number, y2: number, role: SlotRole, mustFill = false, capacity = 2): Slot {
    const s: Slot = { branch: this.branch(x1, y1, x2, y2), role, mustFill, capacity };
    this.slots.push(s);
    return s;
  }

  build(): Circuit {
    return finalize({ points: this.points, branches: this.branches, terminals: this.terminals, ports: this.ports });
  }
}

/** Elemsor megfordítása: a sorrend is és a források iránya is. */
export function reverseElements(els: CircuitElement[]): CircuitElement[] {
  return [...els].reverse().map((e) => (e.kind === 'R' ? e : { ...e, dir: (e.dir === 1 ? -1 : 1) as 1 | -1 }));
}

export function makeElement(kind: ElementKind, value: number, dir: 1 | -1 = 1): CircuitElement {
  return { id: '', kind, value, dir: kind === 'R' ? 1 : dir };
}

const PREFIX: Record<ElementKind, string> = { R: 'R', V: 'Ug', I: 'Ig' };

/**
 * Végleges forma: az elemek olvasási sorrendben (fentről lefelé, balról jobbra) kapnak azonosítót
 * (R1, R2…, Ug1…, Ig1…), az ágak is ebben a sorrendben számozódnak.
 */
export function finalize(c: Circuit): Circuit {
  const pos = new Map(c.points.map((p) => [p.id, p]));
  const mid = (b: Branch) => {
    const p = pos.get(b.from)!;
    const q = pos.get(b.to)!;
    return { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 };
  };
  const sorted = [...c.branches].sort((u, v) => {
    const a = mid(u);
    const b = mid(v);
    return a.y - b.y || a.x - b.x;
  });
  const counters: Record<ElementKind, number> = { R: 0, V: 0, I: 0 };
  const branches = sorted.map((b, i) => ({
    ...b,
    id: `b${i + 1}`,
    elements: b.elements.map((e) => ({ ...e, id: `${PREFIX[e.kind]}${++counters[e.kind]}` })),
  }));
  return { points: c.points.map((p) => ({ ...p })), branches, terminals: c.terminals ? { ...c.terminals } : undefined, ports: c.ports?.map((x) => ({ ...x })) };
}
