// Napi feladatsor: minden nap (helyi idő szerint 00:00-kor) új sor, ugyanaz a nap mindig ugyanazt
// adja (mindenkinek ugyanazt, így a csoport ugyanazokon a feladatokon dolgozhat). Pontozás nincs,
// csak az, hogy melyik feladat van már kész. Tiszta függvények (tesztelhetők).

import type { Topic } from '../generator/generate';
import type { Level } from '../generator/values';
import type { MethodId } from '../methods/types';
import type { AcLevel, AcTopic } from '../ac/problems';
import type { Domain } from '../tasks/types';

export type DailyLevel = 'konnyu' | 'kozepes' | 'nehez' | 'zh';

export const DAILY_LEVELS: { id: DailyLevel; label: string }[] = [
  { id: 'konnyu', label: 'Könnyű' },
  { id: 'kozepes', label: 'Közepes' },
  { id: 'nehez', label: 'Nehéz' },
  { id: 'zh', label: 'ZH-szint' },
];

export interface DailyTask {
  /** A napon belül egyedi azonosító (a haladás ehhez tárolódik). */
  id: string;
  title: string;
  domain: Domain;
  seed: string;
  /** Rövid módszer-tipp a feladathoz. */
  tip: string;
  /** Egyenáramú feladat: témakör, szint és a gyakorolt módszer. */
  dc?: { topic: Topic; level: Level; method: MethodId; zhType?: 'sok-forras' };
  /** Szinuszos / bekapcsolási feladat. */
  ac?: { topic: AcTopic; level: AcLevel };
}

export interface DailyChallenge {
  day: string;
  domain: Domain;
  level: DailyLevel;
  tasks: DailyTask[];
  /** A nap tudnivalója. */
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

/** Ennyi idő van hátra a következő napi feladatsorig (helyi éjfél). */
export function msUntilNext(now: Date): number {
  const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 0, 0);
  return next.getTime() - now.getTime();
}

/** Nehézség → egyenáramú generátorszint; az alapozó témaköröknél a legkönnyebb fokozat alapozó. */
function dcLevel(lvl: DailyLevel, basic: boolean): Level {
  if (lvl === 'konnyu') return basic ? 'alapozo' : 'konnyu';
  if (lvl === 'kozepes') return 'kozepes';
  if (lvl === 'nehez') return 'nehez';
  return basic ? 'nehez' : 'zh';
}

function acLevel(lvl: DailyLevel): AcLevel {
  return lvl === 'konnyu' ? 'konnyu' : lvl === 'kozepes' ? 'kozepes' : 'nehez';
}

const TIPS: Record<string, string> = {
  szuperpozicio:
    'Egyszerre csak egy forrás dolgozik. A többi feszültségforrás helyére rövidzár, áramforrás helyére szakadás. Minden részáramot ugyanabban a referenciairányban számolj, a végén előjelesen add össze.',
  redukcio: 'A mérési ponttól legtávolabbi résztől indulj, és mindig a kapcsok felé haladva vond össze: soros = összeadás, párhuzamos = replusz.',
  oszto: 'Soros ágban a feszültség az ellenállások arányában oszlik; két párhuzamos ágnál az áram a MÁSIK ág ellenállásával arányos.',
  kirchhoff: 'Csomópont: a kifolyó áramok előjeles összege nulla. Hurok: körbeérve a feszültségek előjeles összege nulla. Figyelj a referenciairányokra!',
  hurokaram: 'Először l = b − n + 1: ennyi hurok kell. Minden áramforrásnak saját, ismert hurka van (a hurokáram a forrás árama), a többi J₁, J₂… ismeretlen, mind ugyanabba az irányba. Minden ellenállást és feszültségforrást érintsen ismeretlen hurok. Közös ágban a hurokáramok különbsége folyik.',
  csomoponti: 'Számold meg a csomópontokat. A referencia (0 V) egy feszültségforrás vége legyen, hogy minél több potenciál rögtön ismert legyen. Ismeretlenek: n − 1 − nᵤ. Minden ismeretlen csomópontra: a kifelé menő áramok összege nulla, (φ − túlsó φ) / R alakban, aztán szorozd be egészre.',
  csillagdelta: 'Delta → csillag: R1 = R12·R13 / (R12 + R23 + R31), a két szomszédos delta-ellenállás szorzata per a három összege. Csillag → delta: R12 = R1 + R2 + R1·R2/R3. Átalakítás után már soros-párhuzamosan összevonható.',
  thevenin: 'Rg: források kiiktatva, A–B felől az eredő (mindig üresjárásban). Uü: forrásonként osztókkal, (A→B) / (B→A) iránnyal, majd előjeles összeg. In = Uü / Rg. Illesztésnél Rt = Rg, Pmax = Uü² / (4 Rg).',
  impedancia: 'Előbb minden tekercs és kondenzátor impedanciáját írd fel (jωL, −j/(ωC)), aztán ugyanúgy vonj össze, mint ellenállásokkal, csak komplex számokkal.',
  fazor: 'Osztóknál a komplex számok arányával szorozz. Szorzásnál az abszolút értékek szorzódnak, a szögek összeadódnak; osztásnál a szögek kivonódnak.',
  teljesitmeny: 'Komplex csúcsértékekkel S = ½·Û·Î*. P a valós, Q a képzetes rész. A cos φ az eredő impedancia szögéből jön.',
  helyettesito: 'Zth: a generátor kiiktatva, a kapcsok felől az eredő impedancia. Üresjárási feszültség: terheletlen kapcsokon, osztókkal.',
  rezonancia: 'ω₀ = 1/√(LC). Soros körben B = R/L, párhuzamos körben B = 1/(RC); Q₀ = ω₀/B.',
  tranziens: 'Három dolog kell: τ (Thevenin-ellenállásból), az állandósult érték (L rövidzár, C szakadás) és a kezdeti érték (energiamentesnél 0).',
};

const STUDY_TIPS_DC = [
  'A kiiktatott feszültségforrás rövidzár, a kiiktatott áramforrás szakadás. Ezt mindig rajzold át, mielőtt számolsz!',
  'Áramforrással sorba kötött ellenállás nem változtat az ág áramán: ZH-ban ez gyakori trükk.',
  'Feszültségforrással közvetlenül párhuzamos ellenállás feszültsége a forrás feszültsége, a többi elemre nincs hatása.',
  'Szuperpozíciónál a teljesítmény NEM adható össze: előbb az áramot összegezd, és abból számolj teljesítményt.',
  'Ellenőrzés: a teljesítménymérleg (minden P összege nulla) gyorsan megmutatja, ha valahol elszámoltad.',
  'Hurokáramnál a közös ágban folyó áram a két hurokáram különbsége. A végén mindig ágáramot számolj belőlük.',
  'Osztó: U_x = U · R_x / ΣR soros ágban; két párhuzamos ágnál I_1 = I · R_2 / (R_1 + R_2).',
  'Csomóponti módszernél az ismeretlenek száma: csomópontok − feszültségforrással rögzítettek − 1. Ezzel kezdd!',
  'Thevenin: ha az Rg-nél maradt áramforrás, az szakadás, vagyis az az ág kiesik az eredőből.',
  'Időre gyakorolj: nézd meg, melyik lépésnél lassulsz le, és azt gyakorold külön.',
];

const STUDY_TIPS_AC = [
  'Osztó komplexben is ugyanúgy megy: U_x = U · Z_x / ΣZ, csak komplex számokkal számolsz.',
  'Tekercs: egyenáramon rövidzár, kondenzátor: egyenáramon szakadás. Bekapcsolásnál ebből jön az állandósult állapot.',
  'Komplex csúcsértékből az időfüggvény: u(t) = |Û|·cos(ωt + φ), ahol φ az Û szöge.',
  'A meddő teljesítmény induktív fogyasztónál pozitív, kapacitívnál negatív. Kompenzálni az ellentétes jellegű elemmel lehet.',
  'Effektív érték = csúcsérték / √2. Ha a képletben effektív értékek vannak, nem kell 2-vel osztani.',
  'Időre gyakorolj: nézd meg, melyik lépésnél lassulsz le, és azt gyakorold külön.',
];

/** A nap feladatsora az adott területen és nehézségen. */
export function dailyChallenge(date: Date, lvl: DailyLevel, domain: Domain = 'dc'): DailyChallenge {
  const day = dayKey(date);
  const n = Math.abs(daysBetween('2026-01-01', day));
  const tips = domain === 'ac' ? STUDY_TIPS_AC : STUDY_TIPS_DC;
  const studyTip = tips[n % tips.length]!;
  const seed = (i: number) => `D${day}-${domain}-${lvl}-${i}`;
  if (domain === 'ac') {
    const list: { id: AcTopic; title: string; tip: string }[] = [
      { id: 'ac-impedancia', title: 'Eredő impedancia', tip: TIPS.impedancia! },
      { id: 'ac-fazor', title: 'Fazor és időfüggvény', tip: TIPS.fazor! },
      { id: 'ac-teljesitmeny', title: 'Teljesítmény', tip: TIPS.teljesitmeny! },
      { id: 'ac-helyettesito', title: 'Thevenin / Norton', tip: TIPS.helyettesito! },
      { id: 'ac-rezonancia', title: 'Rezgőkör', tip: TIPS.rezonancia! },
      { id: 'tranziens', title: 'Bekapcsolás', tip: TIPS.tranziens! },
    ];
    return { day, domain, level: lvl, studyTip, tasks: list.map((t, i) => ({ id: t.id, title: t.title, domain, seed: seed(i), tip: t.tip, ac: { topic: t.id, level: acLevel(lvl) } })) };
  }
  const mixed: { id: string; title: string; topic: Topic; method: MethodId; basic: boolean; tip: string }[] = [
    { id: 'eredo', title: 'Eredő ellenállás', topic: 'eredo', method: 'redukcio', basic: true, tip: TIPS.redukcio! },
    { id: 'oszto', title: 'Feszültség- és áramosztás', topic: 'oszto', method: 'redukcio', basic: true, tip: TIPS.oszto! },
    { id: 'kirchhoff', title: 'Kirchhoff törvényei', topic: 'kirchhoff', method: 'kirchhoff', basic: true, tip: TIPS.kirchhoff! },
    { id: 'hurokaram', title: 'Hurokáram', topic: 'tobbforras', method: 'hurokaram', basic: false, tip: TIPS.hurokaram! },
    { id: 'csomoponti', title: 'Csomóponti potenciál', topic: 'tobbforras', method: 'csomoponti', basic: false, tip: TIPS.csomoponti! },
    { id: 'szuperpozicio', title: 'Szuperpozíció', topic: 'tobbforras', method: 'szuperpozicio', basic: false, tip: TIPS.szuperpozicio! },
    { id: 'thevenin', title: 'Helyettesítő generátor', topic: 'thevenin', method: 'thevenin', basic: true, tip: TIPS.thevenin! },
    { id: 'csillag-delta', title: 'Csillag-delta', topic: 'csillag-delta', method: 'csillag-delta', basic: true, tip: TIPS.csillagdelta! },
  ];
  const tasks: DailyTask[] = mixed.map((m, i) => {
    const level = dcLevel(lvl, m.basic);
    // ZH-szinten a többforrásos feladat a ZH "sok forrás" típusa.
    const topic: Topic = m.topic === 'tobbforras' && level === 'zh' ? 'zh' : m.topic;
    return { id: m.id, title: m.title, domain, seed: seed(i), tip: m.tip, dc: { topic, level, method: m.method, zhType: topic === 'zh' ? 'sok-forras' : undefined } };
  });
  return { day, domain, level: lvl, tasks, studyTip };
}
