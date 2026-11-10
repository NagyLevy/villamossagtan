// Thevenin- és Norton-helyettesítő generátor a kijelölt ág (A–B kapcsok) felől, ahogy a tanár úr tanítja:
// Rg = R_AB a források kiiktatásával, Uü üresjárásban (forrásonként feszültség- és áramosztással,
// (A→B) / (B→A) iránnyal, majd előjeles összeg), a Norton-áram In = Uü / Rg, mindkét helyettesítő
// kép kirajzolva, a terhelés árama a helyettesítő körből, illesztésnél Pmax = Uü² / (4 Rg).

import type { Problem } from '../generator/generate';
import { makeElement, Sketch } from '../generator/sketch';
import { zeroCurrentResistors } from '../simplify/seriesParallel';
import { allElements, type Circuit, type Netlist } from '../solver/model';
import { killSources, removeElements, toNetlist } from '../solver/netlist';
import { formatQuantity } from '../units';
import { simplificationStep } from './common';
import { solveAny } from './engine';
import { nodalSteps } from './nodal';
import { transformAndReduce } from './stardelta';
import { exprNum, groupOf, reduceSP, reductionSteps, rSym, singleSourceSteps } from './reduction';
import { texQty } from './tex';
import type { MethodAnswer, MethodResult, Step } from './types';

/** A helyettesítő Thevenin-kör: Uth, Rth és a terhelés. */
function theveninCircuit(Uth: number, Rth: number, RL: number): { circuit: Circuit; ids: { src: string; rth: string; load: string } } {
  const s = new Sketch();
  // Bal oldali fok fentről lefelé: dir −1 → a nyíl felfelé, az A kapocs felé mutat (φA > φB, ha Uth > 0).
  const src = makeElement('V', Math.abs(Uth), Uth >= 0 ? -1 : 1);
  src.name = 'Uü';
  const rth = makeElement('R', Rth);
  rth.name = 'Rg';
  const load = makeElement('R', RL);
  load.name = 'Rt';
  s.branch(0, 0, 0, 4, [src]);
  s.branch(0, 0, 4, 0, [rth]);
  s.wire(4, 0, 8, 0);
  s.wire(0, 4, 4, 4);
  s.wire(4, 4, 8, 4);
  s.branch(8, 0, 8, 4, [load]);
  s.terminals = { a: s.pt(4, 0), b: s.pt(4, 4) };
  const c = s.build();
  const by = (n: string) => allElements(c).find((e) => e.name === n)!.id;
  return { circuit: c, ids: { src: by('Uü'), rth: by('Rg'), load: by('Rt') } };
}

/** A helyettesítő Norton-kör: In ∥ Rth és a terhelés. */
function nortonCircuit(In: number, Rth: number, RL: number): { circuit: Circuit; ids: { src: string; rth: string; load: string } } {
  const s = new Sketch();
  // A forrásáram az A kapocs felé (felfelé) folyik, ha In > 0.
  const src = makeElement('I', Math.abs(In), In >= 0 ? -1 : 1);
  src.name = 'In';
  const rth = makeElement('R', Rth);
  rth.name = 'Rg';
  const load = makeElement('R', RL);
  load.name = 'Rt';
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
  return { circuit: c, ids: { src: by('In'), rth: by('Rg'), load: by('Rt') } };
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
  // Ha a kapcsok felől nem vonható össze (híd), csillag-delta átalakítással számolunk.
  let sd: ReturnType<typeof transformAndReduce> = null;
  if (!red) {
    const back = new Map<number, number>();
    for (const [orig, k] of nodeMap) if (!back.has(k)) back.set(k, orig);
    const marks = [
      ...net.elements.filter((e) => e.kind !== 'R').map((e) => ({ element: e.id, as: e.kind === 'V' ? ('short' as const) : ('open' as const) })),
      { element: loadId, as: 'open' as const },
    ];
    sd = transformAndReduce(rs, killed.nodeCount, ka, kb, {
      drawn: new Set(allElements(p.circuit).map((e) => e.id)),
      from: 'Az A és B kapcsok',
      group: 'Rg: belső ellenállás',
      toDrawing: (n) => back.get(n) ?? n,
      base: { killed: marks, terminals: true },
    });
    if (!sd) return { ok: false, reason: 'Az Rg meghatározásához egyetlen csillag-delta átalakítás nem elég.' };
    red = sd.red;
  }
  const Rth = red.root.R;

  // Uü (üresjárási feszültség) a tanár úr módszerével: forrásonként feszültség- és áramosztással
  // (szuperpozíció), ha nem megy, csomóponti módszerrel. B a referencia, Uü = φA − φB.
  const names = new Map([
    [a, 'A'],
    [b, 'B'],
  ]);
  const loadOpen = { element: loadId, as: 'open' as const };
  const withoutLoad = { ...p.circuit, branches: p.circuit.branches.filter((br) => !br.elements.some((e) => e.id === load.id)) };
  const byDiv = openVoltageByDividers(open, a, b, { circuit: withoutLoad, starDelta: !!p.starDelta, loadOpen });
  const dOpen = byDiv ? null : nodalSteps(open, { ground: b, forceEssential: [a, b], names, base: { killed: [loadOpen], terminals: true }, group: 'Uü: üresjárás' });
  const vOpen = dOpen?.values ?? solveAny(open);
  const Uth = byDiv ? byDiv.U : dOpen ? dOpen.phi.get(a)! : vOpen ? pathVoltage(open, vOpen, a, b) : null;
  if (Uth === null) return { ok: false, reason: 'Az üresjárási állapot nem számolható.' };
  // A Norton-generátor árama a tanár úr szerint egyszerűen Uü / Rg (a rövidzárási áram).
  const In = Uth / Rth;
  const IL = Uth / (Rth + RL);
  const Pmax = (Uth * Uth) / (4 * Rth);

  const sources = net.elements.filter((e) => e.kind !== 'R');
  const killedMarks = [...sources.map((s) => ({ element: s.id, as: s.kind === 'V' ? ('short' as const) : ('open' as const) })), loadOpen];
  const steps: Step[] = [];
  const simp = simplificationStep(p, net);
  if (simp) steps.push(simp);
  steps.push({
    title: 'A vizsgált ág lekötése',
    text: `A(z) ${loadId} ellenállást lekötjük (a helyén szakadás); a két végpont az A és a B kapocs. A hálózat többi része az A–B kapcsok felől egyetlen generátorral helyettesíthető. Minden esetben üresjárásban számolunk: a terhelés nincs bekötve.`,
    highlight: { elements: [loadId], killed: [loadOpen], terminals: true },
    group: 'A helyettesítendő rész',
  });
  steps.push({
    title: 'Források kiiktatása',
    text: 'A belső ellenálláshoz (Rg) minden forrást kiiktatunk: a feszültségforrás helyére rövidzár, az áramforrás helyére szakadás kerül. Ezután az A–B kapcsok felől nézett eredőt számoljuk: Rg = RAB.',
    highlight: { killed: killedMarks, terminals: true },
    group: 'Rg: belső ellenállás',
  });
  if (zero.length) {
    steps.push({
      title: 'Kiegyenlített híd',
      text: `A kiiktatott hálózatban ${zero.join(', ')} árammentes (kiegyenlített híd), ezért elhagyható.`,
      highlight: { killed: killedMarks, dim: zero, terminals: true },
      group: 'Rg: belső ellenállás',
    });
  }
  if (sd) steps.push(...sd.steps.map((st) => ({ ...st, group: st.group === 'Átalakítás' ? 'Rg: csillag-delta átalakítás' : st.group })));
  else
    for (const st of reductionSteps(red, withoutLoad, { killed: killedMarks, terminals: true }))
      steps.push({ ...st, highlight: { ...st.highlight, killed: killedMarks, terminals: true }, group: 'Rg: belső ellenállás' });
  steps.push({
    title: 'Belső ellenállás',
    text: 'Az A–B kapcsok felől nézett eredő a helyettesítő generátor belső ellenállása (a ZH-lapokon Rb). Egyetlen képletben, ahogy a tanár úr írja:',
    terms: [`R_g = R_{AB} = ${rSym(red.root)}`],
    subst: red.root.kind !== 'leaf' ? `R_g = ${exprNum(red.root)}` : undefined,
    result: { symbol: 'R_g', value: Rth, unit: 'Ω' },
    highlight: sd ? sd.filterH({ ...sd.after, killed: killedMarks, groups: [groupOf(red.root, 'result')] }) : { killed: killedMarks, groups: [groupOf(red.root, 'result')], terminals: true },
    group: 'Rg: belső ellenállás',
  });
  if (byDiv) steps.push(...byDiv.steps);
  else {
    steps.push({
      title: 'Üresjárás',
      text: 'A források visszakerülnek, a terhelés továbbra is lekötve. Az A és B kapcsok közötti feszültséget csomóponti módszerrel számoljuk: a B pontot választjuk referenciának (φB = 0), így Uü egyszerűen φA lesz.',
      terms: ['U_{\\text{ü}} = \\varphi_A - \\varphi_B = \\varphi_A'],
      highlight: { killed: [loadOpen], terminals: true },
      group: 'Uü: üresjárás',
    });
    if (dOpen) steps.push(...dOpen.steps);
    steps.push({
      title: 'Üresjárási feszültség',
      text: 'Az A pont potenciálja a B-hez képest a helyettesítő generátor forrásfeszültsége. Ha negatív, akkor B van magasabb potenciálon.',
      terms: ['U_{\\text{ü}} = \\varphi_A - \\varphi_B'],
      subst: `U_{\\text{ü}} = ${texQty(Uth, 'V', { paren: true })} - 0`,
      result: { symbol: 'U_{\\text{ü}}', value: Uth, unit: 'V' },
      highlight: { killed: [loadOpen], terminals: true, nodeLabels: [{ node: a, label: `φA = ${formatQuantity(Uth, 'V', { sig: 3 })}` }, { node: b, label: 'φB = 0' }] },
      group: 'Uü: üresjárás',
    });
  }
  const th = theveninCircuit(Uth, Rth, RL);
  steps.push({
    title: 'Thevenin-helyettesítő kép',
    text: 'A hálózat az A–B kapcsok felől egy Uü forrásfeszültségű, Rg belső ellenállású feszültséggenerátorral helyettesíthető. Visszakötve a terhelést, egyetlen hurok marad.',
    terms: ['I_t =', `\\frac{U_{\\text{ü}}}{R_g + R_t}`],
    subst: `I_t = \\frac{${texQty(Uth, 'V')}}{${texQty(Rth, 'Ω')} + ${texQty(RL, 'Ω')}}`,
    result: { symbol: 'I_t', value: IL, unit: 'A' },
    circuit: th.circuit,
    highlight: { elements: [th.ids.load], arrows: [{ element: th.ids.load, kind: 'I', value: IL }] },
    group: 'Helyettesítő képek',
  });
  steps.push({
    title: 'Norton-generátor árama',
    text: 'A Norton-generátor forrásárama a rövidzárási áram: ha A-t és B-t rövidre zárnánk, ennyi folyna A-ból B felé. A Thevenin-képből Ohm törvényével kapjuk.',
    terms: ['I_n =', '\\frac{U_{\\text{ü}}}{R_g}'],
    subst: `I_n = \\frac{${texQty(Uth, 'V')}}{${texQty(Rth, 'Ω')}}`,
    result: { symbol: 'I_n', value: In, unit: 'A' },
    circuit: th.circuit,
    highlight: {},
    group: 'Helyettesítő képek',
  });
  const no = nortonCircuit(In, Rth, RL);
  steps.push({
    title: 'Norton-helyettesítő kép',
    text: 'Ugyanez Norton-alakban: In forrásáram, vele párhuzamosan Rg. A terhelés árama áramosztással adódik, és megegyezik a Thevenin-képből kapottal.',
    terms: ['I_t =', `I_n \\cdot \\frac{R_g}{R_g + R_t}`],
    subst: `I_t = ${texQty(In, 'A', { paren: true })} \\cdot \\frac{${texQty(Rth, 'Ω')}}{${texQty(Rth, 'Ω')} + ${texQty(RL, 'Ω')}}`,
    result: { symbol: 'I_t', value: (In * Rth) / (Rth + RL), unit: 'A' },
    circuit: no.circuit,
    highlight: { elements: [no.ids.load], arrows: [{ element: no.ids.load, kind: 'I', value: (In * Rth) / (Rth + RL) }] },
    group: 'Helyettesítő képek',
    note: `A terhelés árama mindkét képből ${formatQuantity(IL, 'A')}.`,
  });
  if (p.questions.some((q) => q.kind === 'Pmax')) {
    steps.push({
      title: 'Maximális teljesítmény',
      text: 'A generátorból akkor vehető ki a legnagyobb teljesítmény, ha a terhelő ellenállás egyenlő a belső ellenállással (illesztés): Rt = Rg. Ekkor a feszültség fele a terhelésen esik.',
      terms: ['R_t = R_g,\\quad', 'P_{max} =', '\\frac{U_{\\text{ü}}^2}{4 R_g}'],
      subst: `P_{max} = \\frac{\\left(${texQty(Uth, 'V')}\\right)^2}{4 \\cdot ${texQty(Rth, 'Ω')}}`,
      result: { symbol: 'P_{max}', value: Pmax, unit: 'W' },
      circuit: theveninCircuit(Uth, Rth, Rth).circuit,
      highlight: {},
      group: 'Helyettesítő képek',
    });
  }

  const answers: MethodAnswer[] = [];
  for (const q of p.questions) {
    let raw: number | undefined;
    if (q.kind === 'Uth') raw = Uth;
    if (q.kind === 'Rth') raw = Rth;
    if (q.kind === 'In') raw = In;
    if (q.kind === 'IL') raw = IL;
    if (q.kind === 'Pmax') raw = Pmax;
    if (q.target === loadId && q.kind === 'I') raw = IL;
    if (q.target === loadId && q.kind === 'U') raw = IL * RL;
    if (q.target === loadId && q.kind === 'P') raw = IL * IL * RL;
    if (raw !== undefined) answers.push({ questionId: q.id, value: q.magnitudeOnly ? Math.abs(raw) : raw });
  }
  return { ok: true, solution: { method: 'thevenin', title: 'Thevenin és Norton', steps, answers } };
}

const PRIMES = ["'", "''", "'''", '^{(4)}', '^{(5)}', '^{(6)}'];
const PLAIN = ['′', '″', '‴', '⁽⁴⁾', '⁽⁵⁾', '⁽⁶⁾'];

/**
 * Legrövidebb út a kiiktatott hálózatban a-tól b-ig ellenállásokon (és ha megadjuk, a működő
 * feszültségforráson) át. Előjel: +1, ha az elem a→b irányában haladunk.
 */
function resistorPath(net: Netlist, a: number, b: number, allow?: string): { id: string; sign: 1 | -1 }[] | null {
  const prev = new Map<number, { from: number; id: string; sign: 1 | -1 }>();
  const seen = new Set([a]);
  const queue = [a];
  while (queue.length) {
    const n = queue.shift()!;
    if (n === b) break;
    for (const e of net.elements) {
      if ((e.kind !== 'R' && e.id !== allow) || e.a === e.b) continue;
      const next = e.a === n ? e.b : e.b === n ? e.a : null;
      if (next === null || seen.has(next)) continue;
      seen.add(next);
      prev.set(next, { from: n, id: e.id, sign: e.a === n ? 1 : -1 });
      queue.push(next);
    }
  }
  if (!seen.has(b)) return null;
  const out: { id: string; sign: 1 | -1 }[] = [];
  for (let n = b; n !== a; ) {
    const st = prev.get(n)!;
    out.unshift({ id: st.id, sign: st.sign });
    n = st.from;
  }
  return out;
}

/**
 * Az üresjárási feszültség (U_AB = φA − φB) forrásonként, csak eredővel, feszültség- és áramosztással.
 * Minden részáramkörben az A–B közötti feszültség egy ellenállás-úton át: U′ = ±U_R… (A→B pozitív).
 * null, ha valamelyik részáramkör nem bontható soros-párhuzamos részekre.
 */
function openVoltageByDividers(
  open: Netlist,
  a: number,
  b: number,
  ctx: { circuit: Circuit; starDelta: boolean; loadOpen: { element: string; as: 'open' } },
): { steps: Step[]; U: number } | null {
  const sources = open.elements.filter((e) => e.kind !== 'R');
  if (sources.length === 0) return null;
  const multi = sources.length > 1;
  const steps: Step[] = [];
  const parts: number[] = [];
  steps.push({
    title: 'Üresjárási feszültség',
    text: multi
      ? `A források visszakerülnek, a terhelés lekötve marad. Az A–B kapcsok közötti feszültséget szuperpozícióval számoljuk: ${sources.length} részáramkör, mindegyikben egy forrás működik, a többi kiiktatva. Minden részben feszültség- és áramosztással kapjuk meg az A–B közötti feszültséget, a végén előjelesen összeadjuk (az A→B irány a pozitív).`
      : 'A forrás visszakerül, a terhelés lekötve marad. Az A–B kapcsok közötti feszültséget feszültség- és áramosztással számoljuk.',
    terms: ['U_{\\text{ü}} = U_{AB} = \\varphi_A - \\varphi_B'],
    highlight: { killed: [ctx.loadOpen], terminals: true },
    group: 'Uü: üresjárás',
  });
  for (const [k, s] of sources.entries()) {
    const kk = killSources(open, [s.id]);
    const ka = kk.nodeMap.get(a);
    const kb = kk.nodeMap.get(b);
    if (ka === undefined || kb === undefined) return null;
    const others = sources.filter((x) => x.id !== s.id);
    const marks = [...others.map((x) => ({ element: x.id, as: x.kind === 'V' ? ('short' as const) : ('open' as const) })), ctx.loadOpen];
    const group = multi ? `Uü: csak ${s.id} működik` : 'Uü: üresjárás';
    const prime = multi ? PRIMES[k] ?? `^{(${k + 1})}` : '';
    const primeTxt = multi ? PLAIN[k] ?? `(${k + 1})` : '';
    const Usym = multi ? `U${prime}_{AB}` : 'U_{\\text{ü}}';
    if (multi)
      steps.push({
        title: 'A részáramkör',
        text:
          `Csak ${s.id} működik. ` +
          (others.length ? `${others.map((x) => `${x.id} helyére ${x.kind === 'V' ? 'rövidzár' : 'szakadás'}`).join(', ')} kerül. ` : '') +
          'Az eredő ellenállásból a forrás árama, aztán osztókkal az A–B közötti ellenállások feszültsége.',
        highlight: { elements: [s.id], killed: marks, terminals: true },
        group,
      });
    if (ka === kb) {
      steps.push({
        title: multi ? `Részfeszültség: U${primeTxt}` : 'Üresjárási feszültség',
        text: 'A kiiktatott feszültségforrás rövidzára az A és B pontot összeköti, így ebben a részben nincs köztük feszültség.',
        terms: [`${Usym} = 0`],
        result: { symbol: Usym, value: 0, unit: 'V' },
        highlight: { killed: marks, terminals: true },
        group,
      });
      parts.push(0);
      continue;
    }
    const back = new Map<number, number>();
    for (const [orig, nw] of kk.nodeMap) if (!back.has(nw)) back.set(nw, orig);
    // Ha a működő feszültségforrás nincs zárt körben (a többi forrás kiiktatva szakadás), nem folyik áram:
    // az ellenállásokon nem esik feszültség, A és B között legfeljebb a forrás feszültsége jelenik meg.
    const rest: Netlist = { nodeCount: kk.net.nodeCount, elements: kk.net.elements.filter((e) => e.id !== s.id) };
    const sk = kk.net.elements.find((e) => e.id === s.id)!;
    const noLoop = s.kind === 'V' && resistorPath(rest, sk.a, sk.b) === null;
    const path = resistorPath(kk.net, ka, kb, s.kind === 'V' ? s.id : undefined);
    if (!path) return null;
    const vals = new Map<string, number>();
    if (noLoop) {
      steps.push({
        title: 'Nincs zárt áramkör',
        text: `A(z) ${s.id} forrás a kiiktatás után nincs zárt körben (a szakadás megszakítja), így áram sem folyik: az ellenállásokon nem esik feszültség.`,
        highlight: { elements: [s.id], killed: marks, terminals: true },
        group,
      });
    } else {
      const r = singleSourceSteps(kk.net, path.map((x) => x.id).filter((id) => id !== s.id), {
        group,
        base: { killed: marks, terminals: true },
        circuit: ctx.circuit,
        starDelta: ctx.starDelta,
        toDrawing: (n) => back.get(n) ?? n,
      });
      if (!r) return null;
      steps.push(...r.steps);
      for (const [id, v] of r.values) vals.set(id, v.U);
    }
    // A feszültségforrás U_ab-je: a b oldal potenciálja nagyobb (U_ab = −E).
    if (s.kind === 'V') vals.set(s.id, -s.value);
    const Ue = (id: string) => vals.get(id) ?? 0;
    const U = path.reduce((acc, x) => acc + x.sign * Ue(x.id), 0);
    parts.push(U);
    const sym = (id: string) => (id === s.id ? `U_{\\text{${id}}}` : `U${prime}_{\\text{${id}}}`);
    // A 0 V-os (árammentes) elemeket nem írjuk ki.
    const shownPath = path.filter((x) => Math.abs(Ue(x.id)) > 1e-12);
    steps.push({
      title: multi ? `Részfeszültség: U${primeTxt}` : 'Üresjárási feszültség',
      text:
        `A-tól B-ig ${path.map((x) => x.id).join(', ')} elemen át jutunk el. Amelyiken a feszültség nyila A-tól B felé mutat, az +, amelyiken visszafelé, az −${path.length > shownPath.length ? ' (az árammentes ellenálláson nem esik feszültség, az kimarad)' : ''}. ` +
        (Math.abs(U) < 1e-12
          ? 'A két pont azonos potenciálon van.'
          : `Az eredmény ${U > 0 ? 'pozitív: A van a nagyobb potenciálon, a feszültség nyila A-tól B felé mutat (A→B)' : 'negatív: B van a nagyobb potenciálon, a feszültség nyila B-től A felé mutat (B→A)'}.`),
      terms: [`${Usym} = ${shownPath.map((x, i) => `${x.sign * Ue(x.id) < 0 ? '-' : i ? '+' : ''} ${sym(x.id)}`).join(' ') || '0'}`],
      // Egyetlen elemnél a tanár úr csak a nagyságot és az irányt írja: „U′AB = 0,169 V (↓)”.
      subst: multi && shownPath.length === 1 && Math.abs(U) > 1e-12 ? `${Usym} = ${texQty(Math.abs(U), 'V')}\\;(${U > 0 ? 'A \\to B' : 'B \\to A'})` : shownPath.length ? `${Usym} = ${shownPath.map((x, i) => `${x.sign * Ue(x.id) < 0 ? '-' : i ? '+' : ''} ${texQty(Math.abs(Ue(x.id)), 'V')}`).join(' ')}${multi && Math.abs(U) > 1e-12 ? `${shownPath.length > 1 ? ` = ${texQty(Math.abs(U), 'V')}` : ''}\\;(${U > 0 ? 'A \\to B' : 'B \\to A'})` : ''}` : undefined,
      result: { symbol: Usym, value: U, unit: 'V' },
      highlight: { killed: marks, terminals: true, elements: path.map((x) => x.id) },
      note: multi && Math.abs(U) > 1e-12 ? `U${primeTxt} = ${formatQuantity(Math.abs(U), 'V')} (${U > 0 ? 'A→B' : 'B→A'})` : undefined,
      group,
    });
  }
  const U = parts.reduce((x, y) => x + y, 0);
  if (multi)
    steps.push({
      title: 'Összegzés',
      // A tanár úr (ZH 2021/5: „UAB = U″AB − U′AB”): az első rész irányához képest, ami vele egyező, +, ami ellentétes, −;
      // a végeredmény nagysága és iránya.
      text: `A részfeszültségeket az első rész irányához (${(parts[0] ?? 0) >= 0 ? 'A→B' : 'B→A'}) képest adjuk össze: ami vele egyező irányú, az +, ami ellentétes, az −. Az előjel a φA − φB különbségé: ${U >= 0 ? 'pozitív, A van a nagyobb potenciálon (A→B)' : 'negatív, B van a nagyobb potenciálon (B→A)'}.`,
      terms: [`U_{\\text{ü}} = ${parts.map((v, k) => `${k === 0 ? '' : v * ((parts[0] ?? 0) >= 0 ? 1 : -1) >= 0 ? ' + ' : ' - '}U${PRIMES[k] ?? `^{(${k + 1})}`}_{AB}`).join('')}`],
      subst: `U_{\\text{ü}} = ${parts.map((v, k) => `${k === 0 ? '' : v * ((parts[0] ?? 0) >= 0 ? 1 : -1) >= 0 ? ' + ' : ' - '}${texQty(Math.abs(v), 'V')}`).join('')} = ${texQty(Math.abs(U), 'V')}\\;(${U >= 0 ? 'A \\to B' : 'B \\to A'})`,
      result: { symbol: 'U_{\\text{ü}}', value: U, unit: 'V' },
      highlight: { killed: [ctx.loadOpen], terminals: true },
      note: `Uü = ${formatQuantity(Math.abs(U), 'V')} (${U >= 0 ? 'A→B' : 'B→A'})`,
      group: 'Uü: összegzés',
    });
  return { steps, U };
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
