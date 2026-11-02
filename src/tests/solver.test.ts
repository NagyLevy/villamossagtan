import { describe, expect, it } from 'vitest';
import {
  contribution,
  equivalentResistance,
  fundamentalLoops,
  kirchhoffCheck,
  loadCurrentFromThevenin,
  powerSum,
  solve,
  theveninAt,
} from '../solver/analysis';
import type { NetElement, Netlist } from '../solver/model';
import { netlistIssues } from '../generator/validate';
import { isSeriesParallelReducible, needsStarDeltaBetween } from '../simplify/seriesParallel';

const R = (id: string, a: number, b: number, value: number): NetElement => ({ id, kind: 'R', a, b, value });
/** Feszültségforrás: φ(b) − φ(a) = value (a nyíl b felé mutat). */
const V = (id: string, a: number, b: number, value: number): NetElement => ({ id, kind: 'V', a, b, value });
/** Áramforrás: value áram folyik a→b irányban a forráson át. */
const I = (id: string, a: number, b: number, value: number): NetElement => ({ id, kind: 'I', a, b, value });
const net = (nodeCount: number, elements: NetElement[]): Netlist => ({ nodeCount, elements });

function solved(n: Netlist) {
  const s = solve(n);
  if (!s) throw new Error('szinguláris');
  return s;
}

function expectBalanced(n: Netlist) {
  const s = solved(n);
  expect(Math.abs(powerSum(s))).toBeLessThan(1e-9);
  expect(kirchhoffCheck(n, s.elements).maxResidual).toBeLessThan(1e-9);
}

describe('MNA: kézzel ellenőrzött áramkörök', () => {
  it('feszültségosztó: 12 V, 4 Ω + 2 Ω', () => {
    const n = net(3, [V('U', 0, 1, 12), R('R1', 1, 2, 4), R('R2', 2, 0, 2)]);
    const s = solved(n);
    expect(s.elements.get('R1')!.U).toBeCloseTo(8, 12);
    expect(s.elements.get('R2')!.U).toBeCloseTo(4, 12);
    expect(s.elements.get('R1')!.I).toBeCloseTo(2, 12);
    // A forráson belül 0→1 irányban (a nyíl irányában) folyik 2 A: teljesítményt ad le.
    expect(s.elements.get('U')!.I).toBeCloseTo(2, 12);
    expect(s.elements.get('U')!.P).toBeCloseTo(-24, 12);
    expectBalanced(n);
  });

  it('csak áramgenerátoros hálózat', () => {
    const n = net(3, [I('J1', 0, 1, 3), I('J2', 0, 2, 1), R('R1', 1, 0, 6), R('R2', 1, 2, 2), R('R3', 2, 0, 4)]);
    const s = solved(n);
    // Csomóponti egyenletek: (1/6+1/2)φ1 − φ2/2 = 3; −φ1/2 + (1/2+1/4)φ2 = 1.
    const det = (2 / 3) * (3 / 4) - 1 / 4;
    const p1 = (3 * (3 / 4) + 1 / 2) / det;
    const p2 = ((2 / 3) * 1 + 3 / 2) / det;
    expect(s.nodeVoltage[1]).toBeCloseTo(p1, 12);
    expect(s.nodeVoltage[2]).toBeCloseTo(p2, 12);
    expect(s.elements.get('J1')!.P).toBeLessThan(0);
    expectBalanced(n);
  });

  it('csak feszültséggenerátoros hálózat, sorba kötött forrásokkal', () => {
    // 10 V és 5 V egymás mellett, egy 5 Ω-os ellenálláson: 15 V / 5 Ω = 3 A.
    const n = net(3, [V('U1', 0, 1, 10), V('U2', 1, 2, 5), R('R', 2, 0, 5)]);
    const s = solved(n);
    expect(s.elements.get('R')!.I).toBeCloseTo(3, 12);
    expectBalanced(n);
  });

  it('negatív eredmény: szembe kapcsolt források', () => {
    // 4 V és 10 V egymással szemben: a referenciairányban negatív áram.
    const n = net(3, [V('U1', 0, 1, 4), V('U2', 2, 1, 10), R('R', 2, 0, 3)]);
    const s = solved(n);
    expect(s.elements.get('R')!.I).toBeCloseTo(-2, 12);
    expect(s.elements.get('U1')!.P).toBeGreaterThan(0); // a 4 V-os forrás felvesz
    expect(s.elements.get('U2')!.P).toBeLessThan(0); // a 10 V-os lead
    expectBalanced(n);
  });

  it('ellenállás nélküli forrásos ág (létra)', () => {
    // Két fok: 6 V forrás egyedül, 3 A-es áramforrás egyedül; a sínen 2 Ω.
    const n = net(3, [V('U', 0, 1, 6), R('R', 1, 2, 2), I('J', 2, 0, 3)]);
    const s = solved(n);
    expect(s.elements.get('R')!.I).toBeCloseTo(3, 12); // az áramforrás a 2. csomópontból viszi el a 3 A-t
    expectBalanced(n);
  });

  it('áramforrással sorba kötött ellenállás nem befolyásolja az áramot', () => {
    const base = (Rs: number) => net(4, [I('J', 0, 1, 2), R('Rs', 1, 2, Rs), R('R1', 2, 3, 5), R('R2', 3, 0, 3), R('R3', 2, 0, 8)]);
    const a = solved(base(1));
    const b = solved(base(100));
    expect(a.elements.get('Rs')!.I).toBeCloseTo(2, 12);
    for (const id of ['R1', 'R2', 'R3']) expect(a.elements.get(id)!.I).toBeCloseTo(b.elements.get(id)!.I, 12);
    expectBalanced(base(7));
  });

  it('feszültségforrással párhuzamos ellenállás a többi elem feszültségét nem változtatja', () => {
    const base = (withParallel: boolean) =>
      net(3, [V('U', 0, 1, 12), R('R1', 1, 2, 3), R('R2', 2, 0, 6), ...(withParallel ? [R('Rp', 1, 0, 2)] : [])]);
    const a = solved(base(false));
    const b = solved(base(true));
    expect(b.elements.get('R1')!.U).toBeCloseTo(a.elements.get('R1')!.U, 12);
    expect(b.elements.get('Rp')!.I).toBeCloseTo(6, 12); // 12 V / 2 Ω, a referenciairány 1→0
    expectBalanced(base(true));
  });

  it('nulla áramú ág: kiegyenlített híd', () => {
    // Karok: 2, 4 (felső) és 3, 6 (alsó) → 2/4 = 3/6, az átlóban nem folyik áram.
    const n = net(4, [V('U', 3, 0, 10), R('R1', 0, 1, 2), R('R2', 1, 3, 4), R('R3', 0, 2, 3), R('R4', 2, 3, 6), R('R5', 1, 2, 7)]);
    const s = solved(n);
    expect(Math.abs(s.elements.get('R5')!.I)).toBeLessThan(1e-12);
    expectBalanced(n);
  });

  it('különálló komponensek is megoldhatók (komponensenként referencia)', () => {
    const n = net(4, [V('U', 0, 1, 5), R('R1', 1, 0, 5), I('J', 2, 3, 1), R('R2', 3, 2, 2)]);
    const s = solved(n);
    expect(s.elements.get('R1')!.I).toBeCloseTo(1, 12);
    expect(s.elements.get('R2')!.U).toBeCloseTo(2, 12);
  });
});

describe('érvénytelen hálózatok felismerése', () => {
  it('párhuzamos feszültségforrások (csak feszültségforrásos hurok)', () => {
    expect(netlistIssues(net(2, [V('U1', 0, 1, 5), V('U2', 0, 1, 6), R('R', 1, 0, 2)]))).toContain('feszultsegforras-hurok');
  });
  it('sorba kötött áramforrások (csak áramforrásos vágat)', () => {
    expect(netlistIssues(net(3, [I('J1', 0, 1, 1), I('J2', 1, 2, 2), R('R', 2, 0, 2)]))).toContain('aramforras-vagat');
  });
  it('lebegő rész', () => {
    expect(netlistIssues(net(4, [V('U', 0, 1, 5), R('R1', 1, 0, 5), R('R2', 2, 3, 1)]))).toContain('nem-osszefuggo');
  });
  it('rövidre zárt ellenállás', () => {
    expect(netlistIssues(net(2, [V('U', 0, 1, 5), R('R1', 1, 0, 5), R('R2', 1, 1, 3)]))).toContain('rovidre-zart-ellenallas');
  });
  it('érvényes hálózatnál nincs hiba', () => {
    expect(netlistIssues(net(3, [V('U', 0, 1, 12), R('R1', 1, 2, 4), R('R2', 2, 0, 2)]))).toEqual([]);
  });
});

describe('eredő ellenállás', () => {
  it('soros-párhuzamos', () => {
    // 2 Ω + (3 Ω ∥ 6 Ω) = 4 Ω
    const n = net(3, [R('R1', 0, 1, 2), R('R2', 1, 2, 3), R('R3', 1, 2, 6)]);
    expect(equivalentResistance(n, 0, 2)).toBeCloseTo(4, 12);
  });

  it('kiegyensúlyozatlan híd: egyezik a kézi delta→csillag levezetéssel', () => {
    const [R1, R2, R3, R4, R5] = [1, 2, 3, 4, 5];
    const n = net(4, [R('R1', 0, 1, R1), R('R2', 1, 3, R2), R('R3', 0, 2, R3), R('R4', 2, 3, R4), R('R5', 1, 2, R5)]);
    // Az A, C, D háromszög (R1, R5, R3) csillaggá alakítva, majd soros-párhuzamos összevonás.
    const sum = R1 + R3 + R5;
    const [RA, RC, RD] = [(R1 * R3) / sum, (R1 * R5) / sum, (R3 * R5) / sum];
    const par = (x: number, y: number) => (x * y) / (x + y);
    expect(equivalentResistance(n, 0, 3)).toBeCloseTo(RA + par(RC + R2, RD + R4), 12);
  });

  it('a források kiiktatva: feszültségforrás rövidzár, áramforrás szakadás', () => {
    // A–B között 6 Ω, vele sorban egy feszültségforrás (rövidzár) és párhuzamosan egy áramforrás (szakadás).
    const n = net(3, [R('R', 0, 1, 6), V('U', 1, 2, 9), I('J', 0, 2, 2)]);
    expect(equivalentResistance(n, 0, 2)).toBeCloseTo(6, 12);
  });

  it('nem összekötött pontok: végtelen', () => {
    expect(equivalentResistance(net(4, [R('R1', 0, 1, 1), R('R2', 2, 3, 1)]), 0, 3)).toBe(Infinity);
  });
});

describe('Thevenin / Norton', () => {
  const circuit = (RL: number) =>
    net(4, [V('U', 0, 1, 20), R('R1', 1, 2, 4), R('R2', 2, 0, 12), I('J', 0, 3, 2), R('R3', 3, 2, 3), R('RL', 2, 0, RL)]);

  it('Uth = Rth · In, és a helyettesítő kör bármely terhelésre egyezik', () => {
    const th = theveninAt(circuit(5), 'RL')!;
    expect(th.Uth).toBeCloseTo(th.Rth * th.In, 9);
    for (const RL of [0.1, 1, 5, 17, 1000]) {
      const I = solved(circuit(RL)).elements.get('RL')!.I;
      expect(loadCurrentFromThevenin(th, RL)).toBeCloseTo(I, 9);
    }
  });

  it('rövidzár (RL → 0) és üresjárás (RL → ∞) határesetek', () => {
    const th = theveninAt(circuit(5), 'RL')!;
    expect(loadCurrentFromThevenin(th, 0)).toBeCloseTo(th.In, 12);
    const open = solved(net(4, circuit(5).elements.filter((e) => e.id !== 'RL')));
    expect(open.nodeVoltage[2]! - open.nodeVoltage[0]!).toBeCloseTo(th.Uth, 12);
    expect(loadCurrentFromThevenin(th, 1e12) * 1e12).toBeCloseTo(th.Uth, 3);
  });
});

describe('szuperpozíció', () => {
  it('a részeredmények összege a teljes megoldás', () => {
    const n = net(4, [V('U1', 0, 1, 10), R('R1', 1, 2, 2), I('J', 0, 2, 3), R('R2', 2, 3, 4), V('U2', 0, 3, 6), R('R3', 2, 0, 5)]);
    const full = solved(n);
    const parts = ['U1', 'J', 'U2'].map((id) => contribution(n, id)!);
    for (const id of ['R1', 'R2', 'R3']) {
      const sum = parts.reduce((s, p) => s + p.elements.get(id)!.I, 0);
      expect(sum).toBeCloseTo(full.elements.get(id)!.I, 12);
    }
  });
});

describe('Kirchhoff-ellenőrzés és hurkok', () => {
  it('az alapvető hurkok mentén a feszültségek összege nulla', () => {
    const n = net(4, [V('U1', 0, 1, 10), R('R1', 1, 2, 2), I('J', 0, 2, 3), R('R2', 2, 3, 4), V('U2', 0, 3, 6), R('R3', 2, 0, 5)]);
    const s = solved(n);
    const loops = fundamentalLoops(n);
    expect(loops.length).toBe(n.elements.length - 4 + 1);
    for (const l of loops) {
      const sum = l.elements.reduce((acc, x) => acc + x.sign * s.elements.get(x.id)!.U, 0);
      expect(Math.abs(sum)).toBeLessThan(1e-12);
    }
  });

  it('hibás értékeket kiszúr', () => {
    const n = net(3, [V('U', 0, 1, 12), R('R1', 1, 2, 4), R('R2', 2, 0, 2)]);
    const s = solved(n);
    const bad = new Map([...s.elements].map(([k, v]) => [k, { ...v }]));
    bad.get('R1')!.I += 0.5;
    expect(kirchhoffCheck(n, bad).maxResidual).toBeGreaterThan(0.1);
  });
});

describe('soros-párhuzamos redukálhatóság', () => {
  const bridgeEdges = [
    { a: 0, b: 1 },
    { a: 1, b: 3 },
    { a: 0, b: 2 },
    { a: 2, b: 3 },
    { a: 1, b: 2 },
  ];
  it('a híd nem redukálható, a létra igen', () => {
    expect(isSeriesParallelReducible(bridgeEdges, 0, 3)).toBe(false);
    const ladderEdges = [
      { a: 0, b: 1 },
      { a: 1, b: 9 },
      { a: 1, b: 2 },
      { a: 2, b: 9 },
      { a: 0, b: 9 },
    ];
    expect(isSeriesParallelReducible(ladderEdges, 0, 9)).toBe(true);
  });
  it('kiegyenlített hídnál nem kell csillag-delta, kiegyensúlyozatlannál igen', () => {
    const balanced = net(4, [R('R1', 0, 1, 2), R('R2', 1, 3, 4), R('R3', 0, 2, 3), R('R4', 2, 3, 6), R('R5', 1, 2, 7)]);
    const unbalanced = net(4, [R('R1', 0, 1, 2), R('R2', 1, 3, 4), R('R3', 0, 2, 3), R('R4', 2, 3, 5), R('R5', 1, 2, 7)]);
    expect(needsStarDeltaBetween(balanced, 0, 3)).toBe(false);
    expect(needsStarDeltaBetween(unbalanced, 0, 3)).toBe(true);
  });
});
