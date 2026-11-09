import katex from 'katex';
import { describe, expect, it } from 'vitest';
import { generateProblem, type Problem, type Topic } from '../generator/generate';
import type { Level } from '../generator/values';
import { applicableMethods, solveWith, type Solution } from '../methods';
import { solve } from '../solver/analysis';
import { allElements } from '../solver/model';
import { removeElements, toNetlist } from '../solver/netlist';

const LEVELS: Level[] = ['alapozo', 'konnyu', 'kozepes', 'nehez'];

/**
 * A módszer minden válasza egyezik a kérdés MNA-ból számolt válaszával (1e-9 relatív tűréssel).
 * Egy módszer nem feltétlenül válaszol minden kérdésre (pl. a szuperpozíció a forrás teljesítményére
 * nem); azt, hogy együtt minden kérdésre van válasz, külön teszt nézi.
 */
function expectAnswersMatch(p: Problem, s: Solution) {
  expect(s.answers.length, `${p.topic} ${p.seed}: a módszer egyetlen kérdésre sem válaszol`).toBeGreaterThan(0);
  for (const a of s.answers) {
    const q = p.questions.find((x) => x.id === a.questionId)!;
    expect(Math.abs(a.value - q.answer), `${p.topic} ${p.seed} ${s.method} ${q.kind}`).toBeLessThanOrEqual(1e-9 * Math.max(1, Math.abs(q.answer)));
  }
}

/** Ha a módszer minden elemre ad értéket, azok egyeznek az MNA-val. */
function expectValuesMatch(p: Problem, s: Solution) {
  if (!s.values) return;
  const sol = solve(toNetlist(p.circuit).net)!;
  for (const [id, v] of s.values) {
    const ref = sol.elements.get(id)!;
    expect(Math.abs(v.U - ref.U)).toBeLessThanOrEqual(1e-9 * Math.max(1, Math.abs(ref.U)));
    expect(Math.abs(v.I - ref.I)).toBeLessThanOrEqual(1e-9 * Math.max(1, Math.abs(ref.I)));
  }
}

/** A lépések csak létező elemekre hivatkoznak. */
function expectValidHighlights(p: Problem, s: Solution) {
  const ids = new Set(allElements(p.circuit).map((e) => e.id));
  for (const st of s.steps) {
    const h = st.highlight;
    // Saját ábrája van (pl. a Thevenin-helyettesítő kép): annak az elemeire hivatkozik.
    const known = st.circuit ? new Set(allElements(st.circuit).map((e) => e.id)) : ids;
    for (const id of [...(h.elements ?? []), ...(h.dim ?? []), ...(h.groups ?? []).flatMap((g) => g.elements), ...(h.arrows ?? []).map((a) => a.element), ...(h.loops ?? []).flatMap((l) => l.elements.map((e) => e.id))]) {
      expect(known.has(id), `ismeretlen elem a kiemelésben: ${id}`).toBe(true);
    }
    expect(st.title.length).toBeGreaterThan(0);
    expect(st.text.length).toBeGreaterThan(0);
    // Minden egyenlet érvényes LaTeX (KaTeX hibát dobna), és nincs benne vezérlőkarakter.
    for (const src of [...(st.terms ?? []), st.subst, st.result?.symbol].filter((x): x is string => !!x)) {
      expect(src).not.toMatch(/[\u0000-\u001f]/);
      expect(() => katex.renderToString(src, { throwOnError: true, strict: false })).not.toThrow();
    }
    // A magyarázó szövegben nincs LaTeX-maradvány.
    expect(st.text).not.toMatch(/[\\{}_^]/);
  }
}

describe('alapozó módszerek: 1000+ feladat, eredmény = MNA', () => {
  const topics: Topic[] = ['ohm', 'eredo', 'oszto', 'halozat', 'kirchhoff'];
  it('minden alkalmazható módszer ugyanazt adja, mint az MNA', () => {
    let n = 0;
    for (const topic of topics) {
      for (const level of LEVELS) {
        for (let i = 0; i < 50; i++) {
          const p = generateProblem({ seed: `M${i}`, topic, level });
          const methods = applicableMethods(p);
          expect(methods.length, `${topic} ${level} M${i}: nincs alkalmazható módszer`).toBeGreaterThan(0);
          for (const m of methods) {
            const r = solveWith(p, m);
            if (!r.ok) throw new Error(r.reason);
            expectAnswersMatch(p, r.solution);
            expectValuesMatch(p, r.solution);
            expectValidHighlights(p, r.solution);
            n++;
          }
        }
      }
    }
    expect(n).toBeGreaterThanOrEqual(1000);
  });

  it('ZH "sok ellenállás": redukcióval (kiegyenlített hídnál az átló elhagyásával) megoldható', () => {
    for (let i = 0; i < 300; i++) {
      const p = generateProblem({ seed: `ZB${i}`, topic: 'zh', zhType: 'sok-ellenallas' });
      const r = solveWith(p, 'redukcio');
      if (!r.ok) throw new Error(`${p.seed}: ${r.reason}`);
      expectAnswersMatch(p, r.solution);
      expectValuesMatch(p, r.solution);
    }
  });
});

describe('Kirchhoff: ellentétes körüljárással ugyanaz az eredmény', () => {
  it('csomóponti és huroktörvény', () => {
    let kcl = 0;
    let kvl = 0;
    for (const level of LEVELS) {
      for (let i = 0; i < 60; i++) {
        const p = generateProblem({ seed: `K${i}`, topic: 'kirchhoff', level });
        const a = solveWith(p, 'kirchhoff');
        const b = solveWith(p, 'kirchhoff', { reverse: true });
        if (!a.ok || !b.ok) throw new Error('nem oldható meg');
        expect(b.solution.answers[0]!.value).toBeCloseTo(a.solution.answers[0]!.value, 12);
        expectAnswersMatch(p, b.solution);
        if (p.questions[0]!.node !== undefined) kcl++;
        else kvl++;
      }
    }
    expect(kcl).toBeGreaterThan(30);
    expect(kvl).toBeGreaterThan(30);
  });
});

describe('egyszerűsítés: az elhalványított elem elhagyása után az eredmény ugyanaz', () => {
  it('kiegyenlített híd átlója', () => {
    let checked = 0;
    for (let i = 0; i < 300; i++) {
      const p = generateProblem({ seed: `ZB${i}`, topic: 'zh', zhType: 'sok-ellenallas' });
      const r = solveWith(p, 'redukcio');
      if (!r.ok) continue;
      const dimmed = r.solution.steps.flatMap((s) => s.highlight.dim ?? []);
      if (dimmed.length === 0) continue;
      const net = toNetlist(p.circuit).net;
      const full = solve(net)!;
      const reduced = solve(removeElements(net, dimmed))!;
      const t = p.questions[0]!.target!;
      expect(reduced.elements.get(t)!.I).toBeCloseTo(full.elements.get(t)!.I, 9);
      checked++;
    }
    expect(checked).toBeGreaterThan(20);
  });
});

describe('a módszer nem alkalmazható, ha nem illik a feladathoz', () => {
  it('többforrású hálózatra a redukció nem ad megoldást', () => {
    const p = generateProblem({ seed: 'X1', topic: 'tobbforras', level: 'kozepes' });
    expect(solveWith(p, 'redukcio').ok).toBe(false);
  });
});

describe('többforrásos módszerek: minden témakör és szint, eredmény = MNA', () => {
  const topics: Topic[] = ['ohm', 'eredo', 'kirchhoff', 'oszto', 'halozat', 'valodi-gen', 'thevenin', 'tobbforras'];
  it('minden alkalmazható módszer válasza és elemértéke egyezik az MNA-val; együtt minden kérdésre van válasz', () => {
    let n = 0;
    const perMethod = new Map<string, number>();
    for (const topic of topics) {
      for (const level of LEVELS) {
        for (let i = 0; i < 30; i++) {
          const p = generateProblem({ seed: `MM${i}`, topic, level });
          const covered = new Set<string>();
          for (const m of applicableMethods(p)) {
            const r = solveWith(p, m);
            if (!r.ok) throw new Error(r.reason);
            expectAnswersMatch(p, r.solution);
            expectValuesMatch(p, r.solution);
            expectValidHighlights(p, r.solution);
            for (const a of r.solution.answers) covered.add(a.questionId);
            perMethod.set(m, (perMethod.get(m) ?? 0) + 1);
            n++;
          }
          for (const q of p.questions) if (q.kind !== 'table') expect(covered.has(q.id), `${topic} ${level} MM${i}: ${q.kind} kérdésre nincs módszer`).toBe(true);
        }
      }
    }
    expect(n).toBeGreaterThan(1000);
    for (const m of ['hurokaram', 'csomoponti', 'szuperpozicio', 'thevenin']) expect(perMethod.get(m) ?? 0, m).toBeGreaterThan(100);
  });

  it('ZH-szint, 1000 feladat: hurokáram és csomóponti potenciál mindig megoldja, egyezik az MNA-val', () => {
    for (let i = 0; i < 1000; i++) {
      const p = generateProblem({ seed: `ZM${i}`, topic: 'zh' });
      for (const m of ['hurokaram', 'csomoponti'] as const) {
        const r = solveWith(p, m);
        if (!r.ok) throw new Error(`${p.seed} ${m}: ${r.reason}`);
        expectAnswersMatch(p, r.solution);
        expectValuesMatch(p, r.solution);
      }
    }
  });
});

describe('egyszerűsítés: áramforrással soros / feszültségforrással párhuzamos elem', () => {
  it('az elhalványított elem kiiktatása után a kérdéses eredmény ugyanaz', async () => {
    const { findTricks } = await import('../simplify/tricks');
    const { mergeNodes } = await import('../solver/netlist');
    let checked = 0;
    for (let i = 0; i < 400; i++) {
      const p = generateProblem({ seed: `TR${i}`, topic: 'zh', zhType: 'sok-forras' });
      const net = toNetlist(p.circuit).net;
      const t = p.questions[0]!.target!;
      const ref = solve(net)!.elements.get(t)!;
      for (const tr of findTricks(net).filter((x) => x.dim && !x.elements.includes(t))) {
        // Áramforrással soros ellenállás → rövidzár; feszültségforrással párhuzamos → szakadás.
        let reduced = net;
        for (const id of tr.elements) {
          const e = reduced.elements.find((x) => x.id === id)!;
          reduced = tr.kind === 'soros-aramforras' ? mergeNodes(removeElements(reduced, [id]), e.a, e.b).net : removeElements(reduced, [id]);
        }
        const r = solve(reduced)!.elements.get(t)!;
        expect(r.I).toBeCloseTo(ref.I, 9);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(50);
  });
});

describe('valódi generátor: terhelési karakterisztika', () => {
  it('rövidzár, illesztés, üresjárás', async () => {
    const { loadPoint } = await import('../methods/realsource');
    const [U0, Rb] = [12, 2];
    expect(loadPoint(U0, Rb, 0).Uk).toBe(0);
    expect(loadPoint(U0, Rb, 0).It).toBeCloseTo(U0 / Rb, 12);
    expect(loadPoint(U0, Rb, Rb).P).toBeCloseTo((U0 * U0) / (4 * Rb), 12);
    for (const r of [0.5, 1, 3, 10]) expect(loadPoint(U0, Rb, r).P).toBeLessThanOrEqual(loadPoint(U0, Rb, Rb).P);
    expect(loadPoint(U0, Rb, Infinity).Uk).toBe(U0);
    expect(loadPoint(U0, Rb, 1e12).Uk).toBeCloseTo(U0, 6);
  });
});

describe('Thevenin-módszer: a helyettesítő kör bármely terhelésre egyezik az eredetivel', () => {
  it('Uth, Rth a módszer saját számolásából', () => {
    let n = 0;
    for (const level of ['konnyu', 'kozepes', 'nehez'] as Level[]) {
      for (let i = 0; i < 40; i++) {
        const p = generateProblem({ seed: `TV${i}`, topic: 'thevenin', level });
        const r = solveWith(p, 'thevenin');
        if (!r.ok) throw new Error(r.reason);
        const get = (k: string) => r.solution.answers.find((a) => p.questions.find((q) => q.id === a.questionId)!.kind === k)!.value;
        const [Uth, Rth, In] = [get('Uth'), get('Rth'), get('In')];
        expect(Uth).toBeCloseTo(Rth * In, 9);
        const load = allElements(p.circuit).find((e) => e.role === 'load')!;
        const net = toNetlist(p.circuit).net;
        for (const RL of [0.5, 3, 25]) {
          const changed = { ...net, elements: net.elements.map((e) => (e.id === load.id ? { ...e, value: RL } : e)) };
          expect(Uth / (Rth + RL)).toBeCloseTo(solve(changed)!.elements.get(load.id)!.I, 9);
        }
        n++;
      }
    }
    expect(n).toBe(120);
  });
});
