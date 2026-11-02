// Soros-párhuzamos redukció, eredő ellenállás, feszültség- és áramosztás.
// Az összevonás mindig a mérési pont (a kapcsok / a forrás) felé haladva történik: először a
// legtávolabbi összevonható csoport. A visszafelé lépés (osztás) előjelhelyesen számol, így a
// teljes hálózatanalízis táblázata is ebből jön.

import type { Problem } from '../generator/generate';
import { valueLabel, type Question } from '../generator/questions';
import { zeroCurrentResistors } from '../simplify/seriesParallel';
import type { Circuit, CircuitElement, NetElement, Netlist } from '../solver/model';
import { allElements } from '../solver/model';
import { toNetlist } from '../solver/netlist';
import { formatQuantity, type Unit } from '../units';
import { texElement, texNum, texOf, texQty } from './tex';
import { redrawSequence } from './redraw';
import { transformAndReduce } from './stardelta';
import type { GroupRef, Highlight, MethodResult, Step, TableRow } from './types';

/** Egy (eredeti vagy összevont) kétpólus a redukció közben. */
export interface Edge {
  /** Index a mennyiségek jeléhez: "R3" eredeti elemnél, "e2" eredőnél. */
  key: string;
  a: number;
  b: number;
  R: number;
  /** Az eredeti ellenállások, amelyekből áll. */
  leaves: string[];
  kind: 'leaf' | 'series' | 'parallel';
  /** Gyerekek és irányuk a szülő a→b irányához képest. */
  children: { edge: Edge; o: 1 | -1 }[];
}

export interface Reduction {
  root: Edge;
  /** Az összevonások létrehozási sorrendben. */
  order: Edge[];
}

/** Ellenállás jele LaTeX-ben. */
export function rSym(e: Edge): string {
  return e.kind === 'leaf' ? texElement(e.key) : `R_{${e.key}}`;
}

/** Feszültség / áram jele: U_{R3}, I_{e2}. */
export function qSym(q: 'U' | 'I', e: Edge): string {
  return e.kind === 'leaf' ? texOf(q, e.key) : `${q}_{${e.key}}`;
}

/**
 * Redukció a t1–t2 kapcsok felől. null, ha a hálózat nem soros-párhuzamos.
 * Lógó ágakat (egyik végük szabad) elhagyja: azokon nem folyik áram.
 */
export function reduceSP(resistors: NetElement[], t1: number, t2: number): Reduction | null {
  let edges: Edge[] = resistors.map((e) => ({ key: e.id, a: e.a, b: e.b, R: e.value, leaves: [e.id], kind: 'leaf', children: [] }));
  if (edges.length === 0 || t1 === t2) return null;

  // Távolság a kapcsoktól (élszám), ez adja az összevonás sorrendjét: messzebbről befelé.
  const dist = new Map<number, number>([
    [t1, 0],
    [t2, 0],
  ]);
  const queue = [t1, t2];
  while (queue.length) {
    const n = queue.shift()!;
    for (const e of edges) {
      const other = e.a === n ? e.b : e.b === n ? e.a : null;
      if (other !== null && !dist.has(other)) {
        dist.set(other, dist.get(n)! + 1);
        queue.push(other);
      }
    }
  }
  const d = (n: number) => dist.get(n) ?? 0;

  const order: Edge[] = [];
  let counter = 0;
  const isTerminal = (n: number) => n === t1 || n === t2;

  for (let guard = 0; guard < 500; guard++) {
    edges = edges.filter((e) => e.a !== e.b);
    const incident = new Map<number, Edge[]>();
    for (const e of edges) {
      incident.set(e.a, [...(incident.get(e.a) ?? []), e]);
      incident.set(e.b, [...(incident.get(e.b) ?? []), e]);
    }
    // Lógó ág: nem kapocs, csak egy él csatlakozik.
    const dangling = [...incident.entries()].find(([n, es]) => !isTerminal(n) && es.length === 1);
    if (dangling) {
      edges = edges.filter((e) => e !== dangling[1][0]);
      continue;
    }
    if (edges.length === 1 && ((edges[0]!.a === t1 && edges[0]!.b === t2) || (edges[0]!.a === t2 && edges[0]!.b === t1))) {
      return { root: edges[0]!, order };
    }

    type Cand = { prio: number; apply: () => void };
    const cands: Cand[] = [];

    // Párhuzamos csoportok (azonos végpontok).
    const groups = new Map<string, Edge[]>();
    for (const e of edges) {
      const k = e.a < e.b ? `${e.a}-${e.b}` : `${e.b}-${e.a}`;
      groups.set(k, [...(groups.get(k) ?? []), e]);
    }
    for (const g of groups.values()) {
      if (g.length < 2) continue;
      cands.push({
        prio: Math.max(d(g[0]!.a), d(g[0]!.b)),
        apply: () => {
          const first = g[0]!;
          const R = 1 / g.reduce((s, e) => s + 1 / e.R, 0);
          const ne: Edge = {
            key: `e${++counter}`,
            a: first.a,
            b: first.b,
            R,
            leaves: g.flatMap((e) => e.leaves),
            kind: 'parallel',
            children: g.map((e) => ({ edge: e, o: e.a === first.a ? 1 : -1 })),
          };
          edges = [...edges.filter((e) => !g.includes(e)), ne];
          order.push(ne);
        },
      });
    }

    // Soros láncok: nem kapocs, kétfokú csomópontokon át a lehető leghosszabban.
    const seen = new Set<number>();
    for (const [v, es] of incident) {
      if (isTerminal(v) || es.length !== 2 || seen.has(v)) continue;
      // A lánc egyik végéig, aztán vissza a másik végéig.
      const walk = (start: number, via: Edge): { nodes: number[]; edges: Edge[] } => {
        const nodes = [start];
        const path: Edge[] = [];
        let cur = start;
        let e = via;
        for (;;) {
          path.push(e);
          const next = e.a === cur ? e.b : e.a;
          nodes.push(next);
          const ns = incident.get(next)!;
          if (isTerminal(next) || ns.length !== 2 || next === start) break;
          seen.add(next);
          cur = next;
          e = ns[0] === e ? ns[1]! : ns[0]!;
        }
        return { nodes, edges: path };
      };
      seen.add(v);
      const left = walk(v, es[0]!);
      const right = walk(v, es[1]!);
      // Csomópontok a lánc egyik végétől a másikig.
      const nodes = [...left.nodes.slice(1).reverse(), ...right.nodes];
      const chain = [...left.edges.reverse(), ...right.edges];
      const interior = nodes.slice(1, -1);
      cands.push({
        prio: Math.max(...interior.map(d)),
        apply: () => {
          const ne: Edge = {
            key: `e${++counter}`,
            a: nodes[0]!,
            b: nodes[nodes.length - 1]!,
            R: chain.reduce((s, e) => s + e.R, 0),
            leaves: chain.flatMap((e) => e.leaves),
            kind: 'series',
            children: chain.map((e, i) => ({ edge: e, o: e.a === nodes[i] ? 1 : -1 })),
          };
          edges = [...edges.filter((e) => !chain.includes(e)), ne];
          order.push(ne);
        },
      });
    }

    if (cands.length === 0) return null;
    cands.sort((x, y) => y.prio - x.prio);
    cands[0]!.apply();
  }
  return null;
}

/**
 * Előjelhelyes értékek lefelé: ha egy él U_ab feszültsége ismert, a gyerekeké soros ágban az
 * áramból, párhuzamos ágban a feszültségből adódik.
 */
export function distribute(root: Edge, Uroot: number): Map<Edge, { U: number; I: number }> {
  const out = new Map<Edge, { U: number; I: number }>();
  const visit = (e: Edge, U: number) => {
    const I = U / e.R;
    out.set(e, { U, I });
    if (e.kind === 'series') for (const c of e.children) visit(c.edge, c.o * I * c.edge.R);
    if (e.kind === 'parallel') for (const c of e.children) visit(c.edge, c.o * U);
  };
  visit(root, Uroot);
  return out;
}

export function findPath(root: Edge, leafId: string): Edge[] {
  const path: Edge[] = [];
  const dfs = (e: Edge): boolean => {
    path.push(e);
    if (e.kind === 'leaf' && e.key === leafId) return true;
    for (const c of e.children) if (dfs(c.edge)) return true;
    path.pop();
    return false;
  };
  return dfs(root) ? path : [];
}

export function groupOf(e: Edge, tone: GroupRef['tone']): GroupRef {
  return { elements: e.leaves, label: `${e.kind === 'leaf' ? e.key : `R${e.key}`} = ${texFree(e.R, 'Ω')}`, tone };
}

function texFree(x: number, unit: Unit): string {
  return formatQuantity(x, unit);
}

/** Eredő vagy elem neve sima szövegben: R3, Re2. */
function plain(e: Edge): string {
  return e.kind === 'leaf' ? e.key : `R${e.key}`;
}

/**
 * Az összevonási lépések. Ha `base` (a rajz) adott, minden lépéshez elkészül az újrarajzolt,
 * egyszerűsített áramkör is (az "Áramkör újrarajzolása" beállításhoz); `extra` a kiemelésbe kerül.
 */
export function reductionSteps(red: Reduction, base?: Circuit, extra: Highlight = {}): Step[] {
  const drawn = base ? redrawSequence(base, red) : [];
  return red.order.map((e, k) => {
    const parts = e.children.map((c) => rSym(c.edge));
    const values = e.children.map((c) => texNum(c.edge.R));
    const series = e.kind === 'series';
    const terms = series
      ? [`${rSym(e)} =`, ...parts.map((p, i) => (i === 0 ? p : `+ ${p}`))]
      : e.children.length === 2
        ? [`${rSym(e)} =`, `${parts[0]} \\times ${parts[1]}`, `= \\frac{${parts[0]} \\cdot ${parts[1]}}{${parts[0]} + ${parts[1]}}`]
        : [`\\frac{1}{${rSym(e)}} =`, ...parts.map((p, i) => `${i === 0 ? '' : '+ '}\\frac{1}{${p}}`)];
    const subst = series
      ? `${rSym(e)} = ${values.join(' + ')}`
      : e.children.length === 2
        ? `${rSym(e)} = \\frac{${values[0]} \\cdot ${values[1]}}{${values[0]} + ${values[1]}}`
        : `\\frac{1}{${rSym(e)}} = ${values.map((v) => `\\frac{1}{${v}}`).join(' + ')}`;
    const names = e.children.map((c) => (c.edge.kind === 'leaf' ? c.edge.key : `R${c.edge.key}`)).join(', ');
    return {
      title: series ? 'Soros összevonás' : 'Párhuzamos összevonás',
      text: series
        ? `${names} sorosan kapcsolódnak: ugyanaz az áram folyik rajtuk, az ellenállásuk összeadódik.`
        : `${names} párhuzamosan kapcsolódnak: ugyanaz a feszültség jut rájuk, a vezetésük adódik össze.`,
      terms,
      subst,
      result: { symbol: rSym(e), value: e.R, unit: 'Ω' },
      highlight: {
        elements: e.leaves,
        groups: [groupOf(e, 'accent'), ...e.children.filter((c) => c.edge.kind !== 'leaf').map((c) => groupOf(c.edge, 'result'))],
      },
      ...(drawn[k] ? { redraw: redrawOf(drawn[k]!, e, extra) } : {}),
    } satisfies Step;
  });
}

/** Az újrarajzolt áramkör kiemeléssel: az új eredő ellenállás (a felirata az elemen: "Re1 = 6 Ω"). */
function redrawOf(d: { circuit: Circuit; keep: string }, e: Edge, extra: Highlight): NonNullable<Step['redraw']> {
  return { circuit: d.circuit, highlight: { ...extra, elements: [d.keep] }, kind: e.kind === 'parallel' ? 'parallel' : 'series' };
}

/** A teljes összevonás utáni rajz (egyetlen eredő): az eredő és a forrás lépéseihez. */
export function finalRedraw(base: Circuit | undefined, red: Reduction, extra: Highlight = {}): Partial<Pick<Step, 'redraw'>> {
  if (!base || red.order.length === 0) return {};
  const last = redrawSequence(base, red).at(-1)!;
  return { redraw: { circuit: last.circuit, highlight: { ...extra, elements: [last.keep] } } };
}

function nodeOfPoint(p: Problem, pointId: number): number {
  return toNetlist(p.circuit).pointNode.get(pointId)!;
}

/**
 * Redukciós megoldás: eredő ellenállás A–B között (forrás nélkül), vagy egyforrású hálózat
 * eredője a forrás felől, majd feszültség-/áramosztással a kérdéses elem(ek) értéke.
 */
export function solveByReduction(p: Problem): MethodResult {
  const map = toNetlist(p.circuit);
  const net = map.net;
  const sources = net.elements.filter((e) => e.kind !== 'R');
  const els = new Map(allElements(p.circuit).map((e) => [e.id, e]));
  const steps: Step[] = [];

  if (sources.length > 1) return { ok: false, reason: 'Több forrás van: ehhez hurokáram, csomóponti potenciál vagy szuperpozíció kell.' };

  let t1: number;
  let t2: number;
  if (sources.length === 0) {
    if (!p.circuit.terminals) return { ok: false, reason: 'Nincs kijelölt A–B kapocspár.' };
    t1 = nodeOfPoint(p, p.circuit.terminals.a);
    t2 = nodeOfPoint(p, p.circuit.terminals.b);
    steps.push({
      title: 'Kiindulás',
      text: 'Az A és B kapcsok közötti eredőt keressük. A kapcsoktól legtávolabbi résztől indulva, a mérési pont felé haladva vonjuk össze az ellenállásokat.',
      highlight: {},
    });
  } else {
    // A forrás felől nézett hálózat: a forrás két kivezetése a két kapocs.
    const s = sources[0]!;
    t1 = s.b;
    t2 = s.a;
    const src = els.get(s.id)!;
    steps.push({
      title: 'Kiindulás',
      text: `A hálózatot egyetlen ${src.kind === 'V' ? 'feszültség' : 'áram'}forrás (${valueLabel(src)}) táplálja. Előbb a forrás felől nézett eredő ellenállást határozzuk meg, a forrástól legtávolabbi résztől befelé haladva.`,
      highlight: { elements: [s.id] },
    });
  }

  let resistors = net.elements.filter((e) => e.kind === 'R');
  let red = reduceSP(resistors, t1, t2);
  if (!red) {
    // Kiegyenlített híd: az árammentes átlót elhagyva már soros-párhuzamos.
    const zero = zeroCurrentResistors(net, t1, t2);
    if (zero.length) {
      resistors = resistors.filter((e) => !zero.includes(e.id));
      red = reduceSP(resistors, t1, t2);
      if (red) {
        steps.push({
          title: 'Kiegyenlített híd',
          text: `A híd kiegyenlített: a karok ellenállásainak aránya megegyezik, ezért az átló két végpontja azonos potenciálon van, és ${zero.join(', ')} árama nulla. Az elem elhagyható.`,
          highlight: { dim: zero, elements: zero },
          note: 'Kiegyenlített hídnál az átlóban nem folyik áram.',
        });
      }
    }
  }
  if (!red) return { ok: false, reason: 'A hálózat soros-párhuzamos összevonással nem redukálható.' };

  steps.push(...reductionSteps(red, p.circuit));
  const root = red.root;
  const fin = finalRedraw(p.circuit, red);
  const answers: { questionId: string; value: number }[] = [];
  const reqLabel = sources.length === 0 ? 'R_{AB}' : 'R_{e}';
  steps.push({
    title: 'Eredő ellenállás',
    text: sources.length === 0 ? 'Az A és B kapcsok közötti eredő ellenállás.' : 'A forrás felől nézett eredő ellenállás.',
    terms: [`${reqLabel} = ${rSym(root)}`],
    result: { symbol: reqLabel, value: root.R, unit: 'Ω' },
    highlight: { groups: [groupOf(root, 'result')] },
    ...fin,
  });
  for (const q of p.questions) if (q.kind === 'Req') answers.push({ questionId: q.id, value: root.R });

  if (sources.length === 0) return { ok: true, solution: { method: 'redukcio', title: 'Eredő ellenállás', steps, answers } };

  // A forrás: a hálózaton át a forrás b kivezetésétől az a felé.
  const s = sources[0]!;
  // A gyökér iránya: a = t1 = s.b esetén U_root = φ(s.b) − φ(s.a).
  const sameDir = root.a === s.b;
  let Uroot: number;
  if (s.kind === 'V') {
    Uroot = sameDir ? s.value : -s.value;
    const I = s.value / root.R;
    steps.push({
      title: 'A forrás árama',
      text: 'Ohm törvénye az eredőre: a forrás feszültsége az eredő ellenálláson esik.',
      terms: [`I = \\frac{U_g}{${reqLabel}}`],
      subst: `I = \\frac{${texQty(s.value, 'V')}}{${texQty(root.R, 'Ω')}}`,
      result: { symbol: 'I', value: I, unit: 'A' },
      highlight: { elements: [s.id], groups: [groupOf(root, 'result')] },
      ...fin,
    });
  } else {
    const U = s.value * root.R;
    Uroot = sameDir ? U : -U;
    steps.push({
      title: 'A forrás feszültsége',
      text: 'Az áramforrás árama az eredő ellenálláson folyik át; a rajta eső feszültség Ohm törvényéből adódik.',
      terms: [`U = I_g \\cdot ${reqLabel}`],
      subst: `U = ${texQty(s.value, 'A')} \\cdot ${texQty(root.R, 'Ω')}`,
      result: { symbol: 'U', value: U, unit: 'V' },
      highlight: { elements: [s.id], groups: [groupOf(root, 'result')] },
      ...fin,
    });
  }

  const values = distribute(root, Uroot);
  const leafValues = new Map<string, { U: number; I: number }>();
  for (const [e, v] of values) if (e.kind === 'leaf') leafValues.set(e.key, v);
  // A forrás saját értékei: a hálózaton át b→a irányban folyó áram a forráson a→b irányban folyik.
  const Inet = (sameDir ? 1 : -1) * values.get(root)!.I; // s.b → s.a irányú áram a hálózatban
  const Unet = (sameDir ? 1 : -1) * values.get(root)!.U; // φ(s.b) − φ(s.a)
  leafValues.set(s.id, { U: -Unet, I: Inet });

  // Visszafelé a kérdéses elem(ek)ig: osztók.
  const targets = [...new Set(p.questions.filter((q) => (q.kind === 'U' || q.kind === 'I' || q.kind === 'P') && q.target && els.get(q.target)?.kind === 'R').map((q) => q.target!))];
  const shown = new Set<Edge>();
  for (const t of targets) {
    const path = findPath(root, t);
    for (let i = 0; i + 1 < path.length; i++) {
      const parent = path[i]!;
      const child = path[i + 1]!;
      if (shown.has(child)) continue;
      shown.add(child);
      steps.push(dividerStep(parent, child, values));
    }
  }

  for (const q of p.questions) {
    if (!q.target) continue;
    const v = leafValues.get(q.target);
    if (!v) continue;
    const raw = q.kind === 'U' ? v.U : q.kind === 'I' ? v.I : q.kind === 'P' ? v.U * v.I : NaN;
    if (Number.isNaN(raw)) continue;
    answers.push({ questionId: q.id, value: q.magnitudeOnly ? Math.abs(raw) : raw });
  }

  const table = p.questions.some((q) => q.kind === 'table');
  if (table) steps.push(...tableSteps(p, leafValues, els));

  // Záró lépés: az eredmény(ek) az ábrán, nyíllal.
  const arrowIds = table ? [...leafValues.keys()].filter((id) => els.get(id)?.kind === 'R') : targets;
  const finals = p.questions.filter((q) => q.kind !== 'Req' && q.kind !== 'table');
  // Ohm törvénye a kérdéses elemre: az osztóból kapott mennyiségből a kérdezett.
  const single = finals.length === 1 && finals[0]!.target ? finals[0]! : null;
  const sv = single ? leafValues.get(single.target!) : undefined;
  const R = single ? els.get(single.target!)!.value : NaN;
  const ohm =
    single && sv && single.kind === 'I'
      ? { terms: [`${texOf('I', single.target!)} =`, `\\frac{${texOf('U', single.target!)}}{${texElement(single.target!)}}`], subst: `${texOf('I', single.target!)} = \\frac{${texQty(Math.abs(sv.U), 'V')}}{${texQty(R, 'Ω')}}` }
      : single && sv && single.kind === 'U'
        ? { terms: [`${texOf('U', single.target!)} =`, `${texOf('I', single.target!)} \\cdot ${texElement(single.target!)}`], subst: `${texOf('U', single.target!)} = ${texQty(Math.abs(sv.I), 'A')} \\cdot ${texQty(R, 'Ω')}` }
        : {};
  steps.push({
    title: 'Eredmény',
    text: finals.length ? finals.map((q) => answerSentence(q, answers.find((a) => a.questionId === q.id)?.value)).join(' ') : 'Minden ág árama az ábrán, a referenciairány szerint.',
    ...ohm,
    result: finals.length === 1 ? resultQuantity(finals[0]!, answers.find((a) => a.questionId === finals[0]!.id)?.value ?? NaN) : undefined,
    highlight: { elements: targets, arrows: arrowIds.map((id) => ({ element: id, kind: 'I', value: leafValues.get(id)!.I })) },
  });

  return { ok: true, solution: { method: 'redukcio', title: 'Soros-párhuzamos redukció', steps, answers, values: leafValues } };
}

function resultQuantity(q: Question, value: number): Step['result'] {
  return { symbol: q.kind === 'U' ? texOf('U', q.target!) : q.kind === 'I' ? texOf('I', q.target!) : `P_{\\text{${q.target}}}`, value, unit: q.unit! };
}

function answerSentence(q: Question, value: number | undefined): string {
  if (value === undefined) return '';
  const what = q.kind === 'U' ? 'feszültsége' : q.kind === 'I' ? 'árama' : 'teljesítménye';
  return `${q.target} ${what}${q.magnitudeOnly ? ' (nagysága)' : ''}: ${texFree(value, q.unit!)}.`;
}

/** Egy osztólépés: a szülő ismert feszültségéből / áramából a gyereké. */
export function dividerStep(parent: Edge, child: Edge, values: Map<Edge, { U: number; I: number }>): Step {
  const pv = values.get(parent)!;
  const cv = values.get(child)!;
  const P = rSym(parent);
  const C = rSym(child);
  const highlight = { elements: child.leaves, groups: [groupOf(child, 'accent'), ...(parent.kind === 'leaf' ? [] : [groupOf(parent, 'result')])] };
  if (parent.kind === 'series') {
    return {
      title: 'Feszültségosztás',
      text: `${plain(parent)} soros ág: rajta ${texFree(Math.abs(pv.U), 'V')} esik, és a feszültség az ellenállások arányában oszlik meg.`,
      terms: [`${qSym('U', child)} =`, `${qSym('U', parent)} \\cdot`, `\\frac{${C}}{${P}}`],
      subst: `${qSym('U', child)} = ${texQty(Math.abs(pv.U), 'V')} \\cdot \\frac{${texNum(child.R)}}{${texNum(parent.R)}}`,
      result: { symbol: qSym('U', child), value: Math.abs(cv.U), unit: 'V' },
      highlight,
    };
  }
  const siblings = parent.children.map((c) => c.edge).filter((e) => e !== child);
  if (siblings.length === 1) {
    const S = rSym(siblings[0]!);
    return {
      title: 'Áramosztás',
      text: `${plain(parent)} két párhuzamos ágra oszlik: az áram a másik ág ellenállásával arányosan jut ide.`,
      terms: [`${qSym('I', child)} =`, `${qSym('I', parent)} \\cdot`, `\\frac{${S}}{${C} + ${S}}`],
      subst: `${qSym('I', child)} = ${texQty(Math.abs(pv.I), 'A')} \\cdot \\frac{${texNum(siblings[0]!.R)}}{${texNum(child.R)} + ${texNum(siblings[0]!.R)}}`,
      result: { symbol: qSym('I', child), value: Math.abs(cv.I), unit: 'A' },
      highlight,
    };
  }
  return {
    title: 'Párhuzamos ág árama',
    text: 'Párhuzamos ágakon ugyanaz a feszültség: az ág áramát Ohm törvénye adja.',
    terms: [`${qSym('I', child)} =`, `\\frac{${qSym('U', parent)}}{${C}}`],
    subst: `${qSym('I', child)} = \\frac{${texQty(Math.abs(pv.U), 'V')}}{${texQty(child.R, 'Ω')}}`,
    result: { symbol: qSym('I', child), value: Math.abs(cv.I), unit: 'A' },
    highlight,
  };
}

/** Teljes hálózatanalízis: minden elem U, I, P értéke táblázatban, ellenőrzéssel. */
function tableSteps(p: Problem, leafValues: Map<string, { U: number; I: number }>, els: Map<string, CircuitElement>): Step[] {
  const rows: TableRow[] = [...leafValues.entries()]
    .map(([id, v]) => ({ element: id, label: `${id} (${valueLabel(els.get(id)!)})`, U: v.U, I: v.I, P: v.U * v.I }))
    .sort((a, b) => a.element.localeCompare(b.element, 'hu', { numeric: true }));
  const sumP = rows.reduce((s, r) => s + r.P, 0);
  const net = toNetlist(p.circuit).net;
  const kcl = kclResidual(net, leafValues);
  return [
    {
      title: 'Minden elem árama és feszültsége',
      text: 'Az osztásokat a teljes összevonási fán végigvezetve minden elem feszültsége és árama adódik; a teljesítmény P = U · I (az ellenállásoké pozitív, a forrásé negatív, ha teljesítményt ad le).',
      table: rows,
      highlight: { arrows: rows.filter((r) => els.get(r.element)?.kind === 'R').map((r) => ({ element: r.element, kind: 'I', value: r.I })) },
    },
    {
      title: 'Ellenőrzés',
      text: `Teljesítménymérleg: az összes teljesítmény összege ${texFree(Math.abs(sumP) < 1e-9 ? 0 : sumP, 'W')}. Csomóponti törvény: minden csomópontban a kifolyó áramok összege ${kcl < 1e-9 ? 'nulla' : 'nem nulla'}.`,
      terms: ['\\sum P = 0'],
      subst: `\\sum P = ${rows.map((r) => texNum(r.P, { paren: true })).join(' + ')}`,
      result: { symbol: '\\sum P', value: Math.abs(sumP) < 1e-9 ? 0 : sumP, unit: 'W' },
      highlight: {},
    },
  ];
}

function kclResidual(net: Netlist, values: Map<string, { U: number; I: number }>): number {
  const sum = new Array<number>(net.nodeCount).fill(0);
  for (const e of net.elements) {
    const v = values.get(e.id);
    if (!v) continue;
    sum[e.a]! += v.I;
    sum[e.b]! -= v.I;
  }
  return Math.max(0, ...sum.map(Math.abs));
}

/**
 * Egyforrású (rész)hálózat megoldása csak eredővel és osztókkal (szuperpozíció részáramköreihez):
 * eredő a forrás felől → a forrás árama / feszültsége → feszültség- és áramosztás a kérdéses
 * ellenállásokig. null, ha a hálózat nem soros-párhuzamos. A lépések a megadott fejezetbe és
 * kiemeléssel (pl. kiiktatott források) kerülnek.
 */
export function singleSourceSteps(
  net: Netlist,
  targets: string[],
  ctx: {
    group?: string;
    base?: Partial<Step['highlight']>;
    circuit?: Circuit;
    /** Csillag-delta átalakítás megengedett (ha a részáramkör hidas); a kérdéses elem nem lehet az átalakított csoportban. */
    starDelta?: boolean;
    prefer?: 'delta-csillag' | 'csillag-delta';
    /** A csomópontok visszavezetése a rajzra (kiiktatott forrásoknál átszámozódnak). */
    toDrawing?: (n: number) => number;
  },
): { steps: Step[]; values: Map<string, { U: number; I: number }>; transformed: boolean } | null {
  const sources = net.elements.filter((e) => e.kind !== 'R');
  if (sources.length !== 1) return null;
  const s = sources[0]!;
  const t1 = s.b;
  const t2 = s.a;
  const steps: Step[] = [];
  // A rövidzárral áthidalt ellenállás (két vége ugyanaz a csomópont) árammentes.
  const shorted = net.elements.filter((e) => e.kind === 'R' && e.a === e.b).map((e) => e.id);
  if (shorted.length)
    steps.push({
      title: 'Rövidre zárt ellenállás',
      text: `${shorted.join(', ')} két végét a rövidzár összeköti, így nincs rajta feszültség, és áram sem folyik rajta. Kihagyjuk.`,
      highlight: { dim: shorted, elements: shorted },
    });
  let resistors = net.elements.filter((e) => e.kind === 'R' && e.a !== e.b);
  let red = reduceSP(resistors, t1, t2);
  if (!red) {
    const zero = zeroCurrentResistors(net, t1, t2);
    if (zero.length) {
      resistors = resistors.filter((e) => !zero.includes(e.id));
      red = reduceSP(resistors, t1, t2);
      if (red)
        steps.push({
          title: 'Kiegyenlített híd',
          text: `A híd kiegyenlített: az átló két végpontja azonos potenciálon van, ezért ${zero.join(', ')} árama nulla. Az elem elhagyható.`,
          highlight: { dim: zero, elements: zero },
        });
    }
  }
  // Hidas részáramkör: csillag-delta átalakítás, utána összevonás (csak ha megengedett).
  let sd: ReturnType<typeof transformAndReduce> = null;
  if (!red && ctx.starDelta) {
    sd = transformAndReduce(resistors, net.nodeCount, t1, t2, {
      prefer: ctx.prefer,
      drawn: new Set(ctx.circuit ? allElements(ctx.circuit).map((e) => e.id) : net.elements.map((e) => e.id)),
      from: 'A működő forrás',
      group: ctx.group ?? 'Összevonás',
      toDrawing: ctx.toDrawing,
      base: ctx.base,
    });
    if (sd && targets.some((t) => sd!.removedIds.includes(t))) sd = null;
    red = sd?.red ?? null;
  }
  if (!red) return null;
  const used = new Set([...red.root.leaves, ...(sd?.removedIds ?? [])]);
  const idle = resistors.filter((e) => !used.has(e.id)).map((e) => e.id);
  if (idle.length)
    steps.push({
      title: 'Árammentes ágak',
      text: `${idle.join(', ')} csak egyik végével csatlakozik az áramkörhöz (a szakadás miatt), így nem folyik rajta áram.`,
      highlight: { dim: idle, elements: idle },
    });

  const afterTransform = steps.length;
  if (sd) steps.push(...sd.steps);
  else steps.push(...reductionSteps(red, ctx.circuit, ctx.base));
  const root = red.root;
  const fin = sd ? {} : finalRedraw(ctx.circuit, red, ctx.base);
  steps.push({
    title: 'Eredő ellenállás',
    ...fin,
    text: 'A működő forrás felől nézett eredő ellenállás.',
    terms: [`R_{e} = ${rSym(root)}`],
    result: { symbol: 'R_{e}', value: root.R, unit: 'Ω' },
    highlight: { groups: [groupOf(root, 'result')] },
  });
  const sameDir = root.a === s.b;
  let Uroot: number;
  if (s.kind === 'V') {
    Uroot = sameDir ? s.value : -s.value;
    steps.push({
      title: 'A forrás árama',
      text: 'Ohm törvénye az eredőre: a forrás feszültsége az eredő ellenálláson esik.',
      terms: ['I = \\frac{U_g}{R_e}'],
      subst: `I = \\frac{${texQty(s.value, 'V')}}{${texQty(root.R, 'Ω')}}`,
      result: { symbol: 'I', value: s.value / root.R, unit: 'A' },
      highlight: { elements: [s.id], groups: [groupOf(root, 'result')] },
      ...fin,
    });
  } else {
    const U = s.value * root.R;
    Uroot = sameDir ? U : -U;
    steps.push({
      title: 'A forrás feszültsége',
      text: 'Az áramforrás árama az eredő ellenálláson folyik át; a rajta eső feszültség Ohm törvényéből adódik.',
      terms: ['U = I_g \\cdot R_e'],
      subst: `U = ${texQty(s.value, 'A')} \\cdot ${texQty(root.R, 'Ω')}`,
      result: { symbol: 'U', value: U, unit: 'V' },
      highlight: { elements: [s.id], groups: [groupOf(root, 'result')] },
    });
  }
  const values = distribute(root, Uroot);
  const leafValues = new Map<string, { U: number; I: number }>();
  for (const [e, v] of values) if (e.kind === 'leaf') leafValues.set(e.key, v);
  for (const e of net.elements) if (e.kind === 'R' && !leafValues.has(e.id)) leafValues.set(e.id, { U: 0, I: 0 });
  const shown = new Set<Edge>();
  for (const t of targets) {
    const path = findPath(root, t);
    for (let i = 0; i + 1 < path.length; i++) {
      const child = path[i + 1]!;
      if (shown.has(child)) continue;
      shown.add(child);
      steps.push(dividerStep(path[i]!, child, values));
    }
  }
  return {
    steps: steps.map((st, i) => {
      const h = { ...ctx.base, ...st.highlight };
      // Átalakítás után az ábrán végig látszik az új csillag / delta (szaggatottan).
      const hl = sd && i >= afterTransform + sd.steps.length ? sd.filterH({ ...sd.after, ...h, dim: [...(sd.after.dim ?? []), ...(h.dim ?? [])] }) : h;
      return { ...st, group: st.group === 'Átalakítás' ? `${ctx.group ?? ''}: csillag-delta` : ctx.group, highlight: hl };
    }),
    values: leafValues,
    transformed: !!sd,
  };
}
