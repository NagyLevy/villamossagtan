// Szinuszos és bekapcsolási feladatok: a lépésenkénti (eredő + osztó) levezetés eredménye minden
// esetben egyezik a független komplex MNA-megoldóval.

import { describe, expect, it } from 'vitest';
import { abs, argDeg, conj, mul, scale, sub, angleDiff, type Cx } from '../ac/complex';
import { solveAc } from '../ac/mna';
import { generateAcTask, type AcLevel, type AcTopic } from '../ac/problems';
import type { Circuit, CircuitElement } from '../solver/model';
import type { Task } from '../tasks/types';
import { computeLayout } from '../render/layout';

const LEVELS: AcLevel[] = ['konnyu', 'kozepes', 'nehez'];
const N = 60;

function omegaOf(t: Task): number {
  const m = /\\omega = (?:10\^\{(\d+)\}|([\d{},]+))/.exec(t.given?.[0] ?? '');
  if (!m) return 0;
  return m[1] ? 10 ** Number(m[1]) : Number(m[2]!.replace('{,}', '.'));
}

const elements = (c: Circuit) => c.branches.flatMap((b) => b.elements);

/** A kapcsokra 1 A-es (próba)áramforrás: a kapcsok közti feszültség maga az impedancia. */
function impedanceAt(c: Circuit, a: number, b: number, omega: number, kill: boolean): Cx {
  const copy: Circuit = structuredClone(c);
  if (kill)
    for (const br of copy.branches)
      br.elements = br.elements.flatMap((e): CircuitElement[] => {
        if (e.kind === 'V') return [];
        if (e.kind === 'I') return [{ ...e, value: 0 }];
        return [e];
      });
  copy.branches.push({ id: 'probe', from: a, to: b, elements: [{ id: 'Iprobe', kind: 'I', value: 1, dir: -1, phase: 0 }] });
  const s = solveAc(copy, omega)!;
  return sub(s.phi[s.map.pointNode.get(a)!]!, s.phi[s.map.pointNode.get(b)!]!);
}

function closePhasor(v: Cx, amp: number, phase: number) {
  expect(amp).toBeCloseTo(abs(v), 6);
  if (abs(v) > 1e-12) expect(angleDiff(phase, argDeg(v))).toBeLessThan(1e-6);
}

describe('szinuszos feladatok = MNA', () => {
  it('eredő impedancia', () => {
    for (const level of LEVELS)
      for (let i = 0; i < N; i++) {
        const t = generateAcTask({ seed: `Z${i}`, topic: 'ac-impedancia', level });
        const w = omegaOf(t);
        const z = impedanceAt(t.circuit!, t.circuit!.terminals!.a, t.circuit!.terminals!.b, w, false);
        const f = t.questions[0]!.fields;
        if (f[0]!.label === '|Z|') closePhasor(z, f[0]!.answer, f[1]!.answer);
        else {
          expect(f[0]!.answer).toBeCloseTo(z.re, 6);
          expect(f[1]!.answer).toBeCloseTo(z.im, 6);
        }
      }
  });

  it('elem fazora osztókkal', () => {
    for (const level of LEVELS)
      for (let i = 0; i < N; i++) {
        const t = generateAcTask({ seed: `F${i}`, topic: 'ac-fazor', level });
        const s = solveAc(t.circuit!, omegaOf(t))!;
        const q = t.questions[0]!;
        const isU = q.fields[0]!.unit === 'V';
        const v = (isU ? s.U : s.I).get(q.target!)!;
        closePhasor(v, q.fields[0]!.answer, q.fields[1]!.answer);
      }
  });

  it('teljesítmény, teljesítménytényező, kompenzálás', () => {
    for (const level of LEVELS)
      for (let i = 0; i < N; i++) {
        const t = generateAcTask({ seed: `P${i}`, topic: 'ac-teljesitmeny', level });
        const w = omegaOf(t);
        const c = t.circuit!;
        const f = t.questions[0]!.fields;
        if (c.terminals) {
          const z = impedanceAt(c, c.terminals.a, c.terminals.b, w, false);
          if (f[0]!.label === 'λ') expect(f[0]!.answer).toBeCloseTo(Math.cos((argDeg(z) * Math.PI) / 180), 6);
          else {
            // A kompenzált (párhuzamos elemmel kiegészített) hálózat tisztán valós.
            const extra: CircuitElement = { id: 'Xk', kind: f[0]!.element!, value: f[0]!.answer, dir: 1 };
            const copy: Circuit = structuredClone(c);
            copy.branches.push({ id: 'komp', from: c.terminals.a, to: c.terminals.b, elements: [extra] });
            const z2 = impedanceAt(copy, c.terminals.a, c.terminals.b, w, false);
            expect(Math.abs(z2.im)).toBeLessThan(1e-6 * abs(z2));
          }
        } else {
          const s = solveAc(c, w)!;
          const src = elements(c).find((e) => e.kind === 'V')!;
          // A forrás árama alulról felfelé (a hálózatba), feszültsége fent a +.
          const I = s.I.get(src.id)!;
          const U = scale(s.U.get(src.id)!, -1);
          const S = scale(mul(U, conj(I)), 0.5);
          if (f[0]!.label === 'S') expect(f[0]!.answer).toBeCloseTo(abs(S), 9);
          else {
            expect(f[0]!.answer).toBeCloseTo(S.re, 9);
            expect(f[1]!.answer).toBeCloseTo(S.im, 9);
          }
        }
      }
  });

  it('Thevenin és Norton', () => {
    for (const level of LEVELS)
      for (let i = 0; i < N; i++) {
        const t = generateAcTask({ seed: `T${i}`, topic: 'ac-helyettesito', level });
        const w = omegaOf(t);
        const c = t.circuit!;
        const { a, b } = c.terminals!;
        const f = t.questions[0]!.fields;
        const s = solveAc(c, w)!;
        const uu = sub(s.phi[s.map.pointNode.get(a)!]!, s.phi[s.map.pointNode.get(b)!]!);
        const zth = impedanceAt(c, a, b, w, true);
        if (f[0]!.label === 'valós rész') {
          expect(f[0]!.answer).toBeCloseTo(zth.re, 6);
          expect(f[1]!.answer).toBeCloseTo(zth.im, 6);
        } else if (f[0]!.unit === 'V') closePhasor(uu, f[0]!.answer, f[1]!.answer);
        else {
          // Rövidzár a kapcsokon: az A→B irányú áram.
          const copy: Circuit = structuredClone(c);
          copy.branches.push({ id: 'short', from: a, to: b, elements: [{ id: 'K9', kind: 'K', value: 0, dir: 1 }] });
          const s2 = solveAc(copy, w)!;
          closePhasor(s2.I.get('K9')!, f[0]!.answer, f[1]!.answer);
        }
      }
  });

  it('bekapcsolás: időállandó és érték t1-ben', () => {
    for (const level of LEVELS)
      for (let i = 0; i < N; i++) {
        const t = generateAcTask({ seed: `B${i}`, topic: 'tranziens', level });
        const c = t.circuit!;
        const q = t.questions[0]!;
        const load = elements(c).find((e) => e.id === q.target)!;
        const dc = solveAc(c, 1, { dc: true })!;
        const xInf = load.kind === 'L' ? dc.I.get(load.id)!.re : dc.U.get(load.id)!.re;
        // Thevenin-ellenállás a tároló helyéről, a generátor rövidzár.
        const br = c.branches.find((x) => x.elements.some((e) => e.id === load.id))!;
        const copy: Circuit = structuredClone(c);
        copy.branches = copy.branches.filter((x) => x.id !== br.id);
        const rth = impedanceAt(copy, br.from, br.to, 1, true).re;
        const tau = load.kind === 'L' ? load.value / rth : rth * load.value;
        expect(q.fields[0]!.answer).toBeCloseTo(tau, 12);
        const x1 = q.fields[1]!.answer;
        // x1 = x∞ (1 − e^(−t1/τ)): a kérdésben szereplő t1 az időállandó 0,5; 1; 2 vagy 3-szorosa (2 jegyre kerekítve).
        const ratio = x1 / xInf;
        expect(ratio).toBeGreaterThan(0);
        expect(ratio).toBeLessThan(1);
        const tauQ = q.fields[0]!.answer;
        const t1 = -tauQ * Math.log(1 - ratio);
        expect([0.5, 1, 2, 3].some((m) => Math.abs(Number((m * tauQ).toPrecision(2)) - t1) < 1e-9 * Math.max(1, t1) + 1e-15), `${level} ${i} tau=${tau} t1=${t1}`).toBe(true);
      }
  });

  it('rezgőkör: ω0 = 1/√(LC)', () => {
    for (let i = 0; i < N; i++) {
      const t = generateAcTask({ seed: `Q${i}`, topic: 'ac-rezonancia', level: 'kozepes' });
      const els = elements(t.circuit!);
      const L = els.find((e) => e.kind === 'L')!.value;
      const C = els.find((e) => e.kind === 'C')!.value;
      const w0 = 1 / Math.sqrt(L * C);
      const f = t.questions[0]!.fields;
      const fw = f.find((x) => x.label === 'ω₀');
      if (fw) expect(fw.answer).toBeCloseTo(w0, 6);
      const fl = f.find((x) => x.label === 'L');
      if (fl) expect(fl.answer).toBeCloseTo(L, 12);
      // Rezonancián a soros LC-ág impedanciája valós (a képzetes rész kiesik).
      const s = solveAc(t.circuit!, w0)!;
      expect(s).not.toBeNull();
    }
  });
});

describe('szinuszos feladatok rajza', () => {
  it('nincs ütköző felirat, és minden lépésnek van címe, szövege', () => {
    const topics: AcTopic[] = ['ac-impedancia', 'ac-fazor', 'ac-teljesitmeny', 'ac-helyettesito', 'ac-rezonancia', 'tranziens'];
    for (const topic of topics)
      for (const level of LEVELS)
        for (let i = 0; i < 25; i++) {
          const t = generateAcTask({ seed: `R${i}`, topic, level });
          const lay = computeLayout(t.circuit!);
          expect(lay.collisions, `${topic} ${level} ${i}`).toEqual([]);
          for (const st of t.solution!.steps) {
            expect(st.title.length).toBeGreaterThan(0);
            expect(st.text.length).toBeGreaterThan(10);
          }
        }
  });
});

