// Felhasználói beállítások, böngészőben (localStorage) tárolva. Ha a tároló nem elérhető
// (privát ablak, tiltott tárolás), az alapértékekkel működik tovább.

import type { Topic } from '../generator/generate';
import type { Level } from '../generator/values';

import type { DailyLevel } from '../daily/schedule';
import type { MethodId } from '../methods/types';

export type { MethodId };
export type StarDeltaMode = 'delta-csillag' | 'csillag-delta' | 'veletlen';
export type ThemeChoice = 'system' | 'light' | 'dark';

export interface Settings {
  topic: Topic;
  level: Level;
  method: MethodId;
  starDelta: boolean;
  starDeltaMode: StarDeltaMode;
  theme: ThemeChoice;
  speed: number;
  /** Gyakorló: a megoldás bármikor megnézhető; vizsga: csak beadás után. */
  mode: 'gyakorlo' | 'vizsga';
  examTimer: boolean;
  /** Napi kihívás mód és a választott nehézség. */
  dailyActive: boolean;
  dailyLevel: DailyLevel;
}

export const DEFAULT_SETTINGS: Settings = {
  topic: 'oszto',
  level: 'alapozo',
  method: 'hurokaram',
  starDelta: false,
  starDeltaMode: 'veletlen',
  theme: 'system',
  speed: 1,
  mode: 'gyakorlo',
  examTimer: true,
  dailyActive: true,
  dailyLevel: 'kozepes',
};

const KEY = 'villamossagtan.settings.v1';

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    return { ...DEFAULT_SETTINGS, ...(JSON.parse(raw) as Partial<Settings>) };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(s: Settings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    // A tárolás nem kötelező: enélkül is működik az app.
  }
}

export interface MethodInfo {
  id: MethodId;
  label: string;
  badge?: string;
}

/** A módszerek sorrendje a menüben: a csomóponti potenciál a végén, "most tanulom" jelöléssel. */
export function methodList(starDelta: boolean): MethodInfo[] {
  return [
    { id: 'redukcio', label: 'Redukció' },
    { id: 'kirchhoff', label: 'Kirchhoff' },
    { id: 'hurokaram', label: 'Hurokáram' },
    { id: 'szuperpozicio', label: 'Szuperpozíció' },
    { id: 'thevenin', label: 'Thevenin' },
    ...(starDelta ? [{ id: 'csillag-delta' as const, label: 'Csillag-delta' }] : []),
    { id: 'csomoponti', label: 'Csomóponti', badge: 'most tanulom' },
  ];
}
