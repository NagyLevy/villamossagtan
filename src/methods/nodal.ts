// Csomóponti potenciál módszer. Referenciacsomópont, a feszültségforrásokkal rögzített csomópontok,
// az ismeretlenek száma (csomópontok − rögzítettek − referencia), majd csomóponti egyenletek.
// Az ellenállások referenciairánya egységes: balról jobbra, fentről lefelé.
//
// A levezetés (nodalSteps) más módszerekből is hívható: a Thevenin-generátor Uth és In értékét,
// a szuperpozíció részeredményeit is így vezetjük le, hogy minden szám mögött látszódjon a számolás.

import type { Problem } from '../generator/generate';
import { RealField } from '../solver/field';
import { solveLinear } from '../solver/linear';
import type { Netlist } from '../solver/model';
import { toNetlist } from '../solver/netlist';
import { formatQuantity } from '../units';
import { answersFromValues, simplificationStep, sub, targetResistors } from './common';
import { buildNodal, elementValues, pathCurrent, type NodalSystem, type Path, type Values } from './engine';
import { solveSystemSteps } from './linsolve';
import { linearTex, sourcePowerSteps } from './loopcurrent';
import { texElement, texNum, texOf, texQty } from './tex';
import type { Highlight, MethodResult, Step } from './types';

export interface NodalStepsOptions {
  ground?: number;
  /** Ezek a csomópontok akkor is lényegesek, ha csak két ág fut beléjük (pl. az A, B kapcsok). */
  forceEssential?: number[];
  /** A részhálózat csomópontja → a rajzon látható hálózat csomópontja. */
  toDrawing?: (n: number) => number;
  /** Minden lépés kiemeléséhez hozzáadódik (pl. kiiktatott források, lekötött terhelés). */
  base?: Highlight;
  group?: string;
  /** Névvel ellátott csomópontok (pl. A, B). */
  names?: Map<number, string>;
}

export interface NodalSteps {
  steps: Step[];
  sys: NodalSystem;
  phi: Map<number, number>;
  values: Values;
  currents: Map<number, number>;
  ph: (n: number) => string;
  phTxt: (n: number) => string;
}

export function mergeHighlight(base: Highlight | undefined, h: Highlight): Highlight {
  if (!base) return h;
  const cat = <T>(a?: T[], b?: T[]) => (a || b ? [...(a ?? []), ...(b ?? [])] : undefined);
  return {
    elements: cat(base.elements, h.elements),
    dim: cat(base.dim, h.dim),
    groups: cat(base.groups, h.groups),
    nodes: cat(base.nodes, h.nodes),
    loops: cat(base.loops, h.loops),
    arrows: cat(base.arrows, h.arrows),
    killed: cat(base.killed, h.killed),
    nodeLabels: cat(base.nodeLabels, h.nodeLabels),
    terminals: base.terminals || h.terminals,
  };
}

/** A csomóponti módszer levezetése egy (rész)hálózatra; null, ha nincs legalább két lényeges csomópont. */
export function nodalSteps(net: Netlist, opts: NodalStepsOptions = {}): NodalSteps | null {
  const sys = buildNodal(net, opts.ground, opts.forceEssential ?? []);
  if (!sys || sys.rows.length !== sys.unknowns.length) return null;
  const x = solveLinear(
    sys.rows.map((r) => r.coeffs),
    sys.rows.map((r) => r.rhs),
    RealField,
  );
  if (!x) return null;
  const { topo, ground } = sys;
  const draw = opts.toDrawing ?? ((n: number) => n);
  const names = opts.names ?? new Map<number, string>();
  // Elnevezés: φ₀ a referencia (vagy a kapocs neve), a többi sorszámmal.
  const nameIdx = new Map<number, number>([[ground, 0]]);
  topo.essential.filter((n) => n !== ground && !names.has(n)).forEach((n, i) => nameIdx.set(n, i + 1));
  const ph = (n: number) => (names.has(n) ? `\\varphi_{${names.get(n)}}` : `\\varphi_{${nameIdx.get(n)}}`);
  const phTxt = (n: number) => (names.has(n) ? `φ${names.get(n)}` : `φ${sub(nameIdx.get(n)!)}`);
  const nodeLabels = topo.essential.map((n) => ({ node: draw(n), label: n === ground ? `${phTxt(n)} = 0` : phTxt(n) }));
  const H = (h: Highlight) => mergeHighlight(opts.base, h);
  const dn = (ns: number[]) => ns.map(draw);

  const phi = new Map<number, number>([[ground, 0]]);
  sys.unknowns.forEach((n, i) => phi.set(n, x[i]!));
  const currents = new Map<number, number>();
  for (const pth of topo.paths) if (pth.kind !== 'V') currents.set(pth.id, pth.s === pth.e ? (pth.kind === 'I' ? pth.J : pth.E / pth.R) : pathCurrent(pth, phi));
  const vPaths = topo.paths.filter((q) => q.kind === 'V');
  for (let guard = 0; guard <= vPaths.length; guard++) {
    for (const n of topo.essential) {
      const open = vPaths.filter((q) => !currents.has(q.id) && (q.s === n || q.e === n));
      if (open.length !== 1) continue;
      const q = open[0]!;
      let out = 0;
      for (const r of topo.paths) {
        if (r === q || !currents.has(r.id)) continue;
        if (r.s === n) out += currents.get(r.id)!;
        if (r.e === n) out -= currents.get(r.id)!;
      }
      currents.set(q.id, q.s === n ? -out : out);
    }
  }
  const values = elementValues(topo, phi, currents);

  const fixedCount = topo.essential.filter((n) => n !== ground && sys.groups.find((g) => g.includes(n))!.includes(ground)).length;
  const unknownCount = topo.essential.length - fixedCount - 1;
  const steps: Step[] = [];
  const shown = (ids: string[]) => ids.filter((id) => !id.startsWith('__'));
  steps.push({
    title: 'Csomópontok és referencia',
    text:
      `${topo.essential.length} csomópontot vizsgálunk. ${names.has(ground) ? `A ${names.get(ground)} pontot választjuk referenciának` : 'A legtöbb ághoz csatlakozót választjuk referenciának'} (potenciálja 0). ` +
      (fixedCount ? `${fixedCount} csomópont potenciálját egy feszültségforrás közvetlenül rögzíti. ` : '') +
      `Az ismeretlen potenciálok száma: ${topo.essential.length} − ${fixedCount} − 1 = ${unknownCount}.`,
    terms: [`n_{\\text{ism}} = ${topo.essential.length} - ${fixedCount} - 1 = ${unknownCount}`],
    highlight: H({ nodes: dn(topo.essential), nodeLabels }),
    group: opts.group,
  });

  const pathLatex = (q: Path, from: number): string => {
    // A from csomópontból kifolyó áram az ágon: (φ_from − φ_to ± E) / R, vagy ±J.
    const to = q.s === from ? q.e : q.s;
    const sign = q.s === from ? 1 : -1;
    if (q.kind === 'I') return `${sign * q.J >= 0 ? '+' : '-'} ${texNum(Math.abs(q.J))}`;
    const E = sign * q.E;
    const rs = q.elems.filter((e) => e.kind === 'R').map((e) => texElement(e.id)).join(' + ');
    const eTex = Math.abs(E) < 1e-12 ? '' : ` ${E > 0 ? '+' : '-'} ${texNum(Math.abs(E))}`;
    return `+ \\frac{${ph(from)} - ${ph(to)}${eTex}}{${rs}}`;
  };

  for (const r of sys.rows) {
    if (r.kind === 'fix') {
      const q = r.path!;
      const isShort = q.elems.some((e) => e.id.startsWith('__'));
      const toGround = q.s === ground || q.e === ground;
      steps.push({
        title: isShort ? 'Rövidzár' : toGround ? 'Rögzített csomópont' : 'Szupercsomópont',
        text: isShort
          ? 'A rövidzár a két pontot összeköti: a potenciáljuk azonos.'
          : toGround
            ? `A(z) ${shown(q.elems.map((e) => e.id)).join(', ')} feszültségforrás a referencia és egy csomópont között van: a csomópont potenciálja ismert, a nyíl a magasabb potenciál felé mutat.`
            : `A(z) ${shown(q.elems.map((e) => e.id)).join(', ')} feszültségforrás két ismeretlen csomópont között van: szupercsomópontot alkotnak, a potenciáljuk különbsége a forrásfeszültség.`,
        terms: [`${ph(q.e)} - ${ph(q.s)} = ${texNum(q.E)}`],
        subst: linearTex(r.coeffs, sys.unknowns.map(ph), r.rhs),
        highlight: H({ elements: shown(q.elems.map((e) => e.id)), nodes: dn([q.s, q.e]), nodeLabels }),
        group: opts.group,
      });
    } else {
      const grp = r.nodes;
      const cut = topo.paths.filter((q) => q.kind !== 'V' && q.s !== q.e && grp.includes(q.s) !== grp.includes(q.e));
      const terms = cut.map((q) => pathLatex(q, grp.includes(q.s) ? q.s : q.e));
      if (terms[0]?.startsWith('+ ')) terms[0] = terms[0].slice(2);
      // Tagonként, egyszerű mondatokban: melyik ág, merre, mennyi.
      const bullets = cut.map((q) => {
        const from = grp.includes(q.s) ? q.s : q.e;
        const to = from === q.s ? q.e : q.s;
        const sign = from === q.s ? 1 : -1;
        const ids = shown(q.elems.map((e) => e.id)).join(' + ');
        if (q.kind === 'I') {
          const J = sign * q.J;
          return `${ids}: áramforrásos ág. Itt nem kell számolni: a forrás ${formatQuantity(Math.abs(J), 'A')} áramot ${J >= 0 ? 'visz ki' : 'hoz be'} a csomópontból, ezért ${J >= 0 ? '+' : '−'}${formatQuantity(Math.abs(J), 'A')} kerül az egyenletbe.`;
        }
        const E = sign * q.E;
        const R = formatQuantity(q.R, 'Ω');
        const base = `${ids} ág (${phTxt(from)} → ${phTxt(to)}): a kifolyó áram a két vég potenciálkülönbsége osztva az ág ellenállásával (${R})`;
        if (Math.abs(E) < 1e-12) return `${base}: (${phTxt(from)} − ${phTxt(to)}) / ${R}.`;
        return `${base}. Az ágban van egy ${formatQuantity(Math.abs(E), 'V')}-os feszültségforrás, a nyila ${E > 0 ? phTxt(to) : phTxt(from)} felé mutat. A forrás a nyila irányában emeli a potenciált, ezért ${phTxt(from)}-től ${phTxt(to)} felé haladva ${E > 0 ? 'nő' : 'csökken'} ${formatQuantity(Math.abs(E), 'V')}-tal; így kerül a számlálóba ${E > 0 ? '+' : '−'}${formatQuantity(Math.abs(E), 'V')}.`;
      });
      steps.push({
        title: grp.length > 1 ? `Szupercsomópont (${grp.map(phTxt).join(', ')})` : `Csomóponti egyenlet: ${phTxt(grp[0]!)}`,
        text:
          (grp.length > 1
            ? 'Ezeket a csomópontokat egy feszültségforrás köti össze, ezért egyben kezeljük őket. Ami összesen kifolyik belőlük, annak nullának kell lennie (a köztük lévő forrás árama így kiesik). '
            : `Kirchhoff csomóponti törvénye: a ${phTxt(grp[0]!)} pontból kifolyó áramok összege nulla (ami befolyik, az ki is folyik). `) + 'Minden kapcsolódó ágra felírjuk, mennyi áram folyik ki rajta:',
        bullets,
        terms: [...terms, '= 0'],
        subst: linearTex(r.coeffs, sys.unknowns.map(ph), r.rhs),
        highlight: H({ nodes: dn(grp), nodeLabels, elements: shown(cut.flatMap((q) => q.elems.map((e) => e.id))) }),
        group: opts.group,
      });
    }
  }

  steps.push(
    ...solveSystemSteps(
      sys.rows.map((r) => r.coeffs),
      sys.rows.map((r) => r.rhs),
      sys.unknowns.map(ph),
      sys.unknowns.map(phTxt),
      x,
      'V',
      H({ nodes: dn(topo.essential), nodeLabels }),
      opts.group,
    ),
  );
  steps.push({
    title: 'A csomópontok potenciálja',
    text: 'Most már minden csomópont potenciálja ismert (a referenciához képest). Ezekből bármelyik ellenállás feszültsége a két végének különbsége, az árama pedig Ohm törvényéből jön.',
    highlight: H({ nodes: dn(topo.essential), nodeLabels: topo.essential.map((n) => ({ node: draw(n), label: `${phTxt(n)} = ${formatQuantity(phi.get(n)!, 'V', { sig: 3 })}` })) }),
    group: opts.group,
  });
  return { steps, sys, phi, values, currents, ph, phTxt };
}

export function solveNodalMethod(p: Problem): MethodResult {
  const map = toNetlist(p.circuit);
  const net = map.net;
  if (!net.elements.some((e) => e.kind !== 'R')) return { ok: false, reason: 'Nincs forrás a hálózatban.' };
  const d = nodalSteps(net);
  if (!d) return { ok: false, reason: 'Egyetlen hurok: ehhez elég Ohm törvénye vagy a huroktörvény.' };
  const { sys, phi, values, ph, phTxt } = d;
  const nodeLabels = sys.topo.essential.map((n) => ({ node: n, label: `${phTxt(n)} = ${formatQuantity(phi.get(n)!, 'V', { sig: 3 })}` }));

  const steps: Step[] = [];
  const simp = simplificationStep(p, net);
  if (simp) steps.push(simp);
  steps.push(...d.steps);
  for (const t of targetResistors(p)) {
    const q = sys.topo.paths.find((pp) => pp.elems.some((e) => e.id === t))!;
    const v = values.get(t)!;
    const simple = q.elems.length === 1;
    steps.push({
      title: `${t} árama és feszültsége`,
      text: simple
        ? 'Az ellenállás két végének potenciáljából: a feszültsége a potenciálkülönbség, az árama Ohm törvényéből.'
        : 'Az ellenállás egy összetett ágban van: az ág áramát a végpontok potenciáljából számoljuk, ez folyik az ellenálláson is.',
      terms: simple
        ? [`${texOf('U', t)} = ${q.elems[0]!.d === 1 ? `${ph(q.s)} - ${ph(q.e)}` : `${ph(q.e)} - ${ph(q.s)}`}`, `,\\quad ${texOf('I', t)} = \\frac{${texOf('U', t)}}{${texElement(t)}}`]
        : [`I_{\\text{ág}} = ${q.kind === 'I' ? 'I_{g}' : `\\frac{${ph(q.s)} - ${ph(q.e)}${Math.abs(q.E) > 1e-12 ? ` ${q.E > 0 ? '+' : '-'} ${texNum(Math.abs(q.E))}` : ''}}{${texNum(q.R)}}`}`],
      subst: `${texOf('U', t)} = ${texQty(v.U, 'V')},\\quad ${texOf('I', t)} = ${texQty(v.I, 'A')}`,
      result: p.questions.some((qq) => qq.target === t && qq.kind === 'U') ? { symbol: texOf('U', t), value: v.U, unit: 'V' } : { symbol: texOf('I', t), value: v.I, unit: 'A' },
      highlight: { elements: [t], nodes: [q.s, q.e], nodeLabels, arrows: [{ element: t, kind: 'I', value: v.I }] },
    });
  }
  steps.push(...sourcePowerSteps(p, values));
  return { ok: true, solution: { method: 'csomoponti', title: 'Csomóponti potenciál módszer', steps, answers: answersFromValues(p, values), values } };
}
