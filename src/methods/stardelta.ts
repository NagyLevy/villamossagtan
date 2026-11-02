// Csillag-delta átalakítás módszer:
//  (a) megmutatja, hogy a kapcsok felől nincs soros vagy párhuzamos pár, ezért átalakítás kell;
//  (b) kijelöli a három kivezetést és a deltát / csillagot;
//  (c) képlet, behelyettesítés, az új ellenállások;
//  (d) az átalakított hálózat az ábrán (új ágak felirattal), betétábrán a tankönyvi Y és Δ;
//  (e) soros-párhuzamos redukció az eredőig vagy a kérdéses mennyiségig;
//  (f) ha a kérdés az átalakított csoport egy eredeti elemére vonatkozik: VISSZAHELYETTESÍTÉS
//      a kivezetések potenciáljából, az eredeti hálózatban.

import type { Problem } from '../generator/generate';
import { valueLabel } from '../generator/questions';
import { isSeriesParallelReducible } from '../simplify/seriesParallel';
import { deltaToStar, findTransform, starToDelta, type Transform } from '../simplify/stardelta';
import { allElements, type NetElement } from '../solver/model';
import { toNetlist } from '../solver/netlist';
import { formatQuantity } from '../units';
import { targetResistors } from './common';
import type { Values } from './engine';
import { dividerStep, distribute, findPath, groupOf, reduceSP, reductionSteps, rSym, type Reduction } from './reduction';
import { texElement, texNum, texOf, texQty } from './tex';
import type { Highlight, MethodAnswer, MethodResult, Step } from './types';

export interface StarDeltaOptions {
  prefer?: 'delta-csillag' | 'csillag-delta';
}

const DELTA_FORMULA: Record<string, [string, string]> = {
  R1: ['R_{12} \\cdot R_{31}', 'R_{12} + R_{23} + R_{31}'],
  R2: ['R_{12} \\cdot R_{23}', 'R_{12} + R_{23} + R_{31}'],
  R3: ['R_{23} \\cdot R_{31}', 'R_{12} + R_{23} + R_{31}'],
};
const STAR_FORMULA: Record<string, [string, string, string]> = {
  R12: ['R_1', 'R_2', 'R_3'],
  R23: ['R_2', 'R_3', 'R_1'],
  R31: ['R_3', 'R_1', 'R_2'],
};
const SUB = (n: string) => n.replace(/^R/, '');

/** A három új ellenállás képlete és behelyettesítése. */
function formulaSteps(kind: Transform['kind'], before: [number, number, number], after: [number, number, number], base: Highlight, group?: string): Step[] {
  const [a, b, c] = before;
  const names = kind === 'delta-csillag' ? ['R1', 'R2', 'R3'] : ['R12', 'R23', 'R31'];
  const symmetric = Math.abs(a - b) < 1e-12 && Math.abs(b - c) < 1e-12;
  return names.map((n, i) => {
    let terms: string[];
    let subst: string;
    if (kind === 'delta-csillag') {
      const [num, den] = DELTA_FORMULA[n]!;
      const vals: Record<string, number> = { R12: a, R23: b, R31: c };
      const pick = (s: string) => s.replace(/R_\{(\d+)\}/g, (_, k: string) => texNum(vals[`R${k}`]!));
      terms = [`R_{${SUB(n)}} =`, `\\frac{${num}}{${den}}`];
      subst = `R_{${SUB(n)}} = \\frac{${pick(num)}}{${pick(den)}}`;
    } else {
      const [p, q, r] = STAR_FORMULA[n]!;
      const vals: Record<string, number> = { R_1: a, R_2: b, R_3: c };
      terms = [`R_{${SUB(n)}} =`, `${p} + ${q}`, `+ \\frac{${p} \\cdot ${q}}{${r}}`];
      subst = `R_{${SUB(n)}} = ${texNum(vals[p]!)} + ${texNum(vals[q]!)} + \\frac{${texNum(vals[p]!)} \\cdot ${texNum(vals[q]!)}}{${texNum(vals[r]!)}}`;
    }
    const rule =
      kind === 'delta-csillag'
        ? `Szabály: a csillag minden ellenállása = az adott kivezetésnél találkozó két delta-ellenállás szorzata osztva a három delta-ellenállás összegével. ${n} az ${SUB(n)}. kivezetéshez csatlakozik, ott ${n === 'R1' ? 'R12 és R31' : n === 'R2' ? 'R12 és R23' : 'R23 és R31'} találkozik.`
        : `Szabály: két csillag-ellenállás összege, plusz a szorzatuk osztva a harmadikkal. ${n} az ${SUB(n)[0]} és a ${SUB(n)[1]} kivezetés között van, ezért R${SUB(n)[0]} és R${SUB(n)[1]} a két szomszéd, a harmadik R${'123'.replace(SUB(n)[0]!, '').replace(SUB(n)[1]!, '')}.`;
    return {
      title: `${n} kiszámítása`,
      text: rule,
      terms,
      subst,
      result: { symbol: `R_{${SUB(n)}}`, value: after[i]!, unit: 'Ω' },
      highlight: base,
      note: symmetric && i === 2 ? `Szimmetrikus eset: mindhárom ellenállás egyenlő, ezért ${kind === 'delta-csillag' ? 'RY = RΔ / 3' : 'RΔ = 3 · RY'}.` : undefined,
      inset: i === 0 ? { kind, before, after } : undefined,
      group,
    } satisfies Step;
  });
}

export function solveStarDelta(p: Problem, opts: StarDeltaOptions = {}): MethodResult {
  const sd = p.questions.filter((q) => q.kind === 'SD');
  if (sd.length) return pureTransform(p);
  return networkTransform(p, opts);
}

/** Tiszta átalakítás (adott csillag vagy delta). */
function pureTransform(p: Problem): MethodResult {
  const els = allElements(p.circuit);
  const byName = new Map(els.map((e) => [e.name ?? '', e]));
  const isStar = byName.has('R1');
  const kind: Transform['kind'] = isStar ? 'csillag-delta' : 'delta-csillag';
  const before = (isStar ? ['R1', 'R2', 'R3'] : ['R12', 'R23', 'R31']).map((n) => byName.get(n)!.value) as [number, number, number];
  const afterObj = isStar
    ? starToDelta({ R1: before[0], R2: before[1], R3: before[2] })
    : deltaToStar({ R12: before[0], R23: before[1], R31: before[2] });
  const after = (isStar ? [(afterObj as { R12: number }).R12, (afterObj as { R23: number }).R23, (afterObj as { R31: number }).R31] : [(afterObj as { R1: number }).R1, (afterObj as { R2: number }).R2, (afterObj as { R3: number }).R3]) as [number, number, number];
  const steps: Step[] = [
    {
      title: isStar ? 'Az adott csillag' : 'Az adott delta',
      text: isStar
        ? 'Három ellenállás egy közös pontban (csillagpont) találkozik, a másik végük az 1, 2, 3 kivezetés. Olyan deltát (háromszöget) keresünk, amely a három kivezetés felől nézve pontosan ugyanúgy viselkedik.'
        : 'Három ellenállás háromszöget alkot az 1, 2, 3 kivezetés között. Olyan csillagot keresünk, amely a három kivezetés felől nézve pontosan ugyanúgy viselkedik.',
      highlight: { elements: els.map((e) => e.id) },
    },
    ...formulaSteps(kind, before, after, { elements: els.map((e) => e.id) }),
  ];
  const names = isStar ? ['R12', 'R23', 'R31'] : ['R1', 'R2', 'R3'];
  const answers: MethodAnswer[] = p.questions.filter((q) => q.kind === 'SD').map((q) => ({ questionId: q.id, value: after[names.indexOf(q.sdName!)]! }));
  return { ok: true, solution: { method: 'csillag-delta', title: 'Csillag-delta átalakítás', steps, answers } };
}

/** Hidas hálózat: átalakítás, redukció, és szükség esetén visszahelyettesítés. */
function networkTransform(p: Problem, opts: StarDeltaOptions): MethodResult {
  const map = toNetlist(p.circuit);
  const net = map.net;
  const sources = net.elements.filter((e) => e.kind !== 'R');
  if (sources.length > 1) return { ok: false, reason: 'Csillag-delta átalakítást egyforrású (vagy forrás nélküli) hálózatra mutatunk.' };
  const s = sources[0];
  let t1: number;
  let t2: number;
  if (s) {
    t1 = s.b;
    t2 = s.a;
  } else {
    if (!p.circuit.terminals) return { ok: false, reason: 'Nincs kijelölt A–B kapocspár.' };
    t1 = map.pointNode.get(p.circuit.terminals.a)!;
    t2 = map.pointNode.get(p.circuit.terminals.b)!;
  }
  const rs = net.elements.filter((e) => e.kind === 'R');
  if (isSeriesParallelReducible(rs.map((e) => ({ a: e.a, b: e.b })), t1, t2)) return { ok: false, reason: 'Ehhez a hálózathoz nem kell csillag-delta átalakítás: soros-párhuzamosan redukálható.' };
  const done = transformAndReduce(rs, net.nodeCount, t1, t2, {
    prefer: opts.prefer,
    drawn: new Set(allElements(p.circuit).map((e) => e.id)),
    from: s ? 'A forrás' : 'Az A és B kapcsok',
    group: 'Összevonás',
  });
  if (!done) return { ok: false, reason: 'Egyetlen csillag-delta átalakítás nem elég ehhez a hálózathoz.' };
  const { tr, red, all, after, filterH, removedIds, isDelta } = done;
  const steps: Step[] = [...done.steps];
  const reqLabel = s ? 'R_{e}' : 'R_{AB}';
  steps.push({
    title: 'Eredő ellenállás',
    text: s ? 'A forrás felől nézett eredő ellenállás.' : 'Az A és B kapcsok közötti eredő ellenállás.',
    terms: [`${reqLabel} = ${rSym(red.root)}`],
    result: { symbol: reqLabel, value: red.root.R, unit: 'Ω' },
    highlight: filterH({ ...after, groups: [groupOf(red.root, 'result')] }),
    group: 'Összevonás',
  });
  const answers: MethodAnswer[] = [];
  for (const q of p.questions) if (q.kind === 'Req') answers.push({ questionId: q.id, value: red.root.R });
  if (!s) return { ok: true, solution: { method: 'csillag-delta', title: 'Csillag-delta átalakítás', steps, answers } };

  // A forrás és az osztások (előjelhelyesen), majd a potenciálok.
  const sameDir = red.root.a === s.b;
  const Uroot = s.kind === 'V' ? (sameDir ? s.value : -s.value) : (sameDir ? 1 : -1) * s.value * red.root.R;
  steps.push(
    s.kind === 'V'
      ? { title: 'A forrás árama', text: 'Ohm törvénye az eredőre.', terms: [`I = \\frac{U_g}{${reqLabel}}`], subst: `I = \\frac{${texQty(s.value, 'V')}}{${texQty(red.root.R, 'Ω')}}`, result: { symbol: 'I', value: s.value / red.root.R, unit: 'A' }, highlight: filterH({ ...after, elements: [s.id] }), group: 'Összevonás' }
      : { title: 'A forrás feszültsége', text: 'Az áramforrás árama az eredőn folyik át.', terms: [`U = I_g \\cdot ${reqLabel}`], subst: `U = ${texQty(s.value, 'A')} \\cdot ${texQty(red.root.R, 'Ω')}`, result: { symbol: 'U', value: s.value * red.root.R, unit: 'V' }, highlight: filterH({ ...after, elements: [s.id] }), group: 'Összevonás' },
  );
  const vals = distribute(red.root, Uroot);
  // Potenciálok: a t2 (a forrás "a" kivezetése) a referencia, az élek mentén U_ab = φa − φb.
  const leafEdges = [...vals.keys()].filter((e) => e.kind === 'leaf');
  const leafNet = new Map(all.map((e) => [e.id, e]));
  const phi = new Map<number, number>([[t2, 0]]);
  for (let guard = 0; guard < all.length + 2; guard++) {
    for (const e of leafEdges) {
      const ne = leafNet.get(e.key)!;
      const U = vals.get(e)!.U * (e.a === ne.a ? 1 : -1);
      if (phi.has(ne.a) && !phi.has(ne.b)) phi.set(ne.b, phi.get(ne.a)! - U);
      else if (phi.has(ne.b) && !phi.has(ne.a)) phi.set(ne.a, phi.get(ne.b)! + U);
    }
  }
  // Csillag → delta után a csillagpont eltűnt: a potenciálja a csillagpontra felírt csomóponti
  // törvényből jön vissza (a kivezetések potenciáljából): φc = Σ(φi / Ri) / Σ(1 / Ri).
  if (!isDelta) {
    const num = tr.removed.reduce((acc, e) => acc + (phi.get(e.a === tr.center ? e.b : e.a) ?? 0) / e.value, 0);
    const den = tr.removed.reduce((acc, e) => acc + 1 / e.value, 0);
    phi.set(tr.center, num / den);
  }
  const values: Values = new Map();
  for (const e of rs) {
    const U = (phi.get(e.a) ?? 0) - (phi.get(e.b) ?? 0);
    values.set(e.id, { U, I: U / e.value });
  }
  const Inet = (sameDir ? 1 : -1) * vals.get(red.root)!.I;
  values.set(s.id, { U: (phi.get(s.a) ?? 0) - (phi.get(s.b) ?? 0), I: Inet });

  const els = new Map(allElements(p.circuit).map((e) => [e.id, e]));
  for (const t of targetResistors(p)) {
    const v = values.get(t)!;
    if (!removedIds.includes(t)) {
      // A kérdéses elem kívül esik az átalakított csoporton: osztással, mint a sima redukciónál.
      const path = findPath(red.root, t);
      for (let i = 0; i + 1 < path.length; i++) {
        const st = dividerStep(path[i]!, path[i + 1]!, vals);
        steps.push({ ...st, highlight: filterH({ ...st.highlight, ...mergeAfter(st.highlight, after) }), group: 'Osztás' });
      }
      steps.push({
        title: `${t} értékei`,
        text: 'Az elem nem tartozik az átalakított csoporthoz, ezért az értéke közvetlenül az osztásokból jön.',
        terms: [`${texOf('U', t)} = ${texQty(v.U, 'V')},\\quad ${texOf('I', t)} = \\frac{${texOf('U', t)}}{${texElement(t)}} = ${texQty(v.I, 'A')}`],
        result: p.questions.some((q) => q.target === t && q.kind === 'U') ? { symbol: texOf('U', t), value: Math.abs(v.U), unit: 'V' } : { symbol: texOf('I', t), value: Math.abs(v.I), unit: 'A' },
        highlight: { elements: [t], arrows: [{ element: t, kind: 'I', value: v.I }] },
        group: 'Osztás',
      });
    } else {
      // Visszahelyettesítés: az átalakítás a kivezetések felé hű, belül nem.
      const ne = rs.find((e) => e.id === t)!;
      const pots = tr.terminals.map((n, i) => ({ node: n, label: `${i + 1}: ${formatQuantity(phi.get(n) ?? 0, 'V', { sig: 3 })}` }));
      const nm = (n: number) => (n === tr.center && !isDelta ? 'c' : String(tr.terminals.indexOf(n) + 1));
      const [ia, ib] = [nm(ne.a), nm(ne.b)];
      steps.push({
        title: 'Visszahelyettesítés',
        text: `A kérdéses ${t} (${valueLabel(els.get(t)!)}) az átalakított csoport része. Az átalakítás csak a kivezetések felé hű: a kivezetések potenciálja ugyanaz, de a belső ágak árama más. Ezért a redukált hálózatból kiszámoljuk az 1, 2, 3 pont potenciálját (a forrás alsó kivezetése a 0), és visszatérünk az EREDETI hálózathoz.`,
        bullets: [...tr.terminals.map((n, i) => `${i + 1}. kivezetés potenciálja: ${formatQuantity(phi.get(n) ?? 0, 'V', { sig: 4 })}`), ...(isDelta ? [] : [`A csillagpont (c) eltűnt az átalakításkor, a potenciálját a csillagpontra felírt csomóponti törvény adja vissza: φc = (φ1/R1 + φ2/R2 + φ3/R3) / (1/R1 + 1/R2 + 1/R3) = ${formatQuantity(phi.get(tr.center) ?? 0, 'V', { sig: 4 })}.`])],
        highlight: { elements: [t], nodeLabels: pots, terminals: true },
        group: 'Visszahelyettesítés',
      });
      steps.push({
        title: `${t} az eredeti hálózatban`,
        text: `${t} a(z) ${ia === 'c' ? 'csillagpont' : `${ia}. kivezetés`} és a(z) ${ib === 'c' ? 'csillagpont' : `${ib}. kivezetés`} között van: a feszültsége a két potenciál különbsége, az árama Ohm törvényéből.`,
        terms: [`${texOf('U', t)} = \\varphi_{${ia}} - \\varphi_{${ib}}`, `,\\quad ${texOf('I', t)} = \\frac{${texOf('U', t)}}{${texElement(t)}}`],
        subst: `${texOf('U', t)} = ${texQty(phi.get(ne.a) ?? 0, 'V', { paren: true })} - ${texQty(phi.get(ne.b) ?? 0, 'V', { paren: true })} = ${texQty(v.U, 'V')},\\quad ${texOf('I', t)} = ${texQty(v.I, 'A')}`,
        result: p.questions.some((q) => q.target === t && q.kind === 'U') ? { symbol: texOf('U', t), value: Math.abs(v.U), unit: 'V' } : { symbol: texOf('I', t), value: Math.abs(v.I), unit: 'A' },
        highlight: { elements: [t], nodeLabels: pots, arrows: [{ element: t, kind: 'I', value: v.I }] },
        group: 'Visszahelyettesítés',
      });
    }
  }
  for (const q of p.questions) {
    const v = q.target ? values.get(q.target) : undefined;
    if (!v) continue;
    const raw = q.kind === 'U' ? v.U : q.kind === 'I' ? v.I : q.kind === 'P' ? v.U * v.I : undefined;
    if (raw !== undefined) answers.push({ questionId: q.id, value: q.magnitudeOnly ? Math.abs(raw) : raw });
  }
  return { ok: true, solution: { method: 'csillag-delta', title: 'Csillag-delta átalakítás', steps, answers, values } };
}

/**
 * Átalakítás és összevonás a t1–t2 kapcsok felől: indoklás, a delta / csillag kijelölése, képlet,
 * az átalakított hálózat, majd soros-párhuzamos összevonás. A Thevenin belső ellenállásához is.
 * `toDrawing`: a csomópontok visszavezetése a rajzra (ha a hálózatot átszámoztuk, pl. kiiktatott
 * forrásoknál); `base`: minden lépés kiemelésébe kerül (pl. kiiktatott források, kapcsok).
 */
export function transformAndReduce(
  rs: NetElement[],
  nodeCount: number,
  t1: number,
  t2: number,
  o: { prefer?: 'delta-csillag' | 'csillag-delta'; drawn: Set<string>; from: string; group: string; toDrawing?: (n: number) => number; base?: Highlight },
): { steps: Step[]; red: Reduction; tr: Transform; all: NetElement[]; after: Highlight; filterH: (h: Highlight) => Highlight; removedIds: string[]; isDelta: boolean } | null {
  const tr = findTransform(rs, nodeCount, t1, t2, o.prefer ?? 'delta-csillag') ?? findTransform(rs, nodeCount, t1, t2, o.prefer === 'delta-csillag' ? 'csillag-delta' : 'delta-csillag');
  if (!tr) return null;
  const draw = o.toDrawing ?? ((n: number) => n);
  const base = o.base ?? {};
  const removedIds = tr.removed.map((e) => e.id);
  const isDelta = tr.kind === 'delta-csillag';
  const newNames = isDelta ? ['R1', 'R2', 'R3'] : ['R12', 'R23', 'R31'];
  const labels = tr.added.map((e, i) => `${newNames[i]} = ${formatQuantity(e.value, 'Ω', { sig: 3 })}`) as [string, string, string];
  const drawTerminals = tr.terminals.map(draw) as [number, number, number];
  const portLabels = drawTerminals.map((n, i) => ({ node: n, label: String(i + 1) }));
  const after: Highlight = { ...base, dim: removedIds, transform: { kind: tr.kind, terminals: drawTerminals, labels }, nodeLabels: portLabels, terminals: true };
  const filterH = (h: Highlight): Highlight => ({
    ...h,
    elements: h.elements?.filter((id) => o.drawn.has(id)),
    groups: h.groups?.map((g) => ({ ...g, elements: g.elements.filter((id) => o.drawn.has(id)) })).filter((g) => g.elements.length),
    arrows: h.arrows?.filter((a) => o.drawn.has(a.element)),
  });
  const steps: Step[] = [];
  steps.push({
    title: 'Miért kell átalakítás?',
    text: `${o.from} felől nézve nincs két olyan ellenállás, amely sorosan (egymás után, elágazás nélkül) vagy párhuzamosan (ugyanazon két pont között) kapcsolódna: ez hídkapcsolás. Ezért ${isDelta ? 'egy háromszöget (deltát) csillaggá' : 'egy csillagot deltává'} alakítunk; utána már összevonható.`,
    highlight: { ...base, terminals: true },
    group: 'Átalakítás',
  });
  steps.push({
    title: isDelta ? 'A delta és a három kivezetés' : 'A csillag és a három kivezetés',
    text: isDelta
      ? `${removedIds.join(', ')} háromszöget alkot az 1, 2, 3 csomópont között. Ezt cseréljük egy csillagra: három ellenállás, amely egy új, közös pontban találkozik. A kivezetések a helyükön maradnak.`
      : `${removedIds.join(', ')} egy közös pontban (csillagpont) találkozik, a másik végük az 1, 2, 3 csomópont. Ezt cseréljük deltára: a csillagpont eltűnik, a kivezetések közé kerül egy-egy ellenállás.`,
    highlight: { ...base, groups: [{ elements: removedIds, label: isDelta ? 'delta' : 'csillag', tone: 'transform' }], nodeLabels: portLabels, terminals: true },
    group: 'Átalakítás',
  });
  const before = tr.removed.map((e) => e.value) as [number, number, number];
  const afterVals = tr.added.map((e) => e.value) as [number, number, number];
  steps.push(...formulaSteps(tr.kind, before, afterVals, { ...base, groups: [{ elements: removedIds, label: isDelta ? 'delta' : 'csillag', tone: 'transform' }], nodeLabels: portLabels }, 'Átalakítás'));
  steps.push({
    title: 'Az átalakított hálózat',
    text: `A régi ${isDelta ? 'delta' : 'csillag'} helyére az új ${isDelta ? 'csillag' : 'delta'} kerül (az ábrán szaggatottan). A három kivezetés felől nézve semmi sem változott, ezért a hálózat többi része ugyanúgy viselkedik — és most már soros-párhuzamosan összevonható.`,
    highlight: after,
    group: 'Átalakítás',
  });
  const rest = rs.filter((e) => !removedIds.includes(e.id));
  const all: NetElement[] = [...rest, ...tr.added];
  const red = reduceSP(all, t1, t2);
  if (!red) return null;
  for (const st of reductionSteps(red)) steps.push({ ...st, highlight: filterH({ ...st.highlight, ...mergeAfter(st.highlight, after) }), group: o.group });
  return { steps, red, tr, all, after, filterH, removedIds, isDelta };
}

/** Az átalakított állapot (új ágak, elhalványított régiek) hozzáadása egy lépés kiemeléséhez. */
function mergeAfter(h: Highlight, after: Highlight): Highlight {
  return { ...after, ...h, dim: [...(after.dim ?? []), ...(h.dim ?? [])], nodeLabels: [...(after.nodeLabels ?? []), ...(h.nodeLabels ?? [])] };
}

