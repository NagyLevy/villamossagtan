// Felhasználói beállítások, böngészőben (localStorage) tárolva. Ha a tároló nem elérhető
// (privát ablak, tiltott tárolás), az alapértékekkel működik tovább.

import type { Topic } from '../generator/generate';
import type { Level } from '../generator/values';
import type { AcLevel, AcTopic } from '../ac/problems';
import type { DailyLevel } from '../daily/schedule';
import type { MethodId } from '../methods/types';
import { DC_TOPICS, type ExamKind } from '../tasks';
import type { Domain } from '../tasks/types';

export type { MethodId };
export type StarDeltaMode = 'delta-csillag' | 'csillag-delta' | 'veletlen';
export type ThemeChoice = 'system' | 'light' | 'dark';
/** Gyakorlás, időre megoldás, próbavizsga, napi feladatsor. */
export type Mode = 'gyakorlas' | 'idore' | 'vizsga' | 'napi' | 'epito';

export interface Settings {
  domain: Domain;
  mode: Mode;
  dcTopic: Topic;
  dcLevel: Level;
  acTopic: AcTopic;
  acLevel: AcLevel;
  method: MethodId;
  starDelta: boolean;
  starDeltaMode: StarDeltaMode;
  theme: ThemeChoice;
  speed: number;
  /** Áramkör újrarajzolása: összevonásonként egyszerűsödő rajz (csak ha be van kapcsolva). */
  redraw: boolean;
  /** Időre megoldásnál a rendelkezésre álló idő (perc). */
  timedMinutes: number;
  dailyLevel: DailyLevel;
  examKind: ExamKind;
  /** Próbavizsga (egyenáram): az előre választott megoldási módszer, vagy véletlen (feladatonként a hozzá illő). */
  examMethod: MethodId | 'veletlen';
}

export const DEFAULT_SETTINGS: Settings = {
  domain: 'dc',
  mode: 'gyakorlas',
  dcTopic: 'oszto',
  dcLevel: 'alapozo',
  acTopic: 'ac-impedancia',
  acLevel: 'konnyu',
  method: 'redukcio',
  starDelta: false,
  starDeltaMode: 'veletlen',
  theme: 'system',
  speed: 1,
  redraw: false,
  timedMinutes: 10,
  dailyLevel: 'kozepes',
  examKind: 'dc',
  examMethod: 'veletlen',
};

const KEY = 'villamossagtan.settings.v2';

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    const s = { ...DEFAULT_SETTINGS, ...(JSON.parse(raw) as Partial<Settings>) };
    // Ha a mentett témakör már nincs a választóban (pl. kivett témakör), az alapértelmezettre állunk.
    if (!DC_TOPICS.some((t) => t.id === s.dcTopic)) s.dcTopic = DEFAULT_SETTINGS.dcTopic;
    return s;
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
}

/** A módszerek sorrendje a választóban. */
export function methodList(starDelta: boolean): MethodInfo[] {
  return [
    { id: 'redukcio', label: 'Redukció (eredő + osztók)' },
    { id: 'kirchhoff', label: 'Kirchhoff-törvények' },
    { id: 'hurokaram', label: 'Hurokáramok' },
    { id: 'csomoponti', label: 'Csomóponti potenciálok' },
    { id: 'szuperpozicio', label: 'Szuperpozíció' },
    { id: 'thevenin', label: 'Thevenin / Norton' },
    ...(starDelta ? [{ id: 'csillag-delta' as const, label: 'Csillag-delta' }] : []),
  ];
}
