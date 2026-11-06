// Létrahálózat: a szinuszos (és a bekapcsolási) feladatok közös váza. Balra a generátor (vagy az
// A–B kapocspár), felül soros ágak, függőlegesen keresztágak, alul vezeték. Ez pontosan az a
// szerkezet, amit a vizsgafeladatok megoldásai eredővel és osztókkal számolnak; a levezetés is így
// épül fel: eredő impedancia a túlsó végtől, aztán osztók a generátortól a keresett elemig.

import type { Branch, Circuit, CircuitElement, GridPoint } from '../solver/model';
import type { GroupRef, Step } from '../methods/types';
import { finalize } from '../generator/sketch';
import { formatNumber, formatQuantity } from '../units';
import { add, argDeg, abs, cx, div, fmtAlg, mul, par, texAlg, texAlgP, texE, texExp, texNum, type Cx } from './complex';
import { impedanceOf } from './mna';

export type Passive = 'R' | 'L' | 'C';

export interface PartSpec {
  kind: Passive;
  value: number;
}

/** Egy ág egymás után (sorosan) álló elemei; üres = vezeték. */
export type ArmSpec = PartSpec[];

export interface SourceSpec {
  kind: 'V' | 'I';
  /** Csúcsérték (V vagy A); egyenáramnál maga az érték. */
  amp: number;
  /** Kezdőfázis fokban. */
  phase: number;
  /** Kapcsoló a generátor ágában (bekapcsolási feladat). */
  withSwitch?: boolean;
}

export interface LadderSpec {
  /** Körfrekvencia (rad/s); 0 = egyenáram (csak ellenállások a létrában). */
  omega: number;
  source: SourceSpec | null;
  /** s1…sn: a k. soros ág a (k−1). és a k. keresztág között. */
  series: ArmSpec[];
  /** r1…rn: keresztágak (null = nincs keresztág azon a helyen). Az utolsó kötelező, ha nincs `tail`. */
  shunts: (ArmSpec | null)[];
  /** Az utolsó keresztág után még egy soros ág a kapcsokig (A–B a végén). */
  tail?: ArmSpec;
  /** 'input': A–B a bal szélen (generátor nélkül); 'output': A–B a jobb szélen. */
  terminals: 'input' | 'output' | null;
  /** Bekapcsolási feladat terhelése: a kapcsok közé kötött tekercs vagy kondenzátor. */
  load?: PartSpec;
}

/** Egy ág (soros vagy kereszt) a kész áramkörben: az elemei azonosítóval. */
export interface ArmRef {
  ids: string[];
  parts: PartSpec[];
  z: Cx;
}

export interface BuiltLadder {
  spec: LadderSpec;
  circuit: Circuit;
  series: ArmRef[];
  shunts: (ArmRef | null)[];
  tail: ArmRef | null;
  sourceId: string | null;
  switchId: string | null;
  loadId: string | null;
}

const TOP = (k: number) => k;
const BOT = (k: number) => 50 + k;

/** Az ág impedanciája (soros elemek összege). Egyenáramnál (ω = 0) csak ellenállás lehet benne. */
export function armZ(parts: ArmSpec, omega: number): Cx {
  return parts.reduce((z, p) => add(z, omega === 0 ? cx(p.value) : impedanceOf(p.kind, p.value, omega)), cx(0));
}

export function buildLadder(spec: LadderSpec): BuiltLadder {
  const n = spec.series.length;
  const last = spec.tail ? n + 1 : n;
  const right = spec.load ? last + (spec.tail ? 0 : 1) : last;
  const points: GridPoint[] = [];
  for (let k = 0; k <= right; k++) points.push({ id: TOP(k), x: 2 * k, y: 0 }, { id: BOT(k), x: 2 * k, y: 2 });
  const branches: Branch[] = [];
  const el = (kind: CircuitElement['kind'], value: number, extra: Partial<CircuitElement> = {}): CircuitElement => ({ id: '', kind, value, dir: 1, ...extra });
  let bi = 0;
  const branch = (from: number, to: number, elements: CircuitElement[]) => branches.push({ id: `t${++bi}`, from, to, elements });

  if (spec.source) {
    const s = spec.source;
    const items: CircuitElement[] = [];
    if (s.withSwitch) items.push(el('K', 0));
    // dir = −1: a feszültségforrás nyila felfelé mutat (a felső vezeték a magasabb potenciálú),
    // az áramforrás árama alulról felfelé folyik, vagyis a felső csomópontba táplál.
    items.push(el(s.kind, s.amp, { dir: -1, phase: s.phase }));
    branch(TOP(0), BOT(0), items);
  }
  for (let k = 1; k <= n; k++) {
    branch(TOP(k - 1), TOP(k), spec.series[k - 1]!.map((p) => el(p.kind, p.value)));
    branch(BOT(k - 1), BOT(k), []);
    const r = spec.shunts[k - 1];
    if (r) branch(TOP(k), BOT(k), r.map((p) => el(p.kind, p.value)));
  }
  if (spec.tail) {
    branch(TOP(n), TOP(n + 1), spec.tail.map((p) => el(p.kind, p.value)));
    branch(BOT(n), BOT(n + 1), []);
  }
  if (spec.load) {
    if (!spec.tail) {
      branch(TOP(n), TOP(n + 1), []);
      branch(BOT(n), BOT(n + 1), []);
    }
    branch(TOP(right), BOT(right), [el(spec.load.kind, spec.load.value)]);
  }
  const raw: Circuit = { points, branches };
  if (spec.terminals === 'input') raw.terminals = { a: TOP(0), b: BOT(0) };
  if (spec.terminals === 'output') raw.terminals = { a: TOP(last), b: BOT(last) };
  const circuit = finalize(raw);
  // A kész (átszámozott) áramkörben az ágakat a végpontjaik azonosítják.
  const find = (from: number, to: number) => circuit.branches.find((b) => b.from === from && b.to === to);
  const ref = (from: number, to: number, parts: ArmSpec): ArmRef => ({ ids: find(from, to)?.elements.map((e) => e.id) ?? [], parts, z: armZ(parts, spec.omega) });
  const srcBranch = spec.source ? find(TOP(0), BOT(0)) : undefined;
  return {
    spec,
    circuit,
    series: spec.series.map((s, i) => ref(TOP(i), TOP(i + 1), s)),
    shunts: spec.shunts.map((r, i) => (r ? ref(TOP(i + 1), BOT(i + 1), r) : null)),
    tail: spec.tail ? ref(TOP(n), TOP(n + 1), spec.tail) : null,
    sourceId: srcBranch?.elements.find((e) => e.kind === 'V' || e.kind === 'I')?.id ?? null,
    switchId: srcBranch?.elements.find((e) => e.kind === 'K')?.id ?? null,
    loadId: spec.load ? (find(TOP(right), BOT(right))?.elements[0]?.id ?? null) : null,
  };
}

// ───────── Jelölések ─────────

/** LaTeX-jelek: Z̄ (impedancia), Û, Î (komplex csúcsérték). */
export const texZ = (sub: string) => `\\overline{Z}_{${sub}}`;
export const texU = (sub: string) => `\\hat{U}_{${sub}}`;
export const texI = (sub: string) => `\\hat{I}_{${sub}}`;

/** Elem-azonosító LaTeX-alsó indexe: R3 → R3, Ug1 → g1. */
export const subOf = (id: string) => id.replace(/^Ug|^Ig/, 'g');

/** Elem impedanciájának jele: R-nél maga az R, L-nél, C-nél Z̄_L1. */
export function texElemZ(id: string, kind: Passive): string {
  return kind === 'R' ? `R_{${id.slice(1)}}` : texZ(id);
}

export interface Ctx {
  omega: number;
  /** Komplex mennyiségek (AC) vagy valós (egyenáramú bekapcsolás). */
  ac: boolean;
}

/** Impedancia értéke LaTeX-ben, mértékegységgel: AC-nél algebrai és exponenciális alak. */
export function texZVal(z: Cx, ctx: Ctx, withExp = true): string {
  if (!ctx.ac) return `${texNum(z.re)}\\,\\Omega`;
  const alg = `(${texAlg(z)})\\,\\Omega`;
  return withExp && Math.abs(z.im) > 1e-9 * abs(z) && Math.abs(z.re) > 1e-9 * abs(z) ? `${alg} = ${texExp(z)}\\,\\Omega` : alg;
}

export function plainZ(z: Cx, ctx: Ctx): string {
  return ctx.ac ? `${fmtAlg(z)} Ω` : formatQuantity(z.re, 'Ω');
}

/** Fazor (komplex csúcsérték) LaTeX-ben exponenciális alakban, mértékegységgel. */
export function texPhasor(v: Cx, unit: 'V' | 'A', ctx: Ctx): string {
  if (!ctx.ac) return texQtyReal(v.re, unit);
  const m = abs(v);
  // Kis értékeknél előtaggal (mA, mV), hogy olvasható maradjon.
  const [num, u = unit] = formatQuantity(m, unit).split(/\s/);
  const prefixFactor = m === 0 ? 1 : m / Number(num!.replace(',', '.').replace('−', '-'));
  const mant = m / prefixFactor;
  const prefix = u.slice(0, u.length - unit.length);
  const pre = prefix === 'µ' ? '\\mu' : prefix ? `\\text{${prefix}}` : '';
  return `${texNum(mant)}\\,${texE(argDeg(v))}\\,${pre}\\text{${unit}}`;
}

export function texQtyReal(x: number, unit: string): string {
  const [num, u = ''] = formatQuantity(x, unit as 'V').split(/\s/);
  const n = num!.replace('−', '-').replace(',', '{,}');
  if (unit === '°') return `${n.replace('°', '')}^\\circ`;
  // Előtag és egység: a µ és az Ω matematikai jel, a többi szöveg.
  const prefix = u.length > unit.length ? u.slice(0, u.length - unit.length) : '';
  const pre = prefix === 'µ' ? '\\mu' : prefix ? `\\text{${prefix}}` : '';
  const un = unit === 'Ω' ? '\\Omega' : `\\text{${unit}}`;
  return `${n}\\,${pre}${un}`;
}

/** ω LaTeX-ben: 10^4 alakban, ha tízhatvány. */
export function texOmega(omega: number): string {
  const e = Math.log10(omega);
  if (Math.abs(e - Math.round(e)) < 1e-9 && omega >= 100) return `10^{${Math.round(e)}}`;
  return texNum(omega);
}

// ───────── Reaktanciák ─────────

/** Az első lépés: minden tekercs és kondenzátor impedanciája az adott körfrekvencián. */
export function reactanceStep(b: BuiltLadder): Step | null {
  const ctx = { omega: b.spec.omega, ac: true };
  const arms = [...b.series, ...b.shunts.filter((x): x is ArmRef => !!x), ...(b.tail ? [b.tail] : [])];
  const rows: string[] = [];
  const ids: string[] = [];
  for (const arm of arms)
    arm.parts.forEach((p, i) => {
      const id = arm.ids[i]!;
      if (p.kind === 'R') return;
      ids.push(id);
      const z = impedanceOf(p.kind, p.value, ctx.omega);
      rows.push(
        p.kind === 'L'
          ? `${texZ(id)} = j\\omega L = j\\cdot ${texOmega(ctx.omega)}\\cdot ${texQtyReal(p.value, 'H')} = ${texAlg(z)}\\,\\Omega`
          : `${texZ(id)} = \\dfrac{1}{j\\omega C} = -j\\dfrac{1}{${texOmega(ctx.omega)}\\cdot ${texQtyReal(p.value, 'F')}} = ${texAlg(z)}\\,\\Omega`,
      );
    });
  if (!rows.length) return null;
  return {
    title: 'Reaktanciák',
    text: 'Először minden tekercs és kondenzátor impedanciáját számoljuk ki ezen a körfrekvencián. A tekercsé pozitív képzetes (jωL), a kondenzátoré negatív képzetes (−j/(ωC)); az ellenállásé valós marad.',
    bullets: ['Tekercs: Z = jωL, egyenáramon rövidzár, nagy frekvencián szakadás felé tart.', 'Kondenzátor: Z = −j/(ωC), egyenáramon szakadás, nagy frekvencián rövidzár felé tart.'],
    terms: rows,
    highlight: { elements: ids },
  };
}

// ───────── Eredő impedancia a túlsó végtől ─────────

export interface ForwardChain {
  /** W[k]: a k. keresztágtól jobbra (vele együtt) látott impedancia, k = 1..n. */
  W: Cx[];
  /** P[k]: a (k−1). csomópontból jobbra látott impedancia: s_k + W[k]. */
  P: Cx[];
  /** A generátor felől (vagy az A–B kapcsokról) látott eredő. */
  zin: Cx;
  /** Melyik elemek vannak benne az egyes eredőkben (kiemeléshez). */
  wIds: string[][];
  pIds: string[][];
  /** Az eredők neve (LaTeX), pl. Z_{e2}. */
  wName: string[];
  pName: string[];
  /** Az eredők LaTeX-jele (név, vagy ha nincs külön neve, maga az elem). */
  wTex: string[];
  pTex: string[];
}

/** Egy elem (vagy ág) impedanciája a megfelelő ω-val. */
function partsZ(parts: ArmSpec, omega: number): Cx {
  return armZ(parts, omega);
}

/**
 * Eredő impedancia a túlsó (jobb) végtől a generátorig, lépésenként. Minden lépés egy soros vagy
 * egy párhuzamos összevonás; a lépések a kiemelt csoporttal együtt kerülnek a listába.
 */
export function forwardChain(b: BuiltLadder, steps: Step[], ctx: Ctx): ForwardChain {
  const zs = (sub: string) => (ctx.ac ? texZ(sub) : `R_{${sub}}`);
  const n = b.series.length;
  const W: Cx[] = [];
  const P: Cx[] = [];
  const wIds: string[][] = [];
  const pIds: string[][] = [];
  const wName: string[] = [];
  const pName: string[] = [];
  const wTex: string[] = [];
  const pTex: string[] = [];
  let counter = 0;
  const nextName = () => `e${++counter}`;
  const label = (name: string, z: Cx) => `${ctx.ac ? 'Z' : 'R'}${name} = ${plainZ(z, ctx)}`;
  const armTex = (arm: ArmRef) => {
    const syms = arm.parts.map((p, i) => texElemZ(arm.ids[i]!, p.kind));
    const nums = arm.parts.map((p) => (ctx.ac ? texAlgP(partsZ([p], ctx.omega)) : texNum(p.value)));
    return { syms, nums };
  };
  const group = (elements: string[], name: string, z: Cx, tone: GroupRef['tone'] = 'accent'): GroupRef => ({ elements, label: label(name, z), tone });

  // A legutolsó keresztág (a kapcsok előtt): soros elemei összeadódnak.
  for (let k = n; k >= 1; k--) {
    const r = b.shunts[k - 1];
    const after = k < n ? P[k + 1]! : null;
    const afterIds = k < n ? pIds[k + 1]! : [];
    const afterName = k < n ? pName[k + 1]! : '';
    let w: Cx;
    let ids: string[];
    let name: string;
    if (!r) {
      w = after!;
      ids = afterIds;
      name = afterName;
    } else if (after === null) {
      w = r.z;
      ids = r.ids;
      if (r.parts.length > 1) {
        name = nextName();
        const t = armTex(r);
        steps.push({
          title: 'Soros összevonás',
          text: `A ${k}. keresztág elemei sorosan kapcsolódnak (ugyanaz az áram folyik rajtuk), ezért az impedanciájuk összeadódik.`,
          terms: [`${zs(name)} = ${t.syms.join(' + ')}`],
          subst: `${zs(name)} = ${t.nums.join(' + ')} = ${texZVal(w, ctx)}`,
          result: { symbol: zs(name), value: abs(w), unit: 'Ω', tex: texZVal(w, ctx, false) },
          highlight: { groups: [group(ids, name, w)] },
        });
      } else {
        name = '';
      }
    } else {
      w = par(r.z, after);
      ids = [...r.ids, ...afterIds];
      name = nextName();
      const t = armTex(r);
      const rSym = r.parts.length > 1 ? `(${t.syms.join(' + ')})` : t.syms[0]!;
      const rNum = r.parts.length > 1 ? `(${ctx.ac ? texAlg(r.z) : texNum(r.z.re)})` : t.nums[0]!;
      const aSym = pTex[k + 1] ?? '';
      const aNum = ctx.ac ? texAlgP(after) : texNum(after.re);
      steps.push({
        title: 'Párhuzamos összevonás',
        text: `A ${k}. keresztág és a tőle jobbra lévő rész ugyanarra a két csomópontra csatlakozik, tehát párhuzamosak: replusz (szorzat osztva összeggel).`,
        terms: [`${zs(name)} = ${rSym} \\times ${aSym || aNum}`, ` = \\dfrac{${rSym}\\cdot ${aSym || aNum}}{${rSym} + ${aSym || aNum}}`],
        subst: `${zs(name)} = \\dfrac{${rNum}\\cdot ${aNum}}{${rNum} + ${aNum}} = ${texZVal(w, ctx)}`,
        result: { symbol: zs(name), value: abs(w), unit: 'Ω', tex: texZVal(w, ctx, false) },
        highlight: { groups: [group(ids, name, w)] },
      });
    }
    W[k] = w;
    wIds[k] = ids;
    wName[k] = name;
    wTex[k] = name ? zs(name) : r ? r.parts.map((p, i) => texElemZ(r.ids[i]!, p.kind)).join(' + ') : pTex[k + 1]!;
    // Soros ág a (k−1). csomópont felé.
    const s = b.series[k - 1]!;
    if (s.parts.length === 0) {
      P[k] = w;
      pIds[k] = ids;
      pName[k] = name;
      pTex[k] = wTex[k]!;
    } else {
      const p = add(s.z, w);
      const pn = nextName();
      const t = armTex(s);
      const wSym = wTex[k]!;
      const wNum = ctx.ac ? texAlgP(w) : texNum(w.re);
      P[k] = p;
      pIds[k] = [...s.ids, ...ids];
      pName[k] = pn;
      pTex[k] = zs(pn);
      steps.push({
        title: 'Soros összevonás',
        text: k === 1 ? `Végül a generátorhoz legközelebbi soros ág hozzáadódik: ez a generátor felől látott eredő.` : `A ${k}. soros ág sorosan kapcsolódik az eddigi eredőhöz (ugyanaz az áram folyik át rajtuk): összeadjuk.`,
        terms: [`${zs(pn)} = ${t.syms.join(' + ')} + ${wSym || wNum}`],
        subst: `${zs(pn)} = ${t.nums.join(' + ')} + ${wNum} = ${texZVal(p, ctx)}`,
        result: { symbol: zs(pn), value: abs(p), unit: 'Ω', tex: texZVal(p, ctx, false) },
        highlight: { groups: [group(pIds[k]!, pn, p, k === 1 ? 'result' : 'accent')] },
      });
    }
  }
  return { W, P, zin: P[1]!, wIds, pIds, wName, pName, wTex, pTex };
}

// ───────── Osztók a generátortól a keresett helyig ─────────

export interface NodeChain {
  /** U[k]: a k. keresztág feszültsége (felső − alsó vezeték), k = 0 a generátor kapcsa. */
  U: Cx[];
  /** A k. hely feszültségének LaTeX-jele a levezetésben (elem nélküli soros ágnál az előzőé). */
  sym: string[];
}

/**
 * Feszültségosztók sorban: a (k−1). csomópont feszültségéből a k. keresztágé, amíg el nem érjük
 * a keresett helyet (`upTo`).
 */
export function dividerChain(b: BuiltLadder, fc: ForwardChain, U0: Cx, upTo: number, steps: Step[], ctx: Ctx): NodeChain {
  const us = (sub: string) => (ctx.ac ? texU(sub) : `U_{${sub}}`);
  const U: Cx[] = [U0];
  // Melyik (már bemutatott) jel adja a k. hely feszültségét: elem nélküli soros ágnál az előzőé.
  const idx: number[] = [0];
  const place = (k: number) => (k === 0 ? 'a generátor' : b.shunts[k - 1] ? `a ${k}. keresztág` : `a ${k}. csomópont (a felső és az alsó vezeték között)`);
  for (let k = 1; k <= upTo; k++) {
    const s = b.series[k - 1]!;
    const prev = U[k - 1]!;
    if (s.parts.length === 0) {
      U[k] = prev;
      idx[k] = idx[k - 1]!;
      continue;
    }
    idx[k] = k;
    const ratio = div(fc.W[k]!, fc.P[k]!);
    const u = mul(prev, ratio);
    U[k] = u;
    const wSym = fc.wTex[k]!;
    const pSym = fc.pTex[k]!;
    const prevSym = us(String(idx[k - 1]!));
    const num = (z: Cx) => (ctx.ac ? texAlgP(z) : texNum(z.re));
    steps.push({
      title: 'Feszültségosztás',
      text: `A ${k}. soros ág és a mögötte lévő rész sorosan kapcsolódik, így ${place(idx[k - 1]!)} feszültsége az impedanciák arányában oszlik meg rajtuk. ${capitalize(place(k))} feszültsége a mögötte lévő eredőre eső rész.`,
      terms: [`${us(String(k))} = ${prevSym}\\cdot\\dfrac{${wSym}}{${pSym}}`],
      subst: `${us(String(k))} = ${ctx.ac ? texPhasor(prev, 'V', ctx) : texQtyReal(prev.re, 'V')}\\cdot\\dfrac{${num(fc.W[k]!)}}{${num(fc.P[k]!)}} = ${texPhasor(u, 'V', ctx)}`,
      result: { symbol: us(String(k)), value: abs(u), unit: 'V', tex: texPhasor(u, 'V', ctx) },
      highlight: { elements: b.shunts[k - 1]?.ids ?? [], groups: [{ elements: fc.wIds[k]!, label: `U${k} = ${ctx.ac ? `${formatQuantity(abs(u), 'V', { sig: 3 })} ∠${formatNumber(argDeg(u), 3)}°` : formatQuantity(u.re, 'V')}`, tone: 'result' }] },
    });
  }
  return { U, sym: idx.map((i) => us(String(i))) };
}

const capitalize = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);

/** Hol van egy elem a létrában. */
export function locate(b: BuiltLadder, id: string): { where: 'series' | 'shunt' | 'tail'; k: number; arm: ArmRef; index: number } | null {
  for (let k = 1; k <= b.series.length; k++) {
    const s = b.series[k - 1]!;
    if (s.ids.includes(id)) return { where: 'series', k, arm: s, index: s.ids.indexOf(id) };
    const r = b.shunts[k - 1];
    if (r?.ids.includes(id)) return { where: 'shunt', k, arm: r, index: r.ids.indexOf(id) };
  }
  if (b.tail?.ids.includes(id)) return { where: 'tail', k: b.series.length + 1, arm: b.tail, index: b.tail.ids.indexOf(id) };
  return null;
}
