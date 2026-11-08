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

const TEACHER_WHY: Partial<Record<MethodId, string>> = {
  szuperpozicio: 'Gyakorlati feladat: forrásonként egy részáramkör, eredővel és osztókkal, a végén előjeles összeg.',
  thevenin: 'Gyakorlati feladat: Rg üresjárásban, Uü forrásonként osztókkal, In = Uü / Rg, Pmax illesztésnél.',
  hurokaram: 'Gyakorlati feladat: minden áramforrásnak saját ismert hurka van, a többi hurokáram ismeretlen.',
  csomoponti: 'Gyakorlati feladat: négy csomópont, n − 1 − nᵤ ismeretlen potenciál, kifolyó áramok összege = 0.',
};

const eq = (n: number) => (n === 0 ? 'egyenletrendszer nélkül' : `${n} egyenlet`);

/**
 * Illik-e a feladat a módszerhez úgy, hogy azzal a legkönnyebb. `relaxed`: a hurokáram és a
 * csomóponti potenciál között a döntetlen is elég (ha szigorúan kevesebb egyenlet nem található).
 */
export function methodFit(m: MethodId, p: Problem, relaxed = false): Fit {
  const usable = applicableMethods(p);
  if (!usable.includes(m)) return { ok: false, why: '' };
  const sources = p.stats.sources;
  // A tanár úr feladattípusai: mindegyik a saját módszeréhez való.
  if (p.topic === 'tanari') return { ok: p.teacherType === m, why: TEACHER_WHY[m] ?? '' };
  switch (m) {
    case 'redukcio':
      return { ok: sources <= 1, why: sources === 0 ? 'Soros-párhuzamos hálózat: elég lépésenként összevonni.' : 'Egy forrás, soros-párhuzamos hálózat: elég összevonni és osztani.' };
    case 'kirchhoff':
      return { ok: p.topic === 'kirchhoff', why: 'Egyetlen csomóponti vagy huroktörvény elég hozzá.' };
    case 'thevenin':
      return { ok: p.topic === 'thevenin', why: 'Egy terhelés a kérdés: a többi rész helyettesíthető egy generátorral.' };
    case 'csillag-delta':
      return { ok: !usable.includes('redukcio'), why: 'Híd: átalakítás nélkül nem vonható össze.' };
    case 'szuperpozicio': {
      // Helyettesítő generátor szuperpozícióval: az A–B üresjárási feszültség forrásonként osztókkal.
      if (p.topic === 'thevenin') {
        const ok = sources >= 2 && solveWith(p, 'szuperpozicio').ok;
        return { ok, why: 'Az A–B kapcsok üresjárási feszültsége forrásonként osztókkal számolható, aztán előjelesen összeadjuk.' };
      }
      // Csillag-deltával: valamelyik részáramkörben híd van (átalakítás, utána osztók).
      if (p.starDelta) {
        const r = solveWith(p, 'szuperpozicio');
        const ok = sources >= 2 && r.ok && r.solution.steps.some((s) => s.title === 'Miért kell átalakítás?');
        return { ok, why: 'Egy részáramkörben híd van: csillag-delta átalakítás kell, utána eredővel és osztókkal megy.' };
      }
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
      const [mine, other] = m === 'hurokaram' ? [h, c] : [c, h];
      const ok = mine < other || (relaxed && mine === other && mine >= 1);
      const name = m === 'hurokaram' ? 'Hurokárammal' : 'Csomóponti potenciállal';
      const otherName = m === 'hurokaram' ? 'csomóponti potenciállal' : 'hurokárammal';
      return { ok, why: mine < other ? `${name} ${eq(mine)}, ${otherName} ${eq(other)}: így a legrövidebb.` : `${name} ${eq(mine)}, ${otherName} is ${eq(other)}: itt egyformán jó, gyakorold így.` };
    }
  }
}
