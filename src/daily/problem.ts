// A napi egyenáramú feladat konkrét áramköre. Ugyanaz a nap és fokozat mindenkinél ugyanazt adja.
// Szuperpozíciós feladatnál addig próbálunk (determinisztikusan, a seed végére írt sorszámmal),
// amíg minden részáramkör megoldható csak eredővel, feszültség- és áramosztással.

import { generateProblem, type Problem } from '../generator/generate';
import { superpositionByDividers } from '../methods/superposition';
import type { DailyTask } from './schedule';

export function dailyProblem(t: DailyTask): Problem {
  const d = t.dc!;
  const make = (seed: string) => generateProblem({ seed, topic: d.topic, level: d.level, zhType: d.zhType, starDelta: d.topic === 'csillag-delta' });
  if (d.method !== 'szuperpozicio') return make(t.seed);
  for (let i = 0; i < 40; i++) {
    const p = make(i === 0 ? t.seed : `${t.seed}~${i}`);
    if (superpositionByDividers(p)) return p;
  }
  return make(t.seed);
}
