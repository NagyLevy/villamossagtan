// Hurokáram-módszer, ahogy Dr. Lilik Ferenc tanítja:
//  - a független hurkok száma l = b − n + 1 (b: ágak = elemek, n: csomópontok);
//  - a hurkok a rajz ablakai, óramutató járásával egyező körüljárással (J₁, J₂ …);
//  - minden áramforrásra jut egy ISMERT hurok (árama a forrás árama), és minden ellenállást és
//    feszültségforrást érint legalább egy ismeretlen hurok. Ha az áramforrás két ablak közös ágában
//    van, az egyik ablak az ismert hurok, a másik helyett a kettő közös körvonala az ismeretlen;
//  - a huroktörvény "= 0" alakban: minden tag a bal oldalon, ha a feszültség nyila egyezik a
//    körüljárással +, különben −; utána rendezzük át a megoldáshoz.

import type { Problem } from '../generator/generate';
import { RealField } from '../solver/field';
import { solveLinear } from '../solver/linear';
import { allElements } from '../solver/model';
import { toNetlist } from '../solver/netlist';
import { answersFromValues, simplificationStep, sub, targetResistors } from './common';
import { solveSystemSteps } from './linsolve';
import { formatQuantity } from '../units';
import { meshes, type Mesh, type Values } from './engine';
import { texElement, texNum, texOf, texQty } from './tex';
import type { LoopRef, MethodResult, Step } from './types';

/** A hurokegyenlet "= 0" alakban (a forrás a bal oldalon), majd átrendezve a megoldáshoz. */
function zeroForm(coeffs: number[], names: string[], rhs: number): string {
  const moved = linearTex(coeffs, names, rhs);
  if (Math.abs(rhs) < 1e-12) return moved;
  const left = moved.slice(0, moved.lastIndexOf(' = '));
  return `${left} ${rhs > 0 ? '-' : '+'} ${texNum(Math.abs(rhs))} = 0 \\quad\\Rightarrow\\quad ${moved}`;
}

/** Lineáris egyenlet LaTeX-ben: 6 J_1 - 2 J_2 = 2. */
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

/** Egy hurok: ismeretlen (J_k) vagy ismert (áramforrás, értéke a hurokáram). */
interface Loop {
  elements: { id: string; sign: 1 | -1 }[];
  /** Ismeretlennél a sorszám (J_k), ismertnél null. */
  unknown: number | null;
  /** Ismert hurok árama (A). */
  value: number;
  /** Az áramforrás, amelyhez az ismert hurok tartozik. */
  source?: string;
}

/** Két, egy közös ágon (S) szomszédos ablak közös körvonala, a körüljárás sorrendjében. */
function mergeBoundary(a: Mesh, b: Mesh): { id: string; sign: 1 | -1 }[] {
  const inA = new Set(a.elements.map((x) => x.id));
  const shared = new Set(b.elements.filter((x) => inA.has(x.id)).map((x) => x.id));
  const open = (m: Mesh) => {
    const els = m.elements;
    const n = els.length;
    // Az első nem közös elem, amely előtt közös áll: innen indul a nyitott (közös ág nélküli) ív.
    let start = els.findIndex((x, i) => !shared.has(x.id) && shared.has(els[(i - 1 + n) % n]!.id));
    if (start < 0) start = 0;
    const out: { id: string; sign: 1 | -1 }[] = [];
    for (let k = 0; k < n; k++) {
      const x = els[(start + k) % n]!;
      if (!shared.has(x.id)) out.push(x);
    }
    return out;
  };
  return [...open(a), ...open(b)];
}

export function solveLoopCurrent(p: Problem): MethodResult {
  const map = toNetlist(p.circuit);
  const net = map.net;
  const sources = net.elements.filter((e) => e.kind !== 'R');
  if (sources.length === 0) return { ok: false, reason: 'Nincs forrás a hálózatban: hurokáram helyett eredő ellenállást számolunk.' };
  const ms = meshes(p.circuit, map);
  if (ms.length === 0) return { ok: false, reason: 'Nincs hurok a hálózatban.' };

  // Ablak → előjeles tagság.
  const signIn = (m: Mesh, id: string) => m.elements.filter((x) => x.id === id).reduce((s, x) => s + x.sign, 0);
  const windowsOf = (id: string) => ms.map((m) => ({ m, s: signIn(m, id) })).filter((x) => x.s !== 0);

  // Hurkok: minden ablak egy hurok; áramforrásnál az ismert hurok, közös ágnál összevont körvonal.
  const loops = new Map<number, Loop>(ms.map((m) => [m.index, { elements: m.elements, unknown: 0, value: 0 }]));
  for (const s of sources.filter((e) => e.kind === 'I')) {
    const ws = windowsOf(s.id);
    if (ws.length === 0) continue;
    const [A, B] = ws as [{ m: Mesh; s: number }, { m: Mesh; s: number } | undefined];
    // A forrás ága csak az ismert hurokban van: a hurokáram előjelesen a forrás árama.
    loops.set(A.m.index, { elements: A.m.elements, unknown: null, value: s.value * Math.sign(A.s), source: s.id });
    if (B) loops.set(B.m.index, { elements: mergeBoundary(A.m, B.m), unknown: 0, value: 0 });
  }
  const ordered = [...loops.entries()].sort((x, y) => x[0] - y[0]).map(([, l]) => l);
  let k = 0;
  for (const l of ordered) if (l.unknown !== null) l.unknown = ++k;
  const unknowns = ordered.filter((l) => l.unknown !== null);
  const known = ordered.filter((l) => l.unknown === null);
  const M = unknowns.length;

  // Az elemen átfolyó hurokáramok: elöl a saját (körbejárt) hurok, utána a többi ismeretlen, végül az ismertek.
  const memb = (id: string, own?: Loop) =>
    ordered
      .map((l) => ({ l, s: l.elements.filter((x) => x.id === id).reduce((acc, x) => acc + x.sign, 0) }))
      .filter((x) => x.s !== 0)
      .sort((x, y) => rank(x.l, own) - rank(y.l, own));
  const rank = (l: Loop, own?: Loop) => (l === own ? 0 : l.unknown !== null ? 1 : 2);
  const names = unknowns.map((l) => `J_{${l.unknown}}`);
  const plain = unknowns.map((l) => `J${sub(l.unknown!)}`);
  const loopLabel = (l: Loop) => (l.unknown !== null ? `J${l.unknown}` : formatQuantity(Math.abs(l.value), 'A'));
  const loopRef = (l: Loop): LoopRef => ({ elements: l.elements, label: loopLabel(l) });
  /** Az elem árama a körüljárás irányában, a hurokáramokkal: "J_1 − 2". */
  const branchTex = (id: string, c: number, own?: Loop) =>
    memb(id, own)
      .map(({ l, s }, i) => {
        const sg = c * s;
        const term = l.unknown !== null ? `J_{${l.unknown}}` : texNum(Math.abs(l.value));
        const neg = l.unknown !== null ? sg < 0 : sg * l.value < 0;
        return `${neg ? '-' : i ? '+' : ''} ${term}`;
      })
      .join(' ');
  const branchTxt = (id: string, c: number, own?: Loop) =>
    memb(id, own)
      .map(({ l, s }, i) => {
        const sg = c * s;
        const term = l.unknown !== null ? `J${sub(l.unknown)}` : formatQuantity(Math.abs(l.value), 'A');
        const neg = l.unknown !== null ? sg < 0 : sg * l.value < 0;
        return `${neg ? '− ' : i ? '+ ' : ''}${term}`;
      })
      .join(' ');

  // Ismeretlen hurkonként a huroktörvény.
  const rows: { coeffs: number[]; rhs: number; step: Step }[] = [];
  for (const u of unknowns) {
    const coeffs = new Array<number>(M).fill(0);
    let rhs = 0;
    const lhsTerms: string[] = [];
    const bullets: string[] = [];
    for (const e of net.elements) {
      const c = u.elements.filter((x) => x.id === e.id).reduce((acc, x) => acc + x.sign, 0);
      if (c === 0) continue;
      if (e.kind === 'R') {
        for (const { l, s } of memb(e.id)) {
          if (l.unknown !== null) coeffs[l.unknown - 1]! += c * s * e.value;
          else rhs -= c * s * e.value * l.value;
        }
        const many = memb(e.id).length > 1;
        const expr = branchTex(e.id, c, u);
        lhsTerms.push(`${lhsTerms.length ? '+' : ''} ${texElement(e.id)}${many || expr.trim().startsWith('-') ? `(${expr})` : ` ${expr}`}`);
        bullets.push(
          many
            ? `${e.id} (${formatQuantity(e.value, 'Ω')}): több hurok is átmegy rajta, ezért a körüljárás irányában ${branchTxt(e.id, c, u)} áram folyik rajta; a feszültsége ${formatQuantity(e.value, 'Ω')} · (${branchTxt(e.id, c, u)}).`
            : `${e.id} (${formatQuantity(e.value, 'Ω')}): csak ez a hurok megy át rajta, a feszültsége ${formatQuantity(e.value, 'Ω')} · ${branchTxt(e.id, c, u)}.`,
        );
      } else if (e.kind === 'V') {
        // c · U_ab = c · (−E) a bal oldalon. A feszültség nyila (a nagyobb potenciáltól a kisebb felé)
        // a modell a→b irányával ellentétes: c < 0 jelenti, hogy a körüljárás egyezik vele, ilyenkor +E.
        rhs += c * e.value;
        const along = c < 0;
        lhsTerms.push(`${along ? '+' : '-'} U_{\\text{${e.id}}}`);
        bullets.push(
          `${e.id} (${formatQuantity(e.value, 'V')}): a körüljárás ${along ? 'egyezik a feszültség nyilával' : 'szemben halad a feszültség nyilával'}, ezért a bal oldalra ${along ? '+' : '−'}${formatQuantity(e.value, 'V')} kerül.`,
        );
      }
    }
    rows.push({
      coeffs,
      rhs,
      step: {
        title: `Huroktörvény: J${sub(u.unknown!)}`,
        text: 'Körbejárjuk a hurkot, és minden feszültséget a bal oldalra írunk; az összegük nulla. Amelyik feszültség nyila egyezik a körüljárással, az +, amelyiké szembe megy, az −. Az ellenállás feszültsége R · (a rajta átfolyó hurokáramok előjeles összege); ahol ismert hurok is átmegy rajta, annak az árama számként kerül be. Tagonként:',
        bullets,
        terms: [...lhsTerms, '= 0'],
        subst: zeroForm(coeffs, names, rhs),
        highlight: { loops: [loopRef(u), ...known.filter((l) => l.elements.some((x) => u.elements.some((y) => y.id === x.id))).map(loopRef)] },
      },
    });
  }

  const x = M ? solveLinear(rows.map((r) => r.coeffs), rows.map((r) => r.rhs), RealField) : [];
  if (!x) return { ok: false, reason: 'A hurokegyenlet-rendszer nem oldható meg egyértelműen.' };
  const J = (l: Loop) => (l.unknown !== null ? x[l.unknown - 1]! : l.value);

  // Elemáramok a hurokáramokból; feszültségek: ellenállás R·I, feszültségforrás −E, áramforrás a potenciálokból.
  const values: Values = new Map();
  for (const e of net.elements) {
    const I = e.kind === 'I' ? e.value : memb(e.id).reduce((acc, { l, s }) => acc + s * J(l), 0);
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

  // Melyik hurokáramok kellenek a válaszhoz? Ha minden kérdés egy ellenállásra vonatkozik, csak az azokon
  // átfolyó ismeretlen hurkok, és azok, amelyek ezek egyenleteiben szerepelnek (lezárás). Különben mind.
  // Feszültségforrás árama/teljesítménye is csak a rajta átfolyó hurokáramokból jön; áramforrás feszültségéhez
  // viszont a teljes hurka kellene, ezért akkor mind.
  const kindOf = (id?: string) => net.elements.find((e) => e.id === id)?.kind;
  const onlyResistors = p.questions.every((q) => q.target && ['U', 'I', 'P'].includes(q.kind) && (kindOf(q.target) === 'R' || (kindOf(q.target) === 'V' && q.kind !== 'U')));
  const needSet = new Set<number>();
  if (onlyResistors) {
    for (const q of p.questions) for (const { l } of memb(q.target!)) if (l.unknown !== null) needSet.add(l.unknown - 1);
    for (let grew = true; grew; ) {
      grew = false;
      for (const i of [...needSet])
        rows[i]!.coeffs.forEach((c, j) => {
          if (Math.abs(c) > 1e-12 && !needSet.has(j)) {
            needSet.add(j);
            grew = true;
          }
        });
    }
  } else for (let i = 0; i < M; i++) needSet.add(i);
  const need = [...needSet].sort((a, b) => a - b);
  const needTxt = need.map((i) => plain[i]!).join(', ');
  const vegyukEszre =
    need.length === 0
      ? 'Vegyük észre: a keresett ellenálláson csak ismert (áramforrás) hurokáramok folynak át, így egyetlen egyenletet sem kell felírni.'
      : `Vegyük észre: a keresett mennyiséghez csak ${needTxt} kell, és ${need.length === 1 ? 'ennek a huroknak az egyenletében' : 'ezeknek a hurkoknak az egyenleteiben'} a többi ismeretlen hurokáram nem szerepel (azok nem érintik). Elég tehát ${need.length === 1 ? 'ezt az egy egyenletet' : `ezt a(z) ${need.length} egyenletet`} felírni.`;

  // Lépések.
  const steps: Step[] = [];
  const simp = simplificationStep(p, net);
  if (simp) steps.push(simp);
  const b = net.elements.length;
  const n = net.nodeCount;
  steps.push({
    title: 'Hány hurok kell?',
    text: `Megszámoljuk az ágakat (b, minden elem egy ág) és a csomópontokat (n). A független hurkok száma l = b − n + 1.`,
    terms: [`l = b - n + 1 = ${b} - ${n} + 1 = ${b - n + 1}`],
    highlight: {},
  });
  steps.push({
    title: 'Hurkok kijelölése',
    text: 'Minden hurokba egy körbefolyó áramot rajzolunk (hurokáram), az óramutató járásával egyező irányban. Egy ág valódi árama a rajta átfolyó hurokáramok előjeles összege.',
    bullets: [
      ...(known.length
        ? [
            `Minden áramforrásnak saját, ismert hurka van: ${known.map((l) => `${l.source} → ${formatQuantity(Math.abs(l.value), 'A')}`).join(', ')}. Ezt nem kell kiszámolni, a hurokáram maga a forrás árama.`,
            'Minden ellenállást és feszültségforrást érintenie kell egy ismeretlen huroknak (akkor is, ha egy ismert hurok már átmegy rajta). Az áramforrást csak az ismert hurok érinti.',
          ]
        : []),
      `${M} ismeretlen hurokáram: ${plain.join(', ')}.`,
      ...(need.length < M ? [vegyukEszre] : [`Mind a(z) ${M} huroktörvényre szükség van.`]),
    ],
    highlight: { loops: ordered.map(loopRef) },
  });
  // A tanár úr módszere („Vegyük észre…”): csak a keresett mennyiséghez szükséges hurkok egyenletei.
  steps.push(...need.map((i) => rows[i]!.step));
  if (need.length)
    steps.push(
      ...solveSystemSteps(
        need.map((i) => need.map((j) => rows[i]!.coeffs[j]!)),
        need.map((i) => rows[i]!.rhs),
        need.map((i) => names[i]!),
        need.map((i) => plain[i]!),
        need.map((i) => x[i]!),
        'A',
        { loops: ordered.map(loopRef) },
      ),
    );

  const els = new Map(allElements(p.circuit).map((e) => [e.id, e]));
  for (const t of targetResistors(p)) {
    const v = values.get(t)!;
    const mm = memb(t);
    steps.push({
      title: `${t} árama`,
      text: mm.length > 1 ? 'Az ág árama a rajta átfolyó hurokáramok előjeles összege (az ellenállás referenciairánya szerint).' : 'Az ágban egyetlen hurokáram folyik.',
      terms: [`${texOf('I', t)} = ${branchTex(t, 1)}`],
      subst: `${texOf('I', t)} = ${mm.map(({ l, s }, i) => `${s < 0 ? '-' : i ? '+' : ''} ${texQty(J(l), 'A', { paren: true })}`).join(' ') || '0'}`,
      result: { symbol: texOf('I', t), value: v.I, unit: 'A' },
      highlight: { elements: [t], loops: mm.map(({ l }) => loopRef(l)), arrows: [{ element: t, kind: 'I', value: v.I }] },
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
