// A napi feladat konkrét áramköre. Ugyanaz a nap és fokozat mindenkinél ugyanazt adja.
// Szuperpozíciós feladatnál addig próbálunk (determinisztikusan, a seed végére írt sorszámmal),
// amíg minden részáramkör megoldható csak eredővel, feszültség- és áramosztással.

import { generateProblem, type Problem } from '../generator/generate';
import { superpositionByDividers } from '../methods/superposition';
import type { DailyTask } from './schedule';

export function dailyProblem(t: DailyTask): Problem {
  const make = (seed: string) => generateProblem({ seed, topic: t.topic, level: t.level, zhType: t.zhType });
  if (t.method !== 'szuperpozicio') return make(t.seed);
  for (let i = 0; i < 40; i++) {
    const p = make(i === 0 ? t.seed : `${t.seed}~${i}`);
    if (superpositionByDividers(p)) return p;
  }
  return make(t.seed);
}
