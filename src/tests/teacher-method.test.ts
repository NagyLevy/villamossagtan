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

describe('a tanár úr írásmódja a levezetésben (ZH 2020/2021 megoldásai alapján)', () => {
  it('egyenletcímke „J₁ :)”, „φ₁ :)”; ágáram hurokáramokból; Uü részei nagysággal és iránnyal; tizedesvessző', () => {
    for (let i = 0; i < 15; i++) {
      const h = solveWith(generateProblem({ seed: `STY${i}`, topic: 'tanari', level: 'kozepes', teacherType: 'hurokaram' }), 'hurokaram');
      if (h.ok) for (const s of h.solution.steps.filter((x) => x.title.startsWith('Huroktörvény'))) expect(s.subst!.startsWith('J_{') && s.subst!.includes('\\text{:)}')).toBe(true);
      const c = solveWith(generateProblem({ seed: `STY${i}`, topic: 'tanari', level: 'kozepes', teacherType: 'csomoponti' }), 'csomoponti');
      if (c.ok) for (const s of c.solution.steps.filter((x) => x.title.startsWith('Csomóponti egyenlet'))) expect(s.subst!.startsWith('\\varphi_{') && s.subst!.includes('\\text{:)}')).toBe(true);
      const t = solveWith(generateProblem({ seed: `STY${i}`, topic: 'tanari', level: 'kozepes', teacherType: 'thevenin' }), 'thevenin');
      if (t.ok) {
        for (const s of t.solution.steps.filter((x) => x.title.startsWith('Részfeszültség') && x.subst)) expect(s.subst!.endsWith('A \\to B)') || s.subst!.endsWith('B \\to A)')).toBe(true);
        const sum = t.solution.steps.find((x) => x.title === 'Összegzés');
        if (sum) {
          expect(sum.subst).not.toMatch(/\(-/);
          expect(sum.subst!.endsWith('A \\to B)') || sum.subst!.endsWith('B \\to A)')).toBe(true);
          expect(sum.terms![0]).not.toMatch(/= -/); // az első rész mindig +
        }
      }
      const all = JSON.stringify([h, c, t]);
      expect(/\d\.\d+\\\\,\\\\text/.test(all)).toBe(false); // nincs tizedespont a megjelenített számokban
    }
  });
});

describe('ZH 2021-10-26 A (a tanár úr megoldásai)', () => {
  it('3. feladat: I2 = 1 · 6/(6 + 5 + 2 × (4 + 3)) · (4 + 3)/(4 + 3 + 2) = 0,372 A', () => {
    const net: Netlist = {
      nodeCount: 5,
      elements: [
        { id: 'Ig1', kind: 'I', value: 1, a: 0, b: 1 },
        R('R6', 6, 1, 0), R('R5', 5, 1, 2), R('R2', 2, 2, 0), R('R4', 4, 2, 3), R('R3', 3, 3, 0),
      ],
    };
    const st = chainStepOf(net, 'R2');
    expect(st.result!.value).toBeCloseTo(0.372, 3);
    expect(Math.abs(solve(net)!.elements.get('R2')!.I)).toBeCloseTo(st.result!.value, 9);
  });

  it('4. feladat: az áramforrás teljesítménye P = I²·Re, Re = (((2 + 1) × 2) + 4 + 5) × 1 + 3 = 3,911 Ω → 3,911 W', () => {
    const rs = [R('R3', 3, 1, 2), R('R1', 1, 2, 0), R('R5', 5, 2, 3), R('R4', 4, 3, 4), R('R2', 2, 4, 0), R('Ra', 2, 4, 5), R('Rb', 1, 5, 0)];
    const red = reduceSP(rs, 1, 0)!;
    expect(red.root.R).toBeCloseTo(3.911, 3);
    const net: Netlist = { nodeCount: 6, elements: [{ id: 'Ig1', kind: 'I', value: 1, a: 0, b: 1 }, ...rs] };
    const sol = solve(net)!.elements.get('Ig1')!;
    expect(Math.abs(sol.U * sol.I)).toBeCloseTo(3.911, 3);
  });
});

describe('1. ZH 4. feladat forrás-változata: P = I²·Re vagy U²/Re, leadott → negatív', () => {
  it('a redukció válasza = MNA, a záró lépés a tanár úr képlete', async () => {
    const { examTasks } = await import('../tasks');
    let src = 0;
    for (let i = 0; i < 40; i++) {
      const p = examTasks('zh1', `PS${i}`)[3]!.dc!;
      const q = p.questions[0]!;
      if (!q.target || q.target.startsWith('R')) continue;
      src++;
      const r = solveWith(p, 'redukcio');
      expect(r.ok).toBe(true);
      if (!r.ok) continue;
      expect(r.solution.answers[0]!.value).toBeCloseTo(q.answer, 8);
      const last = r.solution.steps.at(-1)!;
      expect(last.terms!.join(' ')).toMatch(/R_e/);
      expect(last.subst).toContain('leadott');
    }
    expect(src).toBeGreaterThan(5);
  });
});

describe('összevont ellenállás neve: Re′, Re″ (Levi döntése, 2026-11-09)', () => {
  it('a levezetésben nincs R_{e1}, helyette vesszős név', () => {
    let primed = 0;
    for (let i = 0; i < 20; i++) {
      const p = generateProblem({ seed: `RN${i}`, topic: 'oszto', level: 'nehez' });
      const txt = JSON.stringify(solveWith(p, 'redukcio'));
      expect(txt).not.toMatch(/R_\{e[0-9]\}/);
      expect(txt).not.toMatch(/Re[0-9]/);
      if (txt.includes("R_{e'}")) primed++;
    }
    expect(primed).toBeGreaterThan(10);
  });
});

describe('Vizsga 2021-01-11 / 3 (a tanár úr megoldása, delta-csillag után)', () => {
  it('Rg = (6 + 1 + 1,25) × 2 = 1,61 Ω; U′ = 0,39 V, U″ = 0,78 V ellentétes, U = 0,39 V; PM = U²/(4Rg) = 23,62 mW', () => {
    // A–B = 1–0, a 2 Ω-os ellenállás a kapcsokon; a lánc: 2 V-os forrás, 6 Ω, 1 Ω (rajta a 4 A-es áramforrás), 1,25 Ω.
    const chain = [R('R6', 6, 2, 3), R('R1', 1, 3, 4), R('R125', 1.25, 4, 1), R('R2', 2, 1, 0)];
    const red = reduceSP(chain.map((e) => ({ ...e })).concat([R('W', 1e-12, 0, 2)]), 1, 0)!;
    expect(red.root.R).toBeCloseTo(1.61, 2);
    let best = Infinity;
    for (const dv of [1, -1])
      for (const di of [1, -1]) {
        const net: Netlist = {
          nodeCount: 5,
          elements: [{ id: 'Ug', kind: 'V', value: 2 * dv, a: 0, b: 2 }, { id: 'Ig', kind: 'I', value: 4 * di, a: 3, b: 4 }, ...chain],
        };
        const U = Math.abs(solve(net)!.elements.get('R2')!.U);
        best = Math.min(best, Math.abs(U - 0.39));
        if (Math.abs(U - 0.39) < 0.01) expect((U * U) / (4 * red.root.R)).toBeCloseTo(0.02362, 3);
      }
    expect(best).toBeLessThan(0.01); // az egyik irányítással pontosan a tanár úr 0,39 V-ja jön ki (U″ − U′)
  });
});

describe('Vizsga 2021-01-18 / 1, a PDF-ábra pontos kapcsolásával', () => {
  it('„A 0,5 Ω-os ellenállás feszültsége a rá közvetlenül csatlakozó feszültségforrás miatt pontosan 2 V”: I = 4 A, egyenletrendszer nélkül', async () => {
    const { Sketch, makeElement } = await import('../generator/sketch');
    const { toNetlist: tn } = await import('../solver/netlist');
    const { askElementI } = await import('../generator/questions');
    const { recommendMethod, systemSize } = await import('../methods/fit');
    const s = new Sketch();
    const r = (v: number) => makeElement('R', v);
    // Rács: x = 0, 2, 4; y = 0, 2, 4 (fent, közép, lent), ahogy a vizsgalap 1. ábráján.
    s.branch(0, 0, 2, 0, [r(1)]);
    s.branch(2, 0, 4, 0, [r(1)]);
    s.branch(0, 0, 0, 2, [makeElement('I', 1, 1)]); // 1 A, nyíl lefelé
    s.branch(2, 0, 2, 2, [r(1)]);
    s.branch(4, 0, 4, 2, [r(1)]);
    s.branch(0, 2, 2, 2, [r(1)]);
    s.branch(2, 2, 4, 2, [makeElement('V', 1, 1)]); // 1 V, nyíl balra: a jobb oldal a magasabb
    s.branch(0, 2, 0, 4, [makeElement('I', 1, -1)]); // 1 A, nyíl felfelé
    s.branch(2, 2, 2, 4, [makeElement('V', 1, -1)]); // 1 V, nyíl lefelé: a felső vég a magasabb
    const half = makeElement('R', 0.5);
    s.branch(4, 2, 4, 4, [half]);
    s.branch(0, 4, 2, 4, [r(1)]);
    s.branch(2, 4, 4, 4);
    const circuit = s.build();
    const map = tn(circuit);
    const el = circuit.branches.flatMap((b) => b.elements).find((e) => e.kind === 'R' && e.value === 0.5)!;
    const sol = solve(map.net)!;
    expect(Math.abs(sol.elements.get(el.id)!.I)).toBeCloseTo(4, 9);
    const p = {
      seed: 'V20210118', topic: 'tobbforras', level: 'kozepes', topology: 'egyedi', circuit,
      questions: [askElementI(circuit, el, sol.elements.get(el.id)!.I, true)],
      stats: { meshes: 0, resistors: 7, sources: 4 }, attempts: 1,
    } as unknown as Parameters<typeof solveWith>[0];
    const rec = recommendMethod(p);
    const r2 = solveWith(p, rec.method);
    expect(r2.ok).toBe(true);
    if (!r2.ok) return;
    expect(r2.solution.answers[0]!.value).toBeCloseTo(4, 9);
    expect(systemSize(r2)).toBe(0); // a tanár úr: egyenletrendszer nélkül
  });
});

describe('Vizsga 2021-01-18 / 2, a PDF-ábra pontos kapcsolásával', () => {
  it('a tanár úr: hurokáram, 3 ismert hurok, egyetlen egyenlet „J1 :) …”, I = 0,8571 A; az app ugyanezt választja', async () => {
    const { Sketch, makeElement } = await import('../generator/sketch');
    const { toNetlist: tn } = await import('../solver/netlist');
    const { askElementI } = await import('../generator/questions');
    const { recommendMethod, systemSize } = await import('../methods/fit');
    const s = new Sketch();
    const r = (v: number) => makeElement('R', v);
    s.branch(0, 0, 2, 0, [r(1)]);
    s.branch(2, 0, 4, 0, [r(1)]);
    s.branch(0, 0, 0, 2, [makeElement('I', 1, 1)]); // 1 A, nyíl lefelé
    s.branch(2, 0, 2, 2, [r(1)]);
    s.branch(4, 0, 4, 2, [r(1)]);
    s.branch(0, 2, 2, 2, [r(1)]);
    s.branch(2, 2, 4, 2, [makeElement('I', 1, -1)]); // 1 A, nyíl balra
    s.branch(0, 2, 0, 4, [makeElement('I', 1, -1)]); // 1 A, nyíl felfelé
    s.branch(2, 2, 2, 4, [makeElement('V', 1, -1)]); // 1 V, nyíl lefelé
    s.branch(4, 2, 4, 4, [makeElement('R', 0.5)]);
    s.branch(0, 4, 2, 4, [r(1)]);
    s.branch(2, 4, 4, 4);
    const circuit = s.build();
    const map = tn(circuit);
    const el = circuit.branches.flatMap((b) => b.elements).find((e) => e.kind === 'R' && e.value === 0.5)!;
    const sol = solve(map.net)!;
    expect(Math.abs(sol.elements.get(el.id)!.I)).toBeCloseTo(0.8571, 4);
    const p = {
      seed: 'V20210118b', topic: 'tobbforras', level: 'kozepes', topology: 'egyedi', circuit,
      questions: [askElementI(circuit, el, sol.elements.get(el.id)!.I, true)],
      stats: { meshes: 0, resistors: 7, sources: 4 }, attempts: 1,
    } as unknown as Parameters<typeof solveWith>[0];
    const h = solveWith(p, 'hurokaram');
    expect(h.ok).toBe(true);
    if (!h.ok) return;
    expect(h.solution.answers[0]!.value).toBeCloseTo(0.8571, 4);
    const eqs = h.solution.steps.filter((x) => x.title.startsWith('Huroktörvény'));
    expect(eqs).toHaveLength(1); // a tanár úr is egyetlen egyenletet ír fel
    expect(eqs[0]!.subst!.startsWith('J_{1}')).toBe(true);
    expect(recommendMethod(p).method).toBe('hurokaram');
    expect(systemSize(h)).toBeLessThanOrEqual(1);
    console.log('2021-01-18/2 app-egyenlet:', eqs[0]!.subst);
  });
});

// ───────── Vizsgák a PDF-ábrák pontos kapcsolásával (raw/villamossagtan/pdf) ─────────
// Ág: [x1, y1, x2, y2, fajta, érték, irány]. Rács: x = 0, 2, 4; y = 0 (fent), 2, 4 (lent).
// Feszültségforrás iránya: +1 → a to (jobb/alsó) vég a magasabb; áramforrás: +1 → from→to (jobbra/lefelé) folyik.
type Br = [number, number, number, number, ('R' | 'V' | 'I' | 'W'), number?, (1 | -1)?];
async function examProblem(branches: Br[], target: { kind: 'R'; value: number }, ask: 'U' | 'I') {
  const { Sketch, makeElement } = await import('../generator/sketch');
  const { toNetlist: tn } = await import('../solver/netlist');
  const { askElementI, askElementU } = await import('../generator/questions');
  const sk = new Sketch();
  for (const [x1, y1, x2, y2, k, v, d] of branches) sk.branch(x1, y1, x2, y2, k === 'W' ? [] : [makeElement(k, v!, d ?? 1)]);
  const circuit = sk.build();
  const sol = solve(tn(circuit).net)!;
  const el = circuit.branches.flatMap((b) => b.elements).find((e) => e.kind === 'R' && e.value === target.value)!;
  const v = sol.elements.get(el.id)!;
  const q = ask === 'U' ? askElementU(circuit, el, v.U, true) : askElementI(circuit, el, v.I, true);
  return { seed: 'VIZSGA', topic: 'tobbforras', level: 'kozepes', topology: 'egyedi', circuit, questions: [q], stats: { meshes: 0, resistors: 0, sources: branches.filter((b) => b[4] === 'V' || b[4] === 'I').length }, attempts: 1 } as unknown as Parameters<typeof solveWith>[0];
}
async function checkExam(p: Parameters<typeof solveWith>[0], answer: number, method: 'hurokaram' | 'csomoponti', eqs: number) {
  const { recommendMethod, systemSize } = await import('../methods/fit');
  expect(p.questions[0]!.answer).toBeCloseTo(answer, 3);
  const rec = recommendMethod(p);
  const r = solveWith(p, rec.method);
  expect(r.ok).toBe(true);
  if (!r.ok) return;
  expect(r.solution.answers[0]!.value).toBeCloseTo(answer, 3);
  expect(systemSize(r)).toBe(eqs);
  const own = solveWith(p, method);
  expect(own.ok).toBe(true);
  if (own.ok) expect(systemSize(own)).toBe(eqs);
  return { rec: rec.method, eq: own.ok ? own.solution.steps.filter((x) => /^(Huroktörvény|Csomóponti egyenlet)/.test(x.title)).map((x) => x.subst) : [] };
}

describe('Vizsgák a PDF-ábrák pontos kapcsolásával: módszer, egyenletszám, eredmény', () => {
  it('2020-12-14/1: hurokáram, egy ismeretlen hurok („18J1 = 0”), U4k = 4 V', async () => {
    const p = await examProblem([
      [0, 0, 2, 0, 'I', 0.001, 1], [2, 0, 4, 0, 'R', 1000], [4, 0, 4, 2, 'R', 2000], [0, 0, 0, 2, 'V', 2, -1], [2, 0, 2, 2, 'I', 0.002, 1],
      [0, 2, 2, 2, 'R', 3000], [2, 2, 4, 2, 'R', 4000], [4, 2, 4, 4, 'R', 5000], [0, 2, 0, 4, 'W'], [0, 4, 2, 4, 'V', 1, -1], [2, 4, 4, 4, 'R', 6000],
    ], { kind: 'R', value: 4000 }, 'U');
    const r = await checkExam(p, 4, 'hurokaram', 1);
    console.log('2020-12-14/1', JSON.stringify(r));
  });
  it('2020-12-14/2: csomóponti, „tulajdonképpen számolás nélkül”, U7k = 2 V', async () => {
    const p = await examProblem([
      [0, 0, 2, 0, 'V', 1, -1], [2, 0, 4, 0, 'R', 1000], [4, 0, 4, 2, 'R', 2000], [0, 0, 0, 2, 'V', 2, -1], [2, 0, 2, 2, 'V', 3, -1],
      [0, 2, 2, 2, 'R', 3000], [2, 2, 4, 2, 'R', 4000], [2, 2, 2, 4, 'R', 7000], [4, 2, 4, 4, 'R', 5000], [0, 2, 0, 4, 'W'], [0, 4, 2, 4, 'V', 4, -1], [2, 4, 4, 4, 'R', 6000],
    ], { kind: 'R', value: 7000 }, 'U');
    const r = await checkExam(p, 2, 'csomoponti', 0);
    console.log('2020-12-14/2', JSON.stringify(r));
  });
  it('2021-01-11/1: csomóponti, Φ1 „nincs is szükség”, I2Ω = 4 V/3 Ω = 1,33 A', async () => {
    const p = await examProblem([
      [0, 0, 2, 0, 'R', 1], [2, 0, 4, 0, 'R', 4], [0, 0, 0, 2, 'R', 2], [2, 0, 2, 2, 'V', 1, -1], [4, 0, 4, 2, 'W'],
      [0, 2, 2, 2, 'R', 3], [2, 2, 4, 2, 'R', 5], [0, 2, 0, 4, 'V', 2, -1], [2, 2, 2, 4, 'V', 3, 1], [4, 2, 4, 4, 'I', 4, 1], [0, 4, 2, 4, 'W'], [2, 4, 4, 4, 'R', 6],
    ], { kind: 'R', value: 2 }, 'I');
    const r = await checkExam(p, 4 / 3, 'csomoponti', 0);
    console.log('2021-01-11/1', JSON.stringify(r));
  });
  it('2021-01-11/2: hurokáram, egy ismeretlen hurok („15J = 28”), U2Ω = 4,267 V', async () => {
    const p = await examProblem([
      [0, 0, 2, 0, 'R', 1], [2, 0, 4, 0, 'R', 4], [0, 0, 0, 2, 'R', 2], [2, 0, 2, 2, 'I', 1, 1], [4, 0, 4, 2, 'W'],
      [0, 2, 2, 2, 'R', 3], [2, 2, 4, 2, 'R', 5], [0, 2, 0, 4, 'V', 2, -1], [2, 2, 2, 4, 'I', 3, -1], [4, 2, 4, 4, 'I', 4, 1], [0, 4, 2, 4, 'W'], [2, 4, 4, 4, 'R', 6],
    ], { kind: 'R', value: 2 }, 'U');
    const r = await checkExam(p, 4.267, 'hurokaram', 1);
    console.log('2021-01-11/2', JSON.stringify(r));
  });
});
