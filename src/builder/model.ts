// Áramkör-építő: a felhasználó egy rács éleire tesz elemeket (ellenállás, feszültség- és áramforrás, vezeték).
// Ebből készül a rajzolható Circuit, és belőle egy „feladat” (Problem), amelyet a meglévő megoldási módszerek
// ugyanúgy végigszámolnak, mint a generált feladatokat. Itt nincs felület, csak a modell és az ellenőrzés.

import { meshes } from '../methods/engine';
import { askElementI, questionId, type Question } from '../generator/questions';
import type { Problem } from '../generator/generate';
import { finalize } from '../generator/sketch';
import { solve } from '../solver/analysis';
import type { Branch, Circuit, CircuitElement } from '../solver/model';
import { allElements } from '../solver/model';
import { toNetlist, UnionFind } from '../solver/netlist';

export type PartKind = 'W' | 'R' | 'V' | 'I';

export interface Part {
  kind: PartKind;
  /** Ω, V vagy A (vezetéknél nem számít). */
  value: number;
  /** Forrás iránya az él bal→jobb / fent→lent irányához képest (lásd CircuitElement.dir). */
  dir: 1 | -1;
  /** Sorszám a letevés sorrendjében, fajtánként (R1, R2 …; Ug1 …; Ig1 …). A név ebből jön, és áthelyezéskor megmarad. */
  n?: number;
}

const NAME_PREFIX: Record<PartKind, string> = { W: '', R: 'R', V: 'Ug', I: 'Ig' };

/** Az elem neve a sorszámából (R3, Ug1 …); vezetéknek és sorszám nélküli (régi) elemnek nincs. */
export function partName(part: Part): string | null {
  return part.kind === 'W' || !part.n ? null : `${NAME_PREFIX[part.kind]}${part.n}`;
}

/** A következő szabad sorszám az adott fajtából (a legkisebb, ami még nincs használatban). */
export function nextNumber(board: Board, kind: PartKind): number {
  const used = new Set(Object.values(board.parts).filter((p) => p.kind === kind).map((p) => p.n));
  let n = 1;
  while (used.has(n)) n++;
  return n;
}

/** Sorszám nélküli elemek (régi mentés) pótlása; a meglévő sorszámok nem változnak. */
export function numberParts(board: Board): void {
  for (const part of Object.values(board.parts)) if (part.kind !== 'W' && !part.n) part.n = nextNumber(board, part.kind);
}

/**
 * Él kulcsa: "h:x:y" az (x, y) → (x+1, y), "v:x:y" az (x, y) → (x, y+1) szakasz; átlósan (45°) "d:x:y" az
 * (x, y) → (x+1, y+1), "u:x:y" az (x, y+1) → (x+1, y) szakasz (mindkettő az (x, y) sarkú cellában).
 * Az első végpont mindig a bal oldali (függőlegesnél a felső), ahogy a rajzoló várja.
 */
export type EdgeKey = string;

export interface Board {
  /** Régi mentésekből maradt méret; a tábla végtelen, a számolás nem használja. */
  cols: number;
  rows: number;
  parts: Record<EdgeKey, Part>;
}

export const DEFAULT_VALUE: Record<PartKind, number> = { W: 0, R: 10, V: 12, I: 1 };

export function edgeEnds(key: EdgeKey): [[number, number], [number, number]] {
  const [o, xs, ys] = key.split(':');
  const x = Number(xs);
  const y = Number(ys);
  if (o === 'h') return [[x, y], [x + 1, y]];
  if (o === 'v') return [[x, y], [x, y + 1]];
  if (o === 'd') return [[x, y], [x + 1, y + 1]];
  return [[x, y + 1], [x + 1, y]];
}

export function edgeKey(a: [number, number], b: [number, number]): EdgeKey | null {
  const dx = Math.abs(b[0] - a[0]);
  const dy = Math.abs(b[1] - a[1]);
  if (dx + dy === 1) return dy === 0 ? `h:${Math.min(a[0], b[0])}:${a[1]}` : `v:${a[0]}:${Math.min(a[1], b[1])}`;
  if (dx !== 1 || dy !== 1) return null;
  const [left, right] = a[0] < b[0] ? [a, b] : [b, a];
  return left[1] < right[1] ? `d:${left[0]}:${left[1]}` : `u:${left[0]}:${right[1]}`;
}

/** Ugyanannak a cellának a másik átlója (a kettő keresztezné egymást), ha az él átlós. */
export function crossingKey(key: EdgeKey): EdgeKey | null {
  const [o, x, y] = key.split(':');
  return o === 'd' ? `u:${x}:${y}` : o === 'u' ? `d:${x}:${y}` : null;
}

export type BuildResult =
  | { ok: true; problem: Problem; /** Él → az elem neve (R10, Ug1 …). */ names: Map<EdgeKey, string>; /** Kihagyott, sehová nem vezető (lógó) szakaszok. */ dangling: EdgeKey[] }
  | { ok: false; reason: string; dangling: EdgeKey[] };

/** A lógó végek (ahol egy pontba csak egy szakasz fut): ezeken nem folyhat áram, a számolásból kimaradnak. */
function prune(parts: Map<EdgeKey, Part>): EdgeKey[] {
  const removed: EdgeKey[] = [];
  for (;;) {
    const degree = new Map<string, number>();
    for (const k of parts.keys()) for (const p of edgeEnds(k)) degree.set(p.join(','), (degree.get(p.join(',')) ?? 0) + 1);
    const loose = [...parts.keys()].filter((k) => edgeEnds(k).some((p) => degree.get(p.join(',')) === 1));
    if (!loose.length) return removed;
    for (const k of loose) {
      parts.delete(k);
      removed.push(k);
    }
  }
}

export function buildProblem(board: Board): BuildResult {
  const parts = new Map(Object.entries(board.parts));
  const dangling = prune(parts);
  const fail = (reason: string): BuildResult => ({ ok: false, reason, dangling });
  const kinds = [...parts.values()].map((p) => p.kind);
  const crossed = [...parts.keys()].find((k) => k.startsWith('d:') && parts.has(crossingKey(k)!));
  if (crossed) return fail('Két átlós szakasz keresztezi egymást ugyanabban a négyzetben: az egyiket vedd ki (a keresztezés nem csatlakozás).');
  if (!parts.size) return fail('Húzz elemeket a rácsra, és kösd össze őket vezetékkel úgy, hogy zárt kört alkossanak.');
  if (!kinds.some((k) => k === 'V' || k === 'I')) return fail('A zárt körben nincs forrás: tegyél bele feszültség- vagy áramforrást.');
  if (!kinds.includes('R')) return fail('A zárt körben nincs ellenállás: tegyél bele legalább egyet.');

  // Pontok (a rajzoló 2 rácsegységnyi élekkel dolgozik, mint a generált feladatoknál).
  // A rajztábla végtelen (a koordináták negatívak is lehetnek): a használt rész bal felső sarkához igazítunk.
  const all = [...parts.keys()].flatMap((k) => edgeEnds(k));
  const minX = Math.min(...all.map((p) => p[0]));
  const minY = Math.min(...all.map((p) => p[1]));
  const width = Math.max(...all.map((p) => p[0])) - minX + 1;
  const pid = (p: [number, number]) => (p[1] - minY) * width + (p[0] - minX);
  const used = new Map<number, [number, number]>();
  for (const k of parts.keys()) for (const p of edgeEnds(k)) used.set(pid(p), p);
  const uf = new UnionFind(Math.max(...used.keys()) + 1);
  for (const k of parts.keys()) {
    const [a, b] = edgeEnds(k);
    uf.union(pid(a), pid(b));
  }
  if (new Set([...used.keys()].map((i) => uf.find(i))).size > 1) return fail('Két külön áramkör van a rajzon: kösd össze őket, vagy töröld az egyiket.');

  const branches: (Branch & { key: EdgeKey })[] = [...parts.entries()].map(([key, part]) => {
    const [a, b] = edgeEnds(key);
    const el: CircuitElement | null = part.kind === 'W' ? null : { id: '', kind: part.kind, value: part.value, dir: part.kind === 'R' ? 1 : part.dir };
    return { id: '', key, from: pid(a), to: pid(b), elements: el ? [el] : [] };
  });
  const raw: Circuit = { points: [...used.entries()].map(([id, [x, y]]) => ({ id, x: (x - minX) * 2, y: (y - minY) * 2 })), branches };
  const circuit = finalize(raw);
  // Nevek: ha minden elemnek van (egyedi) sorszáma, a név a letevés sorrendjét követi (R1, R2 …); különben marad
  // a rajzoló szokásos elnevezése (érték szerint, vagy olvasási sorrendben).
  const own = [...parts.values()].map((p) => partName(p)).filter((x): x is string => x !== null);
  const numbered = own.length === kinds.filter((k) => k !== 'W').length && new Set(own).size === own.length;
  const names = new Map<EdgeKey, string>();
  for (const b of circuit.branches) {
    const src = branches.find((x) => x.from === b.from && x.to === b.to)!;
    if (!b.elements[0]) continue;
    if (numbered) b.elements[0].id = partName(parts.get(src.key)!)!;
    names.set(src.key, b.elements[0].id);
  }

  const map = toNetlist(circuit);
  const shorted = map.net.elements.filter((e) => e.a === e.b).map((e) => e.id);
  if (shorted.length)
    return fail(`${shorted.join(', ')} mindkét vége ugyanarra a vezetékre csatlakozik (rövidre van zárva): vedd ki a ${shorted.length > 1 ? 'mellettük' : 'mellette'} futó vezetéket.`);
  let sol: ReturnType<typeof solve> = null;
  try {
    sol = solve(map.net);
  } catch {
    sol = null;
  }
  const finite = sol && [...sol.elements.values()].every((v) => Number.isFinite(v.U) && Number.isFinite(v.I));
  if (!sol || !finite)
    return fail('Ez az áramkör nem számolható ki egyértelműen. Gyakori ok: két feszültségforrás párhuzamosan (vagy vezetékkel rövidre zárva), vagy két áramforrás sorosan.');

  const els = allElements(circuit);
  const resistors = els.filter((e) => e.kind === 'R');
  const questions: Question[] = [
    { id: questionId(), kind: 'table', text: 'Minden elem feszültsége, árama és teljesítménye.', unit: null, answer: NaN, magnitudeOnly: false },
    ...resistors.map((e) => askElementI(circuit, e, sol!.elements.get(e.id)!.I, false)),
  ];
  let meshCount = 0;
  try {
    meshCount = meshes(circuit, map).length;
  } catch {
    meshCount = 0;
  }
  const problem: Problem = {
    seed: 'SAJÁT',
    topic: 'halozat',
    level: 'kozepes',
    topology: 'egyedi',
    circuit,
    questions,
    stats: { meshes: meshCount, resistors: resistors.length, sources: els.length - resistors.length },
    attempts: 1,
  };
  return { ok: true, problem, names, dangling };
}

/** Kezdő példa: feszültségforrás, két soros ellenállás, a másodikkal párhuzamosan egy harmadik. */
export function exampleBoard(cols = 7, rows = 4): Board {
  const parts: Record<EdgeKey, Part> = {
    'v:1:1': { kind: 'V', value: 12, dir: -1, n: 1 },
    'h:1:1': { kind: 'R', value: 4, dir: 1, n: 1 },
    'h:2:1': { kind: 'W', value: 0, dir: 1 },
    'v:2:1': { kind: 'R', value: 6, dir: 1, n: 2 },
    'v:3:1': { kind: 'R', value: 3, dir: 1, n: 3 },
    'h:1:2': { kind: 'W', value: 0, dir: 1 },
    'h:2:2': { kind: 'W', value: 0, dir: 1 },
  };
  return { cols: Math.max(4, cols), rows: Math.max(3, rows), parts };
}
