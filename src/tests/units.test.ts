import { describe, expect, it } from 'vitest';
import { articleFor, checkAnswer, formatNumber, formatQuantity, isNiceValue, parseQuantity, toFraction } from '../units';

const NB = ' ';

describe('formatQuantity: automatikus SI-előtag, tizedesvessző', () => {
  it.each([
    [0.0045, 'A', `4,5${NB}mA`],
    [4700, 'Ω', `4,7${NB}kΩ`],
    [1.5e6, 'Ω', `1,5${NB}MΩ`],
    [0.5, 'Ω', `0,5${NB}Ω`],
    [-2, 'V', `−2${NB}V`],
    [2e-6, 'A', `2${NB}µA`],
    [0.9999999, 'A', `1${NB}A`],
    [0.00099999999, 'A', `1${NB}mA`],
    [12, 'W', `12${NB}W`],
    [0, 'V', `0${NB}V`],
    [1 / 3, 'V', `333,3${NB}mV`],
  ] as const)('%s %s → %s', (x, unit, out) => {
    expect(formatQuantity(x, unit)).toBe(out);
  });

  it('lebegőpontos zajt nem mutat', () => {
    expect(formatNumber(0.1 + 0.2)).toBe('0,3');
    expect(formatNumber(2.9999999999)).toBe('3');
  });
});

describe('parseQuantity: egyenértékű alakok', () => {
  it.each([
    ['4,5 mA', 'A', 0.0045],
    ['0,0045 A', 'A', 0.0045],
    ['0.0045A', 'A', 0.0045],
    ['4.5mA', 'A', 0.0045],
    ['4,5 m', 'A', 0.0045],
    ['−2 V', 'V', -2],
    ['-2', 'V', -2],
    ['2 kΩ', 'Ω', 2000],
    ['2 kohm', 'Ω', 2000],
    ['2k', 'Ω', 2000],
    ['3 MΩ', 'Ω', 3e6],
    ['2 µA', 'A', 2e-6],
    ['2 μA', 'A', 2e-6],
    ['2 uA', 'A', 2e-6],
    ['1e-3 A', 'A', 0.001],
    ['15 W', 'W', 15],
  ] as const)('"%s" (%s) → %s', (text, unit, value) => {
    const r = parseQuantity(text, unit);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toBeCloseTo(value, 15);
  });

  it('rossz mértékegységet jelez', () => {
    const r = parseQuantity('4,5 V', 'A');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/Rossz mértékegység/);
  });

  it('értelmetlen bemenetet elutasít', () => {
    expect(parseQuantity('', 'A').ok).toBe(false);
    expect(parseQuantity('abc', 'A').ok).toBe(false);
    expect(parseQuantity('5 xyz', 'A').ok).toBe(false);
  });
});

describe('checkAnswer: ±1% tűrés, előjel, nagyság', () => {
  it('elfogadja az egyenértékű alakokat', () => {
    expect(checkAnswer('4,5 mA', 0.0045, 'A').status).toBe('correct');
    expect(checkAnswer('0,0045 A', 0.0045, 'A').status).toBe('correct');
    expect(checkAnswer('4,54 mA', 0.0045, 'A').status).toBe('correct');
  });
  it('1%-on kívül hibás', () => {
    expect(checkAnswer('4,6 mA', 0.0045, 'A').status).toBe('wrong');
  });
  it('előjeles kérdésnél az irány számít', () => {
    expect(checkAnswer('-2 A', 2, 'A').status).toBe('wrong-sign');
    expect(checkAnswer('-2 A', -2, 'A').status).toBe('correct');
  });
  it('"nagyságát" kérdésnél csak az abszolút érték', () => {
    expect(checkAnswer('2 A', -2, 'A', { magnitudeOnly: true }).status).toBe('correct');
    expect(checkAnswer('-2 A', 2, 'A', { magnitudeOnly: true }).status).toBe('correct');
  });
  it('hibás egységnél érvénytelen', () => {
    expect(checkAnswer('2 V', 2, 'A').status).toBe('invalid');
  });
});

describe('toFraction', () => {
  it('pontos tört alak', () => {
    expect(toFraction(1 / 3)).toEqual({ num: 1, den: 3 });
    expect(toFraction(0.1 + 0.2)).toEqual({ num: 3, den: 10 });
    expect(toFraction(-7 / 4)).toEqual({ num: -7, den: 4 });
    expect(toFraction(5)).toEqual({ num: 5, den: 1 });
  });
  it('irracionálisnál null', () => {
    expect(toFraction(Math.PI, 100)).toBeNull();
  });
});

describe('isNiceValue', () => {
  it('kerek értékek', () => {
    expect(isNiceValue(2.5, 'A')).toBe(true);
    expect(isNiceValue(0.0045, 'A')).toBe(true);
    expect(isNiceValue(1 / 3, 'A')).toBe(false);
  });
});

describe('articleFor: magyar névelő a kimondott szám szerint', () => {
  it.each([
    ['1 Ω', 'az'],
    ['5 V', 'az'],
    ['6 Ω', 'a'],
    ['10 Ω', 'a'],
    ['11 Ω', 'a'],
    ['15 Ω', 'a'],
    ['50 Ω', 'az'],
    ['100 Ω', 'a'],
    ['500 Ω', 'az'],
    ['1000 Ω', 'az'],
    ['0,5 A', 'a'],
    ['1,5 A', 'az'],
    ['4,7 kΩ', 'a'],
  ] as const)('%s → %s', (s, art) => {
    expect(articleFor(s)).toBe(art);
  });
});
