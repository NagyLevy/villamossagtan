// Feladatgenerátor: seed → áramkör + kérdések. Determinisztikus: ugyanaz a seed és beállítás
// mindig ugyanazt a feladatot adja. Érvénytelen áramkörnél automatikusan újrapróbálkozik.

import { contribution, fundamentalLoops, equivalentResistance, meshCount, solve, theveninAt, type RealSolution } from '../solver/analysis';
import type { Circuit, CircuitElement } from '../solver/model';
import { allElements } from '../solver/model';
import { killSources, toNetlist, type NetlistMapping } from '../solver/netlist';
import { singleSourceSteps } from '../methods/reduction';
import { isSeriesParallelReducible, needsStarDeltaBetween, singleSourceNeedsStarDelta } from '../simplify/seriesParallel';
import { deltaToStar, findTransform, niceStars, starToDelta, type Star } from '../simplify/stardelta';
import { formatQuantity, isNiceValue } from '../units';
import { fillSlots, newElement, type FillSpec } from './fill';
import {
  askElementI,
  askElementP,
  askElementU,
  capitalize,
  elementName,
  questionId,
  valueLabel,
  type GivenValue,
  type Question,
} from './questions';
import { injectStarDelta, STAR_DELTA_TOPICS } from './inject';
import { Rng } from './rng';
import { makeElement, Sketch, type Slot, type SlotRole } from './sketch';
import { addBypass, bridge, gridCellsOf, ladder, meshOptions, realSource, singleLoop, skeletonFor, type Topology } from './templates';
import { meshes } from '../methods/engine';
import { circuitIssues, seriesSourcePairs } from './validate';
import { pickI, pickOhmR, pickR, pickV, POWER_RATINGS, type Level } from './values';

export type Topic = 'ohm' | 'eredo' | 'kirchhoff' | 'oszto' | 'halozat' | 'valodi-gen' | 'thevenin' | 'tobbforras' | 'tanari' | 'csillag-delta' | 'zh';

/** A tanár úr füzetének (gyakorlati megoldásainak) feladattípusai, módszerenként. */
export type TeacherType = 'szuperpozicio' | 'thevenin' | 'hurokaram' | 'csomoponti';
export const TEACHER_TYPES: TeacherType[] = ['szuperpozicio', 'thevenin', 'hurokaram', 'csomoponti'];

export const TOPIC_NAMES: Record<Topic, string> = {
  ohm: 'Ohm és teljesítmény',
  eredo: 'Eredő ellenállás',
  kirchhoff: 'Kirchhoff törvényei',
  oszto: 'Feszültség- és áramosztás',
  halozat: 'Teljes hálózatanalízis',
  'valodi-gen': 'Valódi generátor terhelése',
  thevenin: 'Thevenin és Norton',
  tobbforras: 'Többforrásos hálózatok',
  tanari: 'A tanár úr feladattípusai',
  'csillag-delta': 'Csillag-delta',
  zh: 'ZH-feladat',
};

export type ZhType = 'sok-forras' | 'sok-ellenallas';
export type SourceMix = 'V' | 'I' | 'vegyes';

export interface GenerateOptions {
  seed: string;
  topic: Topic;
  level?: Level;
  topology?: Topology | 'veletlen';
  /** Forrásszám felülírása (többforrásos feladatoknál). */
  sourceCount?: number;
  sourceMix?: SourceMix;
  /** Csillag-delta feladatok engedélyezése (a 6. lépésben kap saját generátort). */
  starDelta?: boolean;
  /** Csillag-delta irány: delta → csillag, csillag → delta vagy véletlen. */
  starDeltaMode?: 'delta-csillag' | 'csillag-delta' | 'veletlen';
  /** Addig próbálkozik, amíg a keresett mennyiség szép (kerek) szám. */
  roundResults?: boolean;
  zhType?: ZhType | 'veletlen';
  /** A tanár úr feladattípusa (csak a 'tanari' témakörben); alapból véletlen. */
  teacherType?: TeacherType | 'veletlen';
  /** Pontos forrásmegoszlás (feszültség- és áramforrások száma). */
  sourceSplit?: { nV: number; nI: number };
}

export interface Problem {
  seed: string;
  topic: Topic;
  level: Level;
  topology: Topology | 'egyedi';
  zhType?: ZhType;
  circuit: Circuit;
  questions: Question[];
  stats: { meshes: number; resistors: number; sources: number };
  /** Hányadik próbálkozásra sikerült érvényes feladatot találni. */
  attempts: number;
  /** Csillag-delta bekapcsolva készült (a megoldás használhat átalakítást, pl. szuperpozíció részáramkörében). */
  starDelta?: boolean;
  /** A tanár úr feladattípusa ('tanari' témakör). */
  teacherType?: TeacherType;
}

interface Draft {
  circuit: Circuit;
  topology: Topology | 'egyedi';
  zhType?: ZhType;
  teacherType?: TeacherType;
  /** A kérdéseket a kész (azonosítókkal ellátott) áramkörből és a megoldásból állítjuk elő. */
  ask: (ctx: Ctx) => Question[] | null;
}

interface Ctx {
  circuit: Circuit;
  map: NetlistMapping;
  sol: RealSolution;
  rng: Rng;
  opts: Required<Pick<GenerateOptions, 'starDelta'>>;
}

const MAX_ATTEMPTS = 3000;
/** Egy mérettel nagyobb hálózat (csillag-delta beépítéséhez, ha a kisebbe nem fér). */
const LARGER: Partial<Record<Level, Level>> = { alapozo: 'konnyu', konnyu: 'kozepes', kozepes: 'nehez' };
const EPS = 1e-9;

export function generateProblem(options: GenerateOptions): Problem {
  const topic = options.topic;
  const level: Level = topic === 'zh' ? 'zh' : options.level ?? 'alapozo';
  const rng = new Rng(`${options.seed}|${topic}|${level}|${options.topology ?? ''}|${options.sourceCount ?? ''}|${options.sourceMix ?? ''}|${options.zhType ?? ''}${options.teacherType && options.teacherType !== 'veletlen' ? `|${options.teacherType}` : ''}|0`);
  const starDelta = options.starDelta ?? false;
  // Csillag-delta bekapcsolva: ugyanaz a feladat készül (ugyanaz a seed), és utána kerül bele egy új
  // ellenállás, ami miatt átalakítás kell. Ezekben a témakörökben az alapfeladat maga nem hidas.
  const inject = starDelta && STAR_DELTA_TOPICS.has(topic);
  const draftOptions = inject ? { ...options, starDelta: false } : options;

  // Ha a hálózat ezen a méreten túl kicsi a hídhoz (pl. könnyű Thevenin), egy mérettel nagyobb
  // hálózatból készül; a szint (és vele az értékkészlet) marad.
  let draftLevel = level;
  let failedInjections = 0;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const draft = buildDraft(topic, draftLevel, draftOptions, rng);
    if (!draft) continue;
    let circuit = draft.circuit;
    if (inject) {
      const sdRng = new Rng(`${options.seed}|csillag-delta|${attempt}`);
      const mode = options.starDeltaMode === 'csillag-delta' || options.starDeltaMode === 'delta-csillag' ? options.starDeltaMode : sdRng.pick(['delta-csillag', 'csillag-delta'] as const);
      const withBridge = injectStarDelta(circuit, sdRng, mode);
      if (!withBridge) {
        if (++failedInjections % 40 === 0) draftLevel = LARGER[draftLevel] ?? draftLevel;
        continue;
      }
      circuit = withBridge;
    }
    if (circuitIssues(circuit).length) continue;
    // Egy ablakban (hurokban) legfeljebb egy forrás lehet.
    if (tooManySourcesInMesh(circuit)) continue;
    const map = toNetlist(circuit);
    // Két forrás sosem kerül sorba (sem egy ágon belül, sem egy sarkon át).
    if (seriesSourcePairs(map.net).length) continue;
    const sol = solve(map.net);
    if (!sol) continue;
    const questions = draft.ask({ circuit, map, sol, rng, opts: { starDelta } });
    if (!questions || questions.length === 0) continue;
    const numeric = questions.filter((q) => q.kind !== 'table');
    if (numeric.some((q) => !Number.isFinite(q.answer) || Math.abs(q.answer) < EPS)) continue;
    if (options.roundResults && numeric.some((q) => !isNiceValue(q.answer, q.unit!, 2))) continue;

    const els = allElements(circuit);
    return {
      seed: options.seed,
      topic,
      level,
      topology: draft.topology,
      zhType: draft.zhType,
      teacherType: draft.teacherType,
      circuit,
      questions,
      stats: { meshes: meshCount(map.net), resistors: els.filter((e) => e.kind === 'R').length, sources: els.filter((e) => e.kind !== 'R').length },
      attempts: attempt,
      starDelta,
    };
  }
  throw new Error(`Nem sikerült érvényes feladatot generálni (${topic}, ${level}, seed: ${options.seed}).`);
}

// ───────────────────────────── vázlatok témakörönként ─────────────────────────────

function buildDraft(topic: Topic, level: Level, o: GenerateOptions, rng: Rng): Draft | null {
  switch (topic) {
    case 'ohm':
      return ohmDraft(rng);
    case 'eredo':
      // Csillag-delta opcióval az eredő-feladatok között hidas hálózat is előkerül.
      if (o.starDelta && sizeLevel(level) !== 'alapozo' && rng.chance(0.35)) return bridgeStarDeltaDraft(pickMode(o, rng), 'Req', rng);
      return eredoDraft(level, rng);
    case 'oszto':
      return osztoDraft(level, rng);
    case 'halozat':
      return halozatDraft(level, rng);
    case 'valodi-gen':
      return realSourceDraft(level, rng);
    case 'kirchhoff':
      return kirchhoffDraft(level, o, rng);
    case 'thevenin':
      return theveninDraft(level, o, rng);
    case 'tobbforras':
      return level === 'zh' ? zhDraft(o, rng) : multiDraft(level, o, rng);
    case 'tanari':
      return teacherDraft(level, o, rng);
    case 'csillag-delta':
      return starDeltaDraft(level, o, rng);
    case 'zh':
      return zhDraft(o, rng);
  }
}

/** A méretezéshez használt szint (ZH-szinten a nehéz méretek, de ZH-értékkészlet). */
function sizeLevel(level: Level): Exclude<Level, 'zh'> {
  return level === 'zh' ? 'nehez' : level;
}

// Ohm-törvény és teljesítmény: egy forrás, egy ellenállás, előtagokkal.
function ohmDraft(rng: Rng): Draft {
  const s = singleLoop();
  const [src, load] = s.slots as [Slot, Slot];
  const variant = rng.pick(['UR', 'IR', 'rating'] as const);
  const R = pickOhmR(rng);
  const r = makeElement('R', R);
  if (variant === 'IR') {
    src.branch.elements = [makeElement('I', rng.pick([0.5, 1, 2, 5, 10, 20, 50]) / 1000, -1)];
  } else {
    src.branch.elements = [makeElement('V', rng.pick([1.5, 3, 4.5, 5, 6, 9, 12, 24, 48]), -1)];
  }
  if (variant === 'rating') r.rating = rng.pick(POWER_RATINGS);
  load.branch.elements = [r];
  return {
    circuit: s.build(),
    topology: 'egyedi',
    ask: ({ circuit, sol }) => {
      const el = allElements(circuit).find((e) => e.kind === 'R')!;
      const res = sol.elements.get(el.id)!;
      if (variant === 'rating') {
        const P = el.rating!;
        const desc = `Egy ellenállás feliratán ez áll: ${valueLabel(el)}, ${formatQuantity(P, 'W')}.`;
        return [
          { id: questionId(), kind: 'Imax', text: `${desc} Mekkora a legnagyobb megengedett áram?`, unit: 'A', answer: Math.sqrt(P / el.value), magnitudeOnly: true, target: el.id },
          { id: questionId(), kind: 'Umax', text: 'Mekkora a legnagyobb megengedett feszültség rajta?', unit: 'V', answer: Math.sqrt(P * el.value), magnitudeOnly: true, target: el.id },
        ];
      }
      return variant === 'UR'
        ? [askElementI(circuit, el, res.I, true), askElementP(circuit, el, res.P)]
        : [askElementU(circuit, el, res.U, true), askElementP(circuit, el, res.P)];
    },
  };
}

/** Soros-párhuzamos létra: balról nézve mindig redukálható. A 0. fok helye üres (forrás / kapcsok). */
function spLadder(cells: number, nR: number, level: Level, rng: Rng): Sketch | null {
  if (nR < cells) return null;
  const s = ladder(cells, { openFirstRung: true });
  const spec: FillSpec = { nR, nV: 0, nI: 0, level, allowSourceOnly: false, sourceWeights: {} };
  if (!fillSlots(s.slots, spec, rng)) return null;
  // Néha egy ellenállás "púpként" átível egy kitöltött sínszakasz fölött vagy alatt: azzal
  // párhuzamos, így a hálózat továbbra is soros-párhuzamosan összevonható.
  if (rng.chance(0.2)) {
    const rails = s.slots.filter((x) => (x.role === 'rail-top' || x.role === 'rail-bottom') && x.branch.elements.length > 0);
    if (rails.length) {
      const r = rng.pick(rails);
      const pos = new Map(s.points.map((p) => [p.id, p]));
      const a = pos.get(r.branch.from)!;
      const b = pos.get(r.branch.to)!;
      const hump = addBypass(s, r.role === 'rail-top' ? 'top' : 'bottom', a.x, b.x);
      hump.branch.elements = [makeElement('R', pickR(rng, level))];
    }
  }
  // Keresztbe kötött ellenállás (mint a ZH-rajzokon): egy cellában a felső és az alsó sín között
  // ferdén. Csak ott, ahol az egyik sínszakasz üres vezeték: így a ferde ellenállás egy fokkal
  // párhuzamos, és a hálózat továbbra is soros-párhuzamosan összevonható.
  if (rng.chance(0.4)) {
    const at = (x: number, y: number) => s.points.find((p) => p.x === x && p.y === y)?.id;
    const railEmpty = (x: number, y: number) => {
      const a = at(x, y);
      const b = at(x + 2, y);
      return s.branches.some((br) => br.from === a && br.to === b && br.elements.length === 0);
    };
    const xs = [...new Set(s.points.map((p) => p.x))].sort((u, v) => u - v);
    const options: [number, number, number, number][] = [];
    for (const x of xs.slice(1, -1)) {
      if (railEmpty(x, 2)) options.push([x, 0, x + 2, 2]); // felső bal → alsó jobb
      if (railEmpty(x, 0)) options.push([x, 2, x + 2, 0]); // alsó bal → felső jobb
    }
    if (options.length) {
      const [x1, y1, x2, y2] = rng.pick(options);
      const d = s.slot(x1, y1, x2, y2, 'diag', true, 1);
      d.branch.elements = [makeElement('R', pickR(rng, level))];
    }
  }
  return s;
}

const SP_SIZE: Record<Exclude<Level, 'zh'>, { cells: [number, number]; R: [number, number] }> = {
  alapozo: { cells: [1, 2], R: [2, 5] },
  konnyu: { cells: [2, 3], R: [4, 5] },
  kozepes: { cells: [3, 3], R: [6, 7] },
  nehez: { cells: [3, 4], R: [8, 10] },
};

function spSize(level: Level, rng: Rng): { cells: number; nR: number } {
  const z = SP_SIZE[sizeLevel(level)];
  const cells = rng.int(z.cells[0], z.cells[1]);
  const nR = rng.int(Math.max(z.R[0], cells), Math.min(z.R[1], cells * 3));
  return { cells, nR };
}

function eredoDraft(level: Level, rng: Rng): Draft | null {
  const { cells, nR } = spSize(level, rng);
  const s = spLadder(cells, nR, level, rng);
  if (!s) return null;
  s.terminals = { a: s.pt(0, 0), b: s.pt(0, 2) };
  return {
    circuit: s.build(),
    topology: 'soros-parhuzamos',
    ask: ({ circuit, map }) => {
      const a = map.pointNode.get(circuit.terminals!.a)!;
      const b = map.pointNode.get(circuit.terminals!.b)!;
      const Req = equivalentResistance(map.net, a, b);
      return [{ id: questionId(), kind: 'Req', text: 'Mekkora az A és B pontok közötti eredő ellenállás?', unit: 'Ω', answer: Req, magnitudeOnly: true, points: [circuit.terminals!.a, circuit.terminals!.b] }];
    },
  };
}

/** Egyforrású soros-párhuzamos hálózat; a forrás a bal oldali fokban (esetleg soros ellenállással). */
function singleSourceSP(level: Level, rng: Rng, trick: boolean): { sketch: Sketch; kind: 'V' | 'I' } | null {
  const { cells, nR } = spSize(level, rng);
  const s = spLadder(cells, nR, level, rng);
  if (!s) return null;
  const kind = rng.chance(0.6) ? 'V' : 'I';
  // A nyíl felfelé mutat (a forrás a felső sínt emeli), a fok iránya fentről lefelé, ezért dir = −1.
  const src = kind === 'V' ? makeElement('V', pickV(rng, level), -1) : makeElement('I', pickI(rng, level), -1);
  const els: CircuitElement[] = trick && kind === 'I' ? [src, makeElement('R', pickR(rng, level))] : [src];
  s.branch(0, 0, 0, 2, els);
  return { sketch: s, kind };
}

function osztoDraft(level: Level, rng: Rng): Draft | null {
  const built = singleSourceSP(level, rng, rng.chance(0.3));
  if (!built) return null;
  return {
    circuit: built.sketch.build(),
    topology: 'soros-parhuzamos',
    ask: (ctx) => {
      const { circuit, sol, rng } = ctx;
      const rs = interestingResistors(ctx);
      if (rs.length === 0) return null;
      const el = rng.pick(rs);
      const r = sol.elements.get(el.id)!;
      return [rng.chance(0.5) ? askElementU(circuit, el, r.U, true) : askElementI(circuit, el, r.I, true)];
    },
  };
}

function halozatDraft(level: Level, rng: Rng): Draft | null {
  const built = singleSourceSP(level, rng, false);
  if (!built) return null;
  return {
    circuit: built.sketch.build(),
    topology: 'soros-parhuzamos',
    ask: ({ circuit, map }) => {
      const a = circuit.points.find((p) => p.x === 0 && p.y === 0)!.id;
      const b = circuit.points.find((p) => p.x === 0 && p.y === 2)!.id;
      const Req = equivalentResistance(map.net, map.pointNode.get(a)!, map.pointNode.get(b)!);
      return [
        { id: questionId(), kind: 'Req', text: 'Mekkora eredő ellenállást lát a generátor?', unit: 'Ω', answer: Req, magnitudeOnly: true, points: [a, b] },
        {
          id: questionId(),
          kind: 'table',
          text: 'Határozza meg minden elem feszültségét, áramát és teljesítményét, és ellenőrizze a csomóponti törvénnyel és a teljesítménymérleggel!',
          unit: null,
          answer: NaN,
          magnitudeOnly: false,
        },
      ];
    },
  };
}

function realSourceDraft(level: Level, rng: Rng): Draft {
  const { sketch, source, internal, load } = realSource();
  const variant = rng.pick(['elore', 'elore', 'Rb', 'U0'] as const);
  const U0 = makeElement('V', pickV(rng, level), -1);
  U0.name = 'U0';
  const Rb = makeElement('R', rng.pick([0.5, 1, 2, 4, 5]));
  Rb.role = 'internal';
  Rb.name = 'Rb';
  const Rt = makeElement('R', pickR(rng, level));
  Rt.role = 'load';
  Rt.name = 'Rt';
  if (variant === 'Rb') Rb.unknown = true;
  if (variant === 'U0') U0.unknown = true;
  source.branch.elements = [U0];
  internal.branch.elements = [Rb];
  load.branch.elements = [Rt];
  return {
    circuit: sketch.build(),
    topology: 'egyedi',
    ask: ({ circuit, map, sol }) => {
      const els = allElements(circuit);
      const rb = els.find((e) => e.role === 'internal')!;
      const rt = els.find((e) => e.role === 'load')!;
      const u0 = els.find((e) => e.kind === 'V')!;
      const Uk = sol.nodeVoltage[map.pointNode.get(circuit.terminals!.a)!]! - sol.nodeVoltage[map.pointNode.get(circuit.terminals!.b)!]!;
      const It = sol.elements.get(rt.id)!.I;
      const pts: [number, number] = [circuit.terminals!.a, circuit.terminals!.b];
      if (variant === 'Rb') {
        const given: GivenValue[] = [{ target: rt.id, quantity: 'U', value: Uk }];
        return [
          {
            id: questionId(),
            kind: 'Rb',
            text: `A terhelt generátor kapocsfeszültségét megmérve Uk = ${formatQuantity(Uk, 'V')} adódott. Mekkora a generátor belső ellenállása (Rb)?`,
            unit: 'Ω',
            answer: rb.value,
            magnitudeOnly: true,
            target: rb.id,
            given,
          },
        ];
      }
      if (variant === 'U0') {
        const given: GivenValue[] = [{ target: rt.id, quantity: 'I', value: It }];
        return [
          {
            id: questionId(),
            kind: 'U0',
            text: `A terhelőáramot megmérve It = ${formatQuantity(It, 'A')} adódott. Mekkora a generátor forrásfeszültsége (U0)?`,
            unit: 'V',
            answer: u0.value,
            magnitudeOnly: true,
            target: u0.id,
            given,
          },
        ];
      }
      return [
        { id: questionId(), kind: 'Uk', text: 'Mekkora a generátor kapocsfeszültsége (Uk)?', unit: 'V', answer: Uk, magnitudeOnly: true, points: pts },
        { id: questionId(), kind: 'It', text: 'Mekkora a terhelőáram (It)?', unit: 'A', answer: It, magnitudeOnly: true, target: rt.id },
      ];
    },
  };
}

// ───────────────────────────── többforrásos hálózatok ─────────────────────────────

const MULTI: Record<Exclude<Level, 'zh'>, { meshes: [number, number]; R: [number, number]; sources: [number, number] }> = {
  alapozo: { meshes: [1, 2], R: [2, 4], sources: [1, 2] },
  konnyu: { meshes: [2, 2], R: [4, 5], sources: [2, 2] },
  kozepes: { meshes: [3, 3], R: [6, 7], sources: [2, 3] },
  nehez: { meshes: [4, 5], R: [8, 10], sources: [3, 3] },
};

const SOURCE_WEIGHTS: Record<Topology, Partial<Record<SlotRole, number>>> = {
  'soros-parhuzamos': { rung: 4, 'rail-top': 1, 'rail-bottom': 1 },
  letra: { rung: 4, 'rail-top': 1, 'rail-bottom': 1 },
  racs: { inner: 2, outer: 2 },
  gyuru: { inner: 2, outer: 2 },
  hid: { feed: 4, arm: 1, bridge: 1, shunt: 1 },
};

interface MultiBuilt {
  circuit: Circuit;
  topology: Topology;
  meshes: [number, number];
}

function splitSources(total: number, mix: SourceMix, rng: Rng): { nV: number; nI: number } {
  if (mix === 'V') return { nV: total, nI: 0 };
  if (mix === 'I') return { nV: 0, nI: total };
  if (total === 1) return rng.chance(0.6) ? { nV: 1, nI: 0 } : { nV: 0, nI: 1 };
  const nI = rng.int(1, total - 1);
  return { nV: total - nI, nI };
}

function chooseTopology(o: GenerateOptions, meshes: [number, number], rng: Rng, allowed: Topology[]): { t: Topology; m: number } | null {
  const forced = o.topology && o.topology !== 'veletlen' ? o.topology : null;
  const pool = forced ? [forced] : allowed;
  const options: { t: Topology; m: number }[] = [];
  for (const t of pool) {
    const ms = meshOptions(t);
    for (const m of ms) if (m >= meshes[0] && m <= meshes[1]) options.push({ t, m });
  }
  if (options.length) return rng.pick(options);
  if (!forced) return null;
  // A választott topológia a szint hurokszámához igazodik, amennyire lehet.
  const ms = meshOptions(forced);
  const m = ms.reduce((best, x) => (Math.abs(x - meshes[0]) < Math.abs(best - meshes[0]) ? x : best), ms[0]!);
  return { t: forced, m };
}

function buildMulti(level: Level, o: GenerateOptions, rng: Rng, minSources = 1): MultiBuilt | null {
  const z = MULTI[sizeLevel(level)];
  const pick = chooseTopology(o, z.meshes, rng, ['letra', 'racs', 'gyuru', 'hid']);
  if (!pick) return null;
  // Csak a feladatok egy részében: a váz fölött vagy alatt átívelő ág, illetve egy keresztbe kötött
  // ellenállás (mint a ZH-rajzokon). A többi feladat sima létra / rács marad.
  const sk = skeletonFor(pick.t, pick.m, rng, rng.chance(0.25), rng.chance(0.4));
  if (!sk) return null;
  const total = Math.max(minSources, o.sourceCount ?? rng.int(z.sources[0], z.sources[1]));
  const { nV, nI } = o.sourceSplit ?? splitSources(total, o.sourceMix ?? 'vegyes', rng);
  const nR = rng.int(z.R[0], z.R[1]);
  const lvl = sizeLevel(level);
  const spec: FillSpec = {
    nR,
    nV,
    nI,
    level,
    allowSourceOnly: lvl === 'kozepes' || lvl === 'nehez',
    sourceWeights: SOURCE_WEIGHTS[pick.t],
    cellsOf: pick.t === 'hid' ? undefined : gridCellsOf(sk),
  };
  if (!fillSlots(sk.slots, spec, rng)) return null;
  const circuit = sk.build();
  const m = meshCount(toNetlist(circuit).net);
  const meshRange: [number, number] = o.topology && o.topology !== 'veletlen' ? [1, 99] : z.meshes;
  if (m < meshRange[0] || m > meshRange[1]) return null;
  return { circuit, topology: pick.t, meshes: z.meshes };
}

/** Ha van köztük egyedi értékű ellenállás, csak azokat adjuk vissza (értékkel megnevezhetők). */
function preferUnique(circuit: Circuit, ids: string[]): string[] {
  const all = allElements(circuit).filter((e) => e.kind === 'R');
  const unique = ids.filter((id) => {
    const v = all.find((e) => e.id === id)!.value;
    return all.filter((e) => e.value === v).length === 1;
  });
  return unique.length ? unique : ids;
}

/**
 * Kérdezhető ellenállások: nem nulla áramúak. Ha van egyedi értékű köztük, csak azokat adjuk vissza,
 * hogy a kérdés a ZH-hoz hasonlóan értékkel nevezhesse meg az elemet ("a 6 Ω-os ellenálláson").
 */
function interestingResistors(ctx: Ctx): CircuitElement[] {
  const all = allElements(ctx.circuit);
  const rs = all.filter((e) => e.kind === 'R' && Math.abs(ctx.sol.elements.get(e.id)!.I) > 1e-6);
  const unique = rs.filter((e) => all.filter((x) => x.kind === 'R' && x.value === e.value).length === 1);
  return unique.length ? unique : rs;
}

function multiDraft(level: Level, o: GenerateOptions, rng: Rng): Draft | null {
  const built = buildMulti(level, o, rng);
  if (!built) return null;
  const lvl = sizeLevel(level);
  return {
    circuit: built.circuit,
    topology: built.topology,
    ask: (ctx) => {
      const rs = interestingResistors(ctx);
      if (rs.length === 0) return null;
      const { circuit, sol, rng } = ctx;
      const target = rng.pick(rs);
      const r = sol.elements.get(target.id)!;
      const main = rng.chance(0.5) ? askElementI(circuit, target, r.I, true) : askElementU(circuit, target, r.U, true);
      if (lvl === 'alapozo' || lvl === 'konnyu') return [main];
      const sources = allElements(circuit).filter((e) => e.kind !== 'R');
      if (lvl === 'kozepes') {
        const s = rng.pick(sources);
        return [main, askElementP(circuit, s, sol.elements.get(s.id)!.P)];
      }
      return hardQuestionSet(ctx, target);
    },
  };
}

/**
 * Nehéz szint többrészes kérdéssora:
 * a) ágáram, b) források teljesítménye (ki ad le, ki vesz fel), c) Thevenin/Norton a kijelölt ágra,
 * d) a kijelölt ág árama a helyettesítő körből, e) szuperpozícióval egy forrás hozzájárulása.
 */
function hardQuestionSet(ctx: Ctx, target: CircuitElement): Question[] | null {
  const { circuit, map, sol, rng } = ctx;
  const loadBranch = circuit.branches.find((b) => b.elements.length === 1 && b.elements[0]!.id === target.id);
  if (!loadBranch) return null;
  const th = theveninAt(map.net, target.id);
  if (!th || th.Rth < EPS || Math.abs(th.Uth) < EPS || Math.abs(th.In) < EPS) return null;
  if (!ctx.opts.starDelta && needsStarDeltaBetween(withoutElement(map, target.id), th.a, th.b)) return null;
  const I = sol.elements.get(target.id)!.I;
  const qs: Question[] = [];
  qs.push(askElementI(circuit, target, I, false));
  const sources = allElements(circuit).filter((e) => e.kind !== 'R');
  for (const s of sources) qs.push(askElementP(circuit, s, sol.elements.get(s.id)!.P));
  qs.push(...theveninQuestions(circuit, target, th, I));
  const s = rng.pick(sources);
  const part = contribution(map.net, s.id);
  if (!part) return null;
  const Ipart = part.elements.get(target.id)!.I;
  if (Math.abs(Ipart) < EPS) return null;
  // A részáramot csak akkor kérdezzük, ha minden részáramkör eredővel és osztókkal megoldható
  // (a szuperpozíciót így tanuljuk: csomóponti módszer nélkül).
  const byDividers = sources.every((x) => singleSourceSteps(killSources(map.net, [x.id]).net, [], {}) !== null);
  if (!byDividers) return qs;
  qs.push({
    id: questionId(),
    kind: 'Isup',
    text: `Szuperpozícióval: mekkora áramot hoz létre ${elementName(circuit, s)} egyedül (a többi forrás kiiktatva) ${elementName(circuit, target, 'on')}, a referenciairány szerint, előjelesen?`,
    unit: 'A',
    answer: Ipart,
    magnitudeOnly: false,
    target: target.id,
    source: s.id,
  });
  return qs;
}

// ───────────────────────────── a tanár úr feladattípusai ─────────────────────────────

/**
 * A gyakorlaton (a tanár úr füzetében) megoldott feladatok típusai:
 *  - szuperpozíció: két feszültség- és egy áramforrás, egy ellenállás árama forrásonként és összesen,
 *    minden részáramkör eredővel és osztókkal megoldható;
 *  - helyettesítő generátor: legalább két forrás, Rg, Uü, In, terhelőáram és Pmax (illesztés);
 *  - hurokáram: áramforrás(ok) saját, ismert hurokkal, egy ágáram és az áramforrás feszültsége;
 *  - csomóponti potenciál: négy csomópont (három ismeretlen potenciál), két ellenállás árama.
 * A feladat mérete legalább közepes (a gyakorlati feladatok ilyenek).
 */
function teacherDraft(level: Level, o: GenerateOptions, rng: Rng): Draft | null {
  const type: TeacherType = o.teacherType && o.teacherType !== 'veletlen' ? o.teacherType : rng.pick(TEACHER_TYPES);
  const lvl: Level = sizeLevel(level) === 'nehez' ? 'nehez' : 'kozepes';
  const tag = (d: Draft | null): Draft | null => (d ? { ...d, teacherType: type } : null);
  switch (type) {
    case 'thevenin': {
      const d = theveninDraft(lvl, { ...o, sourceCount: 2 }, rng);
      if (!d) return null;
      return tag({
        ...d,
        ask: (ctx) => {
          if (allElements(ctx.circuit).filter((e) => e.kind !== 'R').length < 2) return null;
          return d.ask(ctx);
        },
      });
    }
    case 'szuperpozicio': {
      const built = buildMulti('nehez', { ...o, sourceSplit: { nV: 2, nI: 1 } }, rng, 3);
      if (!built) return null;
      return tag({
        circuit: built.circuit,
        topology: built.topology,
        ask: (ctx) => {
          const { circuit, map, sol, rng } = ctx;
          const sources = map.net.elements.filter((e) => e.kind !== 'R');
          if (sources.length !== 3) return null;
          // Minden részáramkör eredővel és osztókkal (a szuperpozíciót így tanuljuk).
          if (!sources.every((x) => singleSourceSteps(killSources(map.net, [x.id]).net, [], {}) !== null)) return null;
          const rs = interestingResistors(ctx);
          if (rs.length === 0) return null;
          const target = rng.pick(rs);
          const qs: Question[] = [];
          for (const s of sources) {
            const part = contribution(map.net, s.id);
            const Ipart = part?.elements.get(target.id)?.I;
            if (Ipart === undefined || Math.abs(Ipart) < EPS) return null;
            qs.push({
              id: questionId(),
              kind: 'Isup',
              text: `Szuperpozícióval: mekkora áramot hoz létre ${elementName(circuit, allElements(circuit).find((e) => e.id === s.id)!)} egyedül (a többi forrás kiiktatva) ${elementName(circuit, target, 'on')}, a referenciairány szerint, előjelesen?`,
              unit: 'A',
              answer: Ipart,
              magnitudeOnly: false,
              target: target.id,
              source: s.id,
            });
          }
          qs.push(askElementI(circuit, target, sol.elements.get(target.id)!.I, false));
          return qs;
        },
      });
    }
    case 'hurokaram': {
      const split = lvl === 'nehez' ? { nV: 1, nI: 2 } : { nV: 1, nI: 1 };
      const built = buildMulti(lvl, { ...o, sourceSplit: split }, rng, split.nV + split.nI);
      if (!built) return null;
      return tag({
        circuit: built.circuit,
        topology: built.topology,
        ask: (ctx) => {
          const { circuit, sol, rng } = ctx;
          const isrc = allElements(circuit).filter((e) => e.kind === 'I');
          if (isrc.length !== split.nI) return null;
          const rs = interestingResistors(ctx);
          if (rs.length === 0) return null;
          const target = rng.pick(rs);
          const s = rng.pick(isrc);
          const Us = sol.elements.get(s.id)!.U;
          if (Math.abs(Us) < EPS) return null;
          const qU = askElementU(circuit, s, Us, true);
          qU.text = `Mekkora feszültség van ${elementName(circuit, s, 'on')}? (A huroktörvényből, a nagyságát adja meg.)`;
          return [askElementI(circuit, target, sol.elements.get(target.id)!.I, true), qU];
        },
      });
    }
    case 'csomoponti': {
      const built = buildMulti(lvl, { ...o, sourceSplit: { nV: 1, nI: 1 } }, rng, 2);
      if (!built) return null;
      return tag({
        circuit: built.circuit,
        topology: built.topology,
        ask: (ctx) => {
          const { circuit, map, sol, rng } = ctx;
          // Négy csomópont (ahol legalább három ág találkozik): három ismeretlen potenciál.
          const degree = new Array<number>(map.net.nodeCount).fill(0);
          for (const e of map.net.elements) {
            degree[e.a]!++;
            degree[e.b]!++;
          }
          if (degree.filter((d) => d >= 3).length !== 4) return null;
          const rs = interestingResistors(ctx);
          if (rs.length < 2) return null;
          const [r1, r2] = rng.shuffle([...rs]) as [CircuitElement, CircuitElement];
          return [askElementI(circuit, r1, sol.elements.get(r1.id)!.I, true), askElementU(circuit, r2, sol.elements.get(r2.id)!.U, true)];
        },
      });
    }
  }
}

function withoutElement(map: NetlistMapping, id: string) {
  return { nodeCount: map.net.nodeCount, elements: map.net.elements.filter((e) => e.id !== id) };
}

function theveninQuestions(c: Circuit, load: CircuitElement, th: { Uth: number; Rth: number; In: number }, IL: number): Question[] {
  const name = elementName(c, load);
  return [
    {
      id: questionId(),
      kind: 'Uth',
      text: `${capitalize(name)} kapcsaira (A–B) határozza meg a helyettesítő generátor üresjárási feszültségét, Uü = φA − φB!`,
      unit: 'V',
      answer: th.Uth,
      magnitudeOnly: false,
      target: load.id,
    },
    { id: questionId(), kind: 'Rth', text: 'Mekkora a helyettesítő generátor belső ellenállása (Rg)?', unit: 'Ω', answer: th.Rth, magnitudeOnly: true, target: load.id },
    {
      id: questionId(),
      kind: 'In',
      text: 'Mekkora a Norton-helyettesítő generátor forrásárama (In), az A–B kapcsok rövidrezárásakor A-ból B felé folyó áram?',
      unit: 'A',
      answer: th.In,
      magnitudeOnly: false,
      target: load.id,
    },
    {
      id: questionId(),
      kind: 'IL',
      text: `Mekkora áram folyik ${elementName(c, load, 'on')} A-ból B felé, a helyettesítő körből számolva?`,
      unit: 'A',
      answer: IL,
      magnitudeOnly: false,
      target: load.id,
    },
    {
      id: questionId(),
      kind: 'Pmax',
      text: 'Mekkora terhelő ellenállással (Rt) vehető ki a generátorból a legnagyobb teljesítmény, és mekkora ez a Pmax?',
      unit: 'W',
      answer: (th.Uth * th.Uth) / (4 * th.Rth),
      magnitudeOnly: true,
      target: load.id,
    },
  ];
}

function theveninDraft(level: Level, o: GenerateOptions, rng: Rng): Draft | null {
  let circuit: Circuit;
  let topology: Topology;
  if (sizeLevel(level) === 'alapozo') {
    const built = singleSourceSP('konnyu', rng, false);
    if (!built) return null;
    circuit = built.sketch.build();
    topology = 'soros-parhuzamos';
  } else {
    const built = buildMulti(level, o, rng);
    if (!built) return null;
    circuit = built.circuit;
    topology = built.topology;
  }
  // A terhelés: egy olyan ellenállás, amely egyedül áll az ágában.
  const single = circuit.branches.filter((b) => b.elements.length === 1 && b.elements[0]!.kind === 'R');
  // Egyedi értékű terhelést választunk, hogy a kérdés értékkel nevezhesse meg ("a 7 Ω-os ellenállás").
  const uniqueIds = new Set(preferUnique(circuit, single.map((b) => b.elements[0]!.id)));
  const candidates = single.filter((b) => uniqueIds.has(b.elements[0]!.id));
  if (candidates.length === 0) return null;
  const loadBranch = rng.pick(candidates);
  const load = loadBranch.elements[0]!;
  load.role = 'load';
  circuit.terminals = { a: loadBranch.from, b: loadBranch.to };
  return {
    circuit,
    topology,
    ask: (ctx) => {
      // A terhelést a szerepe alapján keressük: csillag-delta beépítésekor az elemek újraszámozódnak.
      const el = allElements(ctx.circuit).find((e) => e.role === 'load')!;
      const th = theveninAt(ctx.map.net, el.id);
      if (!th || th.Rth < EPS || Math.abs(th.Uth) < EPS || Math.abs(th.In) < EPS) return null;
      if (!ctx.opts.starDelta && needsStarDeltaBetween(withoutElement(ctx.map, el.id), th.a, th.b)) return null;
      return theveninQuestions(ctx.circuit, el, th, ctx.sol.elements.get(el.id)!.I);
    },
  };
}

function kirchhoffDraft(level: Level, o: GenerateOptions, rng: Rng): Draft | null {
  const built = buildMulti(level, o, rng);
  if (!built) return null;
  const variant = rng.pick(['KCL', 'KVL'] as const);
  return {
    circuit: built.circuit,
    topology: built.topology,
    ask: ({ circuit, map, sol, rng }) => {
      const byId = new Map(map.net.elements.map((e) => [e.id, e]));
      const els = new Map(allElements(circuit).map((e) => [e.id, e]));
      if (variant === 'KCL') {
        // Legalább 3 elem csatlakozik a csomóponthoz; egy ellenállás árama az ismeretlen.
        const nodes = new Map<number, string[]>();
        for (const e of map.net.elements) {
          nodes.set(e.a, [...(nodes.get(e.a) ?? []), e.id]);
          nodes.set(e.b, [...(nodes.get(e.b) ?? []), e.id]);
        }
        const options = [...nodes.entries()].filter(([, ids]) => ids.length >= 3 && ids.some((id) => byId.get(id)!.kind === 'R'));
        if (options.length === 0) return null;
        const [node, ids] = rng.pick(options);
        const unknown = rng.pick(preferUnique(circuit, ids.filter((id) => byId.get(id)!.kind === 'R')));
        const given: GivenValue[] = ids.filter((id) => id !== unknown && byId.get(id)!.kind !== 'I').map((id) => ({ target: id, quantity: 'I', value: sol.elements.get(id)!.I }));
        const q = askElementI(circuit, els.get(unknown)!, sol.elements.get(unknown)!.I, false);
        q.text = `Az ábrán megadott ágáramok ismeretében a csomóponti törvénnyel: ${q.text.charAt(0).toLowerCase()}${q.text.slice(1)}`;
        q.given = given;
        q.node = node;
        return [q];
      }
      const loops = fundamentalLoops(map.net).filter((l) => l.elements.length >= 3 && l.elements.some((x) => byId.get(x.id)!.kind === 'R'));
      if (loops.length === 0) return null;
      const loop = rng.pick(loops);
      const unknown = rng.pick(preferUnique(circuit, loop.elements.filter((x) => byId.get(x.id)!.kind === 'R').map((x) => x.id)));
      const given: GivenValue[] = loop.elements
        .filter((x) => x.id !== unknown && byId.get(x.id)!.kind !== 'V')
        .map((x) => ({ target: x.id, quantity: 'U', value: sol.elements.get(x.id)!.U }));
      const q = askElementU(circuit, els.get(unknown)!, sol.elements.get(unknown)!.U, false);
      q.text = `Az ábrán megadott feszültségek ismeretében a huroktörvénnyel: ${q.text.charAt(0).toLowerCase()}${q.text.slice(1)}`;
      q.given = given;
      q.loop = loop.elements;
      return [q];
    },
  };
}

// ───────────────────────────── ZH-szint ─────────────────────────────

function zhDraft(o: GenerateOptions, rng: Rng): Draft | null {
  const type: ZhType = o.zhType && o.zhType !== 'veletlen' ? o.zhType : rng.chance(0.6) ? 'sok-forras' : 'sok-ellenallas';
  const draft = type === 'sok-forras' ? zhManySources(o, rng) : zhManyResistors(o, rng);
  if (draft) draft.zhType = type;
  return draft;
}

function askSingleResistor(ctx: Ctx): Question[] | null {
  const rs = interestingResistors(ctx);
  if (rs.length === 0) return null;
  const el = ctx.rng.pick(rs);
  const r = ctx.sol.elements.get(el.id)!;
  return [ctx.rng.chance(0.7) ? askElementU(ctx.circuit, el, r.U, true) : askElementI(ctx.circuit, el, r.I, true)];
}

/** "Sok forrás": létra vagy rács, 5–7 forrás (2–3 áram-, 3–4 feszültségforrás), 6–8 ellenállás. */
function zhManySources(o: GenerateOptions, rng: Rng): Draft | null {
  const forced = o.topology && o.topology !== 'veletlen' ? o.topology : null;
  const t: Topology = forced ?? (rng.chance(0.7) ? 'letra' : 'racs');
  // Hurkonként legfeljebb egy forrás: több ablak, hogy a feladat nehéz maradjon.
  const m = t === 'racs' ? 6 : t === 'letra' ? rng.int(5, 6) : rng.pick(meshOptions(t));
  const sk = skeletonFor(t, m, rng, t === 'letra' && rng.chance(0.3), t !== 'hid' && rng.chance(0.4));
  if (!sk) return null;
  const nI = rng.int(1, 2);
  const nV = rng.int(2, 3);
  const spec: FillSpec = {
    nR: rng.int(6, 9),
    nV,
    nI,
    level: 'zh',
    allowSourceOnly: true,
    sourceWeights: t === 'letra' ? { rung: 3, 'rail-top': 3, 'rail-bottom': 2 } : SOURCE_WEIGHTS[t],
    cellsOf: t === 'hid' ? undefined : gridCellsOf(sk),
  };
  if (!fillSlots(sk.slots, spec, rng)) return null;
  // A ZH-hoz hasonlóan legyen több ellenállás nélküli, csak forrást tartalmazó ág.
  const sourceOnly = sk.branches.filter((b) => b.elements.length > 0 && b.elements.every((e) => e.kind !== 'R')).length;
  if (sourceOnly < 2) return null;
  return { circuit: sk.build(), topology: t, ask: askSingleResistor };
}

/** "Sok ellenállás": híd vagy gyűrű, 1 forrás (többnyire áramforrás), 8–10 ellenállás, soros-párhuzamosan megoldható. */
function zhManyResistors(o: GenerateOptions, rng: Rng): Draft | null {
  const forced = o.topology && o.topology !== 'veletlen' ? o.topology : null;
  const t: Topology = forced ?? (rng.chance(0.5) ? 'hid' : 'gyuru');
  const starDelta = o.starDelta ?? false;
  let circuit: Circuit | null;
  if (t === 'hid' && !starDelta) circuit = balancedBridge(rng);
  else {
    const m = rng.pick(meshOptions(t).filter((x) => x >= 3));
    const sk = skeletonFor(t, m, rng);
    if (!sk) return null;
    const isI = rng.chance(0.75);
    const spec: FillSpec = {
      nR: rng.int(8, 10),
      nV: isI ? 0 : 1,
      nI: isI ? 1 : 0,
      level: 'zh',
      allowSourceOnly: true,
      sourceWeights: t === 'hid' ? { feed: 1 } : { outer: 1 },
    };
    if (!fillSlots(sk.slots, spec, rng)) return null;
    circuit = sk.build();
  }
  if (!circuit) return null;
  const rCount = allElements(circuit).filter((e) => e.kind === 'R').length;
  if (rCount < 8 || rCount > 10) return null;
  const net = toNetlist(circuit).net;
  if (circuitIssues(circuit).length) return null;
  if (singleSourceNeedsStarDelta(net)) {
    // Csillag-delta nélkül nem kerülhet elő; vele csak akkor, ha egyetlen átalakítás elég.
    if (!starDelta) return null;
    const s = net.elements.find((e) => e.kind !== 'R')!;
    if (!findTransform(net.elements.filter((e) => e.kind === 'R'), net.nodeCount, s.b, s.a)) return null;
  }
  return { circuit, topology: t, ask: askSingleResistor };
}

/**
 * Kiegyenlített híd (csillag-delta nélkül is megoldható): a karok eredői X1, X2, k·X1, k·X2,
 * így az átlóban nem folyik áram. A karok egy vagy két soros ellenállásból állnak.
 */
function balancedBridge(rng: Rng): Circuit | null {
  const sk = bridge({ shunt: rng.chance(0.6) });
  const arms = sk.slots.filter((s) => s.role === 'arm');
  const diag = sk.slots.find((s) => s.role === 'bridge')!;
  const feeds = sk.slots.filter((s) => s.role === 'feed');
  const shunt = sk.slots.find((s) => s.role === 'shunt');
  const X1 = rng.int(2, 10);
  const X2 = rng.int(2, 10);
  const k = rng.pick([1, 2, 3, 0.5]);
  const X = [X1, X2, k * X1, k * X2];
  if (X.some((x) => !Number.isInteger(x) || x < 1 || x > 20)) return null;
  // A karok sorrendje a vázban: bal felső, jobb felső, bal alsó, jobb alsó.
  arms.forEach((slot, i) => {
    slot.branch.elements = realize(X[i]!, rng);
  });
  diag.branch.elements = [newElement('R', 'zh', rng)];
  const isI = rng.chance(0.75);
  const src = isI ? makeElement('I', pickI(rng, 'zh'), rng.chance(0.5) ? 1 : -1) : makeElement('V', pickV(rng, 'zh'), rng.chance(0.5) ? 1 : -1);
  const [f1, f2] = rng.shuffle(feeds) as [Slot, Slot];
  f1.branch.elements = [src];
  f2.branch.elements = rng.chance(0.5) ? [newElement('R', 'zh', rng)] : [];
  if (shunt) shunt.branch.elements = [newElement('R', 'zh', rng)];
  return sk.build();
}

/** Adott eredő megvalósítása egy ellenállással vagy két soros ellenállással (1–10 Ω). */
function realize(x: number, rng: Rng): CircuitElement[] {
  const canSplit = x >= 2;
  if (x > 10 || (canSplit && rng.chance(0.5))) {
    const lo = Math.max(1, x - 10);
    const hi = Math.min(10, x - 1);
    if (lo > hi) return [makeElement('R', x)];
    const a = rng.int(lo, hi);
    return [makeElement('R', a), makeElement('R', x - a)];
  }
  return [makeElement('R', x)];
}

// ───────────────────────────── csillag-delta ─────────────────────────────

const NICE_STARS = niceStars(12);

function pickMode(o: GenerateOptions, rng: Rng): 'delta-csillag' | 'csillag-delta' {
  const m = o.starDeltaMode ?? 'veletlen';
  return m === 'veletlen' ? (rng.chance(0.5) ? 'delta-csillag' : 'csillag-delta') : m;
}

function starDeltaDraft(level: Level, o: GenerateOptions, rng: Rng): Draft | null {
  const lvl = sizeLevel(level);
  if (lvl === 'alapozo' || lvl === 'konnyu') return pureTransformDraft(pickMode(o, rng), lvl === 'alapozo', rng);
  return bridgeStarDeltaDraft(pickMode(o, rng), lvl === 'kozepes' ? 'Req' : 'source', rng);
}

/** Tiszta átalakítás: adott csillag → delta, vagy adott delta → csillag; a három új érték a kérdés. */
function pureTransformDraft(mode: 'delta-csillag' | 'csillag-delta', symmetric: boolean, rng: Rng): Draft {
  const r0 = rng.pick([2, 3, 4, 5, 6, 8, 10]);
  const star: Star = symmetric ? { R1: r0, R2: r0, R3: r0 } : rng.pick(NICE_STARS.filter((s) => !(s.R1 === s.R2 && s.R2 === s.R3)));
  const delta = starToDelta(star);
  const s = new Sketch();
  if (mode === 'csillag-delta') {
    // Adott csillag: 1 bal, 2 jobb, 3 lent; középen a csillagpont.
    const e1 = makeElement('R', star.R1);
    const e2 = makeElement('R', star.R2);
    const e3 = makeElement('R', star.R3);
    e1.name = 'R1';
    e2.name = 'R2';
    e3.name = 'R3';
    s.branch(0, 2, 4, 2, [e1]);
    s.branch(4, 2, 8, 2, [e2]);
    s.branch(4, 2, 4, 6, [e3]);
    s.ports = [
      { point: s.pt(0, 2), name: '1' },
      { point: s.pt(8, 2), name: '2' },
      { point: s.pt(4, 6), name: '3' },
    ];
  } else {
    // Adott delta: 1 bal fent, 2 jobb fent, 3 lent középen.
    const e12 = makeElement('R', delta.R12);
    const e23 = makeElement('R', delta.R23);
    const e31 = makeElement('R', delta.R31);
    e12.name = 'R12';
    e23.name = 'R23';
    e31.name = 'R31';
    s.branch(0, 0, 8, 0, [e12]);
    s.branch(8, 0, 8, 6, [e23]);
    s.wire(4, 6, 8, 6);
    s.wire(0, 6, 4, 6);
    s.branch(0, 0, 0, 6, [e31]);
    s.ports = [
      { point: s.pt(0, 0), name: '1' },
      { point: s.pt(8, 0), name: '2' },
      { point: s.pt(4, 6), name: '3' },
    ];
  }
  const circuit = s.build();
  const asked = mode === 'csillag-delta' ? ['R12', 'R23', 'R31'] : ['R1', 'R2', 'R3'];
  const ystar = deltaToStar(delta);
  const values: Record<string, number> = { R12: delta.R12, R23: delta.R23, R31: delta.R31, R1: ystar.R1, R2: ystar.R2, R3: ystar.R3 };
  return {
    circuit,
    topology: 'egyedi',
    ask: () =>
      asked.map((n) => ({
        id: questionId(),
        kind: 'SD' as const,
        text:
          mode === 'csillag-delta'
            ? `Alakítsa át a csillagot deltává! Mekkora az ${n} ellenállás (a ${n[1]} és a ${n[2]} kivezetés között)?`
            : `Alakítsa át a deltát csillaggá! Mekkora az ${n} ellenállás (a ${n[1]}. kivezetéshez csatlakozó ág)?`,
        unit: 'Ω' as const,
        answer: values[n]!,
        magnitudeOnly: true,
        sdName: n,
      })),
  };
}

/**
 * Hidas hálózat, amely csak csillag-delta átalakítással redukálható. Fordított irányból készül:
 * egy soros-párhuzamosan redukálható alapból (csillag a C pontban, vagy a delta helyén csillag)
 * az átalakítás inverzével kapjuk a feladatot, így az értékek szépek maradnak.
 *
 *   A ──kar1── C ──kar2── B
 *   │          │          │
 *   │        átló         │
 *   A ──kar3── D ──kar4── B
 */
function bridgeStarDeltaDraft(mode: 'delta-csillag' | 'csillag-delta', kind: 'Req' | 'source', rng: Rng): Draft | null {
  const star = rng.pick(NICE_STARS);
  const R = () => rng.int(1, 10);
  let arm1: number;
  let arm2: number;
  let arm3: number;
  let arm4: number;
  let diag: number;
  if (mode === 'delta-csillag') {
    // A delta az A, C, D pontok között: kar1 = R(AC), átló = R(CD), kar3 = R(DA).
    const d = starToDelta(star);
    [arm1, diag, arm3] = [d.R12, d.R23, d.R31];
    [arm2, arm4] = [R(), R()];
  } else {
    // A csillag a C pontban: kar1 (A–C), kar2 (C–B), átló (C–D).
    [arm1, arm2, diag] = [star.R1, star.R2, star.R3];
    [arm3, arm4] = [R(), R()];
  }
  const s = new Sketch();
  s.branch(0, 0, 4, 0, [makeElement('R', arm1)]);
  s.branch(4, 0, 8, 0, [makeElement('R', arm2)]);
  s.branch(0, 4, 4, 4, [makeElement('R', arm3)]);
  s.branch(4, 4, 8, 4, [makeElement('R', arm4)]);
  s.branch(4, 0, 4, 4, [makeElement('R', diag)]);
  if (kind === 'Req') {
    s.wire(0, 0, 0, 2);
    s.wire(0, 2, 0, 4);
    s.wire(8, 0, 8, 2);
    s.wire(8, 2, 8, 4);
    s.terminals = { a: s.pt(0, 2), b: s.pt(8, 2) };
  } else {
    s.wire(0, 0, 0, 4);
    s.wire(8, 0, 8, 4);
    s.wire(0, 4, 0, 6);
    s.wire(8, 4, 8, 6);
    const isI = rng.chance(0.6);
    const src = isI ? makeElement('I', pickI(rng, 'zh'), rng.chance(0.5) ? 1 : -1) : makeElement('V', pickV(rng, 'nehez'), rng.chance(0.5) ? 1 : -1);
    s.branch(0, 6, 4, 6, [src]);
    s.branch(4, 6, 8, 6, rng.chance(0.5) ? [makeElement('R', R())] : []);
  }
  const circuit = s.build();
  const map = toNetlist(circuit);
  const rs = map.net.elements.filter((e) => e.kind === 'R');
  const src = map.net.elements.find((e) => e.kind !== 'R');
  const t1 = src ? src.b : map.pointNode.get(circuit.terminals!.a)!;
  const t2 = src ? src.a : map.pointNode.get(circuit.terminals!.b)!;
  // Valóban kell átalakítás (nem kiegyenlített, nem soros-párhuzamos), és egy átalakítás elég.
  if (isSeriesParallelReducible(rs.map((e) => ({ a: e.a, b: e.b })), t1, t2)) return null;
  if (!needsStarDeltaBetween({ nodeCount: map.net.nodeCount, elements: rs }, t1, t2)) return null;
  if (!findTransform(rs, map.net.nodeCount, t1, t2, mode)) return null;
  return {
    circuit,
    topology: 'hid',
    ask: (ctx) => {
      if (kind === 'Req') {
        const a = ctx.map.pointNode.get(ctx.circuit.terminals!.a)!;
        const b = ctx.map.pointNode.get(ctx.circuit.terminals!.b)!;
        return [
          {
            id: questionId(),
            kind: 'Req',
            text: 'Mekkora az A és B pontok közötti eredő ellenállás?',
            unit: 'Ω',
            answer: equivalentResistance(ctx.map.net, a, b),
            magnitudeOnly: true,
            points: [ctx.circuit.terminals!.a, ctx.circuit.terminals!.b],
          },
        ];
      }
      return askSingleResistor(ctx);
    },
  };
}

/** Igaz, ha valamelyik ablakban (hurokban) egynél több forrás van. */
export function tooManySourcesInMesh(c: Circuit): boolean {
  const sources = new Set(allElements(c).filter((e) => e.kind !== 'R').map((e) => e.id));
  if (sources.size < 2) return false;
  return meshes(c, toNetlist(c)).some((m) => new Set(m.elements.filter((x) => sources.has(x.id)).map((x) => x.id)).size > 1);
}
