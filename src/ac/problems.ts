// Szinuszos (Villamosságtan 2) és bekapcsolási feladatok generátora. Seedből determinisztikus.
// A feladattípusok a vizsgafeladatokat követik: eredő impedancia, egy elem fazora és időfüggvénye,
// teljesítmények és teljesítménytényező, kompenzálás, Thevenin/Norton, rezgőkörök, bekapcsolás.

import type { Step } from '../methods/types';
import { Rng } from '../generator/rng';
import type { AnswerField, Task, TaskQuestion } from '../tasks/types';
import { formatNumber, formatQuantity } from '../units';
import { abs, argDeg, conj, cx, div, inv, mul, scale, texAlg, texExp, texNum, type Cx } from './complex';
import { backwardChain, elementPhasor, polarOf, sourceVoltageStep, texOmega, timeFunctionStep } from './derive';
import { armZ, buildLadder, dividerChain, forwardChain, reactanceStep, texI, texPhasor, texQtyReal, texU, texZ, texZVal, type ArmSpec, type BuiltLadder, type LadderSpec, type PartSpec, type Passive } from './ladder';
import { solveAc } from './mna';

export type AcTopic = 'ac-impedancia' | 'ac-fazor' | 'ac-teljesitmeny' | 'ac-helyettesito' | 'ac-rezonancia' | 'tranziens';
export type AcLevel = 'konnyu' | 'kozepes' | 'nehez';

export const AC_TOPIC_NAMES: Record<AcTopic, string> = {
  'ac-impedancia': 'Impedancia, eredő',
  'ac-fazor': 'Fazorok, osztók, időfüggvény',
  'ac-teljesitmeny': 'Teljesítmény, cos φ, kompenzálás',
  'ac-helyettesito': 'Thevenin és Norton (szinuszos)',
  'ac-rezonancia': 'Rezgőkörök',
  tranziens: 'Bekapcsolási jelenség (RL, RC)',
};

export const AC_LEVEL_NAMES: Record<AcLevel, string> = { konnyu: 'Könnyű', kozepes: 'Közepes', nehez: 'Nehéz (ZH)' };

export interface AcOptions {
  seed: string;
  topic: AcTopic;
  level: AcLevel;
}

let qCounter = 0;
const qid = () => `a${(qCounter = (qCounter + 1) % 1_000_000)}`;
const fid = () => `f${(qCounter = (qCounter + 1) % 1_000_000)}`;

// ───────── Értékkészletek ─────────

/** Körfrekvenciák és az ehhez illő "szép" reaktanciák (Ω). */
const OMEGAS = [1e3, 1e4, 1e5] as const;
const R_VALUES = [500, 1000, 2000];
const X_VALUES = [500, 1000, 2000];

function pickPart(rng: Rng, kind: Passive, omega: number): PartSpec {
  if (kind === 'R') return { kind, value: rng.pick(R_VALUES) };
  const x = rng.pick(X_VALUES);
  // X_L = ωL → L = X/ω; X_C = 1/(ωC) → C = 1/(ωX).
  return kind === 'L' ? { kind, value: round(x / omega) } : { kind, value: round(1 / (omega * x)) };
}

/** Lebegőpontos zaj nélküli érték (pl. 1e-7 pontosan). */
function round(x: number): number {
  return Number(x.toPrecision(6));
}

function pickArm(rng: Rng, omega: number, maxParts: number, allowEmpty: boolean): ArmSpec {
  const n = allowEmpty && rng.chance(0.18) ? 0 : maxParts > 1 && rng.chance(0.35) ? 2 : 1;
  const kinds = rng.shuffle(['R', 'L', 'C'] as Passive[]).slice(0, n);
  return kinds.map((k) => pickPart(rng, k, omega));
}

interface LadderShape {
  sections: number;
  maxParts: number;
}

const SHAPES: Record<AcLevel, LadderShape[]> = {
  konnyu: [
    { sections: 1, maxParts: 2 },
    { sections: 2, maxParts: 1 },
  ],
  kozepes: [
    { sections: 2, maxParts: 2 },
    { sections: 3, maxParts: 1 },
  ],
  nehez: [
    { sections: 3, maxParts: 2 },
    { sections: 4, maxParts: 1 },
  ],
};

/** Véletlen létra; a feltételek: van reaktáns elem, és egyik osztás sem degenerált (rezonancia). */
function randomLadder(rng: Rng, level: AcLevel, base: Omit<LadderSpec, 'series' | 'shunts' | 'omega'>, opts: { minReactive?: number; omega?: number } = {}): LadderSpec | null {
  const shape = rng.pick(SHAPES[level]);
  const omega = opts.omega ?? rng.pick(OMEGAS);
  const series: ArmSpec[] = [];
  const shunts: (ArmSpec | null)[] = [];
  for (let k = 1; k <= shape.sections; k++) {
    // Az első soros ág a generátor mellett ne legyen üres (különben a generátor közvetlenül a keresztágon van).
    series.push(pickArm(rng, omega, shape.maxParts, k > 1));
    shunts.push(k < shape.sections && rng.chance(0.12) ? null : pickArm(rng, omega, shape.maxParts, false));
  }
  if (!shunts[shunts.length - 1] && !base.tail) shunts[shunts.length - 1] = pickArm(rng, omega, 1, false);
  const spec: LadderSpec = { ...base, omega, series, shunts };
  const parts = [...series.flat(), ...shunts.flatMap((s) => s ?? []), ...(base.tail ?? [])];
  if (parts.filter((p) => p.kind !== 'R').length < (opts.minReactive ?? 1)) return null;
  if (parts.length > 7) return null;
  return spec;
}

/** Az osztásoknál nem lehet (közel) nulla nevező; az eredő se legyen nulla vagy végtelen. */
function healthy(b: BuiltLadder): boolean {
  const n = b.series.length;
  // Egy ágon belül a tekercs és a kondenzátor ne oltsa ki egymást (soros rezonancia: rövidzár).
  for (const arm of [...b.series, ...b.shunts, b.tail])
    if (arm && arm.parts.length > 1 && abs(arm.z) < 0.2 * Math.max(...arm.parts.map((p) => abs(armZ([p], b.spec.omega))))) return false;
  let w: Cx | null = null;
  for (let k = n; k >= 1; k--) {
    const r = b.shunts[k - 1];
    if (r && w) {
      const den = abs({ re: r.z.re + w.re, im: r.z.im + w.im });
      if (den < 0.05 * Math.max(abs(r.z), abs(w))) return false;
      w = div(mul(r.z, w), { re: r.z.re + w.re, im: r.z.im + w.im });
    } else if (r) w = r.z;
    w = { re: w!.re + b.series[k - 1]!.z.re, im: w!.im + b.series[k - 1]!.z.im };
    if (abs(w) < 1) return false;
  }
  return abs(w!) > 1 && abs(w!) < 1e9;
}

// ───────── Szövegek ─────────

const NOUN: Record<Passive, string> = { R: 'ellenállás', L: 'tekercs', C: 'kondenzátor' };

function elementText(b: BuiltLadder, id: string, suffix = ''): string {
  const parts = [...b.series, ...b.shunts.filter((x) => !!x), ...(b.tail ? [b.tail] : [])].flatMap((a) => a!.parts.map((p, i) => ({ p, id: a!.ids[i]! })));
  const me = parts.find((x) => x.id === id)!;
  return `az ${id} jelű (${formatQuantity(me.p.value, me.p.kind === 'R' ? 'Ω' : me.p.kind === 'L' ? 'H' : 'F')}) ${NOUN[me.p.kind]}${suffix}`;
}

function sourceLabel(src: { kind: 'V' | 'I'; amp: number; phase: number }): string {
  const a = formatQuantity(src.amp, src.kind === 'V' ? 'V' : 'A');
  const ph = src.phase === 0 ? '' : ` ${src.phase > 0 ? '+' : '−'} ${Math.abs(src.phase)}°`;
  return `${a}·cos(ωt${ph})`;
}

function sourceGiven(src: { kind: 'V' | 'I'; amp: number; phase: number }, omega: number): string {
  const sym = src.kind === 'V' ? 'u_g(t)' : 'i_g(t)';
  const ph = src.phase === 0 ? '' : ` ${src.phase > 0 ? '+' : '-'} ${Math.abs(src.phase)}^\\circ`;
  return `${sym} = ${texQtyReal(src.amp, src.kind === 'V' ? 'V' : 'A')}\\cdot\\cos(${texOmega(omega)}\\,t${ph})`;
}

const omegaGiven = (omega: number) => `\\omega = ${texOmega(omega)}\\,\\tfrac{\\text{rad}}{\\text{s}}`;

function pickSource(rng: Rng, allowCurrent: boolean): { kind: 'V' | 'I'; amp: number; phase: number } {
  const kind = allowCurrent && rng.chance(0.4) ? 'I' : 'V';
  return { kind, amp: kind === 'V' ? rng.pick([1, 2, 5, 10]) : rng.pick([1, 2, 5, 10]) * 1e-3, phase: rng.pick([0, 0, 0, 30, -45, 60, 90]) };
}

function withSourceLabel(b: BuiltLadder): BuiltLadder {
  const src = b.spec.source;
  if (!src) return b;
  for (const br of b.circuit.branches) for (const e of br.elements) if (e.id === b.sourceId) e.label = src.withSwitch ? formatQuantity(src.amp, src.kind === 'V' ? 'V' : 'A') : sourceLabel(src);
  return b;
}

function phasorFields(v: Cx, unit: 'V' | 'A'): AnswerField[] {
  return [
    { id: fid(), label: 'csúcsérték', unit, answer: abs(v), magnitudeOnly: true, example: unit === 'V' ? '0,5 V' : '2 mA' },
    { id: fid(), label: 'kezdőfázis', unit: '°', answer: argDeg(v), kind: 'phase', example: '−45' },
  ];
}

function complexFields(z: Cx, unit: 'Ω'): AnswerField[] {
  return [
    { id: fid(), label: 'valós rész', unit, answer: z.re, example: '500 Ω' },
    { id: fid(), label: 'képzetes rész', unit, answer: z.im, example: '−1 kΩ' },
  ];
}

function ladderMeta(b: BuiltLadder): string {
  const parts = b.circuit.branches.flatMap((x) => x.elements);
  const count = (k: string) => parts.filter((p) => p.kind === k).length;
  return [count('R') ? `${count('R')} ellenállás` : '', count('L') ? `${count('L')} tekercs` : '', count('C') ? `${count('C')} kondenzátor` : ''].filter(Boolean).join(' · ');
}

// ───────── Feladattípusok ─────────

function impedanceTask(rng: Rng, o: AcOptions): Task | null {
  const spec = randomLadder(rng, o.level, { source: null, terminals: 'input' });
  if (!spec) return null;
  const b = buildLadder(spec);
  if (!healthy(b)) return null;
  const ctx = { omega: spec.omega, ac: true };
  const steps: Step[] = [];
  const rx = reactanceStep(b);
  if (rx) steps.push(rx);
  const fc = forwardChain(b, steps, ctx);
  const z = fc.zin;
  const polarAsk = rng.chance(0.35);
  steps.push({
    title: 'Eredmény',
    text: polarAsk ? 'Az eredő impedancia exponenciális alakja: az abszolút értéke és a szöge (fázisszöge).' : 'Az A–B kapcsok felől látott eredő impedancia algebrai alakja: valós rész a rezisztencia, képzetes rész a reaktancia.',
    result: { symbol: texZ('AB'), value: abs(z), unit: 'Ω', tex: texZVal(z, ctx) },
    highlight: { groups: [{ elements: fc.pIds[1]!, label: `ZAB = ${formatQuantity(abs(z), 'Ω', { sig: 3 })} ∠${formatNumber(argDeg(z), 3)}°`, tone: 'result' }], terminals: true },
  });
  const q: TaskQuestion = polarAsk
    ? {
        id: qid(),
        text: 'Mekkora az A–B kapcsok felől látott eredő impedancia abszolút értéke és fázisszöge?',
        fields: [
          { id: fid(), label: '|Z|', unit: 'Ω', answer: abs(z), magnitudeOnly: true, example: '707 Ω' },
          { id: fid(), label: 'fázisszög', unit: '°', answer: argDeg(z), kind: 'phase', example: '45' },
        ],
      }
    : { id: qid(), text: 'Mekkora az A–B kapcsok felől látott eredő impedancia? Add meg algebrai alakban (R + jX)!', fields: complexFields(z, 'Ω') };
  return { domain: 'ac', seed: o.seed, topic: o.topic, topicName: AC_TOPIC_NAMES[o.topic], levelName: AC_LEVEL_NAMES[o.level], meta: ladderMeta(b), title: q.text, given: [omegaGiven(spec.omega)], circuit: b.circuit, questions: [q], solution: { method: 'impedancia', title: 'Eredő impedancia', steps, answers: [] } };
}

function phasorTask(rng: Rng, o: AcOptions): Task | null {
  const src = pickSource(rng, true);
  const spec = randomLadder(rng, o.level, { source: src, terminals: null });
  if (!spec) return null;
  const b = withSourceLabel(buildLadder(spec));
  if (!healthy(b)) return null;
  const ctx = { omega: spec.omega, ac: true };
  const passives = b.circuit.branches.flatMap((x) => x.elements).filter((e) => e.kind === 'R' || e.kind === 'L' || e.kind === 'C');
  const target = rng.pick(passives);
  const want: 'U' | 'I' = rng.chance(0.5) ? 'U' : 'I';
  const steps: Step[] = [];
  const rx = reactanceStep(b);
  if (rx) steps.push(rx);
  const fc = forwardChain(b, steps, ctx);
  const U0 = sourceVoltageStep(b, fc, steps, ctx);
  const r = elementPhasor(b, fc, U0, target.id, want, steps, ctx);
  const v = want === 'U' ? r.U : r.I;
  if (abs(v) < 1e-12) return null;
  const sym = want === 'U' ? `u_{${target.id}}` : `i_{${target.id}}`;
  steps.push(timeFunctionStep(sym, v, want === 'U' ? 'V' : 'A', spec.omega, target.id));
  const noun = want === 'U' ? 'feszültségének' : 'áramának';
  const text = `Adja meg ${elementText(b, target.id)} ${noun} időfüggvényét (csúcsérték és kezdőfázis)! A referenciairány balról jobbra, illetve fentről lefelé mutat.`;
  const q: TaskQuestion = { id: qid(), text, fields: phasorFields(v, want === 'U' ? 'V' : 'A'), target: target.id };
  return { domain: 'ac', seed: o.seed, topic: o.topic, topicName: AC_TOPIC_NAMES[o.topic], levelName: AC_LEVEL_NAMES[o.level], meta: ladderMeta(b), title: text, given: [omegaGiven(spec.omega), sourceGiven(src, spec.omega)], circuit: b.circuit, questions: [q], solution: { method: 'fazor', title: 'Fazorok osztókkal', steps, answers: [] } };
}

function powerTask(rng: Rng, o: AcOptions): Task | null {
  const variant = rng.weighted([
    ['PQ', 3],
    ['S', 2],
    ['lambda', 2],
    ['komp', 3],
  ] as const);
  const passive = variant === 'lambda' || variant === 'komp';
  const src = pickSource(rng, false);
  const spec = randomLadder(rng, o.level, passive ? { source: null, terminals: 'input' } : { source: src, terminals: null });
  if (!spec) return null;
  const b = withSourceLabel(buildLadder(spec));
  if (!healthy(b)) return null;
  const ctx = { omega: spec.omega, ac: true };
  const steps: Step[] = [];
  const rx = reactanceStep(b);
  if (rx) steps.push(rx);
  const fc = forwardChain(b, steps, ctx);
  const z = fc.zin;
  // Teljesítményhez kell hatásos (ellenállásos) rész, különben a teljesítménytényező értelmetlen.
  if (Math.abs(z.re) < 0.05 * abs(z) || Math.abs(z.im) < 0.05 * abs(z)) return null;
  const phi = argDeg(z);
  const base = { domain: 'ac' as const, seed: o.seed, topic: o.topic, topicName: AC_TOPIC_NAMES[o.topic], levelName: AC_LEVEL_NAMES[o.level], meta: ladderMeta(b), circuit: b.circuit };
  if (variant === 'lambda') {
    const lam = Math.cos((phi * Math.PI) / 180);
    steps.push({
      title: 'Teljesítménytényező',
      text: 'A teljesítménytényező az eredő impedancia szögének koszinusza (λ = cos φ = P/S). Tisztán ohmos hálózatnál 1, tisztán reaktánsnál 0.',
      terms: [`${texZ('AB')} = ${texExp(z)}\\,\\Omega`, `\\lambda = \\cos\\varphi = \\cos(${texNum(phi)}^\\circ)`],
      result: { symbol: '\\lambda', value: lam, unit: '', tex: texNum(lam) },
      highlight: { groups: [{ elements: fc.pIds[1]!, label: `λ = ${texNum(lam).replace('{,}', ',')}`, tone: 'result' }], terminals: true },
    });
    const text = 'Mekkora az A–B kapcsokra csatlakozó hálózat teljesítménytényezője (λ = cos φ)?';
    return { ...base, title: text, given: [omegaGiven(spec.omega)], questions: [{ id: qid(), text, fields: [{ id: fid(), label: 'λ', unit: '', answer: lam, example: '0,707' }] }], solution: { method: 'teljesitmeny', title: 'Teljesítménytényező', steps, answers: [] } };
  }
  if (variant === 'komp') {
    const y = inv(z);
    const B = y.im;
    if (Math.abs(B) < 1e-9 * abs(y)) return null;
    const isCap = B < 0;
    const value = isCap ? -B / spec.omega : 1 / (spec.omega * B);
    steps.push({
      title: 'Admittancia',
      text: 'Párhuzamos kapcsolásnál az admittanciák (vezetések) adódnak össze, ezért az eredő impedancia reciprokával dolgozunk: Y = 1/Z = G + jB.',
      terms: [`\\overline{Y}_{AB} = \\dfrac{1}{${texZ('AB')}} = \\dfrac{1}{${texAlg(z)}}`],
      subst: `\\overline{Y}_{AB} = (${texAlg(y, 4)})\\,\\text{S}`,
      result: { symbol: '\\overline{Y}_{AB}', value: abs(y), unit: 'S', tex: `(${texAlg(y)})\\,\\text{S}` },
      highlight: { groups: [{ elements: fc.pIds[1]!, label: `Y = ${texAlg(y).replace(/\{,\}/g, ',')} S`, tone: 'accent' }], terminals: true },
    });
    steps.push({
      title: 'Kompenzáló elem',
      text: `A teljesítménytényező akkor 1, ha az eredő admittancia képzetes része nulla. A párhuzamos elem szuszceptanciája tehát −B kell legyen. ${isCap ? 'A hálózat induktív (B < 0), ezért kondenzátor kell: B_C = ωC.' : 'A hálózat kapacitív (B > 0), ezért tekercs kell: B_L = −1/(ωL).'}`,
      terms: isCap ? [`j\\omega C = ${texAlg(cx(0, -B))}\\,\\text{S}`, `C = \\dfrac{${texNum(-B)}}{${texOmega(spec.omega)}}`] : [`\\dfrac{1}{j\\omega L} = ${texAlg(cx(0, -B))}\\,\\text{S}`, `L = \\dfrac{1}{${texOmega(spec.omega)}\\cdot ${texNum(B)}}`],
      result: { symbol: isCap ? 'C' : 'L', value, unit: isCap ? 'F' : 'H', tex: texQtyReal(value, isCap ? 'F' : 'H') },
      highlight: { terminals: true },
    });
    const text = 'Milyen és mekkora értékű elemet kell párhuzamosan kapcsolni az A–B kapcsokra, hogy a teljesítménytényező 1 legyen? (Írd be mértékegységgel: H = tekercs, F = kondenzátor.)';
    return { ...base, title: text, given: [omegaGiven(spec.omega)], questions: [{ id: qid(), text, fields: [{ id: fid(), label: 'elem', unit: isCap ? 'F' : 'H', answer: value, kind: 'element', element: isCap ? 'C' : 'L', example: '100 nF vagy 200 mH' }] }], solution: { method: 'teljesitmeny', title: 'Kompenzálás', steps, answers: [] } };
  }
  // A generátorra kapcsolt hálózat teljesítménye.
  const U0 = polarOf(src.amp, src.phase);
  const I0 = div(U0, z);
  const S = scale(mul(U0, conj(I0)), 0.5);
  steps.push({
    title: 'A generátor árama',
    text: 'A generátor a teljes eredő impedanciát táplálja: árama a feszültsége osztva az eredővel (komplex Ohm-törvény).',
    terms: [`${texI('g')} = \\dfrac{${texU('g')}}{${fc.pTex[1]!}}`],
    subst: `${texI('g')} = \\dfrac{${texPhasor(U0, 'V', ctx)}}{${texExp(z)}\\,\\Omega} = ${texPhasor(I0, 'A', ctx)}`,
    result: { symbol: texI('g'), value: abs(I0), unit: 'A', tex: `${texPhasor(I0, 'A', ctx)}` },
    highlight: { elements: [b.sourceId!] },
  });
  steps.push({
    title: 'Komplex teljesítmény',
    text: 'Komplex csúcsértékekkel a komplex teljesítmény a feszültség és az áram konjugáltjának szorzata, osztva 2-vel (effektív értékekkel nem kell osztani). Valós része a hatásos (P), képzetes része a meddő teljesítmény (Q), abszolút értéke a látszólagos (S).',
    terms: [`\\overline{S} = \\tfrac{1}{2}\\,${texU('g')}\\,${texI('g')}^{*}`, ` = P + jQ`],
    subst: `\\overline{S} = (${texAlg(S)})\\,\\text{VA}`,
    bullets: [`P = ${formatQuantity(S.re, 'W')}`, `Q = ${formatQuantity(S.im, 'var')} (${S.im >= 0 ? 'induktív: meddőt fogyaszt' : 'kapacitív: meddőt termel'})`, `S = |S̄| = ${formatQuantity(abs(S), 'VA')}`],
    result: { symbol: '\\overline{S}', value: abs(S), unit: 'VA', tex: `(${texAlg(S)})\\,\\text{VA}` },
    highlight: { elements: [b.sourceId!], groups: [{ elements: fc.pIds[1]!, label: `S = ${formatQuantity(abs(S), 'VA')}`, tone: 'result' }] },
  });
  const text =
    variant === 'S'
      ? 'Mekkora a generátorra kapcsolt hálózat látszólagos teljesítménye?'
      : 'Mekkora a generátorra kapcsolt hálózat hatásos és meddő teljesítménye? (A meddő induktív esetben pozitív.)';
  const fields: AnswerField[] =
    variant === 'S'
      ? [{ id: fid(), label: 'S', unit: 'VA', answer: abs(S), magnitudeOnly: true, example: '0,125 mVA' }]
      : [
          { id: fid(), label: 'P', unit: 'W', answer: S.re, example: '2 mW' },
          { id: fid(), label: 'Q', unit: 'var', answer: S.im, example: '−1 mvar' },
        ];
  return { ...base, title: text, given: [omegaGiven(spec.omega), sourceGiven(src, spec.omega)], questions: [{ id: qid(), text, fields }], solution: { method: 'teljesitmeny', title: 'Teljesítmények', steps, answers: [] } };
}

function theveninTask(rng: Rng, o: AcOptions): Task | null {
  const src = pickSource(rng, true);
  const omega = rng.pick(OMEGAS);
  const tail = rng.chance(0.3) ? [pickPart(rng, rng.pick(['R', 'L', 'C'] as Passive[]), omega)] : undefined;
  const spec = randomLadder(rng, o.level, { source: src, terminals: 'output', tail }, { omega });
  if (!spec) return null;
  const b = withSourceLabel(buildLadder(spec));
  if (!healthy(b)) return null;
  const ctx = { omega: spec.omega, ac: true };
  const variant = rng.weighted([
    ['Z', 3],
    ['U', 3],
    ['I', 2],
  ] as const);
  const steps: Step[] = [];
  const rx = reactanceStep(b);
  if (rx) steps.push(rx);
  const base = { domain: 'ac' as const, seed: o.seed, topic: o.topic, topicName: AC_TOPIC_NAMES[o.topic], levelName: AC_LEVEL_NAMES[o.level], meta: ladderMeta(b), circuit: b.circuit, given: [omegaGiven(spec.omega), sourceGiven(src, spec.omega)] };
  let zth: Cx | null = null;
  if (variant !== 'U') {
    if (steps.length) steps[steps.length - 1]!.group = 'Belső impedancia';
    const before = steps.length;
    zth = backwardChain(b, steps, ctx, texZ('th'));
    steps[before]!.group = 'Belső impedancia';
    if (variant === 'Z') {
      const text = 'Mekkora az A–B kapcsokra csatlakozó hálózat Thevenin-helyettesítő generátorának belső impedanciája? Add meg algebrai alakban!';
      return { ...base, title: text, questions: [{ id: qid(), text, fields: complexFields(zth, 'Ω') }], solution: { method: 'helyettesito', title: 'Belső impedancia', steps, answers: [] } };
    }
  }
  // Üresjárási feszültség: az eredeti hálózat osztóival, terheletlen kapcsokon.
  const firstU = steps.length;
  const fc = forwardChain(b, steps, ctx);
  const U0 = sourceVoltageStep(b, fc, steps, ctx);
  const n = b.series.length;
  // Az osztólánc a kimeneti keresztágig.
  const { U } = dividerChain(b, fc, U0, n, steps, ctx);
  if (steps[firstU]) steps[firstU]!.group = 'Üresjárási feszültség';
  const uu = U[n]!;
  steps.push({
    title: 'Üresjárási feszültség',
    text: b.tail ? 'A kapcsok terheletlenek, így a kapcsok előtti soros ágon nem folyik áram, nem esik rajta feszültség: az üresjárási feszültség az utolsó keresztág feszültsége.' : 'A kapcsok terheletlenek: az üresjárási feszültség az utolsó keresztág (a kapcsokkal párhuzamos rész) feszültsége.',
    terms: [`${texU('\\ddot u')} = ${texU(String(n))}`],
    result: { symbol: texU('\\ddot u'), value: abs(uu), unit: 'V', tex: `${texPhasor(uu, 'V', ctx)}` },
    highlight: { terminals: true, elements: b.tail?.ids ?? [] },
  });
  if (variant === 'U') {
    steps.push(timeFunctionStep('u_{\\ddot u}', uu, 'V', spec.omega, b.sourceId!));
    const text = 'Mekkora az A–B kapcsokra csatlakozó hálózat Thevenin-helyettesítő generátorának üresjárási feszültsége (csúcsérték és kezdőfázis)? A referenciairány A-tól B felé mutat.';
    return { ...base, title: text, questions: [{ id: qid(), text, fields: phasorFields(uu, 'V') }], solution: { method: 'helyettesito', title: 'Üresjárási feszültség', steps, answers: [] } };
  }
  const irz = div(uu, zth!);
  steps.push({
    title: 'Rövidzárási áram',
    text: 'A Thevenin- és a Norton-helyettesítés egymásba átszámolható: a Norton-generátor forrásárama (a rövidzárási áram) az üresjárási feszültség osztva a belső impedanciával.',
    group: 'Norton-generátor',
    terms: [`${texI('rz')} = \\dfrac{${texU('\\ddot u')}}{${texZ('th')}}`],
    subst: `${texI('rz')} = \\dfrac{${texPhasor(uu, 'V', ctx)}}{${texExp(zth!)}\\,\\Omega} = ${texPhasor(irz, 'A', ctx)}`,
    result: { symbol: texI('rz'), value: abs(irz), unit: 'A', tex: `${texPhasor(irz, 'A', ctx)}` },
    highlight: { terminals: true },
  });
  const text = 'Adja meg az A–B kapcsokra csatlakozó hálózat Norton-helyettesítő generátorának forrásáramát (csúcsérték és kezdőfázis)! A rövidzárási áram A-tól B felé folyik.';
  return { ...base, title: text, questions: [{ id: qid(), text, fields: phasorFields(irz, 'A') }], solution: { method: 'helyettesito', title: 'Norton-generátor', steps, answers: [] } };
}

function resonanceTask(rng: Rng, o: AcOptions): Task | null {
  const series = rng.chance(0.5);
  const variant = rng.pick(series ? (['adatok', 'savszel'] as const) : (['adatok', 'savszel'] as const));
  const R = rng.pick(series ? [10, 20, 50, 100, 250] : [500, 1000, 2000, 5000]);
  const L = rng.pick([10e-3, 20e-3, 50e-3, 100e-3, 200e-3, 250e-3]);
  const C = rng.pick([10e-9, 20e-9, 50e-9, 100e-9, 250e-9]);
  const w0 = 1 / Math.sqrt(L * C);
  const Q0 = series ? (w0 * L) / R : R / (w0 * L);
  const B = w0 / Q0;
  if (Q0 < 0.5 || Q0 > 200) return null;
  const spec: LadderSpec = series
    ? { omega: w0, source: { kind: 'V', amp: 1, phase: 0 }, series: [[{ kind: 'R', value: R }, { kind: 'L', value: L }]], shunts: [[{ kind: 'C', value: C }]], terminals: null }
    : { omega: w0, source: { kind: 'I', amp: 1e-3, phase: 0 }, series: [[], [], []], shunts: [[{ kind: 'R', value: R }], [{ kind: 'L', value: L }], [{ kind: 'C', value: C }]], terminals: null };
  const b = buildLadder(spec);
  for (const br of b.circuit.branches) for (const e of br.elements) if (e.kind === 'V' || e.kind === 'I') e.label = e.kind === 'V' ? 'ug(t)' : 'ig(t)';
  const kindName = series ? 'soros' : 'párhuzamos';
  const qL = texQtyReal(L, 'H');
  const qC = texQtyReal(C, 'F');
  const qR = texQtyReal(R, 'Ω');
  const steps: Step[] = [];
  const omega0 = { title: 'Rezonancia-körfrekvencia', text: `Rezonanciában a tekercs és a kondenzátor reaktanciája egyenlő nagyságú (ωL = 1/(ωC)), így kioltják egymást; ${series ? 'a soros kör impedanciája ekkor a legkisebb (csak R marad).' : 'a párhuzamos kör impedanciája ekkor a legnagyobb (csak R marad).'}`, terms: ['\\omega_0 = \\dfrac{1}{\\sqrt{LC}}'], subst: `\\omega_0 = \\dfrac{1}{\\sqrt{${qL}\\cdot ${qC}}} = ${texNum(w0)}\\,\\tfrac{\\text{rad}}{\\text{s}}`, result: { symbol: '\\omega_0', value: w0, unit: 'rad/s' as const }, highlight: { elements: b.circuit.branches.flatMap((x) => x.elements).filter((e) => e.kind === 'L' || e.kind === 'C').map((e) => e.id) } };
  const qStep = { title: 'Jósági tényező', text: series ? 'A soros rezgőkör jósági tényezője: a rezonanciabeli reaktancia és a veszteségi ellenállás aránya.' : 'A párhuzamos rezgőkör jósági tényezője: a veszteségi ellenállás és a rezonanciabeli reaktancia aránya.', terms: [series ? 'Q_0 = \\dfrac{\\omega_0 L}{R} = \\dfrac{1}{R}\\sqrt{\\dfrac{L}{C}}' : 'Q_0 = \\dfrac{R}{\\omega_0 L} = R\\sqrt{\\dfrac{C}{L}}'], subst: `Q_0 = ${texNum(Q0)}`, result: { symbol: 'Q_0', value: Q0, unit: '' as const }, highlight: {} };
  const bStep = { title: 'Sávszélesség', text: 'A sávszélesség a rezonancia-körfrekvencia osztva a jósági tényezővel; a képletbe beírva egyszerűsödik.', terms: [series ? 'B = \\dfrac{\\omega_0}{Q_0} = \\dfrac{R}{L}' : 'B = \\dfrac{\\omega_0}{Q_0} = \\dfrac{1}{RC}'], subst: series ? `B = \\dfrac{${qR}}{${qL}} = ${texNum(B)}\\,\\tfrac{\\text{rad}}{\\text{s}}` : `B = \\dfrac{1}{${qR}\\cdot ${qC}} = ${texNum(B)}\\,\\tfrac{\\text{rad}}{\\text{s}}`, result: { symbol: 'B', value: B, unit: 'rad/s' as const }, highlight: {} };
  const base = { domain: 'ac' as const, seed: o.seed, topic: o.topic, topicName: AC_TOPIC_NAMES[o.topic], levelName: AC_LEVEL_NAMES[o.level], meta: `${kindName} rezgőkör`, circuit: b.circuit };
  if (variant === 'adatok') {
    steps.push(omega0, qStep, bStep);
    const text = `Egy ${kindName} rezgőkörben R = ${formatQuantity(R, 'Ω')}, L = ${formatQuantity(L, 'H')}, C = ${formatQuantity(C, 'F')}. Mekkora a rezonancia-körfrekvencia és a sávszélesség?`;
    return { ...base, title: text, given: [`R = ${qR},\\; L = ${qL},\\; C = ${qC}`], questions: [{ id: qid(), text, fields: [{ id: fid(), label: 'ω₀', unit: 'rad/s', answer: w0, magnitudeOnly: true, example: '10000 rad/s' }, { id: fid(), label: 'B', unit: 'rad/s', answer: B, magnitudeOnly: true, example: '1000 rad/s' }] }], solution: { method: 'rezonancia', title: 'Rezgőkör', steps, answers: [] } };
  }
  // Visszafejtés: adott a sávszélesség és R, keresett a hiányzó elem és ω0.
  if (series) {
    steps.push({ title: 'Az induktivitás a sávszélességből', text: 'Soros rezgőkörben B = R/L, ebből az induktivitás közvetlenül kifejezhető.', terms: ['B = \\dfrac{\\omega_0}{Q_0} = \\dfrac{R}{L}', 'L = \\dfrac{R}{B}'], subst: `L = \\dfrac{${qR}}{${texNum(B)}} = ${texQtyReal(L, 'H')}`, result: { symbol: 'L', value: L, unit: 'H' }, highlight: {} }, omega0);
    const text = `Mekkora a rezonancia-körfrekvenciája annak a soros rezgőkörnek, amelyben R = ${formatQuantity(R, 'Ω')}, C = ${formatQuantity(C, 'F')}, a sávszélesség pedig B = ${formatQuantity(B, 'rad/s')}?`;
    return { ...base, title: text, given: [`R = ${qR},\\; C = ${qC},\\; B = ${texNum(B)}\\,\\tfrac{\\text{rad}}{\\text{s}}`], questions: [{ id: qid(), text, fields: [{ id: fid(), label: 'ω₀', unit: 'rad/s', answer: w0, magnitudeOnly: true, example: '4000 rad/s' }] }], solution: { method: 'rezonancia', title: 'Rezgőkör', steps, answers: [] } };
  }
  steps.push(
    { title: 'A kapacitás a sávszélességből', text: 'Párhuzamos rezgőkörben B = 1/(RC), ebből a kapacitás kifejezhető.', terms: ['B = \\dfrac{\\omega_0}{Q_0} = \\dfrac{1}{RC}', 'C = \\dfrac{1}{RB}'], subst: `C = \\dfrac{1}{${qR}\\cdot ${texNum(B)}} = ${qC}`, result: { symbol: 'C', value: C, unit: 'F' }, highlight: {} },
    { title: 'Az induktivitás a rezonanciából', text: 'A rezonancia-körfrekvencia képletéből (ω₀ = 1/√(LC)) az induktivitás kifejezhető.', terms: ['L = \\dfrac{1}{\\omega_0^2 C}'], subst: `L = \\dfrac{1}{${texNum(w0)}^2\\cdot ${qC}} = ${qL}`, result: { symbol: 'L', value: L, unit: 'H' }, highlight: {} },
  );
  const text = `Mekkora az induktivitás abban a párhuzamos rezgőkörben, amelynek veszteségi ellenállása ${formatQuantity(R, 'Ω')}, sávszélessége B = ${formatQuantity(B, 'rad/s')}, rezonancia-körfrekvenciája ω₀ = ${formatQuantity(w0, 'rad/s')}?`;
  return { ...base, title: text, given: [`R = ${qR},\\; B = ${texNum(B)}\\,\\tfrac{\\text{rad}}{\\text{s}},\\; \\omega_0 = ${texNum(w0)}\\,\\tfrac{\\text{rad}}{\\text{s}}`], questions: [{ id: qid(), text, fields: [{ id: fid(), label: 'L', unit: 'H', answer: L, magnitudeOnly: true, example: '200 mH' }] }], solution: { method: 'rezonancia', title: 'Rezgőkör', steps, answers: [] } };
}

function transientTask(rng: Rng, o: AcOptions): Task | null {
  const loadKind: 'L' | 'C' = rng.chance(0.5) ? 'L' : 'C';
  const sections = o.level === 'konnyu' ? 1 : o.level === 'kozepes' ? rng.pick([1, 2]) : 2;
  const R = () => ({ kind: 'R' as const, value: rng.pick([1000, 2000, 3000, 4000, 6000]) });
  const series: ArmSpec[] = [];
  const shunts: (ArmSpec | null)[] = [];
  for (let k = 1; k <= sections; k++) {
    series.push([R()]);
    shunts.push([R()]);
  }
  const tail = rng.chance(o.level === 'konnyu' ? 0.3 : 0.6) ? [R()] : undefined;
  const load: PartSpec = loadKind === 'L' ? { kind: 'L', value: rng.pick([10e-3, 20e-3, 50e-3, 100e-3, 200e-3]) } : { kind: 'C', value: rng.pick([10e-9, 20e-9, 50e-9, 100e-9, 1e-6]) };
  const src = { kind: 'V' as const, amp: rng.pick([1, 2, 5, 10, 12, 20]), phase: 0, withSwitch: true };
  const spec: LadderSpec = { omega: 0, source: src, series, shunts, tail, terminals: null, load };
  const b = withSourceLabel(buildLadder(spec));
  const ctx = { omega: 0, ac: false };
  const steps: Step[] = [];
  const loadId = b.loadId!;
  steps.push({
    title: 'A módszer',
    text: `Elsőrendű hálózat: egyetlen energiatároló (${loadKind === 'L' ? 'tekercs' : 'kondenzátor'}) van benne. A kapcsoló zárása előtt nem folyt áram, így a ${loadKind === 'L' ? 'tekercs árama' : 'kondenzátor feszültsége'} 0 (és ugrásszerűen nem változhat). A megoldás alakja: x(t) = x∞ + M·e^(−t/τ), ahol x∞ az állandósult érték, τ az időállandó.`,
    bullets: ['τ: a tárolóra kapcsolódó hálózat Thevenin-ellenállásából (a generátor rövidzár).', `x∞: állandósult állapotban a ${loadKind === 'L' ? 'tekercs rövidzár' : 'kondenzátor szakadás'}.`, 'M: a kezdeti feltételből (t = 0-ban x = 0).'],
    highlight: { elements: [loadId] },
  });
  const before = steps.length;
  const rth = backwardChain(b, steps, ctx, 'R_{th}').re;
  steps[before]!.group = 'Időállandó';
  const tau = loadKind === 'L' ? load.value / rth : rth * load.value;
  steps.push({
    title: 'Időállandó',
    text: loadKind === 'L' ? 'Tekercsnél az időállandó az induktivitás osztva a rá kapcsolódó (Thevenin-)ellenállással.' : 'Kondenzátornál az időállandó a rá kapcsolódó (Thevenin-)ellenállás szorozva a kapacitással.',
    terms: [loadKind === 'L' ? '\\tau = \\dfrac{L}{R_{th}}' : '\\tau = R_{th}\\cdot C'],
    subst: loadKind === 'L' ? `\\tau = \\dfrac{${texQtyReal(load.value, 'H')}}{${texQtyReal(rth, 'Ω')}} = ${texQtyReal(tau, 's')}` : `\\tau = ${texQtyReal(rth, 'Ω')}\\cdot ${texQtyReal(load.value, 'F')} = ${texQtyReal(tau, 's')}`,
    result: { symbol: '\\tau', value: tau, unit: 's' },
    highlight: { elements: [loadId] },
  });
  const firstU = steps.length;
  const fc = forwardChain(b, steps, ctx);
  const U0 = sourceVoltageStep(b, fc, steps, ctx);
  const { U } = dividerChain(b, fc, U0, b.series.length, steps, ctx);
  if (steps[firstU]) steps[firstU]!.group = 'Állandósult állapot';
  const uu = U[b.series.length]!.re;
  const xInf = loadKind === 'L' ? uu / rth : uu;
  steps.push({
    title: 'Állandósult érték',
    text: loadKind === 'L' ? 'Állandósult állapotban a tekercs rövidzár: az árama a Thevenin-helyettesítő rövidzárási árama, vagyis az üresjárási feszültség osztva a belső ellenállással.' : 'Állandósult állapotban a kondenzátor szakadás (nem folyik áram), így a feszültsége a kapcsain lévő üresjárási feszültség.',
    terms: [loadKind === 'L' ? `i_{L\\infty} = \\dfrac{U_{\\ddot u}}{R_{th}}` : `u_{C\\infty} = U_{\\ddot u}`],
    subst: loadKind === 'L' ? `i_{L\\infty} = \\dfrac{${texQtyReal(uu, 'V')}}{${texQtyReal(rth, 'Ω')}} = ${texQtyReal(xInf, 'A')}` : `u_{C\\infty} = ${texQtyReal(xInf, 'V')}`,
    result: { symbol: loadKind === 'L' ? 'i_{L\\infty}' : 'u_{C\\infty}', value: xInf, unit: loadKind === 'L' ? 'A' : 'V' },
    highlight: { elements: [loadId] },
  });
  const m = rng.pick([0.5, 1, 2, 3]);
  const t1 = Number((m * tau).toPrecision(2));
  const x1 = xInf * (1 - Math.exp(-t1 / tau));
  const sym = loadKind === 'L' ? 'i_L' : 'u_C';
  const unit = loadKind === 'L' ? 'A' : 'V';
  steps.push({
    title: 'Időfüggvény',
    text: `A kezdeti feltételből: t = 0-ban ${sym} = 0, tehát 0 = x∞ + M, vagyis M = −x∞. Így a ${loadKind === 'L' ? 'tekercs árama' : 'kondenzátor feszültsége'} exponenciálisan közelít az állandósult értékhez.`,
    terms: [`${sym}(t) = ${texQtyReal(xInf, unit)}\\cdot\\left(1 - e^{-t/\\tau}\\right)`],
    subst: `${sym}(${texQtyReal(t1, 's')}) = ${texQtyReal(xInf, unit)}\\cdot\\left(1 - e^{-${texNum(t1 / tau)}}\\right) = ${texQtyReal(x1, unit)}`,
    result: { symbol: `${sym}(t_1)`, value: x1, unit },
    highlight: { elements: [loadId] },
  });
  const text = `A kapcsolót t = 0-ban zárjuk (előtte a hálózat energiamentes). Mekkora az időállandó, és mennyi ${loadKind === 'L' ? `a tekercs árama (fentről lefelé)` : 'a kondenzátor feszültsége (fent a +)'} t₁ = ${formatQuantity(t1, 's')} pillanatban?`;
  return {
    domain: 'ac',
    seed: o.seed,
    topic: o.topic,
    topicName: AC_TOPIC_NAMES[o.topic],
    levelName: AC_LEVEL_NAMES[o.level],
    meta: `${loadKind === 'L' ? 'RL' : 'RC'}-kör · ${b.circuit.branches.flatMap((x) => x.elements).filter((e) => e.kind === 'R').length} ellenállás`,
    title: text,
    given: [`U_g = ${texQtyReal(src.amp, 'V')}\\ \\text{(egyenfeszültség)},\\quad t_1 = ${texQtyReal(t1, 's')}`],
    circuit: b.circuit,
    questions: [{ id: qid(), text, target: loadId, fields: [{ id: fid(), label: 'τ', unit: 's', answer: tau, magnitudeOnly: true, example: '37,5 µs' }, { id: fid(), label: loadKind === 'L' ? 'iL(t₁)' : 'uC(t₁)', unit, answer: x1, example: unit === 'A' ? '0,5 mA' : '2 V' }] }],
    solution: { method: 'tranziens', title: 'Bekapcsolási jelenség', steps, answers: [] },
  };
}

const BUILDERS: Record<AcTopic, (rng: Rng, o: AcOptions) => Task | null> = {
  'ac-impedancia': impedanceTask,
  'ac-fazor': phasorTask,
  'ac-teljesitmeny': powerTask,
  'ac-helyettesito': theveninTask,
  'ac-rezonancia': resonanceTask,
  tranziens: transientTask,
};

export function generateAcTask(o: AcOptions): Task {
  const rng = new Rng(`${o.seed}|${o.topic}|${o.level}|ac`);
  for (let attempt = 0; attempt < 400; attempt++) {
    const t = BUILDERS[o.topic](rng, o);
    if (t) return t;
  }
  throw new Error('Nem sikerült feladatot generálni.');
}

/** Ellenőrzés a független MNA-megoldóval (a tesztek használják). */
export function referenceSolve(t: Task, omega: number) {
  return t.circuit ? solveAc(t.circuit, omega) : null;
}

