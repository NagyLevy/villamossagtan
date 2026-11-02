// Thevenin- és Norton-helyettesítő generátor a kijelölt ág (A–B kapcsok) felől:
// Rth a források kiiktatásával, Uth üresjárásban, In rövidzárban, ellenőrzés Uth = Rth · In,
// mindkét helyettesítő kép kirajzolva, végül a terhelés árama a helyettesítő körből.

import type { Problem } from '../generator/generate';
import { makeElement, Sketch } from '../generator/sketch';
import { zeroCurrentResistors } from '../simplify/seriesParallel';
import { allElements, type Circuit, type Netlist } from '../solver/model';
import { killSources, removeElements, toNetlist } from '../solver/netlist';
import { formatQuantity } from '../units';
import { simplificationStep } from './common';
import { solveAny } from './engine';
import { nodalSteps } from './nodal';
import { groupOf, reduceSP, reductionSteps, rSym } from './reduction';
import { texQty } from './tex';
import type { MethodAnswer, MethodResult, Step } from './types';

/** A helyettesítő Thevenin-kör: Uth, Rth és a terhelés. */
function theveninCircuit(Uth: number, Rth: number, RL: number): { circuit: Circuit; ids: { src: string; rth: string; load: string } } {
  const s = new Sketch();
  // Bal oldali fok fentről lefelé: dir −1 → a nyíl felfelé, az A kapocs felé mutat (φA > φB, ha Uth > 0).
  const src = makeElement('V', Math.abs(Uth), Uth >= 0 ? -1 : 1);
  src.name = 'Uth';
  const rth = makeElement('R', Rth);
  rth.name = 'Rth';
  const load = makeElement('R', RL);
  load.name = 'RL';
  s.branch(0, 0, 0, 4, [src]);
  s.branch(0, 0, 4, 0, [rth]);
  s.wire(4, 0, 8, 0);
  s.wire(0, 4, 4, 4);
  s.wire(4, 4, 8, 4);
  s.branch(8, 0, 8, 4, [load]);
  s.terminals = { a: s.pt(4, 0), b: s.pt(4, 4) };
  const c = s.build();
  const by = (n: string) => allElements(c).find((e) => e.name === n)!.id;
  return { circuit: c, ids: { src: by('Uth'), rth: by('Rth'), load: by('RL') } };
}

/** A helyettesítő Norton-kör: In ∥ Rth és a terhelés. */
function nortonCircuit(In: number, Rth: number, RL: number): { circuit: Circuit; ids: { src: string; rth: string; load: string } } {
  const s = new Sketch();
  // A forrásáram az A kapocs felé (felfelé) folyik, ha In > 0.
  const src = makeElement('I', Math.abs(In), In >= 0 ? -1 : 1);
  src.name = 'In';
  const rth = makeElement('R', Rth);
  rth.name = 'Rth';
  const load = makeElement('R', RL);
  load.name = 'RL';
  s.branch(0, 0, 0, 4, [src]);
  s.wire(0, 0, 4, 0);
  s.wire(0, 4, 4, 4);
  s.branch(4, 0, 4, 4, [rth]);
  s.wire(4, 0, 8, 0);
  s.wire(4, 4, 8, 4);
  s.branch(10, 0, 10, 4, [load]);
  s.wire(8, 0, 10, 0);
  s.wire(8, 4, 10, 4);
  s.terminals = { a: s.pt(8, 0), b: s.pt(8, 4) };
  const c = s.build();
  const by = (n: string) => allElements(c).find((e) => e.name === n)!.id;
  return { circuit: c, ids: { src: by('In'), rth: by('Rth'), load: by('RL') } };
}

/** A kijelölt terhelés: a "load" szerepű elem, különben az első kérdéses ellenállás, amely egyedül áll az ágában. */
function findLoad(p: Problem): string | null {
  const els = allElements(p.circuit);
  const load = els.find((e) => e.role === 'load' && e.kind === 'R');
  if (load && p.topic !== 'valodi-gen') return load.id;
  for (const q of p.questions) {
    if (!q.target) continue;
    const br = p.circuit.branches.find((b) => b.elements.length === 1 && b.elements[0]!.id === q.target && b.elements[0]!.kind === 'R');
    if (br) return q.target;
  }
  return null;
}

export function solveThevenin(p: Problem): MethodResult {
  const map = toNetlist(p.circuit);
  const net = map.net;
  if (!net.elements.some((e) => e.kind !== 'R')) return { ok: false, reason: 'Nincs forrás a hálózatban.' };
  const loadId = findLoad(p);
  if (!loadId) return { ok: false, reason: 'Nincs kijelölt ág (terhelés), amelyre helyettesítő generátort lehetne számolni.' };
  const load = net.elements.find((e) => e.id === loadId)!;
  const RL = load.value;
  const a = load.a;
  const b = load.b;
  const open: Netlist = removeElements(net, [loadId]);

  // Rth: a források kiiktatva, A–B felől.
  const { net: killed, nodeMap } = killSources(open);
  const ka = nodeMap.get(a);
  const kb = nodeMap.get(b);
  if (ka === undefined || kb === undefined || ka === kb) return { ok: false, reason: 'A kapcsok a források kiiktatása után rövidre záródnak.' };
  let rs = killed.elements.filter((e) => e.kind === 'R');
  let red = reduceSP(rs, ka, kb);
  const zero = red ? [] : zeroCurrentResistors(killed, ka, kb);
  if (!red && zero.length) {
    rs = rs.filter((e) => !zero.includes(e.id));
    red = reduceSP(rs, ka, kb);
  }
  if (!red) return { ok: false, reason: 'Az Rth meghatározásához csillag-delta átalakítás kellene.' };
  const Rth = red.root.R;

  // Uth és In csomóponti levezetéssel; B a referencia, így Uth = φA.
  const names = new Map([
    [a, 'A'],
    [b, 'B'],
  ]);
  const loadOpen = { element: loadId, as: 'open' as const };
  const loadShort = { element: loadId, as: 'short' as const };
  const dOpen = nodalSteps(open, { ground: b, forceEssential: [a, b], names, base: { killed: [loadOpen], terminals: true }, group: 'Uth: üresjárás' });
  const shorted: Netlist = { nodeCount: open.nodeCount, elements: [...open.elements, { id: '__rz', kind: 'V', value: 0, a, b }] };
  const dShort = nodalSteps(shorted, { ground: b, forceEssential: [a, b], names, base: { killed: [loadShort], terminals: true }, group: 'In: rövidzár' });
  // Ha a levezetés nem készíthető el (pl. egyetlen hurok), közvetlen számolás.
  const vOpen = dOpen?.values ?? solveAny(open);
  const vShort = dShort?.values ?? solveAny(shorted);
  const Uth = dOpen ? dOpen.phi.get(a)! : vOpen ? pathVoltage(open, vOpen, a, b) : null;
  if (Uth === null || !vShort) return { ok: false, reason: 'Az üresjárási vagy a rövidzárási állapot nem számolható.' };
  const In = vShort.get('__rz')!.I;
  const IL = Uth / (Rth + RL);

  const sources = net.elements.filter((e) => e.kind !== 'R');
  const killedMarks = [...sources.map((s) => ({ element: s.id, as: s.kind === 'V' ? ('short' as const) : ('open' as const) })), loadOpen];
  const steps: Step[] = [];
  const simp = simplificationStep(p, net);
  if (simp) steps.push(simp);
  steps.push({
    title: 'A vizsgált ág lekötése',
    text: `A(z) ${loadId} ellenállást lekötjük (a helyén szakadás); a két végpont az A és a B kapocs. A hálózat többi része az A–B kapcsok felől egyetlen generátorral helyettesíthető.`,
    highlight: { elements: [loadId], killed: [loadOpen], terminals: true },
    group: 'A helyettesítendő rész',
  });
  steps.push({
    title: 'Források kiiktatása',
    text: 'A belső ellenálláshoz minden forrást kiiktatunk: a feszültségforrás helyére rövidzár, az áramforrás helyére szakadás kerül. Ezután az A–B kapcsok felől nézett eredőt számoljuk.',
    highlight: { killed: killedMarks, terminals: true },
    group: 'Rth: belső ellenállás',
  });
  if (zero.length) {
    steps.push({
      title: 'Kiegyenlített híd',
      text: `A kiiktatott hálózatban ${zero.join(', ')} árammentes (kiegyenlített híd), ezért elhagyható.`,
      highlight: { killed: killedMarks, dim: zero, terminals: true },
      group: 'Rth: belső ellenállás',
    });
  }
  for (const st of reductionSteps(red)) steps.push({ ...st, highlight: { ...st.highlight, killed: killedMarks, terminals: true }, group: 'Rth: belső ellenállás' });
  steps.push({
    title: 'Belső ellenállás',
    text: 'Az A–B kapcsok felől nézett eredő a helyettesítő generátor belső ellenállása.',
    terms: [`R_{th} = ${rSym(red.root)}`],
    result: { symbol: 'R_{th}', value: Rth, unit: 'Ω' },
    highlight: { killed: killedMarks, groups: [groupOf(red.root, 'result')], terminals: true },
    group: 'Rth: belső ellenállás',
  });
  steps.push({
    title: 'Üresjárás',
    text: 'A források visszakerülnek, a terhelés továbbra is lekötve. Az A és B kapcsok közötti feszültséget csomóponti módszerrel számoljuk: a B pontot választjuk referenciának (φB = 0), így Uth egyszerűen φA lesz.',
    terms: ['U_{th} = \\varphi_A - \\varphi_B = \\varphi_A'],
    highlight: { killed: [loadOpen], terminals: true },
    group: 'Uth: üresjárás',
  });
  if (dOpen) steps.push(...dOpen.steps);
  steps.push({
    title: 'Üresjárási feszültség',
    text: 'Az A pont potenciálja a B-hez képest a Thevenin-generátor forrásfeszültsége. Ha negatív, akkor B van magasabb potenciálon.',
    terms: ['U_{th} = \\varphi_A - \\varphi_B'],
    subst: `U_{th} = ${texQty(Uth, 'V', { paren: true })} - 0`,
    result: { symbol: 'U_{th}', value: Uth, unit: 'V' },
    highlight: { killed: [loadOpen], terminals: true, nodeLabels: [{ node: a, label: `φA = ${formatQuantity(Uth, 'V', { sig: 3 })}` }, { node: b, label: 'φB = 0' }] },
    group: 'Uth: üresjárás',
  });
  steps.push({
    title: 'Rövidzár',
    text: 'Most az A és B kapcsot rövidre zárjuk. A rövidzáron A-ból B felé folyó áram a Norton-generátor forrásárama. Ezt is csomóponti módszerrel számoljuk; a rövidzár miatt φA = φB = 0.',
    terms: ['I_n = I_{A \\to B}'],
    highlight: { killed: [loadShort], terminals: true },
    group: 'In: rövidzár',
  });
  if (dShort) {
    steps.push(...dShort.steps);
    // In az A pontra felírt csomóponti törvényből: a többi ágon A-ból kifolyó áramok ellentettje.
    const others = dShort.sys.topo.paths.filter((q) => !q.elems.some((e) => e.id === '__rz') && (q.s === a || q.e === a) && q.s !== q.e);
    const outs = others.map((q) => (q.s === a ? 1 : -1) * dShort.currents.get(q.id)!);
    steps.push({
      title: 'Rövidzárási áram',
      text: 'Az A pontban a csomóponti törvény: ami a többi ágon befolyik A-ba, az a rövidzáron át B felé távozik.',
      terms: ['I_n = -\\sum I_{A,\\text{ki}}'],
      subst: `I_n = -(${outs.map((v) => texQty(v, 'A', { paren: true })).join(' + ') || '0'})`,
      result: { symbol: 'I_n', value: In, unit: 'A' },
      highlight: { killed: [loadShort], terminals: true, nodes: [a] },
      group: 'In: rövidzár',
    });
  } else {
    steps.push({ title: 'Rövidzárási áram', text: 'A rövidzáron A-ból B felé folyó áram:', result: { symbol: 'I_n', value: In, unit: 'A' }, highlight: { killed: [loadShort], terminals: true }, group: 'In: rövidzár' });
  }
  steps.push({
    title: 'Ellenőrzés',
    text: 'A három mennyiség nem független: az üresjárási feszültség a belső ellenállás és a rövidzárási áram szorzata.',
    terms: ['U_{th} = R_{th} \\cdot I_n'],
    subst: `${texQty(Uth, 'V')} = ${texQty(Rth, 'Ω')} \\cdot ${texQty(In, 'A', { paren: true })} = ${texQty(Rth * In, 'V')}`,
    highlight: { terminals: true },
    group: 'Helyettesítő képek',
  });
  const th = theveninCircuit(Uth, Rth, RL);
  steps.push({
    title: 'Thevenin-helyettesítő kép',
    text: 'A hálózat az A–B kapcsok felől egy Uth feszültségű, Rth belső ellenállású generátorral helyettesíthető. Visszakötve a terhelést, egyetlen hurok marad.',
    terms: ['I_L =', `\\frac{U_{th}}{R_{th} + R_L}`],
    subst: `I_L = \\frac{${texQty(Uth, 'V')}}{${texQty(Rth, 'Ω')} + ${texQty(RL, 'Ω')}}`,
    result: { symbol: 'I_L', value: IL, unit: 'A' },
    circuit: th.circuit,
    highlight: { elements: [th.ids.load], arrows: [{ element: th.ids.load, kind: 'I', value: IL }] },
    group: 'Helyettesítő képek',
  });
  const no = nortonCircuit(In, Rth, RL);
  steps.push({
    title: 'Norton-helyettesítő kép',
    text: 'Ugyanez Norton-alakban: In forrásáram, vele párhuzamosan Rth. A terhelés árama áramosztással adódik, és megegyezik a Thevenin-képből kapottal.',
    terms: ['I_L =', `I_n \\cdot \\frac{R_{th}}{R_{th} + R_L}`],
    subst: `I_L = ${texQty(In, 'A', { paren: true })} \\cdot \\frac{${texQty(Rth, 'Ω')}}{${texQty(Rth, 'Ω')} + ${texQty(RL, 'Ω')}}`,
    result: { symbol: 'I_L', value: (In * Rth) / (Rth + RL), unit: 'A' },
    circuit: no.circuit,
    highlight: { elements: [no.ids.load], arrows: [{ element: no.ids.load, kind: 'I', value: (In * Rth) / (Rth + RL) }] },
    group: 'Helyettesítő képek',
    note: `A terhelés árama mindkét képből ${formatQuantity(IL, 'A')}.`,
  });

  const answers: MethodAnswer[] = [];
  for (const q of p.questions) {
    let raw: number | undefined;
    if (q.kind === 'Uth') raw = Uth;
    if (q.kind === 'Rth') raw = Rth;
    if (q.kind === 'In') raw = In;
    if (q.kind === 'IL') raw = IL;
    if (q.target === loadId && q.kind === 'I') raw = IL;
    if (q.target === loadId && q.kind === 'U') raw = IL * RL;
    if (q.target === loadId && q.kind === 'P') raw = IL * IL * RL;
    if (raw !== undefined) answers.push({ questionId: q.id, value: q.magnitudeOnly ? Math.abs(raw) : raw });
  }
  return { ok: true, solution: { method: 'thevenin', title: 'Thevenin és Norton', steps, answers } };
}

/** φ(a) − φ(b) az elemfeszültségekből: szélességi bejárás a-tól, U_ab = φa − φb. */
function pathVoltage(net: Netlist, values: Map<string, { U: number }>, a: number, b: number): number | null {
  const phi = new Map<number, number>([[a, 0]]);
  const queue = [a];
  while (queue.length) {
    const n = queue.shift()!;
    for (const e of net.elements) {
      const v = values.get(e.id);
      if (!v) continue;
      if (e.a === n && !phi.has(e.b)) {
        phi.set(e.b, phi.get(n)! - v.U);
        queue.push(e.b);
      } else if (e.b === n && !phi.has(e.a)) {
        phi.set(e.a, phi.get(n)! + v.U);
        queue.push(e.a);
      }
    }
  }
  const pb = phi.get(b);
  return pb === undefined ? null : -pb;
}
