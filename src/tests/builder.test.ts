// Áramkör-építő: a rácsra tett elemekből feladat lesz, és minden alkalmazható módszer az MNA-val egyező
// eredményt ad. A hibás rajzokra érthető üzenet jön, nem kivétel.
import { describe, expect, it } from 'vitest';
import { buildProblem, exampleBoard, type Board, type Part } from '../builder/model';
import { applicableMethods, solveWith } from '../methods';
import { solve } from '../solver/analysis';
import { toNetlist } from '../solver/netlist';

const W: Part = { kind: 'W', value: 0, dir: 1 };
const R = (value: number): Part => ({ kind: 'R', value, dir: 1 });
const V = (value: number, dir: 1 | -1 = -1): Part => ({ kind: 'V', value, dir });
const I = (value: number, dir: 1 | -1 = -1): Part => ({ kind: 'I', value, dir });
const board = (parts: Record<string, Part>): Board => ({ cols: 7, rows: 4, parts });

/** Minden alkalmazható módszer válaszai és elemértékei egyeznek az MNA-val. */
function checkAll(b: Board, expectMethods: string[]) {
  const r = buildProblem(b);
  if (!r.ok) throw new Error(r.reason);
  const p = r.problem;
  const ref = solve(toNetlist(p.circuit).net)!;
  const methods = applicableMethods(p);
  for (const m of expectMethods) expect(methods, `hiányzó módszer: ${m}`).toContain(m);
  for (const m of methods) {
    const s = solveWith(p, m);
    if (!s.ok) throw new Error(s.reason);
    for (const a of s.solution.answers) expect(a.value, `${m} ${a.questionId}`).toBeCloseTo(p.questions.find((q) => q.id === a.questionId)!.answer, 8);
    for (const [id, v] of s.solution.values ?? []) {
      expect(v.I).toBeCloseTo(ref.elements.get(id)!.I, 8);
      expect(v.U).toBeCloseTo(ref.elements.get(id)!.U, 8);
    }
  }
  return { p, methods };
}

describe('áramkör-építő', () => {
  it('a kezdő példa: egy forrás, soros-párhuzamos; redukció és egyenletrendszer is megoldja', () => {
    const { p } = checkAll(exampleBoard(), ['redukcio', 'kirchhoff', 'hurokaram', 'csomoponti']);
    expect(p.stats).toEqual({ meshes: 2, resistors: 3, sources: 1 });
    // 12 V, 4 Ω + (6 Ω × 3 Ω = 2 Ω): a forrás árama 2 A.
    const i4 = p.questions.find((q) => q.target === 'R4')!.answer;
    expect(Math.abs(i4)).toBeCloseTo(2, 9);
  });

  it('két forrás, két ablak: hurokáram, csomóponti, szuperpozíció', () => {
    checkAll(
      board({ 'v:0:0': V(10), 'h:0:0': R(2), 'v:1:0': R(8), 'h:1:0': R(4), 'v:2:0': V(6), 'h:0:1': W, 'h:1:1': W }),
      ['kirchhoff', 'hurokaram', 'csomoponti', 'szuperpozicio'],
    );
  });

  it('áramforrással és azonos értékű ellenállásokkal (sorszámozott nevek)', () => {
    const { p } = checkAll(board({ 'v:0:0': I(2), 'h:0:0': R(5), 'v:1:0': R(5), 'h:1:0': R(5), 'v:2:0': R(10), 'h:0:1': W, 'h:1:1': W }), ['hurokaram', 'csomoponti']);
    expect(p.questions.filter((q) => q.kind === 'I').map((q) => q.target)).toEqual(['R1', 'R2', 'R3', 'R4']);
  });

  it('híd (nem soros-párhuzamos) is megoldható', () => {
    checkAll(
      board({ 'v:0:0': V(12), 'v:0:1': W, 'h:0:0': R(1), 'h:1:0': R(2), 'v:1:0': R(3), 'v:1:1': R(4), 'v:2:0': R(5), 'v:2:1': R(6), 'h:0:2': W, 'h:1:2': W, 'h:1:1': R(7) }),
      ['hurokaram', 'csomoponti'],
    );
  });

  it('a lógó vég kimarad, a többi kiszámolódik', () => {
    const b = exampleBoard();
    b.parts['h:3:1'] = R(100);
    b.parts['h:4:1'] = W;
    const r = buildProblem(b);
    expect(r.ok).toBe(true);
    expect(r.dangling.sort()).toEqual(['h:3:1', 'h:4:1']);
    if (r.ok) expect(r.problem.stats.resistors).toBe(3);
  });

  it('hibás rajzokra érthető üzenet jön', () => {
    expect(buildProblem(board({}))).toMatchObject({ ok: false });
    // Nincs forrás.
    expect(buildProblem(board({ 'h:0:0': R(1), 'v:0:0': W, 'v:1:0': W, 'h:0:1': R(2) }))).toMatchObject({ ok: false, reason: expect.stringContaining('nincs forrás') });
    // Rövidre zárt ellenállás: mindkét vége ugyanazon a vezetéken.
    const short = buildProblem(board({ 'v:0:0': V(5), 'h:0:0': R(1), 'v:1:0': R(2), 'h:0:1': W, 'h:1:0': W, 'v:2:0': W, 'h:1:1': W }));
    expect(short.ok).toBe(false);
    // Két feszültségforrás párhuzamosan: nem számolható.
    const par = buildProblem(board({ 'v:0:0': V(5), 'h:0:0': W, 'v:1:0': V(7), 'h:0:1': W, 'h:1:0': R(1), 'v:2:0': W, 'h:1:1': W }));
    expect(par.ok).toBe(false);
    // Két külön kör.
    const two = buildProblem(board({ 'v:0:0': V(5), 'h:0:0': R(1), 'v:1:0': W, 'h:0:1': W, 'v:3:0': V(5), 'h:3:0': R(1), 'v:4:0': W, 'h:3:1': W }));
    expect(two).toMatchObject({ ok: false, reason: expect.stringContaining('külön') });
  });
});
