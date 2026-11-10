// Módszerek nyilvántartása: melyik feladatra melyik alkalmazható, és a megoldás előállítása.

import type { Problem } from '../generator/generate';
import { solveKirchhoff, type KirchhoffOptions } from './kirchhoff';
import { solveLoopCurrent } from './loopcurrent';
import { solveNodalMethod } from './nodal';
import { solveOhm } from './ohm';
import { solveRealSource } from './realsource';
import { solveStarDelta, type StarDeltaOptions } from './stardelta';
import { solveByReduction } from './reduction';
import { solveSuperposition } from './superposition';
import { solveThevenin } from './thevenin';
import type { MethodId, MethodResult } from './types';

export type { MethodId, MethodResult, Solution, Step, Highlight } from './types';

export interface SolveOptions extends KirchhoffOptions, StarDeltaOptions {}

export function solveWith(p: Problem, method: MethodId, opts: SolveOptions = {}): MethodResult {
  switch (method) {
    case 'redukcio':
      if (p.topic === 'ohm') return solveOhm(p);
      if (p.topic === 'valodi-gen') return solveRealSource(p);
      return solveByReduction(p);
    case 'kirchhoff':
      return solveKirchhoff(p, opts);
    case 'hurokaram':
      return solveLoopCurrent(p);
    case 'csomoponti':
      return solveNodalMethod(p);
    case 'szuperpozicio':
      return solveSuperposition(p);
    case 'thevenin':
      return solveThevenin(p);
    case 'csillag-delta':
      return solveStarDelta(p, opts);
  }
}

const ALL: MethodId[] = ['redukcio', 'kirchhoff', 'hurokaram', 'szuperpozicio', 'thevenin', 'csillag-delta', 'csomoponti'];

/** Az adott feladatra alkalmazható módszerek, a menü sorrendjében. */
export function applicableMethods(p: Problem): MethodId[] {
  return ALL.filter((m) => {
    // Saját (építőben rajzolt) áramkörnél egy módszer váratlan elrendezésen el is hasalhat: az nem alkalmazható.
    let r: MethodResult;
    try {
      r = solveWith(p, m);
    } catch {
      return false;
    }
    // Csak az számít alkalmazhatónak, ami legalább egy kérdésre választ ad.
    return r.ok && (r.solution.answers.length > 0 || p.questions.every((q) => q.kind === 'table'));
  });
}
