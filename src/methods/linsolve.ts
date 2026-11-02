// Az egyenletrendszer megoldásának látható levezetése (nem csak a végeredmény), úgy, ahogy
// papíron csinálnánk: behelyettesítő módszerrel.
//  1. felírjuk az egyenleteket,
//  2. az egyik egyenletből kifejezünk egy ismeretlent,
//  3. ezt beírjuk a többi egyenletbe → eggyel kevesebb ismeretlen marad,
//  4. ismételjük, amíg egy egyenlet, egy ismeretlen nem marad,
//  5. visszafelé behelyettesítjük a kapott számokat.
// (A végeredményt a gép máshogy számolja; ez csak a megmutatott út.)

import { texNum } from './tex';
import type { Highlight, Step } from './types';

const EPS = 1e-12;

/** Lineáris egyenlet: Σ a[j]·x[j] = r (az eliminált ismeretlenek együtthatója 0). */
interface Eq {
  a: number[];
  r: number;
  label: string;
}

/** Kifejezés: x = c + Σ k[j]·x[j]. */
interface Expr {
  v: number;
  c: number;
  k: number[];
}

const isZero = (x: number, scale = 1) => Math.abs(x) < EPS * Math.max(1, scale);

/** Egy tag előjellel: "+ 4\,φ_2", "- φ_3", az első tag előtt pozitív előjel nélkül. */
function term(coef: number, name: string, first: boolean): string {
  const abs = Math.abs(coef);
  const num = Math.abs(abs - 1) < 1e-9 ? '' : `${texNum(abs)}\\,`;
  const sign = coef < 0 ? (first ? '-' : ' - ') : first ? '' : ' + ';
  return `${sign}${num}${name}`;
}

/** Konstans tag előjellel. */
function constTerm(c: number, first: boolean): string {
  const sign = c < 0 ? (first ? '-' : ' - ') : first ? '' : ' + ';
  return `${sign}${texNum(Math.abs(c))}`;
}

/** Az egyenlet bal oldala: 12\,φ_1 - 4\,φ_2. */
function lhs(a: number[], names: string[]): string {
  const scale = Math.max(...a.map(Math.abs));
  const parts = a.map((v, j) => ({ v, j })).filter(({ v }) => !isZero(v, scale));
  if (!parts.length) return '0';
  return parts.map(({ v, j }, i) => term(v, names[j]!, i === 0)).join('');
}

/** A kifejezés jobb oldala: 2{,}5 + 0{,}25\,φ_2 - φ_3. */
function exprTex(e: Expr, names: string[]): string {
  const scale = Math.max(Math.abs(e.c), ...e.k.map(Math.abs));
  let out = isZero(e.c, scale) ? '' : constTerm(e.c, true);
  for (let j = 0; j < e.k.length; j++) if (!isZero(e.k[j]!, scale)) out += term(e.k[j]!, names[j]!, out === '');
  return out || '0';
}

const system = (eqs: Eq[], names: string[]) =>
  `\\begin{aligned} ${eqs.map((e) => `\\text{(${e.label})}\\quad & ${lhs(e.a, names)} = ${texNum(e.r)}`).join(' \\\\ ')} \\end{aligned}`;

/** `names`: az ismeretlenek LaTeX-jele, `plain`: ugyanaz olvasható szövegként (pl. φ₁, I₂). */
export function solveSystemSteps(A: number[][], b: number[], names: string[], plain: string[], x: number[], unit: string, highlight: Highlight, group?: string): Step[] {
  const n = b.length;
  const res = (i: number) => `${names[i]} = ${texNum(x[i]!)}\\,\\text{${unit}}`;
  if (n === 1) {
    return [
      {
        title: 'Az egyenlet megoldása',
        text: 'Egyetlen ismeretlen van: az egyenletet elosztjuk az ismeretlen együtthatójával.',
        terms: [`${names[0]} = \\frac{${texNum(b[0]!)}}{${texNum(A[0]![0]!)}}`],
        subst: res(0),
        highlight,
        group,
      },
    ];
  }

  const steps: Step[] = [];
  let eqs: Eq[] = A.map((row, i) => ({ a: [...row], r: b[i]!, label: String(i + 1) }));
  steps.push({
    title: 'Az egyenletrendszer',
    text: `${n} egyenlet, ${n} ismeretlen (${plain.join(', ')}). Behelyettesítő módszerrel oldjuk meg: az egyik egyenletből kifejezünk egy ismeretlent, beírjuk a többibe, és így minden körben eggyel kevesebb ismeretlen marad.`,
    terms: [system(eqs, names)],
    highlight,
    group,
  });

  const exprs: Expr[] = [];
  const remaining = new Set(names.map((_, i) => i));
  let round = 0;
  while (eqs.length > 1) {
    round++;
    // Azt az ismeretlent és egyenletet választjuk, ahol az együttható a legnagyobb (így a legpontosabb).
    let best = { eq: 0, v: -1, abs: 0 };
    eqs.forEach((e, ei) => {
      for (const v of remaining) if (Math.abs(e.a[v]!) > best.abs) best = { eq: ei, v, abs: Math.abs(e.a[v]!) };
    });
    if (best.v < 0) break;
    const src = eqs[best.eq]!;
    const v = best.v;
    const av = src.a[v]!;
    const e: Expr = { v, c: src.r / av, k: src.a.map((aj, j) => (j === v ? 0 : -aj / av)) };
    exprs.push(e);
    remaining.delete(v);

    // Az ismeretlen kifejezése: minden más a jobb oldalra, aztán osztás az együtthatóval.
    const moved: Expr = { v, c: src.r, k: src.a.map((aj, j) => (j === v ? 0 : -aj)) };
    steps.push({
      title: `${plain[v]} kifejezése`,
      text: `A (${src.label}) egyenletből kifejezzük ${plain[v]}-t: minden más tagot átviszünk a jobb oldalra (ott előjelet váltanak), aztán az egészet elosztjuk ${plain[v]} együtthatójával.`,
      terms: [`\\begin{aligned} ${term(av, names[v]!, true)} &= ${exprTex(moved, names)} \\\\ ${names[v]} &= ${exprTex(e, names)} \\end{aligned}`],
      highlight,
      group,
    });

    // Behelyettesítés a többi egyenletbe.
    const others = eqs.filter((_, i) => i !== best.eq);
    const lines: string[] = [];
    eqs = others.map((o) => {
      const ov = o.a[v]!;
      // Amelyik egyenletben nincs benne, az változatlan marad.
      if (isZero(ov, Math.max(...o.a.map(Math.abs)))) {
        lines.push(`\\text{(${o.label})}\\quad & ${lhs(o.a, names)} = ${texNum(o.r)} \\qquad \\text{(nincs benne ${plain[v]}, változatlan)}`);
        return o;
      }
      const a = o.a.map((aj, j) => (j === v ? 0 : aj + ov * e.k[j]!));
      const r = o.r - ov * e.c;
      const label = `${o.label}'`;
      const restTex = exprTex({ v, c: 0, k: o.a.map((aj, j) => (j === v ? 0 : aj)) }, names);
      const substituted = `${texNum(ov, { paren: true })} \\cdot \\left(${exprTex(e, names)}\\right)${restTex === '0' ? '' : restTex.startsWith('-') ? ` ${restTex}` : ` + ${restTex}`}`;
      lines.push(`\\text{(${o.label})}\\quad & ${substituted} = ${texNum(o.r)} \\\\ \\Rightarrow\\ \\text{(${label})}\\quad & ${lhs(a, names)} = ${texNum(r)}`);
      return { a, r, label };
    });
    steps.push({
      title: `Behelyettesítés (${round}. kör)`,
      text: `${plain[v]} helyére beírjuk a kifejezését a többi egyenletben, felbontjuk a zárójelet, és összevonjuk az azonos ismeretlenes tagokat. Így ${plain[v]} kiesik: ${eqs.length} egyenlet marad ${eqs.length} ismeretlennel.`,
      terms: [`\\begin{aligned} ${lines.join(' \\\\[6pt] ')} \\end{aligned}`],
      highlight,
      group,
    });
  }

  // Az utolsó egyenlet: egy ismeretlen.
  const last = eqs[0]!;
  const lv = [...remaining][0]!;
  steps.push({
    title: `${plain[lv]} kiszámítása`,
    text: `Egy egyenlet maradt, egyetlen ismeretlennel: elosztjuk ${plain[lv]} együtthatójával.`,
    terms: [`${term(last.a[lv]!, names[lv]!, true)} = ${texNum(last.r)}`, `\\quad\\Rightarrow\\quad ${names[lv]} = \\frac{${texNum(last.r)}}{${texNum(last.a[lv]!)}}`],
    subst: res(lv),
    highlight,
    group,
  });

  // Visszahelyettesítés: a kifejezésekbe fordított sorrendben írjuk be a már ismert értékeket.
  const back = [...exprs].reverse().map((e) => {
    const scale = Math.max(Math.abs(e.c), ...e.k.map(Math.abs));
    let s = isZero(e.c, scale) ? '' : texNum(e.c);
    for (let j = 0; j < e.k.length; j++) {
      const k = e.k[j]!;
      if (isZero(k, scale)) continue;
      s += `${s === '' ? '' : ' + '}${texNum(k, { paren: s !== '' })} \\cdot ${texNum(x[j]!, { paren: true })}`;
    }
    return `${names[e.v]} &= ${exprTex(e, names)} = ${s || '0'} = ${texNum(x[e.v]!)}\\,\\text{${unit}}`;
  });
  steps.push({
    title: 'Visszahelyettesítés',
    text: 'A már ismert értékeket visszaírjuk a korábban kifejezett ismeretlenekbe, a legutóbbitól visszafelé haladva.',
    terms: [`\\begin{aligned} ${back.join(' \\\\ ')} \\end{aligned}`],
    subst: x.map((_, i) => res(i)).join(',\\quad '),
    highlight,
    group,
  });
  return steps;
}
