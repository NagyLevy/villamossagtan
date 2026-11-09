// A tanár úr valódi feladatai (ZH-k, példatár): a rendszer ugyanazt a végeredményt és ugyanolyan
// felépítésű „egy képletben” levezetést adja-e. Forrás: a gyakorlok vault (zh1-2020-10-12, peldatar-lilik-2020).

import { describe, expect, it } from 'vitest';
import { generateProblem } from '../generator/generate';
import type { Level } from '../generator/values';
import { solveWith } from '../methods';
import { exprNum, reduceSP, singleSourceSteps } from '../methods/reduction';
import type { NetElement, Netlist } from '../solver/model';
import { solve } from '../solver/analysis';

const R = (id: string, value: number, a: number, b: number): NetElement => ({ id, kind: 'R', value, a, b });

/** Létrahálózat: forrás a 0–1 csomópontok között, aztán felváltva soros (felső) és sönt (lefelé) ellenállások. */
function chainStepOf(net: Netlist, target: string) {
  const r = singleSourceSteps(net, [target], {})!;
  expect(r).not.toBeNull();
  return r.steps.find((s) => s.title === 'Egy képletben')!;
}

describe('a tanár úr valódi feladatai', () => {
  it('ZH 2020-10-12 A / 3: I7 = 2 · 2/(2 + 5 + 7 × 11) · 11/(11 + 7) = 216,7 mA', () => {
    const net: Netlist = {
      nodeCount: 5,
      elements: [
        { id: 'Ig1', kind: 'I', value: 2, a: 0, b: 1 },
        R('R1', 1, 1, 2), R('R2', 2, 2, 0), R('R5', 5, 2, 3), R('R7', 7, 3, 0), R('R8', 8, 3, 4), R('R3', 3, 4, 0),
      ],
    };
    const st = chainStepOf(net, 'R7');
    expect(st.result!.value).toBeCloseTo(0.2167, 4);
    expect(Math.abs(solve(net)!.elements.get('R7')!.I)).toBeCloseTo(st.result!.value, 9);
    expect(st.terms![0]).toMatch(/\\times/); // replusz a képletben
  });

  it('ZH 2020-10-12 B / 3: U7 = 1 · 7 × (1 + 2 × 8)/(…) · (2 × 8)/(2 × 8 + 1) = 117,9 mV', () => {
    const net: Netlist = {
      nodeCount: 5,
      elements: [
        { id: 'Ug1', kind: 'V', value: 1, a: 0, b: 1 },
        R('R8', 8, 1, 2), R('R7', 7, 2, 0), R('R1', 1, 2, 3), R('R2', 2, 3, 0), R('R5', 5, 3, 4), R('R3', 3, 4, 0),
      ],
    };
    const st = chainStepOf(net, 'R2');
    expect(st.result!.value).toBeCloseTo(0.11789, 5);
    expect(Math.abs(solve(net)!.elements.get('R2')!.U)).toBeCloseTo(st.result!.value, 9);
  });

  it('Példatár 2.2: RAB = (((8 + 4) × 7 + 3) × 6 + 2) × 5 + 1 = 3,577 Ω, egy beágyazott képletben', () => {
    // A–B a 0–1 csomópontok; létra: 1 soros, 5 sönt, 2 soros, 6 sönt, 3 soros, 7 sönt, 4 + 8 a végén.
    const rs = [R('R1', 1, 1, 2), R('R5', 5, 2, 0), R('R2', 2, 2, 3), R('R6', 6, 3, 0), R('R3', 3, 3, 4), R('R7', 7, 4, 0), R('R4', 4, 4, 5), R('R8', 8, 5, 0)];
    const red = reduceSP(rs, 1, 0)!;
    expect(red.root.R).toBeCloseTo(3.577, 3);
    const tex = exprNum(red.root);
    expect(tex).toMatch(/\\times/);
    expect(tex).toMatch(/\\left\(/);
  });

  it('Példatár 2.4: I4 = 2 · 5/(5 + (2 + 6 × (3 + 7))) · 6/(6 + (3 + 7)) = 0,349 A', () => {
    const net: Netlist = {
      nodeCount: 5,
      elements: [
        { id: 'Ig1', kind: 'I', value: 2, a: 0, b: 1 },
        R('R1', 1, 1, 2), R('R5', 5, 2, 0), R('R2', 2, 2, 3), R('R6', 6, 3, 0), R('R3', 3, 3, 4), R('R7', 7, 4, 0),
      ],
    };
    const st = chainStepOf(net, 'R7');
    expect(st.result!.value).toBeCloseTo(0.349, 3);
  });
});

describe('módszerválasztás a tanár úr szerint (generált feladatokon)', () => {
  it('„Vegyük észre”: a hurokáram és a csomóponti módszer csak a szükséges egyenleteket írja fel, és ez előfordul', () => {
    let loopShort = 0;
    let nodalShort = 0;
    let nodalZero = 0;
    for (const level of ['kozepes', 'nehez'] as Level[])
      for (let i = 0; i < 80; i++) {
        const p0 = generateProblem({ seed: `VE${i}`, topic: 'tobbforras', level });
        // A ZH-n jellemzően egyetlen ellenállás mennyiségét kérdezik: a forrásteljesítmény-kérdést elhagyjuk.
        const p = { ...p0, questions: p0.questions.filter((q) => q.kind !== 'P' || !/^[UI]g/.test(q.target ?? '')) };
        const h = solveWith(p, 'hurokaram');
        if (h.ok && h.solution.steps.some((s) => (s.bullets ?? []).some((b) => b.startsWith('Vegyük észre')))) loopShort++;
        const c = solveWith(p, 'csomoponti');
        if (c.ok && c.solution.steps.some((s) => s.title === 'Vegyük észre')) {
          nodalShort++;
          if (!c.solution.steps.some((s) => s.title.startsWith('Csomóponti egyenlet'))) nodalZero++;
        }
        // A rövidebb levezetés is MNA-helyes (a kérdésekre adott válasz).
        for (const r of [h, c])
          if (r.ok)
            for (const a of r.solution.answers) {
              const q = p.questions.find((x) => x.id === a.questionId)!;
              expect(a.value).toBeCloseTo(q.answer, 8);
            }
      }
    console.log(`Vegyük észre — hurokáram: ${loopShort}/160, csomóponti: ${nodalShort}/160 (ebből számolás nélkül: ${nodalZero})`);
    expect(loopShort).toBeGreaterThan(0);
    expect(nodalShort).toBeGreaterThan(0);
  });
});

describe('1. ZH tanári formátumban (próbavizsga)', () => {
  it('5 feladat a régi 1. ZH-k sorrendjében; mind megoldható, MNA-helyes', async () => {
    const { examTasks } = await import('../tasks');
    const { applicableMethods } = await import('../methods');
    let starDelta = 0;
    for (let i = 0; i < 20; i++) {
      const ts = examTasks('zh1', `Z${i}`);
      expect(ts).toHaveLength(5);
      const [re, loop, , , th] = ts.map((t) => t.dc!);
      expect(re!.questions.some((q) => q.kind === 'Req')).toBe(true);
      if (solveWith(re!, 'csillag-delta').ok) starDelta++;
      expect(loop!.teacherType).toBe('hurokaram');
      expect(JSON.stringify(solveWith(loop!, 'hurokaram'))).toMatch(/saját, ismert hurka/);
      expect(th!.teacherType).toBe('thevenin');
      for (const p of ts.map((t) => t.dc!)) {
        const ms = applicableMethods(p);
        expect(ms.length).toBeGreaterThan(0);
        for (const m of ms) {
          const r = solveWith(p, m);
          if (r.ok)
            for (const a of r.solution.answers) expect(a.value).toBeCloseTo(p.questions.find((q) => q.id === a.questionId)!.answer, 8);
        }
      }
    }
    expect(starDelta).toBe(20);
  });
});

describe('1. ZH 4. feladat: hálózat egy ellenállásának teljesítménye', () => {
  it('P-t kérdez, redukcióval megoldható, a záró lépés P = I²R vagy U²/R, MNA-helyes', async () => {
    const { examTasks } = await import('../tasks');
    for (let i = 0; i < 20; i++) {
      const p = examTasks('zh1', `P${i}`)[3]!.dc!;
      expect(p.questions).toHaveLength(1);
      expect(p.questions[0]!.kind).toBe('P');
      const r = solveWith(p, 'redukcio');
      expect(r.ok).toBe(true);
      if (!r.ok) continue;
      expect(r.solution.answers[0]!.value).toBeCloseTo(p.questions[0]!.answer, 8);
      expect(r.solution.steps.at(-1)!.terms!.join(' ')).toMatch(/\^2/);
    }
  });
});

describe('szuperpozíció a tanár úr szerint: nagyság + irány-nyíl, összeg az első részhez képest', () => {
  it('minden részeredményben van nyíl, az összegben + / − a nagyságokkal, és helyes', () => {
    let n = 0;
    for (let i = 0; i < 30; i++) {
      const p = generateProblem({ seed: `SPA${i}`, topic: 'tanari', level: 'kozepes', teacherType: 'szuperpozicio' });
      const r = solveWith(p, 'szuperpozicio');
      if (!r.ok) continue;
      n++;
      for (const s of r.solution.steps.filter((x) => x.title === 'Részeredmény')) for (const t of s.terms!) expect(t).toMatch(/arrow\)/);
      for (const s of r.solution.steps.filter((x) => x.title.startsWith('Összegzés'))) {
        expect(s.subst).toMatch(/arrow\)$/);
        expect(s.subst).not.toMatch(/-\s*\d.*\(-/); // nincs negatív nagyság zárójelben
      }
    }
    expect(n).toBeGreaterThan(10);
  });
});

describe('ZH 2020-10-12 A / 4: P9Ω = 0,205² · 9 = 378,7 mW (I²R, mert áramforrás)', () => {
  it('a redukció ugyanazt adja, I²·R alakban', () => {
    const net: Netlist = {
      nodeCount: 5,
      elements: [
        { id: 'Ig1', kind: 'I', value: 2, a: 0, b: 1 },
        R('R2', 2, 1, 0), R('R9', 9, 1, 2), R('R14', 5, 2, 3), R('R7', 7, 3, 0), R('R3', 3, 3, 4), R('R4', 4, 4, 0),
      ],
    };
    const st = chainStepOf(net, 'R9');
    expect(st.result!.value).toBeCloseTo(0.2051, 4); // I9 = 2 · 2/(2 + (14 + 7 × 7))
    const I = Math.abs(solve(net)!.elements.get('R9')!.I);
    expect(I * I * 9).toBeCloseTo(0.3787, 4);
  });
});

describe('módszerválasztás: recommendMethod a tanár úr döntési sorrendjével', () => {
  it('egy forrás → redukció; tanári típus → a sajátja; több forrás → a legkevesebb egyenlet, és mindig megoldja', async () => {
    const { recommendMethod, systemSize } = await import('../methods/fit');
    const counts: Record<string, number> = {};
    for (const [topic, level] of [['oszto', 'nehez'], ['eredo', 'kozepes'], ['tobbforras', 'kozepes'], ['tobbforras', 'nehez'], ['tanari', 'kozepes'], ['thevenin', 'kozepes']] as const)
      for (let i = 0; i < 25; i++) {
        const p = generateProblem({ seed: `RM${topic}${i}`, topic, level });
        const { method } = recommendMethod(p);
        counts[method] = (counts[method] ?? 0) + 1;
        const r = solveWith(p, method);
        expect(r.ok, `${topic} ${i} ${method}`).toBe(true);
        if (topic === 'oszto' || topic === 'eredo') expect(['redukcio', 'csillag-delta']).toContain(method);
        if (topic === 'tanari') expect(method).toBe(p.teacherType);
        if (topic === 'tobbforras' && (method === 'hurokaram' || method === 'csomoponti')) {
          const h = systemSize(solveWith(p, 'hurokaram'));
          const c = systemSize(solveWith(p, 'csomoponti'));
          expect(systemSize(r)).toBe(Math.min(h, c)); // soha nem a hosszabb
        }
        if (r.ok) for (const a of r.solution.answers) expect(a.value).toBeCloseTo(p.questions.find((q) => q.id === a.questionId)!.answer, 8);
      }
    console.log('Javasolt módszerek:', JSON.stringify(counts));
    expect(counts.szuperpozicio ?? 0).toBeGreaterThan(0);
  });
});
