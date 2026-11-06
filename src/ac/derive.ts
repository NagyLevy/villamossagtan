// Levezetés-építőkockák a létrahálózatokhoz: helyettesítő generátor belső impedanciája (a generátor
// kiiktatásával, a generátor felől a kapcsok felé), egy elem fazora (osztókkal), időfüggvény.

import type { Step } from '../methods/types';
import { formatQuantity } from '../units';
import { abs, add, argDeg, cx, div, mul, par, texAlgP, texNum, type Cx } from './complex';
import { impedanceOf } from './mna';
import { dividerChain, locate, texOmega, texElemZ, texI, texPhasor, texU, texZ, texZVal, plainZ, type BuiltLadder, type Ctx, type ForwardChain } from './ladder';

const INF = cx(Number.POSITIVE_INFINITY);
const isInf = (z: Cx) => !Number.isFinite(z.re) || !Number.isFinite(z.im);

/**
 * Belső impedancia a kimeneti kapcsok felől: a generátort kiiktatjuk (feszültségforrás → rövidzár,
 * áramforrás → szakadás), aztán a generátor felől haladva vonjuk össze az elemeket.
 */
export function backwardChain(b: BuiltLadder, steps: Step[], ctx: Ctx, symbol: string): Cx {
  const zs = (sub: string) => (ctx.ac ? texZ(sub) : `R_{${sub}}`);
  const num = (z: Cx) => (ctx.ac ? texAlgP(z) : texNum(z.re));
  const src = b.spec.source!;
  const killedShort = src.kind === 'V';
  const all: string[] = [];
  steps.push({
    title: 'Generátor kiiktatása',
    text: killedShort
      ? 'A belső impedanciához a generátort kiiktatjuk: a feszültségforrás helyére rövidzár kerül (a feszültsége nulla, de az áramot átengedi). A kapcsoló a bekapcsolás után zárt, vezetéknek számít.'
      : 'A belső impedanciához a generátort kiiktatjuk: az áramforrás helyére szakadás kerül (az árama nulla, az ága kiesik).',
    highlight: { killed: [{ element: b.sourceId!, as: killedShort ? 'short' : 'open' }], terminals: true },
  });
  let Q: Cx = killedShort ? cx(0) : INF;
  let qName = '';
  let counter = 0;
  const n = b.series.length;
  for (let k = 1; k <= n; k++) {
    const s = b.series[k - 1]!;
    // Soros ág: az eddigihez adódik (szakadással sorban továbbra is szakadás).
    if (s.parts.length && !isInf(Q)) {
      const next = add(Q, s.z);
      const name = `b${++counter}`;
      all.push(...s.ids);
      const sSym = s.parts.map((p, i) => texElemZ(s.ids[i]!, p.kind)).join(' + ');
      steps.push({
        title: 'Soros összevonás',
        text: Q.re === 0 && Q.im === 0 && !qName ? `A rövidzár után a ${k}. soros ág a bal oldali keresztág felé csak önmagát adja.` : `A ${k}. soros ág sorosan kapcsolódik az eddigi eredőhöz (a generátor felőli részhez).`,
        terms: [`${zs(name)} = ${qName ? `${zs(qName)} + ` : ''}${sSym}`],
        subst: `${zs(name)} = ${qName ? `${num(Q)} + ` : ''}${s.parts.map((p) => num(armOf(p, ctx))).join(' + ')} = ${texZVal(next, ctx)}`,
        result: { symbol: zs(name), value: abs(next), unit: 'Ω', tex: texZVal(next, ctx, false) },
        highlight: { killed: [{ element: b.sourceId!, as: killedShort ? 'short' : 'open' }], groups: [{ elements: [...all], label: `${ctx.ac ? 'Z' : 'R'}${name} = ${plainZ(next, ctx)}`, tone: 'accent' }] },
      });
      Q = next;
      qName = name;
    } else if (s.parts.length && isInf(Q)) {
      steps.push({
        title: 'Szakadással sorban',
        text: `A ${k}. soros ág egy szakadással van sorban (a kiiktatott áramforrás ága nem vezet), ezért rajta nem folyik áram: kiesik az összevonásból.`,
        highlight: { dim: s.ids, killed: [{ element: b.sourceId!, as: 'open' }] },
      });
    }
    const r = b.shunts[k - 1];
    if (!r) continue;
    const rSym = r.parts.length > 1 ? `(${r.parts.map((p, i) => texElemZ(r.ids[i]!, p.kind)).join(' + ')})` : texElemZ(r.ids[0]!, r.parts[0]!.kind);
    if (isInf(Q) || (Q.re === 0 && Q.im === 0 && !qName)) {
      if (Q.re === 0 && Q.im === 0 && !isInf(Q)) {
        // A rövidzár párhuzamosan a keresztággal: az ág rövidre van zárva.
        steps.push({
          title: 'Rövidre zárt ág',
          text: `A ${k}. keresztággal párhuzamosan a rövidzár áll, így rajta nincs feszültség: kiesik, az eredő itt nulla.`,
          highlight: { dim: r.ids, killed: [{ element: b.sourceId!, as: 'short' }] },
        });
        continue;
      }
      // Szakadás párhuzamosan: csak a keresztág marad.
      const name = `b${++counter}`;
      all.push(...r.ids);
      Q = r.z;
      qName = name;
      steps.push({
        title: 'A keresztág marad',
        text: `A kiiktatott áramforrás szakadás, ezért a ${k}. keresztággal párhuzamosan nincs semmi: az eredő eddig maga a keresztág.`,
        terms: [`${zs(name)} = ${rSym}`],
        subst: `${zs(name)} = ${texZVal(Q, ctx)}`,
        result: { symbol: zs(name), value: abs(Q), unit: 'Ω', tex: texZVal(Q, ctx, false) },
        highlight: { killed: [{ element: b.sourceId!, as: 'open' }], groups: [{ elements: [...all], label: `${ctx.ac ? 'Z' : 'R'}${name} = ${plainZ(Q, ctx)}`, tone: 'accent' }] },
      });
      continue;
    }
    const next = par(r.z, Q);
    const name = `b${++counter}`;
    all.push(...r.ids);
    steps.push({
      title: 'Párhuzamos összevonás',
      text: `A ${k}. keresztág párhuzamos az eddigi (generátor felőli) eredővel: ugyanarra a két csomópontra csatlakoznak.`,
      terms: [`${zs(name)} = ${rSym} \\times ${zs(qName)}`, ` = \\dfrac{${rSym}\\cdot ${zs(qName)}}{${rSym} + ${zs(qName)}}`],
      subst: `${zs(name)} = \\dfrac{${num(r.z)}\\cdot ${num(Q)}}{${num(r.z)} + ${num(Q)}} = ${texZVal(next, ctx)}`,
      result: { symbol: zs(name), value: abs(next), unit: 'Ω', tex: texZVal(next, ctx, false) },
      highlight: { killed: [{ element: b.sourceId!, as: killedShort ? 'short' : 'open' }], groups: [{ elements: [...all], label: `${ctx.ac ? 'Z' : 'R'}${name} = ${plainZ(next, ctx)}`, tone: 'accent' }] },
    });
    Q = next;
    qName = name;
  }
  if (b.tail && b.tail.parts.length) {
    const t = b.tail;
    const next = add(Q, t.z);
    all.push(...t.ids);
    steps.push({
      title: 'Soros összevonás',
      text: 'Végül a kapcsok előtti soros ág adódik hozzá.',
      terms: [`${symbol} = ${zs(qName)} + ${t.parts.map((p, i) => texElemZ(t.ids[i]!, p.kind)).join(' + ')}`],
      subst: `${symbol} = ${num(Q)} + ${t.parts.map((p) => num(armOf(p, ctx))).join(' + ')} = ${texZVal(next, ctx)}`,
      result: { symbol, value: abs(next), unit: 'Ω', tex: texZVal(next, ctx, false) },
      highlight: { killed: [{ element: b.sourceId!, as: killedShort ? 'short' : 'open' }], groups: [{ elements: [...all], label: `${symbol.includes('th') ? (ctx.ac ? 'Zth' : 'Rth') : 'Z'} = ${plainZ(next, ctx)}`, tone: 'result' }], terminals: true },
    });
    return next;
  }
  steps.push({
    title: ctx.ac ? 'Belső impedancia' : 'Belső ellenállás',
    text: 'A kapcsok felől nézve ennyi az eredő a kiiktatott generátorral: ez a helyettesítő generátor belső ' + (ctx.ac ? 'impedanciája.' : 'ellenállása.'),
    terms: [`${symbol} = ${zs(qName)}`],
    result: { symbol, value: abs(Q), unit: 'Ω', tex: texZVal(Q, ctx) },
    highlight: { killed: [{ element: b.sourceId!, as: killedShort ? 'short' : 'open' }], groups: [{ elements: [...all], label: `${ctx.ac ? 'Zth' : 'Rth'} = ${plainZ(Q, ctx)}`, tone: 'result' }], terminals: true },
  });
  return Q;
}

function armOf(p: { kind: 'R' | 'L' | 'C'; value: number }, ctx: Ctx): Cx {
  return ctx.ac ? impedanceOf(p.kind, p.value, ctx.omega) : cx(p.value);
}

/** A generátor kapcsán lévő feszültség (U0) és a generátor felől látott eredő ismeretében. */
export function sourceVoltageStep(b: BuiltLadder, fc: ForwardChain, steps: Step[], ctx: Ctx): Cx {
  const src = b.spec.source!;
  const value = ctx.ac ? polarOf(src.amp, src.phase) : cx(src.amp);
  if (src.kind === 'V') {
    steps.push({
      title: 'A generátor feszültsége',
      text: 'A feszültségforrás kapcsain (a bal oldali két vezeték között) a generátor feszültsége van, ez az osztók kiindulópontja.',
      terms: [`${texU('0')} = ${texU('g')}`],
      result: { symbol: texU('0'), value: src.amp, unit: 'V', tex: texPhasor(value, 'V', ctx) },
      highlight: { elements: [b.sourceId!] },
    });
    return value;
  }
  const u0 = mul(value, fc.zin);
  steps.push({
    title: 'A generátor kapcsain',
    text: 'Az áramforrás árama a teljes eredőn folyik át (a bal oldali két vezeték között), így Ohm törvénye adja a kapocsfeszültséget.',
    terms: [`${texU('0')} = ${texI('g')}\\cdot ${fc.pTex[1]!}`],
    subst: `${texU('0')} = ${texPhasor(value, 'A', ctx)}\\cdot ${ctx.ac ? texAlgP(fc.zin) : texNum(fc.zin.re)} = ${texPhasor(u0, 'V', ctx)}`,
    result: { symbol: texU('0'), value: abs(u0), unit: 'V', tex: texPhasor(u0, 'V', ctx) },
    highlight: { elements: [b.sourceId!] },
  });
  return u0;
}

export function polarOf(amp: number, phase: number): Cx {
  const r = (phase * Math.PI) / 180;
  return { re: amp * Math.cos(r), im: amp * Math.sin(r) };
}

/** Egy elem feszültsége és árama az osztóláncból, lépésekkel. */
export function elementPhasor(b: BuiltLadder, fc: ForwardChain, U0: Cx, id: string, want: 'U' | 'I', steps: Step[], ctx: Ctx): { U: Cx; I: Cx } {
  const loc = locate(b, id)!;
  const upTo = loc.where === 'series' ? loc.k - 1 : loc.k;
  const chain = dividerChain(b, fc, U0, upTo, steps, ctx);
  const part = loc.arm.parts[loc.index]!;
  const ze = armOf(part, ctx);
  const zeSym = texElemZ(id, part.kind);
  const num = (z: Cx) => (ctx.ac ? texAlgP(z) : texNum(z.re));
  const us = (s: string) => (ctx.ac ? texU(s) : `U_{${s}}`);
  const is = (s: string) => (ctx.ac ? texI(s) : `I_{${s}}`);
  let I: Cx;
  if (loc.where === 'shunt') {
    const Uk = chain.U[loc.k]!;
    I = div(Uk, loc.arm.z);
    const armSym = loc.arm.parts.length > 1 ? `(${loc.arm.parts.map((p, i) => texElemZ(loc.arm.ids[i]!, p.kind)).join(' + ')})` : zeSym;
    steps.push({
      title: 'Ohm törvénye',
      text: loc.arm.parts.length > 1 ? `A ${loc.k}. keresztág árama a keresztág feszültsége osztva a keresztág teljes (soros) impedanciájával; ez folyik a keresett elemen is.` : `A keresett elem maga a ${loc.k}. keresztág: az árama a keresztág feszültsége osztva az impedanciájával.`,
      terms: [`${is(id)} = \\dfrac{${chain.sym[loc.k]!}}{${armSym}}`],
      subst: `${is(id)} = \\dfrac{${texPhasor(Uk, 'V', ctx)}}{${num(loc.arm.z)}} = ${texPhasor(I, 'A', ctx)}`,
      result: { symbol: is(id), value: abs(I), unit: 'A', tex: texPhasor(I, 'A', ctx) },
      highlight: { elements: loc.arm.ids, arrows: [{ element: id, kind: 'I', value: ctx.ac ? abs(I) : I.re }] },
    });
  } else {
    const Uprev = chain.U[loc.k - 1]!;
    I = div(Uprev, fc.P[loc.k]!);
    steps.push({
      title: 'A soros ág árama',
      text: `A ${loc.k}. soros ágon az az áram folyik, ami a ${loc.k - 1 === 0 ? 'generátor kapcsairól' : `${loc.k - 1}. keresztág csomópontjából`} a jobbra lévő teljes részbe befolyik: feszültség osztva a jobbra látott eredővel.`,
      terms: [`${is(id)} = \\dfrac{${chain.sym[loc.k - 1]!}}{${fc.pTex[loc.k]!}}`],
      subst: `${is(id)} = \\dfrac{${texPhasor(Uprev, 'V', ctx)}}{${num(fc.P[loc.k]!)}} = ${texPhasor(I, 'A', ctx)}`,
      result: { symbol: is(id), value: abs(I), unit: 'A', tex: texPhasor(I, 'A', ctx) },
      highlight: { elements: loc.arm.ids, groups: [{ elements: fc.pIds[loc.k]!, label: `${ctx.ac ? 'Z' : 'R'}${fc.pName[loc.k]} = ${plainZ(fc.P[loc.k]!, ctx)}`, tone: 'accent' }], arrows: [{ element: id, kind: 'I', value: ctx.ac ? abs(I) : I.re }] },
    });
  }
  const U = mul(I, ze);
  if (want === 'U') {
    steps.push({
      title: part.kind === 'R' ? 'Az ellenállás feszültsége' : part.kind === 'L' ? 'A tekercs feszültsége' : 'A kondenzátor feszültsége',
      text: 'Az elem feszültsége az árama szorozva a saját impedanciájával (a komplex Ohm-törvény). A szorzásnál az abszolút értékek szorzódnak, a szögek összeadódnak.',
      terms: [`${us(id)} = ${is(id)}\\cdot ${zeSym}`],
      subst: `${us(id)} = ${texPhasor(I, 'A', ctx)}\\cdot ${num(ze)} = ${texPhasor(U, 'V', ctx)}`,
      result: { symbol: us(id), value: abs(U), unit: 'V', tex: texPhasor(U, 'V', ctx) },
      highlight: { elements: [id], arrows: [{ element: id, kind: 'U', value: ctx.ac ? abs(U) : U.re }] },
    });
  }
  return { U, I };
}

/** A komplex csúcsértékből az időfüggvény: x(t) = |X̂|·cos(ωt + φ). */
export function timeFunctionStep(sym: string, v: Cx, unit: 'V' | 'A', omega: number, id: string): Step {
  const q = formatQuantity(abs(v), unit).replace(',', '{,}').replace(' ', '\\,').replace('µ', '\\mu ');
  const ph = argDeg(v);
  const phTex = Math.abs(ph) < 1e-9 ? '' : ` ${ph < 0 ? '-' : '+'} ${texNum(Math.abs(ph))}^\\circ`;
  return {
    title: 'Időfüggvény',
    text: 'A komplex csúcsérték abszolút értéke a csúcsérték, a szöge a kezdőfázis. A körfrekvencia ugyanaz, mint a generátoré.',
    terms: [`${sym}(t) = ${q.replace(/([A-Za-z]+)$/, '\\text{$1}')}\\cdot\\cos(${texOmega(omega)} t${phTex})`],
    highlight: { elements: [id] },
  };
}

export { texOmega } from './ladder';
