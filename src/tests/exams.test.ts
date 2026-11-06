// A feltöltött vizsgafeladatok (2020-12-07, 2020-12-14) újraszámolása a saját motorral: a létra-
// levezetés (eredő + osztók) és a független komplex MNA is a vizsgamegoldás eredményét adja-e.

import { describe, expect, it } from 'vitest';
import { abs, argDeg, angleDiff, cx, inv, type Cx } from '../ac/complex';
import { elementPhasor, sourceVoltageStep } from '../ac/derive';
import { buildLadder, forwardChain, type LadderSpec } from '../ac/ladder';
import { solveAc } from '../ac/mna';
import type { Step } from '../methods/types';

const ctx = (omega: number) => ({ omega, ac: true });

/** Létra-levezetés: a keresett elem fazora, és ugyanez az MNA-ból. */
function viaLadder(spec: LadderSpec, pick: (ids: string[]) => string, want: 'U' | 'I') {
  const b = buildLadder(spec);
  const ids = b.circuit.branches.flatMap((x) => x.elements).map((e) => e.id);
  const id = pick(ids);
  const steps: Step[] = [];
  const fc = forwardChain(b, steps, ctx(spec.omega));
  const U0 = sourceVoltageStep(b, fc, steps, ctx(spec.omega));
  const r = elementPhasor(b, fc, U0, id, want, steps, ctx(spec.omega));
  const mna = solveAc(b.circuit, spec.omega)!;
  return { ladder: want === 'U' ? r.U : r.I, mna: want === 'U' ? mna.U.get(id)! : mna.I.get(id)!, steps, fc };
}

function close(v: Cx, amp: number, phase: number, relAmp = 2e-3, degTol = 0.15) {
  expect(Math.abs(abs(v) - amp) / amp).toBeLessThan(relAmp);
  expect(angleDiff(argDeg(v), phase)).toBeLessThan(degTol);
}

describe('vizsga 2020-12-07', () => {
  it('6. feladat: a 200 mH-s tekercs feszültsége 2·cos(10⁴t) V', () => {
    const spec: LadderSpec = {
      omega: 1e4,
      source: { kind: 'V', amp: 1, phase: 0 },
      series: [[{ kind: 'L', value: 0.1 }], [{ kind: 'R', value: 1000 }]],
      shunts: [[{ kind: 'C', value: 1e-7 }], [{ kind: 'L', value: 0.2 }]],
      terminals: null,
    };
    const r = viaLadder(spec, (ids) => ids.find((i) => i === 'L2')!, 'U');
    close(r.ladder, 2, 0);
    close(r.mna, 2, 0);
  });

  it('7. feladat: a 200 mH-s tekercs árama 0,447 mA, −116,6°', () => {
    const spec: LadderSpec = {
      omega: 1e4,
      source: { kind: 'I', amp: 1e-3, phase: 0 },
      series: [[], [{ kind: 'L', value: 0.1 }], [{ kind: 'R', value: 1000 }]],
      shunts: [[{ kind: 'R', value: 1000 }], [{ kind: 'C', value: 1e-7 }], [{ kind: 'L', value: 0.2 }]],
      terminals: null,
    };
    const r = viaLadder(spec, () => 'L2', 'I');
    // A vizsgamegoldás 0,447 mA·cos(10⁴t − 116,6°); a mi referenciairányunk (fentről lefelé) ezzel egyezik.
    close(r.ladder, 0.447e-3, -116.6, 3e-3, 0.3);
    close(r.mna, 0.447e-3, -116.6, 3e-3, 0.3);
  });

  it('9. és 10. feladat: Z = 706,8 + j591,4 Ω, λ = 0,767; párhuzamos kompenzálás 69,6 nF', () => {
    const spec: LadderSpec = {
      omega: 1e4,
      source: null,
      series: [[{ kind: 'L', value: 0.07 }], [{ kind: 'C', value: 90e-9 }]],
      shunts: [[{ kind: 'R', value: 1000 }], [{ kind: 'R', value: 2000 }]],
      terminals: 'input',
    };
    const b = buildLadder(spec);
    const z = forwardChain(b, [], ctx(1e4)).zin;
    expect(z.re).toBeCloseTo(706.8, 0);
    expect(z.im).toBeCloseTo(591.4, 0);
    expect(Math.cos((argDeg(z) * Math.PI) / 180)).toBeCloseTo(0.767, 3);
    // Párhuzamos kompenzálásnál az admittancia képzetes részét kell kioltani: C = −B/ω = 69,6 nF.
    // (A hivatalos megoldás 169 nF-ot ír, de az az impedancia képzetes részét oltaná ki, ami soros
    // kompenzálás lenne; a 2020-12-14-i 10. feladat megoldása már helyesen admittanciával számol.)
    const C = -inv(z).im / 1e4;
    expect(C * 1e9).toBeCloseTo(69.62, 1);
  });

  it('8. feladat: párhuzamos rezgőkör, R = 1 kΩ, B = 10⁴ rad/s, ω₀ = 7071 → L = 200 mH', () => {
    const C = 1 / (1000 * 1e4);
    const L = 1 / (7071 ** 2 * C);
    expect(C).toBeCloseTo(100e-9, 12);
    expect(L).toBeCloseTo(0.2, 3);
  });

  it('10. feladat (bekapcsolás): τ = L / (2 kΩ + 2 kΩ × 1 kΩ) = 37,5 µs', () => {
    const rth = 2000 + (2000 * 1000) / 3000;
    expect(0.1 / rth).toBeCloseTo(37.5e-6, 9);
  });
});

describe('vizsga 2020-12-14', () => {
  it('6. feladat: a 100 mH-s tekercs feszültsége 3,162 V, −18,4°', () => {
    const spec: LadderSpec = {
      omega: 1e4,
      source: { kind: 'V', amp: 10, phase: 0 },
      series: [[{ kind: 'R', value: 2000 }, { kind: 'L', value: 0.2 }], [{ kind: 'R', value: 1000 }]],
      shunts: [[{ kind: 'C', value: 1e-7 }], [{ kind: 'L', value: 0.1 }]],
      terminals: null,
    };
    const r = viaLadder(spec, () => 'L2', 'U');
    close(r.ladder, 3.162, -18.4, 2e-3, 0.1);
    close(r.mna, 3.162, -18.4, 2e-3, 0.1);
  });

  it('9. feladat: párhuzamos L–R tag (1 kΩ ∥ j1 kΩ), λ = 0,7071; 10. feladat: 100 nF-tal kompenzálható', () => {
    const spec: LadderSpec = { omega: 1e4, source: null, series: [[], []], shunts: [[{ kind: 'L', value: 0.1 }], [{ kind: 'R', value: 1000 }]], terminals: 'input' };
    const z = forwardChain(buildLadder(spec), [], ctx(1e4)).zin;
    expect(z.re).toBeCloseTo(500, 6);
    expect(z.im).toBeCloseTo(500, 6);
    expect(Math.cos((argDeg(z) * Math.PI) / 180)).toBeCloseTo(0.7071, 4);
    expect(-inv(z).im / 1e4).toBeCloseTo(100e-9, 12);
  });

  it('8. feladat: soros rezgőkör, R = 250 Ω, C = 250 nF, B = 10³ → ω₀ = 4000 rad/s', () => {
    const L = 250 / 1e3;
    expect(1 / Math.sqrt(L * 250e-9)).toBeCloseTo(4000, 6);
  });
});

describe('vizsga 2020-12-07, 3. és 4. feladat (nem létra): a független MNA a vizsga eredményét adja', () => {
  // 1 kΩ (felül bal) – 1 kΩ (felül jobb) – A; 100 mH bal oldalon; középen 1 kΩ függőlegesen;
  // jobb oldalon 1 kΩ A–B között; alul: u_g0 (bal–közép), 100 nF (közép–B), alatta i_g1 a két szél között.
  const circuit = (withSources: boolean) => ({
    points: [
      { id: 0, x: 0, y: 0 },
      { id: 1, x: 2, y: 0 },
      { id: 2, x: 4, y: 0 },
      { id: 3, x: 0, y: 2 },
      { id: 4, x: 2, y: 2 },
      { id: 5, x: 4, y: 2 },
      { id: 6, x: 0, y: 4 },
      { id: 7, x: 4, y: 4 },
    ],
    branches: [
      { id: 'a', from: 0, to: 1, elements: [{ id: 'R1', kind: 'R' as const, value: 1000, dir: 1 as const }] },
      { id: 'b', from: 1, to: 2, elements: [{ id: 'R2', kind: 'R' as const, value: 1000, dir: 1 as const }] },
      { id: 'c', from: 0, to: 3, elements: [{ id: 'L1', kind: 'L' as const, value: 0.1, dir: 1 as const }] },
      { id: 'd', from: 1, to: 4, elements: [{ id: 'R3', kind: 'R' as const, value: 1000, dir: 1 as const }] },
      { id: 'e', from: 2, to: 5, elements: [{ id: 'R4', kind: 'R' as const, value: 1000, dir: 1 as const }] },
      // u_g0 nyila balra mutat. A könyv szerint a feszültség nyila a + pólustól a − felé mutat, tehát
      // a jobb oldali (4) pont a magasabb potenciálú → az app jelölésében dir = +1.
      { id: 'f', from: 3, to: 4, elements: withSources ? [{ id: 'Ug1', kind: 'V' as const, value: 1, dir: 1 as const, phase: 0 }] : [] },
      { id: 'g', from: 4, to: 5, elements: [{ id: 'C1', kind: 'C' as const, value: 1e-7, dir: 1 as const }] },
      { id: 'h', from: 3, to: 6, elements: [] },
      { id: 'i', from: 5, to: 7, elements: [] },
      // i_g1 nyila balra: a 7 → 6 irányba folyik → dir = −1.
      { id: 'j', from: 6, to: 7, elements: withSources ? [{ id: 'Ig1', kind: 'I' as const, value: 1e-3, dir: -1 as const, phase: 0 }] : [] },
    ],
  });

  it('3. feladat: Z_AB = 648,6 − j108,1 Ω', () => {
    // Kiiktatott források: a feszültségforrás rövidzár (üres ág), az áramforrás szakadás (az ág törölve).
    const c = circuit(false);
    c.branches = c.branches.filter((b) => b.id !== 'j');
    c.branches.push({ id: 'p', from: 2, to: 5, elements: [{ id: 'Ip', kind: 'I', value: 1, dir: -1, phase: 0 } as never] });
    const s = solveAc(c, 1e4)!;
    const z = { re: s.phi[s.map.pointNode.get(2)!]!.re - s.phi[s.map.pointNode.get(5)!]!.re, im: s.phi[s.map.pointNode.get(2)!]!.im - s.phi[s.map.pointNode.get(5)!]!.im };
    expect(z.re).toBeCloseTo(648.6, 0);
    expect(z.im).toBeCloseTo(-108.1, 0);
  });

  it('4. feladat: az üresjárási feszültség 0,329 V, a két részeredmény 0,164 V és 0,368 V', () => {
    const s = solveAc(circuit(true), 1e4)!;
    const u = { re: s.phi[s.map.pointNode.get(2)!]!.re - s.phi[s.map.pointNode.get(5)!]!.re, im: s.phi[s.map.pointNode.get(2)!]!.im - s.phi[s.map.pointNode.get(5)!]!.im };
    expect(abs(u)).toBeCloseTo(0.329, 2);
  });
});

void cx;
