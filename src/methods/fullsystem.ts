// Teljes hálózatanalízis egyenletrendszerrel (Kirchhoff-egyenletek, ágáramok módszere), ahogy a
// gyakorlaton papíron csináljuk:
//  1. Ohm-törvény minden ellenállásra: U = R · I (az áram és a feszültség iránya egyezik);
//  2. ágak (b) és csomópontok (n) megszámolása: n − 1 csomóponti és l = b − n + 1 hurokegyenlet;
//  3. csomóponti egyenletek: a kifolyó áramok összege = 0;
//  4. hurokegyenletek "= 0" alakban (a nyíl a körüljárással egyezik: +, szembe: −), az Ohm-törvényt
//     beírva csak az ágáramok maradnak;
//  5. az egyenletrendszer behelyettesítő módszerrel (linsolve.ts), végül minden elem U, I, P-je.
// Egy ágban sorban álló elemek árama közös: az ág áramát az első ellenállásáról nevezzük el.

import type { Problem } from '../generator/generate';
import { RealField } from '../solver/field';
import { solveLinear } from '../solver/linear';
import { allElements } from '../solver/model';
import { toNetlist } from '../solver/netlist';
import { answersFromValues, sub } from './common';
import { compoundPaths, meshes, type Values } from './engine';
import { solveSystemSteps } from './linsolve';
import { tableSteps } from './reduction';
import { texElement, texNum, texOf, texQty } from './tex';
import type { LoopRef, MethodAnswer, MethodResult, Step } from './types';

const GROUP = 'Egyenletrendszer';

/** Egyenlet "= 0" alakban: 2\,I_{R1} - I_{R2} + 3 = 0 (a: együtthatók, c: ismert tag). */
function zeroTex(a: number[], names: string[], c: number): string {
  const parts: string[] = [];
  a.forEach((v, j) => {
    if (Math.abs(v) < 1e-12) return;
    const abs = Math.abs(v);
    const num = Math.abs(abs - 1) < 1e-9 ? '' : `${texNum(abs)}\\,`;
    parts.push(`${v < 0 ? '-' : parts.length ? '+' : ''} ${num}${names[j]}`);
  });
  if (Math.abs(c) > 1e-12) parts.push(`${c < 0 ? '-' : parts.length ? '+' : ''} ${texNum(Math.abs(c))}`);
  return `${parts.join(' ') || '0'} = 0`;
}

export function solveFullSystem(p: Problem): MethodResult {
  const fail = (reason: string): MethodResult => ({ ok: false, reason });
  if (!p.questions.some((q) => q.kind === 'table')) return fail('Az egyenletrendszeres teljes hálózatanalízis a „Teljes hálózatanalízis” feladatokhoz való.');
  const map = toNetlist(p.circuit);
  const net = map.net;
  const topo = compoundPaths(net);
  if (!topo || topo.essential.length < 2) return fail('Egyetlen hurok: itt nincs szükség egyenletrendszerre.');
  const els = new Map(allElements(p.circuit).map((e) => [e.id, e]));

  // Ágak: mindegyiknek egy ismeretlenje van. Ellenállásos ágban az ág árama (az első ellenállásáról
  // elnevezve); áramforrásos ágban az áram ismert (a forrásé), helyette a forrás feszültsége az ismeretlen.
  const paths = topo.paths;
  const isI = paths.map((x) => x.kind === 'I');
  const rep = paths.map((x, i) => (isI[i] ? x.elems.find((e) => e.kind === 'I')! : (x.elems.find((e) => e.kind === 'R') ?? x.elems[0]!)));
  const names = rep.map((r, i) => texOf(isI[i] ? 'U' : 'I', r.id));
  const plain = rep.map((r, i) => `${isI[i] ? 'U' : 'I'}(${r.id})`);
  const units = isI.map((v) => (v ? 'V' : 'A'));
  const pathOf = new Map<string, number>();
  paths.forEach((x, i) => x.elems.forEach((e) => pathOf.set(e.id, i)));
  // Az elem a→b irányú árama = coef · (az ág névadó elemének árama).
  const coefOf = (id: string) => {
    const i = pathOf.get(id)!;
    const el = paths[i]!.elems.find((e) => e.id === id)!;
    return el.d * rep[i]!.d;
  };
  // Áramforrásos ágban az elem ismert árama (a→b irányban).
  const knownI = (id: string) => {
    const i = pathOf.get(id)!;
    return coefOf(id) * els.get(rep[i]!.id)!.value;
  };

  const b = paths.length;
  const n = topo.essential.length;
  const nodeName = new Map(topo.essential.map((v, i) => [v, `n${sub(i + 1)}`]));
  const nodeLabels = topo.essential.map((v) => ({ node: v, label: nodeName.get(v)! }));

  // ── csomóponti egyenletek (n − 1): kifolyó áramok összege = 0 (a = együtthatók, c = ismert tag) ──
  const kclRows = topo.essential.slice(0, n - 1).map((v) => {
    const a = new Array<number>(b).fill(0);
    let c = 0;
    paths.forEach((x, i) => {
      // Az ág árama s → e irányban = rep.d · (a névadó elem árama); s-ből kifolyó, e-be befolyó.
      const out = (x.s === v ? 1 : 0) - (x.e === v ? 1 : 0);
      if (!out) return;
      if (isI[i]) c += out * rep[i]!.d * els.get(rep[i]!.id)!.value;
      else a[i]! += out * rep[i]!.d;
    });
    return { node: v, a, c };
  });

  // ── hurokegyenletek (az ablakok) ──
  const ms = meshes(p.circuit, map);
  const l = b - n + 1;
  if (ms.length !== l) return fail('A hálózat ablakai nem adják ki a független hurkokat.');
  const kvlRows = ms.map((m) => {
    const a = new Array<number>(b).fill(0);
    let c = 0;
    const symbolic: string[] = [];
    const ohm: string[] = [];
    const put = (arr: string[], sgn: number, body: string) => arr.push(`${sgn < 0 ? '-' : arr.length ? '+' : ''} ${body}`);
    for (const { id, sign } of m.elements) {
      const e = els.get(id)!;
      const i = pathOf.get(id)!;
      // Minden elem feszültsége U = φa − φb (nyila a→b); a tag +sign · U.
      if (e.kind === 'V') {
        // Feszültségforrás: U = −E (a nyila a→b irányával ellentétes), a tag −sign · E.
        c += -sign * e.value;
        put(symbolic, -sign, texNum(e.value));
        put(ohm, -sign, texNum(e.value));
        continue;
      }
      put(symbolic, sign, texOf('U', id));
      if (e.kind === 'I') {
        a[i]! += sign;
        put(ohm, sign, texOf('U', id));
      } else if (isI[i]) {
        // Az áramforrás ágában az áram ismert: a tag szám.
        c += sign * e.value * knownI(id);
        put(ohm, sign, `${texNum(e.value)} \\cdot ${texNum(knownI(id), { paren: true })}`);
      } else {
        a[i]! += sign * e.value * coefOf(id);
        const own = rep[i]!.id === id;
        put(ohm, sign, `${texNum(e.value)}${own ? '\\,' : ' \\cdot '}${own || coefOf(id) > 0 ? names[i] : `(-${names[i]})`}`);
      }
    }
    return { mesh: m, a, c, symbolic: `${symbolic.join(' ')} = 0`, ohm: `${ohm.join(' ')} = 0` };
  });

  const rows = [...kclRows, ...kvlRows];
  const A = rows.map((r) => r.a);
  const rhs = rows.map((r) => -r.c);
  const x = solveLinear(A, rhs, RealField);
  if (!x) return fail('Az egyenletrendszer nem oldható meg egyértelműen.');

  // ── elemértékek ──
  const values: Values = new Map();
  for (const [id, e] of els) {
    if (!pathOf.has(id)) continue;
    const i = pathOf.get(id)!;
    if (e.kind === 'I') values.set(id, { U: x[i]!, I: e.value });
    else {
      const I = isI[i] ? knownI(id) : coefOf(id) * x[i]!;
      values.set(id, { U: e.kind === 'R' ? e.value * I : -e.value, I });
    }
  }

  const loopRefs: LoopRef[] = ms.map((m, i) => ({ elements: m.elements, label: `h${sub(i + 1)}` }));
  const resistors = [...els.values()].filter((e) => e.kind === 'R' && pathOf.has(e.id)).sort((u, v) => u.id.localeCompare(v.id, 'hu', { numeric: true }));
  const series = paths.flatMap((pth, i) => pth.elems.filter((e) => e.id !== rep[i]!.id && e.kind !== 'V').map((e) => ({ id: e.id, i })));
  const seriesTex = series.map((s) =>
    isI[s.i] ? `${texOf('I', s.id)} &= ${texQty(knownI(s.id), 'A')}` : `${texOf('I', s.id)} &= ${coefOf(s.id) < 0 ? '-' : ''}${names[s.i]}`,
  );
  const sources = paths.filter((_, i) => isI[i]).map((_, k) => k);

  const steps: Step[] = [];
  steps.push({
    title: 'Ohm-törvény minden ellenállásra',
    text: 'Minden ellenállás feszültségét az áramával fejezzük ki. Az áram és a feszültség nyila az ellenálláson egy irányba mutat, ezért nincs előjel.',
    terms: [`\\begin{aligned} ${resistors.map((e) => `${texOf('U', e.id)} &= ${texElement(e.id)} \\cdot ${texOf('I', e.id)} = ${texNum(e.value)}\\,${texOf('I', e.id)}`).join(' \\\\ ')} \\end{aligned}`],
    highlight: { elements: resistors.map((e) => e.id) },
    group: GROUP,
  });
  steps.push({
    title: 'Ágak és csomópontok',
    text:
      `${b} ág és ${n} csomópont van (csomópont: ahol legalább három ág találkozik). Ezért n − 1 = ${n - 1} csomóponti és l = b − n + 1 = ${b} − ${n} + 1 = ${l} hurokegyenletet írunk fel: összesen ${b} egyenlet ${b} ismeretlenre (${plain.join(', ')}).` +
      (sources.length ? ' Az áramforrás ágában az áram ismert (a forrás árama), ott a forrás feszültsége az ismeretlen.' : '') +
      (series.some((s) => !isI[s.i]) ? ' Egy ágban sorban álló elemeken ugyanaz az áram folyik, ezért azok áramát az ág áramával írjuk.' : ''),
    terms: seriesTex.length ? [`\\begin{aligned} ${seriesTex.join(' \\\\ ')} \\end{aligned}`] : undefined,
    highlight: { nodes: topo.essential, nodeLabels },
    group: GROUP,
  });

  const kclTex = kclRows.map((r) => `\\text{${nodeName.get(r.node)}:}\\quad & ${zeroTex(r.a, names, r.c)}`);
  steps.push({
    title: 'Csomóponti egyenletek',
    text: `Minden csomópontra (az utolsó, ${nodeName.get(topo.essential[n - 1]!)} kivételével, mert annak egyenlete a többiből következik): a csomópontból kifolyó áramok összege nulla. Amelyik ág árama a csomópont felé mutat, az mínusz előjellel szerepel; az áramforrás árama számként.`,
    terms: [`\\begin{aligned} ${kclTex.join(' \\\\ ')} \\end{aligned}`],
    highlight: { nodes: topo.essential.slice(0, n - 1), nodeLabels },
    group: GROUP,
  });

  kvlRows.forEach((r, i) => {
    steps.push({
      title: `Huroktörvény: h${sub(i + 1)}`,
      text: 'A hurok elemeit a körüljárás szerint vesszük sorra: ha a feszültség nyila egyezik a körüljárással, a tag pozitív, ha szembe megy, negatív (a forrásé is), és az összeg nulla. Utána az ellenállások feszültsége helyére az Ohm-törvényt írjuk, így csak az ismeretlenek maradnak.',
      terms: [r.symbolic, `\\quad\\Rightarrow\\quad ${r.ohm}`, `\\quad\\Rightarrow\\quad ${zeroTex(r.a, names, r.c)}`],
      highlight: { loops: [loopRefs[i]!] },
      group: GROUP,
    });
  });

  steps.push(...solveSystemSteps(A, rhs, names, plain, x, units, { nodes: topo.essential, nodeLabels }, 'Megoldás', { preferUnit: true }));
  steps.push(...tableSteps(p, values, els, 'Az ágáramokból (a sorban álló elemeké ugyanaz) minden elem árama, az Ohm-törvényből a feszültsége adódik'));

  const answers: MethodAnswer[] = answersFromValues(p, values);
  // Eredő ellenállás: a generátor feszültsége osztva az áramával (egy forrásnál).
  const srcs = [...els.values()].filter((e) => e.kind !== 'R' && pathOf.has(e.id));
  for (const q of p.questions) {
    if (q.kind !== 'Req' || srcs.length !== 1) continue;
    const v = values.get(srcs[0]!.id)!;
    if (Math.abs(v.I) > 1e-12) answers.push({ questionId: q.id, value: Math.abs(v.U / v.I) });
  }
  return { ok: true, solution: { method: 'kirchhoff', title: 'Teljes hálózatanalízis egyenletrendszerrel', steps, answers, values } };
}

