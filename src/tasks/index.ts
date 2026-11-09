// Feladatok egységes előállítása: egyenáramú (a régi generátorból), szinuszos és bekapcsolási.
// Itt áll össze a próbavizsga feladatsora is.

import { AC_LEVEL_NAMES, AC_TOPIC_NAMES, generateAcTask, type AcLevel, type AcTopic } from '../ac/problems';
import { generateProblem, TOPIC_NAMES, type Problem, type TeacherType, type Topic } from '../generator/generate';
import { LEVEL_NAMES, type Level } from '../generator/values';
import { Rng } from '../generator/rng';
import type { AnswerField, Domain, Task } from './types';

export type { Task } from './types';

const EXAMPLE: Record<string, string> = { V: '4,5 V', A: '350 mA', Ω: '4,7 kΩ', W: '1,2 W' };

/** Egyenáramú feladat a közös formátumban. */
export function dcTask(p: Problem): Task {
  const parts = [LEVEL_NAMES[p.level], p.stats.sources ? `${p.stats.sources} forrás` : null, `${p.stats.resistors} ellenállás`];
  return {
    domain: 'dc',
    seed: p.seed,
    topic: p.topic,
    topicName: TOPIC_NAMES[p.topic],
    levelName: LEVEL_NAMES[p.level],
    meta: parts.filter(Boolean).join(' · '),
    title: p.questions.length === 1 ? p.questions[0]!.text : `${TOPIC_NAMES[p.topic]}: ${p.questions.length} részkérdés`,
    circuit: p.circuit,
    dc: p,
    questions: p.questions.map((q) => ({
      id: q.id,
      text: q.text,
      target: q.target,
      table: q.kind === 'table',
      fields: q.kind === 'table' || !q.unit ? [] : [{ id: `${q.id}-v`, label: 'válasz', unit: q.unit, answer: q.answer, magnitudeOnly: q.magnitudeOnly, example: EXAMPLE[q.unit] } satisfies AnswerField],
    })),
  };
}

export interface DcSpec {
  domain: 'dc';
  topic: Topic;
  level: Level;
  seed: string;
  starDelta?: boolean;
  starDeltaMode?: 'delta-csillag' | 'csillag-delta' | 'veletlen';
  /** A tanári gyakorlati típusok közül (topic: 'tanari'). */
  teacherType?: TeacherType;
}

export interface AcSpec {
  domain: 'ac';
  topic: AcTopic;
  level: AcLevel;
  seed: string;
}

export type TaskSpec = DcSpec | AcSpec;

export function makeTask(s: TaskSpec): Task {
  if (s.domain === 'ac') return generateAcTask({ seed: s.seed, topic: s.topic, level: s.level });
  return dcTask(generateProblem({ seed: s.seed, topic: s.topic, level: s.level, starDelta: s.starDelta, starDeltaMode: s.starDeltaMode, teacherType: s.teacherType }));
}

// ───────── Témakörök a választóhoz ─────────

export interface TopicInfo {
  id: string;
  name: string;
  /** Rövid leírás a választóban. */
  hint: string;
}

export const DC_TOPICS: TopicInfo[] = [
  { id: 'ohm', name: TOPIC_NAMES.ohm, hint: 'U = R·I, P = U·I' },
  { id: 'eredo', name: TOPIC_NAMES.eredo, hint: 'soros, párhuzamos összevonás' },
  { id: 'oszto', name: TOPIC_NAMES.oszto, hint: 'feszültség- és áramosztó' },
  { id: 'kirchhoff', name: TOPIC_NAMES.kirchhoff, hint: 'csomóponti és huroktörvény' },
  { id: 'halozat', name: TOPIC_NAMES.halozat, hint: 'minden elem U, I, P' },
  { id: 'valodi-gen', name: TOPIC_NAMES['valodi-gen'], hint: 'belső ellenállás, terhelés' },
  { id: 'thevenin', name: TOPIC_NAMES.thevenin, hint: 'helyettesítő generátor' },
  { id: 'tobbforras', name: TOPIC_NAMES.tobbforras, hint: 'hurokáram, csomóponti, szuperpozíció' },
  { id: 'tanari', name: TOPIC_NAMES.tanari, hint: 'a gyakorlati füzet típusai: szuperpozíció, Thevenin/Norton, csomóponti, hurokáram' },
  { id: 'csillag-delta', name: TOPIC_NAMES['csillag-delta'], hint: 'Δ ↔ Y átalakítás, hidas hálózatok' },
  { id: 'zh', name: TOPIC_NAMES.zh, hint: 'nagy hálózat, ZH-méret' },
];

export const AC_TOPICS: TopicInfo[] = [
  { id: 'ac-impedancia', name: AC_TOPIC_NAMES['ac-impedancia'], hint: 'jωL, −j/(ωC), komplex eredő' },
  { id: 'ac-fazor', name: AC_TOPIC_NAMES['ac-fazor'], hint: 'komplex osztók, u(t), i(t)' },
  { id: 'ac-teljesitmeny', name: AC_TOPIC_NAMES['ac-teljesitmeny'], hint: 'P, Q, S, cos φ, fázisjavítás' },
  { id: 'ac-helyettesito', name: AC_TOPIC_NAMES['ac-helyettesito'], hint: 'Zth, üresjárási feszültség, Irz' },
  { id: 'ac-rezonancia', name: AC_TOPIC_NAMES['ac-rezonancia'], hint: 'ω₀, jósági tényező, sávszélesség' },
  { id: 'tranziens', name: AC_TOPIC_NAMES.tranziens, hint: 'időállandó, x(t) = x∞(1 − e^(−t/τ))' },
];

export const DC_LEVELS: { id: Level; name: string }[] = (Object.keys(LEVEL_NAMES) as Level[]).filter((l) => l !== 'zh').map((id) => ({ id, name: LEVEL_NAMES[id] }));
export const AC_LEVELS: { id: AcLevel; name: string }[] = (Object.keys(AC_LEVEL_NAMES) as AcLevel[]).map((id) => ({ id, name: AC_LEVEL_NAMES[id] }));

// ───────── Próbavizsga ─────────

export type ExamKind = 'dc' | 'zh1' | 'ac' | 'vegyes';

/** A váltóáramú anyagot is tartalmazó vizsgák (amíg a váltóáram zárva van, ezek is). */
export const AC_EXAMS: ExamKind[] = ['ac', 'vegyes'];

export interface ExamInfo {
  kind: ExamKind;
  name: string;
  minutes: number;
  description: string;
}

export const EXAMS: ExamInfo[] = [
  { kind: 'dc', name: 'Villamosságtan 1 (egyenáram)', minutes: 45, description: '5 feladat: eredő ellenállás, hálózatszámítás, osztók, teljesítmény, Thevenin.' },
  { kind: 'zh1', name: '1. ZH (tanári formátum)', minutes: 90, description: 'A korábbi 1. ZH-k felépítése: 1. eredő csillag-deltával, 2. hurokáram ismert hurokkal, 3. osztók egy képletben, 4. teljesítmény, 5. üresjárási feszültség, rövidzárási áram, belső ellenállás.' },
  { kind: 'ac', name: 'Villamosságtan 2 (szinuszos)', minutes: 90, description: '10 feladat: impedancia, fazorok, teljesítmény, helyettesítő generátor, rezgőkör, bekapcsolás.' },
  { kind: 'vegyes', name: 'Vegyes (év végi)', minutes: 60, description: '7 feladat mindkét félév anyagából.' },
];

/** A próbavizsga feladatai: ugyanaz a seed mindig ugyanazt a sort adja. */
export function examTasks(kind: ExamKind, seed: string): Task[] {
  const rng = new Rng(`vizsga|${kind}|${seed}`);
  const s = (i: number) => `${seed}-${i}`;
  const dc = (i: number, topic: Topic, level: Level, starDelta = false): Task => makeTask({ domain: 'dc', topic, level, seed: s(i), starDelta });
  const ac = (i: number, topic: AcTopic, level: AcLevel = 'nehez'): Task => makeTask({ domain: 'ac', topic, level, seed: s(i) });
  if (kind === 'dc')
    return [
      dc(0, 'eredo', 'kozepes', rng.chance(0.6)),
      dc(1, 'zh', 'zh'),
      dc(2, 'oszto', 'kozepes'),
      dc(3, 'ohm', 'nehez'),
      dc(4, 'thevenin', 'kozepes', rng.chance(0.4)),
    ];
  if (kind === 'zh1')
    return [
      dc(0, 'csillag-delta', 'kozepes', true),
      makeTask({ domain: 'dc', topic: 'tanari', level: 'kozepes', seed: s(1), teacherType: 'hurokaram' }),
      dc(2, 'oszto', 'nehez'),
      dc(3, 'ohm', 'nehez'),
      makeTask({ domain: 'dc', topic: 'tanari', level: 'kozepes', seed: s(4), teacherType: 'thevenin' }),
    ];
  if (kind === 'ac')
    return [
      dc(0, 'tobbforras', 'nehez'),
      dc(1, 'zh', 'zh'),
      ac(2, 'ac-impedancia'),
      ac(3, 'ac-helyettesito'),
      ac(4, 'ac-teljesitmeny'),
      ac(5, 'ac-fazor'),
      ac(6, 'ac-fazor', 'kozepes'),
      ac(7, 'ac-rezonancia'),
      ac(8, 'ac-teljesitmeny', 'kozepes'),
      ac(9, 'tranziens'),
    ];
  return [dc(0, 'eredo', 'nehez'), dc(1, 'zh', 'zh'), dc(2, 'thevenin', 'kozepes'), ac(3, 'ac-impedancia', 'kozepes'), ac(4, 'ac-fazor'), ac(5, 'ac-teljesitmeny'), ac(6, rng.pick(['tranziens', 'ac-rezonancia'] as AcTopic[]))];
}

export function domainOfTopic(topic: string): Domain {
  return AC_TOPICS.some((t) => t.id === topic) ? 'ac' : 'dc';
}
