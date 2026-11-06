// Hurokáram-módszer. Hurkok = a síkrajz ablakai, óramutató járásával egyező körüljárással.
// Áramforrás: ha csak egy hurokban van, a hurokáramot a forrás áramához kötjük; ha két hurok
// közös ágában van, a két hurok szuperhurkot alkot (a forrás feszültsége kiesik).

import type { Problem } from '../generator/generate';
import { RealField } from '../solver/field';
import { solveLinear } from '../solver/linear';
import { allElements } from '../solver/model';
import { toNetlist, UnionFind } from '../solver/netlist';
import { answersFromValues, simplificationStep, sub, targetResistors } from './common';
import { solveSystemSteps } from './linsolve';
import { formatQuantity } from '../units';
import { meshes, type Values } from './engine';
import { texElement, texNum, texOf, texQty } from './tex';
import type { MethodResult, Step } from './types';

const IM = (k: number) => `I_{${k}}`;

/** Lineáris egyenlet LaTeX-ben: 6 I_1 - 2 I_2 = 2. */
/** A hurokegyenlet "= 0" alakban (a forrás a bal oldalon), majd átrendezve a megoldáshoz. */
function zeroForm(coeffs: number[], names: string[], rhs: number): string {
  const moved = linearTex(coeffs, names, rhs);
  if (Math.abs(rhs) < 1e-12) return moved;
  const left = moved.slice(0, moved.lastIndexOf(' = '));
  return `${left} ${rhs > 0 ? '-' : '+'} ${texNum(Math.abs(rhs))} = 0 \\quad\\Rightarrow\\quad ${moved}`;
}

export function linearTex(coeffs: number[], names: string[], rhs: number): string {
  const parts: string[] = [];
  coeffs.forEach((c, i) => {
    if (Math.abs(c) < 1e-12) return;
    const abs = Math.abs(c);
    const num = Math.abs(abs - 1) < 1e-12 ? '' : `${texNum(abs)}\\,`;
    parts.push(`${c < 0 ? '-' : parts.length ? '+' : ''} ${num}${names[i]}`);
  });
  return `${parts.join(' ') || '0'} = ${texNum(rhs)}`;
}

/** Ágáram a hurokáramokból: I_1 - I_2. */
function branchExpr(memb: { mesh: number; sign: number }[]): string {
  return memb.map((m, i) => `${m.sign < 0 ? '-' : i ? '+' : ''} ${IM(m.mesh)}`).join(' ') || '0';
}

export function solveLoopCurrent(p: Problem): MethodResult {
  const map = toNetlist(p.circuit);
  const net = map.net;
  const sources = net.elements.filter((e) => e.kind !== 'R');
  if (sources.length === 0) return { ok: false, reason: 'Nincs forrás a hálózatban: hurokáram helyett eredő ellenállást számolunk.' };
  const ms = meshes(p.circuit, map);
  if (ms.length === 0) return { ok: false, reason: 'Nincs hurok a hálózatban.' };
  const M = ms.length;

  // Elem → hurkok (előjellel). Egy elem legfeljebb két hurokban lehet.
  const member = new Map<string, { mesh: number; sign: number }[]>();
  for (const m of ms) {
    for (const x of m.elements) {
      const list = member.get(x.id) ?? [];
      const same = list.find((y) => y.mesh === m.index);
      if (same) same.sign += x.sign;
      else list.push({ mesh: m.index, sign: x.sign });
      member.set(x.id, list);
    }
  }
  for (const [id, list] of member) member.set(id, list.filter((x) => x.sign !== 0));
  const memb = (id: string) => member.get(id) ?? [];

  // Szuperhurkok: közös ágban álló áramforrás köti össze a hurkokat.
  const uf = new UnionFind(M + 1);
  const isrcs = sources.filter((e) => e.kind === 'I');
  for (const s of isrcs) {
    const mm = memb(s.id);
    if (mm.length === 2) uf.union(mm[0]!.mesh, mm[1]!.mesh);
  }
  const groups = new Map<number, number[]>();
  for (const m of ms) groups.set(uf.find(m.index), [...(groups.get(uf.find(m.index)) ?? []), m.index]);
  const boundary = new Set<number>();
  for (const s of isrcs) {
    const mm = memb(s.id);
    if (mm.length === 1) boundary.add(uf.find(mm[0]!.mesh));
  }

  const rows: { coeffs: number[]; rhs: number; step: Step }[] = [];
  const names = ms.map((m) => IM(m.index));
  const loopsOf = (idx: number[]) => ms.filter((m) => idx.includes(m.index)).map((m) => ({ elements: m.elements, label: `I${m.index}` }));

  for (const s of isrcs) {
    const mm = memb(s.id);
    const coeffs = new Array<number>(M).fill(0);
    for (const x of mm) coeffs[x.mesh - 1] = x.sign;
    const shared = mm.length === 2;
    rows.push({
      coeffs,
      rhs: s.value,
      step: {
        title: shared ? 'Áramforrás két hurok közös ágában' : 'Áramforrás egy hurokban',
        text: shared
          ? `Az ${s.id} áramforrás két hurok közös ágában van: a két hurokáram előjeles összege éppen a forrás árama. A két hurok szuperhurkot alkot.`
          : `Az ${s.id} áramforrás csak egy hurokban van: a hurokáram előjelesen megegyezik a forrás áramával, ezt nem kell egyenlettel keresni.`,
        terms: [`${branchExpr(mm)} = I_{\\text{${s.id}}}`],
        subst: linearTex(coeffs, names, s.value),
        highlight: { elements: [s.id], loops: loopsOf(mm.map((x) => x.mesh)) },
      },
    });
  }

  for (const [root, idx] of groups) {
    if (boundary.has(root)) continue;
    const coeffs = new Array<number>(M).fill(0);
    let rhs = 0;
    const lhsTerms: string[] = [];
    const bullets: string[] = [];
    // Ágáram szövegesen: "I₁ − I₂".
    const exprTxt = (mm: { mesh: number; sign: number }[]) => mm.map((m, i) => `${m.sign < 0 ? '− ' : i ? '+ ' : ''}I${sub(m.mesh)}`).join(' ');
    for (const e of net.elements) {
      // A csoportba tartozó hurkok összegében az elem együtthatója.
      const c = memb(e.id)
        .filter((x) => idx.includes(x.mesh))
        .reduce((acc, x) => acc + x.sign, 0);
      if (c === 0) continue;
      if (e.kind === 'R') {
        for (const x of memb(e.id)) coeffs[x.mesh - 1]! += c * x.sign * e.value;
        const expr = branchExpr(memb(e.id));
        const multi = memb(e.id).length > 1;
        lhsTerms.push(`${c < 0 ? '-' : lhsTerms.length ? '+' : ''} ${texElement(e.id)}${multi ? `(${expr})` : expr === IM(memb(e.id)[0]!.mesh) ? ` ${expr}` : `(${expr})`}`);
        // A körüljárás irányában számolt ágáram: c · (az elem saját irányú árama).
        const along = memb(e.id).map((m) => ({ mesh: m.mesh, sign: c * m.sign }));
        bullets.push(
          multi
            ? `${e.id} (${formatQuantity(e.value, 'Ω')}): két hurok közös ága, ezért a körüljárás irányában ${exprTxt(along)} áram folyik rajta; a feszültsége ${formatQuantity(e.value, 'Ω')} · (${exprTxt(along)}).`
            : `${e.id} (${formatQuantity(e.value, 'Ω')}): csak ebben a hurokban van, a hurokáram folyik rajta; a feszültsége ${formatQuantity(e.value, 'Ω')} · ${exprTxt(along)}.`,
        );
      } else if (e.kind === 'V') {
        // A forrás feszültsége a bal oldalon: c · U_ab = c · (−E). A feszültség nyila (a nagyobb potenciáltól a
        // kisebb felé) a modell a→b irányával ellentétes, így c < 0 jelenti, hogy a körüljárás egyezik vele: +E.
        rhs += c * e.value;
        const along = c < 0;
        lhsTerms.push(`${along ? '+' : '-'} U_{\\text{${e.id}}}`);
        bullets.push(
          `${e.id} (${formatQuantity(e.value, 'V')}): a körüljárás ${along ? 'egyezik a feszültség nyilával' : 'szemben halad a feszültség nyilával'}, ezért a bal oldalra ${along ? '+' : '−'}${formatQuantity(e.value, 'V')} kerül (ugyanúgy, mint egy ellenállás feszültsége, aminek a nyila a körüljárással ${along ? 'egyezik' : 'szembe megy'}).`,
        );
      }
    }
    const isSuper = idx.length > 1;
    rows.push({
      coeffs,
      rhs,
      step: {
        title: isSuper ? `Szuperhurok (${idx.map((i) => `I${i}`).join(', ')})` : `Huroktörvény: I${idx[0]} hurok`,
        text: isSuper
          ? 'A két hurkot együtt járjuk körbe (szuperhurok), mert a közös águkban áramforrás van, aminek a feszültségét nem ismerjük; így az kiesik. A huroktörvény: körbeérve a feszültségek előjeles összege nulla. Minden tag a bal oldalra kerül: amelyik feszültség nyila egyezik a körüljárással, az +, amelyiké szembe megy, az −. Tagonként:'
          : 'Kirchhoff huroktörvénye: ha körbejárjuk a hurkot, a feszültségek előjeles összege nulla (különben nem érnénk vissza ugyanarra a potenciálra). Minden tag a bal oldalra kerül: amelyik feszültség nyila egyezik a körüljárással, az +, amelyiké szembe megy, az −. Tagonként:',
        bullets,
        terms: [...lhsTerms, '= 0'],
        subst: zeroForm(coeffs, names, rhs),
        highlight: { loops: loopsOf(idx) },
      },
    });
  }

  if (rows.length !== M) return { ok: false, reason: 'A hurokegyenletek száma nem egyezik a hurkok számával.' };
  const x = solveLinear(
    rows.map((r) => r.coeffs),
    rows.map((r) => r.rhs),
    RealField,
  );
  if (!x) return { ok: false, reason: 'A hurokegyenlet-rendszer nem oldható meg egyértelműen.' };

  // Elemáramok a hurokáramokból, feszültségek: ellenállás R·I, feszültségforrás −E,
  // áramforrás a potenciálokból (az áramforrások nélkül összefüggő gráfon végigsétálva).
  const values: Values = new Map();
  for (const e of net.elements) {
    const I = e.kind === 'I' ? e.value : memb(e.id).reduce((acc, m) => acc + m.sign * x[m.mesh - 1]!, 0);
    values.set(e.id, { U: e.kind === 'R' ? e.value * I : e.kind === 'V' ? -e.value : NaN, I });
  }
  const phi = new Map<number, number>([[0, 0]]);
  const queue = [0];
  while (queue.length) {
    const n = queue.shift()!;
    for (const e of net.elements) {
      if (e.kind === 'I') continue;
      const U = values.get(e.id)!.U;
      if (e.a === n && !phi.has(e.b)) {
        phi.set(e.b, phi.get(n)! - U);
        queue.push(e.b);
      } else if (e.b === n && !phi.has(e.a)) {
        phi.set(e.a, phi.get(n)! + U);
        queue.push(e.a);
      }
    }
  }
  for (const e of net.elements) if (e.kind === 'I') values.get(e.id)!.U = (phi.get(e.a) ?? 0) - (phi.get(e.b) ?? 0);

  const steps: Step[] = [];
  const simp = simplificationStep(p, net);
  if (simp) steps.push(simp);
  steps.push({
    title: 'Hurkok kijelölése',
    text: `A hálózatban ${M} "ablak" (független hurok) van. Mindegyikbe képzeletben egy körbefolyó áramot rajzolunk (hurokáram), az óramutató járásával egyező irányban. Egy ág valódi árama a rajta átfolyó hurokáramok előjeles összege: két ablak közös ágában például a kettő különbsége.`,
    bullets: [`${M} ismeretlen hurokáram: ${ms.map((m) => `I${sub(m.index)}`).join(', ')}.`, `Ehhez ${M} egyenlet kell: hurkonként egy huroktörvény (áramforrás esetén helyette annak árama).`],
    highlight: { loops: loopsOf(ms.map((m) => m.index)) },
  });
  steps.push(...rows.map((r) => r.step));
  steps.push(
    ...solveSystemSteps(
      rows.map((r) => r.coeffs),
      rows.map((r) => r.rhs),
      names,
      ms.map((m) => `I${sub(m.index)}`),
      x,
      'A',
      { loops: loopsOf(ms.map((m) => m.index)) },
    ),
  );

  const els = new Map(allElements(p.circuit).map((e) => [e.id, e]));
  const targets = targetResistors(p);
  for (const t of targets) {
    const v = values.get(t)!;
    const mm = memb(t);
    steps.push({
      title: `${t} árama`,
      text: mm.length > 1 ? 'Az ág árama a két hurokáram előjeles összege (a referenciairány szerint).' : 'Az ágban egyetlen hurokáram folyik.',
      terms: [`${texOf('I', t)} = ${branchExpr(mm)}`],
      subst: `${texOf('I', t)} = ${mm.map((m, i) => `${m.sign < 0 ? '-' : i ? '+' : ''} ${texQty(x[m.mesh - 1]!, 'A', { paren: true })}`).join(' ') || '0'}`,
      result: { symbol: texOf('I', t), value: v.I, unit: 'A' },
      highlight: { elements: [t], loops: loopsOf(mm.map((m) => m.mesh)), arrows: [{ element: t, kind: 'I', value: v.I }] },
    });
    if (p.questions.some((q) => q.target === t && (q.kind === 'U' || q.kind === 'P'))) {
      steps.push({
        title: `${t} feszültsége`,
        text: 'Ohm törvénye az ellenállásra.',
        terms: [`${texOf('U', t)} = ${texElement(t)} \\cdot ${texOf('I', t)}`],
        subst: `${texOf('U', t)} = ${texQty(els.get(t)!.value, 'Ω')} \\cdot ${texQty(v.I, 'A', { paren: true })}`,
        result: { symbol: texOf('U', t), value: v.U, unit: 'V' },
        highlight: { elements: [t], arrows: [{ element: t, kind: 'U', value: v.U }] },
      });
    }
  }
  steps.push(...sourcePowerSteps(p, values));
  return { ok: true, solution: { method: 'hurokaram', title: 'Hurokáram-módszer', steps, answers: answersFromValues(p, values), values } };
}

/** A források teljesítménye (ha kérdés): P = U · I, negatív = lead. */
export function sourcePowerSteps(p: Problem, values: Values): Step[] {
  const asked = p.questions.filter((q) => q.kind === 'P' && q.target && !q.target.startsWith('R'));
  if (asked.length === 0) return [];
  const ids = asked.map((q) => q.target!);
  return [
    {
      title: 'A források teljesítménye',
      text: 'Minden forrásra P = U · I a saját referenciairányában: negatív, ha teljesítményt ad le, pozitív, ha felvesz.',
      terms: ids.map((id, i) => `P_{\\text{${id}}} = ${texQty(values.get(id)!.U, 'V', { paren: true })} \\cdot ${texQty(values.get(id)!.I, 'A', { paren: true })} = ${texQty(values.get(id)!.U * values.get(id)!.I, 'W')}${i < ids.length - 1 ? ',\\quad' : ''}`),
      highlight: { elements: ids },
      note: ids
        .map((id) => {
          const P = values.get(id)!.U * values.get(id)!.I;
          return `${id} ${P < 0 ? 'lead' : 'felvesz'} teljesítményt.`;
        })
        .join(' '),
    },
  ];
}
