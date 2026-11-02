// Melyik feladat "való" egy módszerhez: amit azzal a módszerrel a legkönnyebb megoldani.
// A hurokáram és a csomóponti potenciál között a levezetésben megoldandó egyenletrendszer
// mérete dönt (kevesebb egyenlet = könnyebb).

import type { Problem } from '../generator/generate';
import { applicableMethods, solveWith } from '.';
import { superpositionByDividers } from './superposition';
import type { MethodId, MethodResult } from './types';

/** A levezetésben megoldott egyenletrendszer mérete (0, ha nincs egyenletrendszer). */
export function systemSize(r: MethodResult): number {
  if (!r.ok) return Infinity;
  const sys = r.solution.steps.find((s) => s.title === 'Az egyenletrendszer');
  if (sys) return Number.parseInt(sys.text, 10) || 0;
  return r.solution.steps.some((s) => s.title === 'Az egyenlet megoldása') ? 1 : 0;
}

export interface Fit {
  ok: boolean;
  /** Rövid indoklás a feladat fejlécébe. */
  why: string;
}

const eq = (n: number) => (n === 0 ? 'egyenletrendszer nélkül' : `${n} egyenlet`);

/** Illik-e a feladat a módszerhez úgy, hogy azzal a legkönnyebb. */
export function methodFit(m: MethodId, p: Problem): Fit {
  const usable = applicableMethods(p);
  if (!usable.includes(m)) return { ok: false, why: '' };
  const sources = p.stats.sources;
  switch (m) {
    case 'redukcio':
      return { ok: sources <= 1, why: 'Egy forrás, soros-párhuzamos hálózat: elég összevonni és osztani.' };
    case 'kirchhoff':
      return { ok: p.topic === 'kirchhoff', why: 'Egyetlen csomóponti vagy huroktörvény elég hozzá.' };
    case 'thevenin':
      return { ok: p.topic === 'thevenin', why: 'Egy terhelés a kérdés: a többi rész helyettesíthető egy generátorral.' };
    case 'csillag-delta':
      return { ok: !usable.includes('redukcio'), why: 'Híd: átalakítás nélkül nem vonható össze.' };
    case 'szuperpozicio': {
      if (sources < 2 || !superpositionByDividers(p)) return { ok: false, why: '' };
      const h = systemSize(solveWith(p, 'hurokaram'));
      const c = systemSize(solveWith(p, 'csomoponti'));
      return { ok: Math.min(h, c) >= 2, why: `Minden részáramkör eredővel és osztókkal megoldható; hurokárammal ${eq(h)}, csomóponti potenciállal ${eq(c)} lenne.` };
    }
    case 'hurokaram':
    case 'csomoponti': {
      if (sources < 2) return { ok: false, why: '' };
      const h = systemSize(solveWith(p, 'hurokaram'));
      const c = systemSize(solveWith(p, 'csomoponti'));
      const ok = m === 'hurokaram' ? h < c : c < h;
      return { ok, why: `Hurokárammal ${eq(h)}, csomóponti potenciállal ${eq(c)}.` };
    }
  }
}
