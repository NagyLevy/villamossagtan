// Statisztika: megoldott feladatok és helyes arány, témakörönként, szintenként, módszerenként és
// topológiánként. Böngészőben (localStorage) tárolva; a tároló hiánya esetén csak a memóriában él.
// Az összesítés tiszta függvény (tesztelhető).

export interface Attempt {
  /** Időbélyeg (ms). */
  t: number;
  topic: string;
  level: string;
  topology: string;
  method: string;
  /** Vizsga / gyakorló mód. */
  mode: string;
  correct: boolean;
}

export interface Bucket {
  key: string;
  total: number;
  correct: number;
}

export interface Summary {
  total: number;
  correct: number;
  byTopic: Bucket[];
  byLevel: Bucket[];
  byMethod: Bucket[];
  byTopology: Bucket[];
}

function bucket(list: Attempt[], key: (a: Attempt) => string): Bucket[] {
  const m = new Map<string, Bucket>();
  for (const a of list) {
    const k = key(a);
    const b = m.get(k) ?? { key: k, total: 0, correct: 0 };
    b.total++;
    if (a.correct) b.correct++;
    m.set(k, b);
  }
  return [...m.values()].sort((x, y) => y.total - x.total || x.key.localeCompare(y.key, 'hu'));
}

export function summarize(list: Attempt[]): Summary {
  return {
    total: list.length,
    correct: list.filter((a) => a.correct).length,
    byTopic: bucket(list, (a) => a.topic),
    byLevel: bucket(list, (a) => a.level),
    byMethod: bucket(list, (a) => a.method),
    byTopology: bucket(list, (a) => a.topology),
  };
}

const KEY = 'villamossagtan.stats.v1';
let memory: Attempt[] = [];

export function loadAttempts(): Attempt[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) memory = JSON.parse(raw) as Attempt[];
  } catch {
    // A tárolás nem elérhető: a memóriában lévő listát használjuk.
  }
  return memory;
}

export function recordAttempt(a: Attempt): void {
  memory = [...loadAttempts(), a].slice(-5000);
  try {
    localStorage.setItem(KEY, JSON.stringify(memory));
  } catch {
    // A tárolás nem kötelező.
  }
}

export function clearAttempts(): void {
  memory = [];
  try {
    localStorage.removeItem(KEY);
  } catch {
    // A tárolás nem kötelező.
  }
}
