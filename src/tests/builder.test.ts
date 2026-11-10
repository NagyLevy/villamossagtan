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
    // A példa elemei sorszámozottak: R1 = 4 Ω.
    const i4 = p.questions.find((q) => q.target === 'R1')!.answer;
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

describe('áramkör-építő: átlós (keresztbe tett) elemek', () => {
  it('átlós ellenállás mindkét irányban: minden alkalmazható módszer = MNA', () => {
    // Négyzet: bal oldalon forrás, fent és jobbra ellenállás, alul vezeték, az átlóban ellenállás.
    for (const diag of ['d:0:0', 'u:0:0']) {
      const { p } = checkAll(board({ 'v:0:0': V(12), 'h:0:0': R(2), 'v:1:0': R(6), 'h:0:1': W, [diag]: R(3) }), ['hurokaram', 'csomoponti']);
      expect(p.stats.resistors).toBe(3);
    }
  });

  it('átlós vezeték és átlós forrás is működik', () => {
    checkAll(board({ 'd:0:0': V(9), 'h:0:0': R(3), 'v:1:0': R(6), 'u:1:0': W, 'h:1:0': R(4) }), ['csomoponti']);
  });

  it('két egymást keresztező átló: üzenet, nem számolás', () => {
    const r = buildProblem(board({ 'v:0:0': V(12), 'h:0:0': R(2), 'v:1:0': R(6), 'h:0:1': W, 'd:0:0': R(3), 'u:0:0': R(4) }));
    expect(r).toMatchObject({ ok: false, reason: expect.stringContaining('keresztezi') });
  });
});

describe('áramkör-építő: végtelen tábla', () => {
  it('negatív és nagy koordinátákon ugyanaz az eredmény', () => {
    const shift = (b: Board, dx: number, dy: number): Board => ({
      ...b,
      parts: Object.fromEntries(
        Object.entries(b.parts).map(([k, v]) => {
          const [o, x, y] = k.split(':');
          return [`${o}:${Number(x) + dx}:${Number(y) + dy}`, v];
        }),
      ),
    });
    const base = buildProblem(exampleBoard());
    for (const [dx, dy] of [[-5, -3], [40, 25], [-1, 0]] as const) {
      const moved = buildProblem(shift(exampleBoard(), dx, dy));
      expect(moved.ok).toBe(true);
      if (base.ok && moved.ok) expect(moved.problem.questions.map((q) => q.answer)).toEqual(base.problem.questions.map((q) => q.answer));
    }
    checkAll(shift(exampleBoard(), -7, -2), ['redukcio', 'kirchhoff']);
  });
});

describe('áramkör-építő: sorszámozás a letevés sorrendjében', () => {
  it('a név a sorszámból jön (R1, R2 …), nem az értékből vagy a helyből; az új elem a legkisebb szabad számot kapja', async () => {
    const { nextNumber, numberParts, partName } = await import('../builder/model');
    const b = board({ 'v:0:0': { ...V(12), n: 1 }, 'h:0:0': { ...R(7), n: 3 }, 'v:1:0': { ...R(7), n: 1 }, 'h:0:1': W });
    const r = buildProblem(b);
    if (!r.ok) throw new Error(r.reason);
    expect(r.names.get('h:0:0')).toBe('R3');
    expect(r.names.get('v:1:0')).toBe('R1');
    expect(r.names.get('v:0:0')).toBe('Ug1');
    expect(nextNumber(b, 'R')).toBe(2);
    // Régi mentés sorszám nélkül: pótlódik, a meglévők nem változnak.
    b.parts['h:1:0'] = R(5);
    numberParts(b);
    expect(partName(b.parts['h:1:0']!)).toBe('R2');
    expect(partName(b.parts['h:0:0']!)).toBe('R3');
    checkAll(b, ['redukcio']);
  });
});

describe('áramkör-építő: kézi átszámozás', () => {
  it('szabad számra átír, foglalt számnál a két elem számot cserél; a források külön számozódnak', async () => {
    const { partName, renumber } = await import('../builder/model');
    const b = board({ 'v:0:0': { ...V(12), n: 1 }, 'h:0:0': { ...R(2), n: 1 }, 'v:1:0': { ...R(6), n: 2 }, 'h:0:1': W });
    expect(renumber(b, 'h:0:0', 5)).toBe(true);
    expect(partName(b.parts['h:0:0']!)).toBe('R5');
    // Csere: R5 ↔ R2.
    expect(renumber(b, 'v:1:0', 5)).toBe(true);
    expect([partName(b.parts['h:0:0']!), partName(b.parts['v:1:0']!)]).toEqual(['R2', 'R5']);
    // A forrás száma független az ellenállásokétól.
    expect(renumber(b, 'v:0:0', 2)).toBe(true);
    expect(partName(b.parts['v:0:0']!)).toBe('Ug2');
    // Érvénytelen szám és vezeték: nem változik semmi.
    expect(renumber(b, 'h:0:0', 0)).toBe(false);
    expect(renumber(b, 'h:0:0', 1.5)).toBe(false);
    expect(renumber(b, 'h:0:1', 3)).toBe(false);
    const r = buildProblem(b);
    if (!r.ok) throw new Error(r.reason);
    expect([...r.names.values()].sort()).toEqual(['R2', 'R5', 'Ug2']);
    checkAll(b, ['redukcio']);
  });
});
