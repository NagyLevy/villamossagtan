import { describe, expect, it } from 'vitest';
import { generateProblem, type Topic } from '../generator/generate';
import { samples } from '../generator/samples';
import { circuitIssues, geometryIssues, seriesSourcePairs } from '../generator/validate';
import type { Level } from '../generator/values';
import { boxesOverlap, computeLayout, type Layout } from '../render/layout';
import { renderCircuitSvg } from '../render/svg';
import { solve } from '../solver/analysis';
import type { Circuit } from '../solver/model';
import { allElements } from '../solver/model';
import { toNetlist } from '../solver/netlist';

function checkLayout(c: Circuit, layout: Layout) {
  expect(layout.collisions).toEqual([]);
  // Egy ágon belül az elemek nem érnek egymásba, és nem lógnak ki az ágból.
  const byBranch = new Map<string, typeof layout.elements>();
  for (const g of layout.elements) byBranch.set(g.branchId, [...(byBranch.get(g.branchId) ?? []), g]);
  for (const els of byBranch.values()) {
    for (let i = 0; i < els.length; i++) for (let j = i + 1; j < els.length; j++) expect(boxesOverlap(els[i]!.body, els[j]!.body, 4)).toBe(false);
  }
  // A feliratok nem takarják egymást.
  const labels = layout.elements.map((g) => g.label.box);
  for (let i = 0; i < labels.length; i++) for (let j = i + 1; j < labels.length; j++) expect(boxesOverlap(labels[i]!, labels[j]!)).toBe(false);
  expect(layout.elements).toHaveLength(allElements(c).length);
}

/** A rajzon lévő nyilak iránya egyezik a megoldó által használt iránnyal. */
function checkArrowsMatchSolver(c: Circuit, layout: Layout) {
  const map = toNetlist(c);
  const sol = solve(map.net)!;
  for (const br of c.branches) {
    const nodes = map.branchNodes.get(br.id)!;
    br.elements.forEach((el, i) => {
      const geom = layout.elements.find((g) => g.el.id === el.id)!;
      const fromNode = nodes[i]!;
      const toNode = nodes[i + 1]!;
      if (el.kind === 'V') {
        const a = geom.arrow!;
        const along = (a.to.x - a.from.x) * geom.axis.x + (a.to.y - a.from.y) * geom.axis.y;
        // A feszültség nyila (Dr. Lilik Ferenc jelölése): a nagyobb potenciáltól (talp) a kisebb felé (hegy),
        // a különbség éppen a forrásfeszültség.
        const [high, low] = along > 0 ? [fromNode, toNode] : [toNode, fromNode];
        expect(sol.nodeVoltage[high]! - sol.nodeVoltage[low]!).toBeCloseTo(el.value, 9);
      }
      if (el.kind === 'I') {
        const a = geom.arrow!;
        const along = (a.to.x - a.from.x) * geom.axis.x + (a.to.y - a.from.y) * geom.axis.y;
        const net = map.net.elements.find((e) => e.id === el.id)!;
        // A kör melletti nyíl az áram irányába mutat: a megoldóban a forrásáram a nyíl farkától a hegye felé folyik.
        expect(net.a).toBe(along > 0 ? fromNode : toNode);
        expect(sol.elements.get(el.id)!.I).toBeCloseTo(el.value, 12);
      }
    });
  }
}

describe('mintaáramkörök (fix sablonok)', () => {
  for (const s of samples()) {
    it(s.name, () => {
      expect(geometryIssues(s.circuit)).toEqual([]);
      expect(circuitIssues(s.circuit)).toEqual([]);
      expect(seriesSourcePairs(toNetlist(s.circuit).net)).toEqual([]);
      const layout = computeLayout(s.circuit);
      checkLayout(s.circuit, layout);
      checkArrowsMatchSolver(s.circuit, layout);
      const svg = renderCircuitSvg(s.circuit);
      expect(svg.startsWith('<svg')).toBe(true);
      expect((svg.match(/data-id="/g) ?? []).length).toBe(allElements(s.circuit).length);
    });
  }
});

describe('generált áramkörök rajza', () => {
  const topics: Topic[] = ['ohm', 'eredo', 'kirchhoff', 'oszto', 'halozat', 'valodi-gen', 'thevenin', 'tobbforras', 'zh'];
  const levels: Level[] = ['alapozo', 'konnyu', 'kozepes', 'nehez'];

  it('1000+ feladat: nincs ütközés, a nyilak iránya egyezik a számolással', () => {
    let n = 0;
    for (const topic of topics) {
      for (const level of levels) {
        for (let i = 0; i < 30; i++) {
          const p = generateProblem({ seed: `RD${i}`, topic, level });
          const layout = computeLayout(p.circuit);
          checkLayout(p.circuit, layout);
          checkArrowsMatchSolver(p.circuit, layout);
          n++;
        }
      }
    }
    expect(n).toBeGreaterThanOrEqual(1000);
  });

  it('a forrásoknál sehol nincs + vagy − jel', () => {
    for (let i = 0; i < 200; i++) {
      const p = generateProblem({ seed: `PM${i}`, topic: 'zh' });
      const svg = renderCircuitSvg(p.circuit);
      const texts = [...svg.matchAll(/<text[^>]*>([^<]*)<\/text>/g)].map((m) => m[1]!);
      for (const t of texts) expect(t).not.toMatch(/[+−]/);
    }
  });

  it('IEC-jelek: feszültségforrásnál a vonal a vezeték irányában, áramforrásnál merőlegesen; a nyíl a kör mellett', () => {
    let checked = 0;
    for (let i = 0; i < 130; i++) {
      const p = generateProblem({ seed: `IEC${i}`, topic: 'zh' });
      const layout = computeLayout(p.circuit);
      const svg = renderCircuitSvg(p.circuit, {}, layout);
      for (const g of layout.elements) {
        if (g.el.kind === 'R') continue;
        const group = new RegExp(`data-id="${g.el.id}">(.*?)</g>`).exec(svg)![1]!;
        const [, y1, , y2] = /class="sym-line" d="M([\d.-]+) ([\d.-]+)L([\d.-]+) ([\d.-]+)"/.exec(group)!.slice(1).map(Number) as [number, number, number, number];
        const lineIsHorizontal = Math.abs(y1 - y2) < 1e-6;
        const branchIsHorizontal = g.orient === 'h';
        expect(lineIsHorizontal === branchIsHorizontal).toBe(g.el.kind === 'V');
        // A nyíl teljes egészében a körön kívül van.
        const a = g.arrow!;
        for (const pt of [a.from, a.to]) {
          const dist = Math.abs((pt.x - g.center.x) * -g.axis.y + (pt.y - g.center.y) * g.axis.x);
          expect(dist).toBeGreaterThan(g.halfWidth);
        }
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(300);
  });

  it('a kérdéses elem kiemelést kap', () => {
    const p = generateProblem({ seed: 'HL1', topic: 'zh' });
    const target = p.questions[0]!.target!;
    const svg = renderCircuitSvg(p.circuit, { targets: [target] });
    expect(svg).toMatch(new RegExp(`class="[^"]*is-target[^"]*" data-id="${target}"`));
  });

  it('kapcsok (A, B) kis körrel és betűvel', () => {
    const p = generateProblem({ seed: 'AB1', topic: 'eredo', level: 'konnyu' });
    const svg = renderCircuitSvg(p.circuit);
    expect(svg).toContain('data-terminal="A"');
    expect(svg).toContain('data-terminal="B"');
  });
});

describe('kiemelések geometriája', () => {
  it('a Kirchhoff-hurok zárt alakzat a vezetékekkel együtt, van körüljárási iránya', async () => {
    const { loopGeometry } = await import('../render/overlay');
    let n = 0;
    for (let i = 0; i < 200; i++) {
      const p = generateProblem({ seed: `LG${i}`, topic: 'kirchhoff', level: 'kozepes' });
      const q = p.questions[0]!;
      if (!q.loop) continue;
      const ctx = { circuit: p.circuit, layout: computeLayout(p.circuit), map: toNetlist(p.circuit) };
      const geo = loopGeometry(ctx, { elements: q.loop })!;
      expect(geo).not.toBeNull();
      // Zárt: minden szakaszvégpont legalább két szakaszhoz tartozik.
      const deg = new Map<string, number>();
      for (const s of geo.segments) for (const pt of [s.a, s.b]) deg.set(`${pt.x},${pt.y}`, (deg.get(`${pt.x},${pt.y}`) ?? 0) + 1);
      for (const d of deg.values()) expect(d).toBeGreaterThanOrEqual(2);
      // Ellentétes körüljárásnál a forgásirány megfordul.
      const rev = loopGeometry(ctx, { elements: q.loop.map((x) => ({ id: x.id, sign: (x.sign * -1) as 1 | -1 })).reverse() })!;
      expect(rev.clockwise).toBe(!geo.clockwise);
      n++;
    }
    expect(n).toBeGreaterThan(50);
  });
});

describe('áramlás-animáció adatai', () => {
  it('minden rácspontban teljesül a csomóponti törvény, és az elemes ágakban az elem árama folyik', async () => {
    const { flowSegments, stateCurrents } = await import('../render/flow');
    for (let i = 0; i < 200; i++) {
      const p = generateProblem({ seed: `FL${i}`, topic: i % 2 ? 'zh' : 'tobbforras', level: 'kozepes' });
      const layout = computeLayout(p.circuit);
      const cur = stateCurrents(p.circuit, {});
      const segs = flowSegments(p.circuit, layout, cur);
      // Pontonként: befolyó − kifolyó áramok (csak a rácspontokon, ahol szakaszok találkoznak).
      const sum = new Map<string, number>();
      const key = (q: { x: number; y: number }) => `${q.x.toFixed(1)},${q.y.toFixed(1)}`;
      const gridKeys = new Set(layout.wires.flatMap((w) => [w.a, w.b]).map(key));
      for (const s of segs) {
        sum.set(key(s.a), (sum.get(key(s.a)) ?? 0) - s.I);
        sum.set(key(s.b), (sum.get(key(s.b)) ?? 0) + s.I);
      }
      // Az elemek két végén (szakaszvég, ahol elem kezdődik) az áram az elemen folytatódik:
      // ott nem nulla az összeg, ezért csak a csomópontokat (≥ 3 szakasz) ellenőrizzük.
      const count = new Map<string, number>();
      for (const s of segs) for (const q of [s.a, s.b]) count.set(key(q), (count.get(key(q)) ?? 0) + 1);
      for (const [k, v] of sum) if ((count.get(k) ?? 0) >= 3 && gridKeys.has(k)) expect(Math.abs(v)).toBeLessThan(1e-9);
    }
  });
});
