import { describe, expect, it } from 'vitest';
import { generateProblem, tooManySourcesInMesh, type GenerateOptions, type Problem, type Topic } from '../generator/generate';
import { circuitIssues, geometryIssues, seriesSourcePairs } from '../generator/validate';
import type { Level } from '../generator/values';
import { equivalentResistance, kirchhoffCheck, powerSum, solve, theveninAt } from '../solver/analysis';
import { allElements } from '../solver/model';
import { toNetlist } from '../solver/netlist';
import { needsStarDeltaBetween, singleSourceNeedsStarDelta } from '../simplify/seriesParallel';

const LEVELS: Level[] = ['alapozo', 'konnyu', 'kozepes', 'nehez'];
const TOPICS: Topic[] = ['ohm', 'eredo', 'kirchhoff', 'oszto', 'halozat', 'valodi-gen', 'thevenin', 'tobbforras'];

/** Minden generált feladatra érvényes általános feltételek. */
function checkProblem(p: Problem) {
  expect(geometryIssues(p.circuit)).toEqual([]);
  expect(circuitIssues(p.circuit)).toEqual([]);
  const { net } = toNetlist(p.circuit);
  // Két forrás sosem kerül sorba, és egy ablakban (hurokban) legfeljebb egy forrás van.
  expect(seriesSourcePairs(net)).toEqual([]);
  expect(tooManySourcesInMesh(p.circuit)).toBe(false);
  const sol = solve(net);
  expect(sol).not.toBeNull();
  const scale = Math.max(1, ...[...sol!.elements.values()].map((r) => Math.abs(r.P)));
  expect(Math.abs(powerSum(sol!))).toBeLessThan(1e-9 * scale);
  const scaleUI = Math.max(1, ...[...sol!.elements.values()].flatMap((r) => [Math.abs(r.U), Math.abs(r.I)]));
  expect(kirchhoffCheck(net, sol!.elements).maxResidual).toBeLessThan(1e-9 * scaleUI);
  expect(p.questions.length).toBeGreaterThan(0);
  for (const q of p.questions) {
    if (q.kind === 'table') continue;
    expect(Number.isFinite(q.answer)).toBe(true);
    expect(Math.abs(q.answer)).toBeGreaterThan(1e-9);
    expect(q.text.length).toBeGreaterThan(10);
  }
}

describe('generátor: 1000 seed minden témakörre és szintre', () => {
  const combos: GenerateOptions[] = [];
  for (const topic of TOPICS) for (const level of LEVELS) combos.push({ seed: '', topic, level });
  const N = Math.ceil(1000 / combos.length);

  it(`${combos.length} kombináció × ${N} seed: mind érvényes és megoldható`, () => {
    let count = 0;
    for (const c of combos) {
      for (let i = 0; i < N; i++) {
        const p = generateProblem({ ...c, seed: `T${i}` });
        checkProblem(p);
        count++;
      }
    }
    expect(count).toBeGreaterThanOrEqual(1000);
  });
});

describe('generátor: ZH-szint, 1000 seed', () => {
  it('"sok forrás" és "sok ellenállás" típus a specifikáció szerint', () => {
    let manySources = 0;
    let manyResistors = 0;
    for (let i = 0; i < 1000; i++) {
      const p = generateProblem({ seed: `ZH-${i}`, topic: 'zh' });
      checkProblem(p);
      const els = allElements(p.circuit);
      const nR = els.filter((e) => e.kind === 'R').length;
      const nV = els.filter((e) => e.kind === 'V').length;
      const nI = els.filter((e) => e.kind === 'I').length;
      expect(p.questions).toHaveLength(1);
      expect(p.questions[0]!.magnitudeOnly).toBe(true);
      expect(['U', 'I']).toContain(p.questions[0]!.kind);
      if (p.zhType === 'sok-forras') {
        manySources++;
        expect(['letra', 'racs']).toContain(p.topology);
        // Hurkonként legfeljebb egy forrás: 3–5 forrás 5–6 ablakban.
        expect(nV + nI).toBeGreaterThanOrEqual(3);
        expect(nV + nI).toBeLessThanOrEqual(5);
        expect(nI).toBeGreaterThanOrEqual(1);
        expect(nI).toBeLessThanOrEqual(2);
        expect(nR).toBeGreaterThanOrEqual(6);
        expect(nR).toBeLessThanOrEqual(9);
        // Van ellenállás nélküli, forrást tartalmazó ág.
        expect(p.circuit.branches.some((b) => b.elements.length > 0 && b.elements.every((e) => e.kind !== 'R'))).toBe(true);
      } else {
        manyResistors++;
        expect(['hid', 'gyuru']).toContain(p.topology);
        expect(nV + nI).toBe(1);
        expect(nR).toBeGreaterThanOrEqual(8);
        expect(nR).toBeLessThanOrEqual(10);
        // Csillag-delta kikapcsolva: soros-párhuzamosan (és osztással) megoldható.
        expect(singleSourceNeedsStarDelta(toNetlist(p.circuit).net)).toBe(false);
      }
    }
    // A két típus 60/40 arányban, véletlenszerűen keveredik.
    expect(manySources).toBeGreaterThan(400);
    expect(manyResistors).toBeGreaterThan(200);
  });
});

describe('nehézségi szintek méretei (többforrásos hálózatok)', () => {
  const expectations: Record<'konnyu' | 'kozepes' | 'nehez', { meshes: [number, number]; R: [number, number]; S: [number, number] }> = {
    konnyu: { meshes: [2, 2], R: [4, 5], S: [2, 2] },
    kozepes: { meshes: [3, 3], R: [6, 7], S: [2, 3] },
    nehez: { meshes: [4, 5], R: [8, 10], S: [3, 3] },
  };
  for (const [level, e] of Object.entries(expectations)) {
    it(level, () => {
      for (let i = 0; i < 100; i++) {
        const p = generateProblem({ seed: `L${i}`, topic: 'tobbforras', level: level as Level });
        expect(p.stats.meshes).toBeGreaterThanOrEqual(e.meshes[0]);
        expect(p.stats.meshes).toBeLessThanOrEqual(e.meshes[1]);
        expect(p.stats.resistors).toBeGreaterThanOrEqual(e.R[0]);
        expect(p.stats.resistors).toBeLessThanOrEqual(e.R[1]);
        expect(p.stats.sources).toBeGreaterThanOrEqual(e.S[0]);
        expect(p.stats.sources).toBeLessThanOrEqual(e.S[1]);
      }
    });
  }

  it('nehéz szint: többrészes kérdéssor (ágáram, teljesítmények, Thevenin/Norton, szuperpozíció)', () => {
    for (let i = 0; i < 50; i++) {
      const p = generateProblem({ seed: `H${i}`, topic: 'tobbforras', level: 'nehez' });
      const kinds = p.questions.map((q) => q.kind);
      expect(kinds).toEqual(expect.arrayContaining(['I', 'P', 'Uth', 'Rth', 'In', 'IL', 'Isup']));
    }
  });
});

describe('determinizmus és beállítások', () => {
  it('ugyanaz a seed ugyanazt a feladatot adja', () => {
    for (const topic of [...TOPICS, 'zh'] as Topic[]) {
      const a = generateProblem({ seed: 'K7Q2-9FMX', topic, level: 'kozepes' });
      const b = generateProblem({ seed: 'K7Q2-9FMX', topic, level: 'kozepes' });
      expect(JSON.stringify(b.circuit)).toBe(JSON.stringify(a.circuit));
      expect(b.questions.map((q) => [q.kind, q.answer, q.text])).toEqual(a.questions.map((q) => [q.kind, q.answer, q.text]));
    }
  });

  it('a választott topológiát használja', () => {
    for (const topology of ['letra', 'racs', 'gyuru', 'hid'] as const) {
      for (let i = 0; i < 20; i++) {
        expect(generateProblem({ seed: `T${i}`, topic: 'tobbforras', level: 'kozepes', topology }).topology).toBe(topology);
      }
    }
  });

  it('forrástípus: csak feszültség / csak áram', () => {
    for (let i = 0; i < 50; i++) {
      const v = allElements(generateProblem({ seed: `S${i}`, topic: 'tobbforras', level: 'kozepes', sourceMix: 'V' }).circuit);
      expect(v.some((e) => e.kind === 'I')).toBe(false);
      const c = allElements(generateProblem({ seed: `S${i}`, topic: 'tobbforras', level: 'kozepes', sourceMix: 'I' }).circuit);
      expect(c.some((e) => e.kind === 'V')).toBe(false);
    }
  });

  it('kerek eredmények mód', () => {
    for (let i = 0; i < 30; i++) {
      const p = generateProblem({ seed: `R${i}`, topic: 'zh', roundResults: true });
      const a = Math.abs(p.questions[0]!.answer);
      // Legfeljebb két tizedesjegy az előtagos alakban.
      const m = a >= 1 ? a : a * 1000;
      expect(Math.abs(m * 100 - Math.round(m * 100))).toBeLessThan(1e-6 * Math.max(1, m * 100));
    }
  });
});

describe('csillag-delta kikapcsolva: soha nem kell átalakítás', () => {
  it('eredő ellenállás, osztás, hálózatanalízis: mindig soros-párhuzamos', () => {
    for (const topic of ['eredo', 'oszto', 'halozat'] as Topic[]) {
      for (const level of LEVELS) {
        for (let i = 0; i < 40; i++) {
          const p = generateProblem({ seed: `SD${i}`, topic, level });
          const map = toNetlist(p.circuit);
          if (topic === 'eredo') {
            const a = map.pointNode.get(p.circuit.terminals!.a)!;
            const b = map.pointNode.get(p.circuit.terminals!.b)!;
            expect(needsStarDeltaBetween(map.net, a, b)).toBe(false);
          } else {
            expect(singleSourceNeedsStarDelta(map.net)).toBe(false);
          }
        }
      }
    }
  });

  it('Thevenin: az Rth meghatározásához nem kell átalakítás, és Uth = Rth·In', () => {
    for (const level of LEVELS) {
      for (let i = 0; i < 40; i++) {
        const p = generateProblem({ seed: `TH${i}`, topic: 'thevenin', level });
        const map = toNetlist(p.circuit);
        const load = allElements(p.circuit).find((e) => e.role === 'load')!;
        const th = theveninAt(map.net, load.id)!;
        expect(th.Uth).toBeCloseTo(th.Rth * th.In, 9);
        const open = { nodeCount: map.net.nodeCount, elements: map.net.elements.filter((e) => e.id !== load.id) };
        expect(needsStarDeltaBetween(open, th.a, th.b)).toBe(false);
        expect(equivalentResistance(open, th.a, th.b)).toBeCloseTo(th.Rth, 12);
      }
    }
  });
});

describe('valódi generátor', () => {
  it('Uk = U0 · Rt / (Rt + Rb)', () => {
    for (let i = 0; i < 100; i++) {
      const p = generateProblem({ seed: `VG${i}`, topic: 'valodi-gen', level: 'alapozo' });
      const els = allElements(p.circuit);
      const U0 = els.find((e) => e.kind === 'V')!.value;
      const Rb = els.find((e) => e.role === 'internal')!.value;
      const Rt = els.find((e) => e.role === 'load')!.value;
      const uk = p.questions.find((q) => q.kind === 'Uk');
      if (uk) expect(uk.answer).toBeCloseTo((U0 * Rt) / (Rt + Rb), 12);
      const rb = p.questions.find((q) => q.kind === 'Rb');
      if (rb) expect(rb.answer).toBe(Rb);
    }
  });
});
