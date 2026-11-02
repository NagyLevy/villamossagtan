// Pontkód: a becenév és a teljes napi napló (mikor nyitottad, mikor oldottad meg, hibák, tippek)
// egy rövid, másolható kódban, ellenőrzőösszeggel. A kódban NINCS pontszám: a fogadó app maga
// számolja újra a naplóból, és kiszűri a lehetetlen rekordokat (rossz nap, nem létező feladat,
// gyanúsan gyors megoldás). Fiókoktól független ranglista: a kódot (vagy a meghívó linket)
// elküldjük egymásnak. Az ellenőrzőösszeg csak az elírás és a kézi átírás ellen véd, nem titkosítás.

import type { ProgressData } from './progress';
import type { TaskRecord } from './score';
import { DAILY_LEVELS, dailyChallenge, dayKey, daysBetween, type DailyLevel } from './schedule';

/** A publikált app címe (GitHub Pages): a meghívó link ide mutat, a pontkód a # után áll. */
export const SHARE_URL = 'https://nagylevy.github.io/villamossagtan/';

/** Ennél gyorsabb megoldást nem fogadunk el (ms). */
export const MIN_SOLVE_MS = 10_000;

export interface PlayerScore {
  /** Becenév (legfeljebb 24 karakter). */
  name: string;
  /** Véletlen játékosazonosító (így két azonos becenév sem keveredik). */
  id: string;
  /** A kód készítésének ideje (ms). */
  at: number;
  /** A napló (csak az ellenőrzésen átment rekordok). */
  data: ProgressData;
  /** Ennyi rekordot dobott ki az ellenőrzés. */
  dropped: number;
}

const PREFIX = 'VT2';

function checksum(s: string): string {
  // FNV-1a, 32 bit, sózva: a kód tartalmát köti össze az ellenőrzőösszeggel.
  let h = 0x811c9dc5;
  for (const ch of `villamossagtan|${s}`) {
    h ^= ch.codePointAt(0)!;
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

function toBase64Url(s: string): string {
  const bytes = new TextEncoder().encode(s);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(s: string): string {
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/'));
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
}

/** Tömör rekord: [megnyitás (s), megoldás ideje (s, −1 ha nincs), hibák, tippek, jelzők (1 trükk, 2 megoldás)]. */
type Packed = [number, number, number, number, number];

function pack(r: TaskRecord): Packed {
  const opened = Math.round(r.opened / 1000);
  return [opened, r.solvedAt ? Math.round(r.solvedAt / 1000) - opened : -1, r.wrong, r.tips, (r.trick ? 1 : 0) | (r.solution ? 2 : 0)];
}

function unpack(p: Packed): TaskRecord {
  const [o, d, wrong, tips, f] = p;
  return { opened: o * 1000, ...(d >= 0 ? { solvedAt: (o + d) * 1000 } : {}), wrong, tips, trick: !!(f & 1), solution: !!(f & 2) };
}

const LEVEL_IDS = new Set<string>(DAILY_LEVELS.map((l) => l.id));
const nonNegInt = (x: unknown) => Number.isInteger(x) && (x as number) >= 0;

/**
 * Csak a lehetséges rekordok maradnak: létező nap (nem a kód készítése utáni), létező fokozat és feladat,
 * a megnyitás az adott napon történt, a megoldás nem a kód készítése után és nem gyanúsan gyors.
 */
export function sanitize(raw: unknown, at: number): { data: ProgressData; dropped: number } {
  const data: ProgressData = {};
  let dropped = 0;
  if (!raw || typeof raw !== 'object') return { data, dropped };
  const atDay = dayKey(new Date(at));
  for (const [day, levels] of Object.entries(raw as Record<string, unknown>)) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || daysBetween(day, atDay) < 0 || !levels || typeof levels !== 'object') {
      dropped++;
      continue;
    }
    const [y, m, d] = day.split('-').map(Number) as [number, number, number];
    const start = new Date(y, m - 1, d).getTime();
    const end = new Date(y, m - 1, d + 1).getTime();
    for (const [lvl, tasks] of Object.entries(levels as Record<string, unknown>)) {
      if (!LEVEL_IDS.has(lvl) || !tasks || typeof tasks !== 'object') {
        dropped++;
        continue;
      }
      const ids = new Set(dailyChallenge(new Date(y, m - 1, d, 12), lvl as DailyLevel).tasks.map((t) => t.id));
      for (const [task, p] of Object.entries(tasks as Record<string, unknown>)) {
        const ok =
          ids.has(task) &&
          Array.isArray(p) &&
          p.length === 5 &&
          Number.isInteger(p[0]) &&
          Number.isInteger(p[1]) &&
          nonNegInt(p[2]) &&
          nonNegInt(p[3]) &&
          nonNegInt(p[4]);
        const r = ok ? unpack(p as Packed) : null;
        if (!r || r.opened < start - 60_000 || r.opened >= end || (r.solvedAt !== undefined && (r.solvedAt - r.opened < MIN_SOLVE_MS || r.solvedAt > at + 60_000))) {
          dropped++;
          continue;
        }
        ((data[day] ??= {})[lvl as DailyLevel] ??= {})[task] = r;
      }
    }
  }
  return { data, dropped };
}

/** A napló tömör alakja (a pontkód és az online ranglista is ezt viszi; a fogadó a `sanitize`-zal olvassa). */
export function packData(data: ProgressData): Record<string, Record<string, Record<string, Packed>>> {
  const d: Record<string, Record<string, Record<string, Packed>>> = {};
  for (const [day, levels] of Object.entries(data))
    for (const [lvl, tasks] of Object.entries(levels ?? {}))
      for (const [task, r] of Object.entries(tasks ?? {})) ((d[day] ??= {})[lvl] ??= {})[task] = pack(r);
  return d;
}

export function encodeScore(p: { name: string; id: string; at: number; data: ProgressData }): string {
  const body = toBase64Url(JSON.stringify({ n: p.name.slice(0, 24), i: p.id, a: p.at, d: packData(p.data) }));
  return `${PREFIX}.${body}.${checksum(body)}`;
}

export type DecodeResult = { ok: true; score: PlayerScore } | { ok: false; error: string };

export function decodeScore(code: string): DecodeResult {
  const clean = code.trim().replace(/^.*#/, '');
  const parts = clean.split('.');
  if (parts[0] === 'VT1') return { ok: false, error: 'Ez a régi fajta kód: kérj újat (az új kód már a teljes naplót viszi).' };
  if (parts.length !== 3 || parts[0] !== PREFIX) return { ok: false, error: 'Ez nem pontkód (VT2.… alakú kódot vagy meghívó linket várok).' };
  const [, body, sum] = parts as [string, string, string];
  if (checksum(body) !== sum) return { ok: false, error: 'A kód sérült vagy módosították (nem stimmel az ellenőrzőösszeg).' };
  try {
    const o = JSON.parse(fromBase64Url(body)) as { n: string; i: string; a: number; d: unknown };
    if (typeof o.n !== 'string' || typeof o.i !== 'string' || typeof o.a !== 'number') return { ok: false, error: 'Hiányos kód.' };
    if (o.a > Date.now() + 5 * 60_000) return { ok: false, error: 'A kód a jövőből jött (rossz az óra?).' };
    const { data, dropped } = sanitize(o.d, o.a);
    return { ok: true, score: { name: o.n.slice(0, 24), id: o.i, at: o.a, data, dropped } };
  } catch {
    return { ok: false, error: 'A kód nem olvasható.' };
  }
}

/** A meghívó link: megnyitva az app magától felveszi a küldőt a ranglistára. */
export function inviteLink(code: string): string {
  return `${SHARE_URL}#${code}`;
}

// ───────── a saját profil és a barátok kódjai (böngészőben) ─────────

const KEY = 'villamossagtan.league.v2';

export interface League {
  me: { name: string; id: string };
  friends: PlayerScore[];
}

export function loadLeague(): League {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return JSON.parse(raw) as League;
    const old = localStorage.getItem('villamossagtan.league.v1');
    if (old) return { me: (JSON.parse(old) as League).me, friends: [] };
  } catch {
    // A tárolás nem kötelező.
  }
  return { me: { name: '', id: Math.random().toString(36).slice(2, 10) }, friends: [] };
}

export function saveLeague(l: League): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(l));
  } catch {
    // A tárolás nem kötelező.
  }
}

/** Barát kódjának felvétele: azonos játékos újabb kódja felülírja a régit (régebbi kód nem írja felül az újat). */
export function addFriend(l: League, s: PlayerScore): League {
  if (s.id === l.me.id) return l;
  const prev = l.friends.find((f) => f.id === s.id);
  if (prev && prev.at > s.at) return l;
  return { ...l, friends: [...l.friends.filter((f) => f.id !== s.id), s] };
}
