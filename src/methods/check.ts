// Táblázatkitöltős feladat ellenőrzése és az ellenőrző nézet adatai. Tiszta függvények.

import type { Problem } from '../generator/generate';
import { valueLabel } from '../generator/questions';
import { kirchhoffCheck, powerSum, solve } from '../solver/analysis';
import { allElements } from '../solver/model';
import { toNetlist } from '../solver/netlist';
import { checkAnswer, type CheckResult } from '../units';
import { applicableMethods, solveWith, type MethodId } from './index';

export interface TableTarget {
  element: string;
  label: string;
  U: number;
  I: number;
  P: number;
}

/** A táblázat helyes értékei (MNA, előjelesen az elem referenciairányában). */
export function tableTargets(p: Problem): TableTarget[] {
  const sol = solve(toNetlist(p.circuit).net)!;
  return allElements(p.circuit)
    .map((el) => {
      const r = sol.elements.get(el.id)!;
      return { element: el.id, label: `${el.id} (${valueLabel(el)})`, U: r.U, I: r.I, P: r.P };
    })
    .sort((a, b) => a.element.localeCompare(b.element, 'hu', { numeric: true }));
}

export type CellKey = 'U' | 'I' | 'P';
const UNIT: Record<CellKey, 'V' | 'A' | 'W'> = { U: 'V', I: 'A', P: 'W' };

/** Egy cella ellenőrzése: ±1% tűrés, előjel számít (referenciairány), nulla értéknél abszolút tűrés. */
export function checkCell(input: string, target: TableTarget, key: CellKey): CheckResult {
  const expected = target[key];
  if (Math.abs(expected) < 1e-9) {
    const r = checkAnswer(input, 1, UNIT[key]);
    if (r.status === 'invalid') return r;
    return Math.abs(r.value) < 1e-6 ? { status: 'correct', value: r.value } : { status: 'wrong', value: r.value };
  }
  return checkAnswer(input, expected, UNIT[key]);
}

export interface VerifyRow {
  questionId: string;
  text: string;
  unit: string | null;
  reference: number;
  /** Módszerenként a módszer saját eredménye (ha válaszol erre a kérdésre). */
  byMethod: Partial<Record<MethodId, number>>;
}

export interface Verification {
  methods: MethodId[];
  rows: VerifyRow[];
  powerSum: number;
  kirchhoffResidual: number;
}

/** Ellenőrző nézet: minden alkalmazható módszer eredménye egymás mellett, plusz MNA-mérlegek. */
export function verify(p: Problem): Verification {
  const methods = applicableMethods(p);
  const results = new Map(methods.map((m) => [m, solveWith(p, m)]));
  const rows: VerifyRow[] = p.questions
    .filter((q) => q.kind !== 'table')
    .map((q) => {
      const byMethod: VerifyRow['byMethod'] = {};
      for (const m of methods) {
        const r = results.get(m)!;
        if (!r.ok) continue;
        const a = r.solution.answers.find((x) => x.questionId === q.id);
        if (a) byMethod[m] = a.value;
      }
      return { questionId: q.id, text: q.text, unit: q.unit, reference: q.answer, byMethod };
    });
  const net = toNetlist(p.circuit).net;
  const sol = solve(net)!;
  return { methods, rows, powerSum: powerSum(sol), kirchhoffResidual: kirchhoffCheck(net, sol.elements).maxResidual };
}
