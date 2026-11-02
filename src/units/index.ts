// Mértékegységek, SI-előtagok, magyar számformátum (tizedesvessző), válaszellenőrzés.
// Minden függvény tiszta, a UI-tól független.

export type Unit = 'V' | 'A' | 'Ω' | 'W';

export interface Prefix {
  symbol: string;
  factor: number;
}

/** A megjelenítéshez használt előtagok, növekvő sorrendben. */
export const PREFIXES: readonly Prefix[] = [
  { symbol: 'n', factor: 1e-9 },
  { symbol: 'µ', factor: 1e-6 },
  { symbol: 'm', factor: 1e-3 },
  { symbol: '', factor: 1 },
  { symbol: 'k', factor: 1e3 },
  { symbol: 'M', factor: 1e6 },
];

/** Beíráskor elfogadott előtag-írásmódok (a µ többféle kódpontja és az "u" is). */
const INPUT_PREFIXES: Record<string, number> = {
  n: 1e-9,
  µ: 1e-6, // U+00B5
  μ: 1e-6, // U+03BC
  u: 1e-6,
  m: 1e-3,
  k: 1e3,
  K: 1e3,
  M: 1e6,
};

/** Egységek elfogadott írásmódjai. */
const UNIT_ALIASES: Record<Unit, string[]> = {
  V: ['V', 'v', 'volt'],
  A: ['A', 'a', 'amper'],
  Ω: ['Ω', 'Ω', 'ohm', 'Ohm', 'OHM', 'ohmos'],
  W: ['W', 'w', 'watt'],
};

const MINUS = '−'; // U+2212, tipográfiai mínusz a megjelenítéshez

/** Kerekítés adott számú értékes jegyre, lebegőpontos zaj nélkül. */
export function roundSig(x: number, sig: number): number {
  if (x === 0 || !Number.isFinite(x)) return x;
  return Number(x.toPrecision(sig));
}

/** Szám magyar formátumban: tizedesvessző, felesleges nullák nélkül, legfeljebb `sig` értékes jegy. */
export function formatNumber(x: number, sig = 4): string {
  if (!Number.isFinite(x)) return x > 0 ? '∞' : x < 0 ? `${MINUS}∞` : 'NaN';
  const r = roundSig(x, sig);
  if (Object.is(r, -0) || r === 0) return '0';
  const abs = Math.abs(r);
  // Fix tizedes alak (nem exponenciális), majd a végződő nullák levágása.
  const decimals = Math.max(0, sig - 1 - Math.floor(Math.log10(abs)));
  let s = abs.toFixed(Math.min(decimals, 12));
  if (s.includes('.')) s = s.replace(/0+$/, '').replace(/\.$/, '');
  s = s.replace('.', ',');
  return (r < 0 ? MINUS : '') + s;
}

/** Az előtag kiválasztása: a mantissza 1 és 1000 közé essen. Ohmnál 1 alatt nincs előtag (0,5 Ω, nem 500 mΩ). */
export function choosePrefix(x: number, unit: Unit, sig = 4): Prefix {
  const abs = Math.abs(roundSig(x, sig));
  const unitPrefix = PREFIXES[3]!;
  if (abs === 0 || !Number.isFinite(abs)) return unitPrefix;
  let candidates = PREFIXES;
  if (unit === 'Ω') candidates = PREFIXES.filter((p) => p.factor >= 1);
  let chosen = candidates[0]!;
  for (const p of candidates) {
    // A kerekítés után 1000-re ugró mantisszát is kezeljük (pl. 999,99 mA → 1 A).
    if (roundSig(abs / p.factor, sig) >= 1) chosen = p;
  }
  return chosen;
}

export interface FormatOptions {
  /** Értékes jegyek száma (alapértelmezés: 4). */
  sig?: number;
  /** false esetén nincs előtag, alapegységben írjuk ki. */
  prefix?: boolean;
}

/** Mennyiség kiírása előtaggal: pl. 0.0045, 'A' → "4,5 mA". A szám és az egység közt nem törő szóköz. */
export function formatQuantity(x: number, unit: Unit, opts: FormatOptions = {}): string {
  const sig = opts.sig ?? 4;
  const p = opts.prefix === false ? PREFIXES[3]! : choosePrefix(x, unit, sig);
  return `${formatNumber(x / p.factor, sig)} ${p.symbol}${unit}`;
}

export type ParseResult = { ok: true; value: number } | { ok: false; error: string };

/**
 * Beírt mennyiség értelmezése alapegységre. Elfogadja: "4,5 mA", "0.0045 A", "4,5mA", "−2 V",
 * "2 kΩ", "2 kohm", "4,5 m" (egység nélkül, előtaggal), "1e-3". Ha egység szerepel, egyeznie kell `unit`-tal.
 */
export function parseQuantity(text: string, unit: Unit): ParseResult {
  const s = text.trim().replace(/ /g, ' ').replace(/[−–]/g, '-');
  if (s === '') return { ok: false, error: 'Üres válasz.' };
  const m = /^([+-]?\s*(?:\d+(?:[.,]\d*)?|[.,]\d+)(?:[eE][+-]?\d+)?)\s*(.*)$/.exec(s);
  if (!m) return { ok: false, error: 'Nem számmal kezdődik.' };
  const num = Number(m[1]!.replace(/\s/g, '').replace(',', '.'));
  if (!Number.isFinite(num)) return { ok: false, error: 'Érvénytelen szám.' };
  const rest = m[2]!.trim();
  if (rest === '') return { ok: true, value: num };

  const factor = unitFactor(rest, unit);
  if (factor !== null) return { ok: true, value: num * factor };
  for (const other of Object.keys(UNIT_ALIASES) as Unit[]) {
    if (other !== unit && unitFactor(rest, other) !== null) {
      return { ok: false, error: `Rossz mértékegység: ${unit} kell, nem ${other}.` };
    }
  }
  return { ok: false, error: `Ismeretlen mértékegység: "${rest}".` };
}

/** A szám utáni rész szorzója, ha `unit` egy írásmódja (előtaggal vagy anélkül), vagy csak egy előtag. */
function unitFactor(rest: string, unit: Unit): number | null {
  const aliases = UNIT_ALIASES[unit];
  if (aliases.includes(rest)) return 1;
  for (const [sym, factor] of Object.entries(INPUT_PREFIXES)) {
    if (!rest.startsWith(sym)) continue;
    const tail = rest.slice(sym.length).trim();
    if (tail === '' || aliases.includes(tail)) return factor;
  }
  return null;
}

export interface CheckOptions {
  /** Relatív tűrés (alapértelmezés: 1%). */
  relTol?: number;
  /** Csak a nagyság számít ("…nagyságát"), az előjel nem. */
  magnitudeOnly?: boolean;
}

export type CheckResult =
  | { status: 'correct'; value: number }
  | { status: 'wrong-sign'; value: number }
  | { status: 'wrong'; value: number }
  | { status: 'invalid'; error: string };

/** Válasz ellenőrzése ±1% tűréssel, előtag- és előjelkezeléssel. */
export function checkAnswer(input: string, expected: number, unit: Unit, opts: CheckOptions = {}): CheckResult {
  const parsed = parseQuantity(input, unit);
  if (!parsed.ok) return { status: 'invalid', error: parsed.error };
  const relTol = opts.relTol ?? 0.01;
  const v = parsed.value;
  const close = (a: number, b: number) => Math.abs(a - b) <= relTol * Math.abs(b) + 1e-12;
  if (opts.magnitudeOnly) {
    return close(Math.abs(v), Math.abs(expected)) ? { status: 'correct', value: v } : { status: 'wrong', value: v };
  }
  if (close(v, expected)) return { status: 'correct', value: v };
  if (close(-v, expected) && expected !== 0) return { status: 'wrong-sign', value: v };
  return { status: 'wrong', value: v };
}

export interface Fraction {
  num: number;
  den: number;
}

/** Pontos tört alak keresése (lánctörttel), ha létezik `maxDen` nevezőig; különben null. */
export function toFraction(x: number, maxDen = 1000, tol = 1e-9): Fraction | null {
  if (!Number.isFinite(x)) return null;
  const sign = x < 0 ? -1 : 1;
  let v = Math.abs(x);
  let [h0, h1, k0, k1] = [0, 1, 1, 0];
  for (let i = 0; i < 40; i++) {
    const a = Math.floor(v);
    [h0, h1] = [h1, a * h1 + h0];
    [k0, k1] = [k1, a * k1 + k0];
    if (k1 > maxDen) return null;
    if (Math.abs(Math.abs(x) - h1 / k1) <= tol * Math.max(1, Math.abs(x))) return { num: sign * h1, den: k1 };
    const frac = v - a;
    if (frac < 1e-15) break;
    v = 1 / frac;
  }
  return null;
}

/** "Szép" érték: az előtagos mantissza legfeljebb `decimals` tizedesjegyű. A kerek-eredmény módhoz. */
export function isNiceValue(x: number, unit: Unit, decimals = 1): boolean {
  if (!Number.isFinite(x)) return false;
  if (x === 0) return true;
  const p = choosePrefix(x, unit, 10);
  const m = Math.abs(x / p.factor) * 10 ** decimals;
  return Math.abs(m - Math.round(m)) < 1e-6 * Math.max(1, m);
}

/**
 * Magyar névelő egy kiírt szám elé ("a 6 Ω", "az 5 V", "az 1 A", "az 50 Ω", "az 1000 Ω").
 * A szám kimondott alakjának első hangja dönt: egy, öt, ötven, ötszáz, ezer magánhangzóval kezdődik.
 */
export function articleFor(displayed: string): 'a' | 'az' {
  const m = /\d+/.exec(displayed.replace(/\s/g, ''));
  if (!m) return 'a';
  const digits = m[0].replace(/^0+(?=\d)/, '');
  if (digits === '0') return 'a';
  const d = digits[0]!;
  const pos = digits.length % 3; // 1: egyes, 2: tízes, 0: százas helyiérték a csoportban
  if (pos === 1) return d === '1' || d === '5' ? 'az' : 'a';
  return d === '5' ? 'az' : 'a';
}

/** Egységhez illő toldalék: "Ω-os", "V-os", "A-es", "W-os". */
export function unitSuffix(unit: Unit): string {
  return unit === 'A' ? '-es' : '-os';
}
