// Napi kihívás: minden nap (helyi idő szerint 00:00-kor) új feladatsor, ugyanaz a nap mindig
// ugyanazt adja. Az első héten csak szuperpozíció, utána vegyesen, minden típusból egy feladat.
// Tiszta függvények (tesztelhetők).

import type { Topic } from '../generator/generate';
import type { Level } from '../generator/values';
import type { MethodId } from '../methods/types';

/** Az első nap (hétfő) és az első ZH napja. */
export const START_DAY = '2026-11-02';
export const ZH_DAY = '2026-11-16';
/** Eddig (ezt a napot már nem beleértve) tart a szuperpozíció hét. */
export const MIXED_FROM = '2026-11-09';

export type DailyLevel = 'free' | 'kozepes' | 'tryhard' | 'kurva';

export const DAILY_LEVELS: { id: DailyLevel; label: string }[] = [
  { id: 'free', label: 'Free elo' },
  { id: 'kozepes', label: 'Közepes' },
  { id: 'tryhard', label: 'Tryhard' },
  { id: 'kurva', label: 'Kurva nehéz' },
];

export interface DailyTask {
  /** A napon belül egyedi azonosító (a haladás ehhez tárolódik). */
  id: string;
  title: string;
  topic: Topic;
  level: Level;
  seed: string;
  /** A módszer, amivel ezt a feladatot gyakoroljuk. */
  method: MethodId;
  /** Rövid módszer-tipp a feladathoz. */
  tip: string;
  /** ZH-szinten a többforrásos feladatok mindig a "sok forrás" típusból jönnek. */
  zhType?: 'sok-forras';
}

export interface DailyChallenge {
  day: string;
  theme: string;
  level: DailyLevel;
  tasks: DailyTask[];
  /** A nap tudnivalója (ZH-felkészülés). */
  studyTip: string;
}

/** Helyi dátum YYYY-MM-DD alakban (a napi váltás a helyi éjfélhez igazodik). */
export function dayKey(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function parseDay(key: string): Date {
  const [y, m, d] = key.split('-').map(Number) as [number, number, number];
  return new Date(y, m - 1, d);
}

/** Napok különbsége két YYYY-MM-DD között (b − a). */
export function daysBetween(a: string, b: string): number {
  return Math.round((parseDay(b).getTime() - parseDay(a).getTime()) / 86_400_000);
}

/** Ennyi idő van hátra a következő napi kihívásig (helyi éjfél). */
export function msUntilNext(now: Date): number {
  const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 0, 0);
  return next.getTime() - now.getTime();
}

export function daysUntilZh(now: Date): number {
  return daysBetween(dayKey(now), ZH_DAY);
}

/** Nehézség → generátorszint; az alapozó témaköröknél a legkönnyebb fokozat alapozó. */
function levelFor(lvl: DailyLevel, basic: boolean): Level {
  if (lvl === 'free') return basic ? 'alapozo' : 'konnyu';
  if (lvl === 'kozepes') return 'kozepes';
  if (lvl === 'tryhard') return 'nehez';
  return basic ? 'nehez' : 'zh';
}

const TIPS: Record<string, string> = {
  szuperpozicio:
    'Egyszerre csak egy forrás dolgozik. A többi feszültségforrás helyére rövidzár, áramforrás helyére szakadás. Minden részáramot ugyanabban a referenciairányban számolj, a végén előjelesen add össze.',
  redukcio: 'A mérési ponttól legtávolabbi résztől indulj, és mindig a kapcsok felé haladva vond össze: soros = összeadás, párhuzamos = replusz.',
  oszto: 'Soros ágban a feszültség az ellenállások arányában oszlik; két párhuzamos ágnál az áram a MÁSIK ág ellenállásával arányos.',
  kirchhoff: 'Csomópont: a kifolyó áramok előjeles összege nulla. Hurok: körbeérve a feszültségek előjeles összege nulla. Figyelj a referenciairányokra!',
  hurokaram: 'Ablakonként egy hurokáram, mind ugyanabba az irányba. Közös ágban a két hurokáram különbsége folyik. Áramforrásnál kötött hurok vagy szuperhurok.',
  csomoponti: 'Válassz referenciát (0 V), a feszültségforrással rögzített csomópontokat írd fel előre. Minden ismeretlen csomópontra: kifolyó áramok összege nulla.',
  thevenin: 'Rth: források kiiktatva, A–B felől az eredő. Uth: üresjárás. In: rövidzár. Ellenőrzés: Uth = Rth · In.',
};

const STUDY_TIPS = [
  'Szuperpozíciónál a teljesítmény NEM adható össze: előbb az áramot összegezd, és abból számolj teljesítményt.',
  'A kiiktatott feszültségforrás rövidzár, a kiiktatott áramforrás szakadás. Ezt mindig rajzold át, mielőtt számolsz!',
  'Áramforrással sorba kötött ellenállás nem változtat az ág áramán: ZH-ban ez gyakori trükk.',
  'Feszültségforrással közvetlenül párhuzamos ellenállás feszültsége a forrás feszültsége, a többi elemre nincs hatása.',
  'Előjel! A ZH a nagyságot kéri, de a részáramokat előjelesen kell összeadni, különben rossz lesz a nagyság is.',
  'Ha két forrás van, két részáramkör. Ha három, három. Ne próbáld egyszerre többet számolni.',
  'Ellenőrzés: a teljesítménymérleg (minden P összege nulla) gyorsan megmutatja, ha valahol elszámoltad.',
  'Csomóponti módszernél az ismeretlenek száma: csomópontok − rögzítettek − 1. Ezzel kezdd!',
  'Hurokáramnál a közös ágban folyó áram a két hurokáram különbsége. A végén mindig ágáramot számolj belőlük.',
  'Thevenin: ha az Rth-nál maradt áramforrás, az szakadás, vagyis az az ág kiesik az eredőből.',
  'Eredő ellenállásnál mindig onnan nézd, ahonnan kérdezik: a mérési pont felé haladva vonj össze.',
  'Osztó: U_x = U · R_x / ΣR soros ágban; két párhuzamos ágnál I_1 = I · R_2 / (R_1 + R_2).',
  'Kirchhoff huroktörvény: ha a körüljárás a forrás nyila irányában halad át rajta, a forrás „hajtja” a kört.',
  'Utolsó nap a ZH előtt: csinálj meg egy Kurva nehéz kihívást időre, és nézd meg, melyik lépésnél lassulsz le.',
];

/** A nap kihívása az adott nehézségen. */
export function dailyChallenge(date: Date, lvl: DailyLevel): DailyChallenge {
  const day = dayKey(date);
  const n = Math.max(0, daysBetween(START_DAY, day));
  const studyTip = STUDY_TIPS[n % STUDY_TIPS.length]!;
  const seed = (i: number) => `D${day}-${lvl}-${i}`;
  if (day < MIXED_FROM) {
    // Szuperpozíció hét: három, egyre nagyobb feladat.
    const tasks: DailyTask[] = [0, 1, 2].map((i) => {
      // Free elo: két könnyű, egy közepes; a többi szint egyenletesen a saját fokozatán.
      const level: Level = lvl === 'free' ? (i < 2 ? 'konnyu' : 'kozepes') : levelFor(lvl, false);
      return { id: `szup-${i}`, title: `Szuperpozíció ${i + 1}`, topic: level === 'zh' ? 'zh' : 'tobbforras', level, seed: seed(i), method: 'szuperpozicio', tip: TIPS.szuperpozicio!, zhType: level === 'zh' ? 'sok-forras' : undefined };
    });
    return { day, theme: 'Szuperpozíció hét', level: lvl, tasks, studyTip };
  }
  const mixed: { id: string; title: string; topic: Topic; method: MethodId; basic: boolean; tip: string }[] = [
    { id: 'eredo', title: 'Eredő ellenállás', topic: 'eredo', method: 'redukcio', basic: true, tip: TIPS.redukcio! },
    { id: 'oszto', title: 'Feszültség- és áramosztás', topic: 'oszto', method: 'redukcio', basic: true, tip: TIPS.oszto! },
    { id: 'kirchhoff', title: 'Kirchhoff törvényei', topic: 'kirchhoff', method: 'kirchhoff', basic: true, tip: TIPS.kirchhoff! },
    { id: 'hurokaram', title: 'Hurokáram', topic: 'tobbforras', method: 'hurokaram', basic: false, tip: TIPS.hurokaram! },
    { id: 'csomoponti', title: 'Csomóponti potenciál', topic: 'tobbforras', method: 'csomoponti', basic: false, tip: TIPS.csomoponti! },
    { id: 'szuperpozicio', title: 'Szuperpozíció', topic: 'tobbforras', method: 'szuperpozicio', basic: false, tip: TIPS.szuperpozicio! },
    { id: 'thevenin', title: 'Thevenin és Norton', topic: 'thevenin', method: 'thevenin', basic: true, tip: TIPS.thevenin! },
  ];
  const tasks: DailyTask[] = mixed.map((m, i) => {
    const level = levelFor(lvl, m.basic);
    // ZH-szinten a többforrásos feladat a ZH "sok forrás" típusa.
    const topic: Topic = m.topic === 'tobbforras' && level === 'zh' ? 'zh' : m.topic;
    return { id: m.id, title: m.title, topic, level, seed: seed(i), method: m.method, tip: m.tip, zhType: topic === 'zh' ? 'sok-forras' : undefined };
  });
  return { day, theme: 'Vegyes nap', level: lvl, tasks, studyTip };
}
