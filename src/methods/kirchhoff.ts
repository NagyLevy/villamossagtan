// Kirchhoff törvényeinek egyszerű alkalmazása: ismeretlen áram a csomóponti törvénnyel,
// ismeretlen feszültség a huroktörvénnyel. Opció: ellentétes körüljárás / előjelkonvenció,
// amely ugyanazt az eredményt adja.

import type { Problem } from '../generator/generate';
import type { Question } from '../generator/questions';
import { toNetlist } from '../solver/netlist';
import { texNum, texOf, texQty } from './tex';
import type { MethodResult, Step } from './types';

export interface KirchhoffOptions {
  /** Ellentétes körüljárás (hurok) / befolyó áram pozitív (csomópont). */
  reverse?: boolean;
}

export function solveKirchhoff(p: Problem, opts: KirchhoffOptions = {}): MethodResult {
  const q = p.questions.find((x) => x.given && (x.node !== undefined || x.loop));
  if (!q) return { ok: false, reason: 'Ehhez a feladathoz a Kirchhoff-féle "ismeretlen kiszámítása" lépés nem illik; válassz más módszert.' };
  return q.node !== undefined ? kcl(p, q, opts) : kvl(p, q, opts);
}

function kcl(p: Problem, q: Question, opts: KirchhoffOptions): MethodResult {
  const net = toNetlist(p.circuit).net;
  const node = q.node!;
  const incident = net.elements.filter((e) => e.a === node || e.b === node);
  const flip = opts.reverse ? -1 : 1;
  // Kifolyó áram pozitív: I_ab az a kivezetésből folyik ki.
  const sign = (id: string) => (incident.find((e) => e.id === id)!.a === node ? 1 : -1) * flip;
  const known = new Map<string, number>();
  for (const g of q.given ?? []) known.set(g.target, g.value);
  // Az áramforrás árama az ábráról ismert: I_ab = a forrás értéke.
  for (const e of incident) if (e.kind === 'I') known.set(e.id, e.value);
  const u = q.target!;
  const others = incident.filter((e) => e.id !== u);
  const sumOthers = others.reduce((s, e) => s + sign(e.id) * known.get(e.id)!, 0);
  const Iu = -sumOthers / sign(u);

  const term = (id: string, first: boolean) => `${sign(id) > 0 ? (first ? '' : '+ ') : '- '}${texOf('I', id)}`;
  const ordered = [u, ...others.map((e) => e.id)];
  const steps: Step[] = [
    {
      title: 'A csomópont',
      text: `A kérdéses ellenállás egyik végén ${incident.length} ág találkozik. A csomóponti törvény szerint a csomópontba befolyó és onnan kifolyó áramok előjeles összege nulla; itt a ${flip > 0 ? 'kifolyó' : 'befolyó'} áramot vesszük pozitívnak.`,
      highlight: { nodes: [node], elements: [u], arrows: others.map((e) => ({ element: e.id, kind: 'I', value: known.get(e.id)! })) },
    },
    {
      title: 'Csomóponti egyenlet',
      text: 'Minden ág áramát a saját referenciairánya szerint írjuk be: ha a nyíl a csomóponttól elfelé mutat, az áram kifolyó.',
      terms: [...ordered.map((id, i) => term(id, i === 0)), '= 0'],
      highlight: { nodes: [node], arrows: others.map((e) => ({ element: e.id, kind: 'I', value: known.get(e.id)! })) },
    },
    {
      title: 'Behelyettesítés',
      text: 'A megadott áramokat előjelesen helyettesítjük be, és kifejezzük az ismeretlent.',
      terms: [`${sign(u) > 0 ? '' : '-'}${texOf('I', u)} = ${others.map((e, i) => `${-sign(e.id) > 0 ? (i === 0 ? '' : '+ ') : '- '}${texQty(known.get(e.id)!, 'A', { paren: true })}`).join(' ')}`],
      subst: `${texOf('I', u)} = ${texQty(Iu, 'A')}`,
      result: { symbol: texOf('I', u), value: Iu, unit: 'A' },
      highlight: { nodes: [node], elements: [u], arrows: [...others.map((e) => ({ element: e.id, kind: 'I' as const, value: known.get(e.id)! })), { element: u, kind: 'I', value: Iu }] },
      note: opts.reverse ? 'Ellentétes előjelkonvencióval is ugyanez az eredmény adódik: az egyenlet minden tagja −1-szeresére változik.' : undefined,
    },
  ];
  return { ok: true, solution: { method: 'kirchhoff', title: 'Csomóponti törvény', steps, answers: [{ questionId: q.id, value: q.magnitudeOnly ? Math.abs(Iu) : Iu }] } };
}

function kvl(p: Problem, q: Question, opts: KirchhoffOptions): MethodResult {
  const net = toNetlist(p.circuit).net;
  const byId = new Map(net.elements.map((e) => [e.id, e]));
  const flip = opts.reverse ? -1 : 1;
  // Feszültségforrásnál a feszültség nyila (a nagyobb potenciáltól a kisebb felé) a modell a→b irányával
  // ellentétes: az előjelét ehhez a nyílhoz mérjük, és a feszültsége így +E.
  const isV = (id: string) => byId.get(id)!.kind === 'V';
  const loop = q.loop!.map((x) => ({ id: x.id, sign: (x.sign * flip * (isV(x.id) ? -1 : 1)) as 1 | -1 }));
  const known = new Map<string, number>();
  for (const g of q.given ?? []) known.set(g.target, g.value);
  for (const x of loop) if (isV(x.id)) known.set(x.id, byId.get(x.id)!.value);
  const u = q.target!;
  const su = loop.find((x) => x.id === u)!.sign;
  const others = loop.filter((x) => x.id !== u);
  const Uu = -others.reduce((s, x) => s + x.sign * known.get(x.id)!, 0) / su;

  const term = (x: { id: string; sign: number }, first: boolean) => `${x.sign > 0 ? (first ? '' : '+ ') : '- '}${texOf('U', x.id)}`;
  const steps: Step[] = [
    {
      title: 'A hurok',
      text: `Kijelöljük a hurkot és a körüljárási irányt (${opts.reverse ? 'az előzővel ellentétesen' : 'az ábrán a nyíl'}). A huroktörvény szerint a hurok mentén a feszültségek előjeles összege nulla.`,
      highlight: { loops: [{ elements: loop }], elements: [u], arrows: others.filter((x) => byId.get(x.id)!.kind !== 'V').map((x) => ({ element: x.id, kind: 'U', value: known.get(x.id)! })) },
    },
    {
      title: 'Huroktörvény',
      text: 'Ha a körüljárás az elem feszültségének nyilával egyezik, a feszültsége pozitív előjellel kerül az egyenletbe, különben negatívval. A feszültség nyila mindig a nagyobb potenciáltól a kisebb felé mutat, az ellenállásnál és a feszültségforrásnál is.',
      terms: [...[loop.find((x) => x.id === u)!, ...others].map((x, i) => term(x, i === 0)), '= 0'],
      highlight: { loops: [{ elements: loop }], arrows: others.filter((x) => byId.get(x.id)!.kind !== 'V').map((x) => ({ element: x.id, kind: 'U', value: known.get(x.id)! })) },
    },
    {
      title: 'Behelyettesítés',
      text: 'A megadott feszültségeket előjelesen helyettesítjük be, és kifejezzük az ismeretlent.',
      terms: [`${su > 0 ? '' : '-'}${texOf('U', u)} = ${others.map((x, i) => `${-x.sign > 0 ? (i === 0 ? '' : '+ ') : '- '}${texNum(known.get(x.id)!, { paren: true })}`).join(' ')}\\,\\text{V}`],
      subst: `${texOf('U', u)} = ${texQty(Uu, 'V')}`,
      result: { symbol: texOf('U', u), value: Uu, unit: 'V' },
      highlight: { loops: [{ elements: loop }], elements: [u], arrows: [{ element: u, kind: 'U', value: Uu }] },
      note: opts.reverse ? 'Ellentétes körüljárással is ugyanez az eredmény: minden tag előjele megfordul, az egyenlet ugyanaz marad.' : undefined,
    },
  ];
  return { ok: true, solution: { method: 'kirchhoff', title: 'Huroktörvény', steps, answers: [{ questionId: q.id, value: q.magnitudeOnly ? Math.abs(Uu) : Uu }] } };
}
