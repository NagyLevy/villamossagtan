// Az alkalmazás kerete: fejléc (egyenáram / váltóáram, és a négy mód: gyakorlás, időre, próbavizsga,
// napi feladatok), beállítások panel, és a módok saját nézetei. Egy feladat megjelenítése a
// TaskViewer dolga; itt csak az dől el, hogy melyik feladat, milyen módban.

import { generateProblem, type Topic } from '../generator/generate';
import { randomSeed } from '../generator/rng';
import type { Level } from '../generator/values';
import type { AcLevel, AcTopic } from '../ac/problems';
import { solveWith } from '../methods';
import { methodFit, prescribedMethod } from '../methods/fit';
import { dailyProblem } from '../daily/problem';
import { DAILY_LEVELS, dailyChallenge, dayKey, msUntilNext, type DailyLevel } from '../daily/schedule';
import { isDone, loadProgress, markDone, streak } from '../daily/progress';
import { AC_LEVELS, AC_TOPICS, DC_LEVELS, DC_TOPICS, dcTask, AC_EXAMS, EXAMS, examTasks, makeTask, type ExamKind } from '../tasks';
import type { Domain, Task } from '../tasks/types';
import { button, iconButton, segmented, select, slider, toast, toggle } from './components';
import { h, icon, ICONS } from './dom';
import { isLite, setLite } from './perf';
import { loadSettings, methodList, saveSettings, type MethodId, type Mode, type Settings, type ThemeChoice } from './settings';
import { openTopicWheel } from './wheel';
import { fieldAnswerText, scoreTask, TaskViewer, type Score } from './viewer';
import { formatNumber } from '../units';

/**
 * A váltóáramú (Villamosságtan 2) rész egyelőre zárva: a fül szürke, „Hamarosan” felirattal.
 * A kód kész és tesztelt; megnyitáshoz elég ezt true-ra állítani.
 */
export const AC_ENABLED = false;
const SOON = 'Hamarosan';

const MODE_NAMES: Record<Mode, string> = { gyakorlas: 'Gyakorlás', idore: 'Időre', vizsga: 'Próbavizsga', napi: 'Napi' };

export function startApp(root: HTMLElement): void {
  const settings = loadSettings();
  // Zárt váltóáramnál a korábban elmentett választás is visszaáll egyenáramra.
  if (!AC_ENABLED) {
    settings.domain = 'dc';
    if (AC_EXAMS.includes(settings.examKind)) settings.examKind = 'dc';
  }
  // A választóból kivett vizsgafajta (pl. a régi külön 1. ZH) helyett az egyenáramú sor jön.
  if (!EXAMS.some((e) => e.kind === settings.examKind)) settings.examKind = 'dc';
  const update = (patch: Partial<Settings>) => {
    Object.assign(settings, patch);
    saveSettings(settings);
  };

  const viewer = new TaskViewer({
    settings: () => settings,
    onAllCorrect: () => onSolved(),
    onMethodPick: (m) => pickMethod(m),
    onNewTask: () => newPractice(),
  });

  const applyTheme = () => {
    if (settings.theme === 'system') document.documentElement.removeAttribute('data-theme');
    else document.documentElement.setAttribute('data-theme', settings.theme);
  };

  // ───────── Fejléc ─────────

  const domainSeg = segmented<Domain>(
    'Tananyag',
    [
      { value: 'dc', label: 'Egyenáram' },
      { value: 'ac', label: 'Váltóáram', ...(AC_ENABLED ? {} : { disabled: true, badge: SOON, hint: 'A váltóáramú (Villamosságtan 2) feladatok hamarosan elérhetők.' }) },
    ],
    settings.domain,
    (v) => {
      update({ domain: v });
      route();
    },
  );
  domainSeg.el.title = 'Egyenáram: Villamosságtan 1 · Váltóáram: Villamosságtan 2 (impedancia, rezgőkörök, bekapcsolás)';
  const modeSeg = segmented<Mode>(
    'Mód',
    (Object.keys(MODE_NAMES) as Mode[]).map((m) => ({ value: m, label: MODE_NAMES[m] })),
    settings.mode,
    (v) => {
      update({ mode: v });
      route();
    },
  );
  modeSeg.el.classList.add('seg-tabs');
  const settingsBtn = h('button', { class: 'btn btn-quiet settings-btn', attrs: { type: 'button' }, on: { click: () => openSettings() } }, icon(ICONS.settings, 16), h('span', { text: 'Beállítások' }));
  const header = h(
    'header',
    { class: 'toolbar' },
    h(
      'div',
      { class: 'brand' },
      h('span', { class: 'brand-mark', html: '<svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true"><path d="M2 9h3l2-5 4 10 2-5h3" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>' }),
      'Villamosságtan',
    ),
    domainSeg.el,
    modeSeg.el,
    h('div', { class: 'toolbar-group' }, settingsBtn),
  );

  const main = h('main', { class: 'main' });
  root.replaceChildren(header, main);

  // ───────── Közös: témakör és nehézség ─────────

  const topicPicker = (onChange: () => void): HTMLElement => {
    const dc = settings.domain === 'dc';
    const topics = dc ? DC_TOPICS : AC_TOPICS;
    const topicId = () => (dc ? settings.dcTopic : settings.acTopic);
    // A témakör gombja a kör alakú választót nyitja (wheel.ts); ott a nehézség is állítható.
    const topicName = h('span', { class: 'topic-btn-name', text: topics.find((t) => t.id === topicId())?.name ?? '' });
    const topicBtn = h(
      'button',
      {
        class: 'select topic-btn',
        attrs: { type: 'button', 'aria-haspopup': 'dialog', title: 'Témakör választása' },
        on: {
          click: () =>
            openTopicWheel({
              items: topics,
              current: topicId(),
              levels,
              level: dc ? settings.dcLevel : settings.acLevel,
              fixedLevel: (id) => (dc && id === 'zh' ? 'ZH-szint' : null),
              onPick: (id, lv) => {
                if (dc) update({ dcTopic: id as Topic, dcLevel: lv as Level });
                else update({ acTopic: id as AcTopic, acLevel: lv as AcLevel });
                topicName.textContent = topics.find((t) => t.id === id)?.name ?? '';
                levelSel.set(lv);
                syncLevel();
                hint.textContent = topics.find((t) => t.id === id)?.hint ?? '';
                onChange();
              },
            }),
        },
      },
      h('span', { class: 'topic-btn-mark', attrs: { 'aria-hidden': 'true' } }),
      topicName,
      icon(ICONS.chevron, 12),
    );
    const levels = dc ? DC_LEVELS : AC_LEVELS;
    const levelSel = select<string>(
      'Nehézség',
      levels.map((l) => ({ value: l.id, label: l.name })),
      dc ? settings.dcLevel : settings.acLevel,
      (v) => {
        if (dc) update({ dcLevel: v as Level });
        else update({ acLevel: v as AcLevel });
        onChange();
      },
    );
    const syncLevel = () => {
      const forced = dc && settings.dcTopic === 'zh';
      levelSel.setDisabled(forced);
    };
    syncLevel();
    const hint = h('span', { class: 'picker-hint', text: topics.find((t) => t.id === (dc ? settings.dcTopic : settings.acTopic))?.hint ?? '' });
    return h('div', { class: 'picker' }, h('div', { class: 'picker-field' }, h('span', { text: 'Témakör' }), topicBtn), h('label', { class: 'picker-field' }, h('span', { text: 'Nehézség' }), levelSel.el), hint);
  };

  /** A gyakorló feladat: egyenáramnál a választott módszerhez illő, ha talál ilyet. */
  const practiceTask = (seed = randomSeed()): Task => {
    if (settings.domain === 'ac') return makeTask({ domain: 'ac', topic: settings.acTopic, level: settings.acLevel, seed });
    const level: Level = settings.dcTopic === 'zh' ? 'zh' : settings.dcLevel;
    // A Csillag-delta témakörben az átalakítás a módszer.
    const method: MethodId = settings.dcTopic === 'halozat' ? 'kirchhoff' : settings.dcTopic === 'csillag-delta' ? 'csillag-delta' : settings.method === 'csillag-delta' && !settings.starDelta ? 'redukcio' : settings.method;
    // Bekapcsolt csillag-deltánál sem minden feladat hidas: csak kb. minden harmadik.
    const sd = sdOn(settings.dcTopic);
    const found = findFor(method, settings.dcTopic, level, sd);
    return dcTask(generateProblem({ seed: found ?? seed, topic: settings.dcTopic, level, starDelta: sd, starDeltaMode: settings.starDeltaMode }));
  };

  /**
   * Kerüljön-e csillag-delta ebbe a feladatba: a Csillag-delta témakörben mindig; máshol csak ha a
   * beállítás be van kapcsolva, és akkor is csak a feladatok egy részében (véletlenszerűen).
   */
  const sdOn = (topic: Topic) => topic === 'csillag-delta' || (settings.starDelta && Math.random() < 0.35);

  /** Seed, amivel a feladat az adott módszerrel a legkönnyebb (vagy legalább megoldható). */
  const findFor = (m: MethodId, topic: Topic, level: Level, sd: boolean): string | null => {
    for (const relaxed of [false, true])
      for (let i = 0; i < (relaxed ? 30 : 40); i++) {
        const s = randomSeed();
        try {
          const p = generateProblem({ seed: s, topic, level, starDelta: sd, starDeltaMode: settings.starDeltaMode });
          if (methodFit(m, p, relaxed).ok) return s;
        } catch {
          // Ez a seed nem adott érvényes feladatot.
        }
      }
    return null;
  };

  // ───────── Gyakorlás ─────────

  /**
   * A témakör saját módszere: a Csillag-delta témakörben az átalakítás, a Teljes hálózatanalízisben
   * az egyenletrendszer (Kirchhoff-egyenletek); máshol a választott módszer.
   */
  const topicMethod = (): MethodId => {
    if (settings.domain !== 'dc') return settings.method;
    if (settings.dcTopic === 'csillag-delta') return 'csillag-delta';
    if (settings.dcTopic === 'halozat') return 'kirchhoff';
    return settings.method;
  };

  let practiceCurrent: Task | null = null;
  const newPractice = () => {
    try {
      practiceCurrent = practiceTask();
    } catch (e) {
      toast(String(e instanceof Error ? e.message : e));
      return;
    }
    viewer.load(practiceCurrent, { mode: 'practice', method: topicMethod(), allowNew: true });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  /**
   * Módszerválasztás: a feladat MINDIG marad, csak a megoldás menete változik (Levi kérése, 2026-11-09).
   * A legördülőben csak az erre a feladatra alkalmazható módszerek szerepelnek.
   */
  const pickMethod = (m: MethodId) => {
    update({ method: m });
    viewer.setMethod(m);
  };

  const showPractice = () => {
    main.replaceChildren(h('div', { class: 'mode-bar' }, topicPicker(() => newPractice())), viewer.el);
    if (!practiceCurrent || practiceCurrent.domain !== settings.domain) newPractice();
    else viewer.load(practiceCurrent, { mode: 'practice', method: topicMethod(), allowNew: true });
  };

  // ───────── Időre ─────────

  let timer = 0;
  const stopTimer = () => window.clearInterval(timer);
  const clock = (ms: number) => {
    const s = Math.max(0, Math.ceil(ms / 1000));
    return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
  };

  const showTimed = () => {
    stopTimer();
    const minutes = select<string>(
      'Idő',
      [3, 5, 10, 15, 20, 30].map((m) => ({ value: String(m), label: `${m} perc` })),
      String(settings.timedMinutes),
      (v) => update({ timedMinutes: Number(v) }),
    );
    const start = button('Indítás', () => runTimed(), 'primary');
    const gate = h(
      'section',
      { class: 'card gate' },
      h('h2', { class: 'gate-title', text: 'Megoldás időre' }),
      h('p', { class: 'gate-info', text: 'Kapsz egy feladatot a kiválasztott témakörből. Az óra az Indításkor indul; a megoldás csak beadás után (vagy ha lejár az idő) látszik. Utána végig tudod nézni a levezetést.' }),
      topicPicker(() => {}),
      h('div', { class: 'gate-row' }, h('label', { class: 'picker-field' }, h('span', { text: 'Rendelkezésre álló idő' }), minutes.el), start),
    );
    main.replaceChildren(gate);
  };

  const runTimed = () => {
    let task: Task;
    try {
      task = practiceTask();
    } catch (e) {
      toast(String(e instanceof Error ? e.message : e));
      return;
    }
    const total = settings.timedMinutes * 60_000;
    const t0 = Date.now();
    const time = h('span', { class: 'timer num', text: clock(total) });
    const status = h('span', { class: 'timer-status', text: 'hátra' });
    const submitBtn = button('Beadás', () => finish(false), 'primary');
    const again = button('Új feladat időre', () => runTimed(), 'secondary');
    again.hidden = true;
    const result = h('div', { class: 'run-result', attrs: { 'aria-live': 'polite' } });
    const bar = h('div', { class: 'run-bar card' }, icon(ICONS.timer, 18), time, status, h('span', { class: 'spacer' }), result, submitBtn, again);
    main.replaceChildren(bar, viewer.el);
    viewer.load(task, { mode: 'test', method: settings.method });
    const finish = (timeout: boolean) => {
      stopTimer();
      const used = Date.now() - t0;
      const s = viewer.submit();
      submitBtn.hidden = true;
      again.hidden = false;
      time.textContent = clock(used);
      status.textContent = timeout ? 'lejárt az idő' : 'alatt';
      result.textContent = `${s.correct} / ${s.total} helyes`;
      result.className = `run-result ${s.correct === s.total ? 'is-good' : 'is-bad'}`;
      toast(timeout ? 'Lejárt az idő: itt a megoldás.' : s.correct === s.total ? 'Minden helyes!' : 'Beadva: nézd meg a megoldást.');
    };
    timer = window.setInterval(() => {
      const left = total - (Date.now() - t0);
      time.textContent = clock(left);
      bar.classList.toggle('is-urgent', left < 60_000);
      if (left <= 0) finish(true);
    }, 250);
  };

  // ───────── Próbavizsga ─────────

  const showExamStart = () => {
    stopTimer();
    const cards = EXAMS.map((e) => {
      const locked = !AC_ENABLED && AC_EXAMS.includes(e.kind);
      return h(
        'button',
        {
          class: `exam-card${settings.examKind === e.kind ? ' is-on' : ''}${locked ? ' is-disabled' : ''}`,
          attrs: { type: 'button', 'aria-pressed': String(settings.examKind === e.kind), ...(locked ? { 'aria-disabled': 'true', title: 'Hamarosan elérhető' } : {}) },
          on: { click: () => (locked ? toast('A váltóáramú próbavizsga hamarosan elérhető.') : (update({ examKind: e.kind }), showExamStart())) },
        },
        h('span', { class: 'exam-name' }, e.name, locked ? h('span', { class: 'badge', text: SOON }) : null),
        h('span', { class: 'exam-time', text: `${e.minutes} perc` }),
        h('span', { class: 'exam-desc', text: e.description }),
      );
    });
    main.replaceChildren(
      h(
        'section',
        { class: 'card gate' },
        h('h2', { class: 'gate-title', text: 'Próbavizsga' }),
        h('p', { class: 'gate-info', text: 'Egy teljes feladatsor a ZH-k és vizsgák mintájára, egy közös órával. A feladatok között szabadon ugrálhatsz; a megoldások a beadás után látszanak, feladatonként végignézhetők.' }),
        h('div', { class: 'exam-cards' }, ...cards),
        h('div', { class: 'gate-row' }, button('Próbavizsga indítása', () => runExam(settings.examKind), 'primary')),
      ),
    );
  };

  const runExam = (kind: ExamKind) => {
    stopTimer();
    const info = EXAMS.find((e) => e.kind === kind)!;
    let tasks: Task[];
    try {
      tasks = examTasks(kind, randomSeed());
    } catch (e) {
      toast(String(e instanceof Error ? e.message : e));
      return;
    }
    const answers = tasks.map(() => new Map<string, string>());
    let current = 0;
    let submitted = false;
    const total = info.minutes * 60_000;
    const t0 = Date.now();
    const time = h('span', { class: 'timer num', text: clock(total) });
    const tabs = h('div', { class: 'exam-tabs', attrs: { role: 'tablist', 'aria-label': 'Feladatok' } });
    const submitBtn = button('Beadás', () => {
      if (!submitted && !confirm('Biztosan beadod? Utána már nem tudod módosítani a válaszokat.')) return;
      finish();
    }, 'primary');
    const summaryBtn = button('Összesítés', () => showSummary(), 'secondary');
    summaryBtn.hidden = true;
    const bar = h('div', { class: 'run-bar card exam-bar' }, icon(ICONS.timer, 18), time, tabs, h('span', { class: 'spacer' }), summaryBtn, submitBtn);
    const body = h('div', { class: 'exam-body' });
    main.replaceChildren(bar, body);

    const renderTabs = () => {
      tabs.replaceChildren(
        ...tasks.map((t, i) => {
          const filled = [...answers[i]!.values()].some((v) => v.trim());
          const sc = submitted ? scoreTask(t, answers[i]!) : null;
          const cls = ['exam-tab', i === current ? 'is-current' : '', filled ? 'is-filled' : '', sc ? (sc.correct === sc.total ? 'is-good' : sc.correct > 0 ? 'is-part' : 'is-bad') : ''].filter(Boolean).join(' ');
          return h('button', { class: cls, attrs: { type: 'button', role: 'tab', 'aria-selected': String(i === current), title: t.topicName }, on: { click: () => open(i) }, text: String(i + 1) });
        }),
      );
    };
    const open = (i: number) => {
      // A beírt válaszok megmaradnak (a nézet a feladat saját táblájába ír).
      current = i;
      const t = tasks[i]!;
      const nav = h(
        'div',
        { class: 'exam-nav' },
        h('span', { class: 'exam-count', text: `${i + 1}. feladat / ${tasks.length}` }),
        h('span', { class: 'spacer' }),
        i > 0 ? button('← Előző', () => open(i - 1), 'quiet') : null,
        i < tasks.length - 1 ? button('Következő →', () => open(i + 1), 'secondary') : null,
      );
      body.replaceChildren(nav, viewer.el);
      // Egyenáramú feladatnál megadjuk a módszert is, amivel számolni kell (a megoldás is ezzel készül).
      const method = t.dc ? bestMethod(t) : undefined;
      const banner = method ? h('p', { class: 'exam-method' }, h('span', { text: 'Ezzel a módszerrel számold: ' }), h('strong', { text: methodName(t, method) })) : null;
      viewer.load(t, { mode: 'test', method, answers: answers[i], submitted, banner });
      renderTabs();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    };
    const showSummary = () => {
      const scores: Score[] = tasks.map((t, i) => scoreTask(t, answers[i]!));
      const got = scores.reduce((a, s) => a + s.correct, 0);
      const all = scores.reduce((a, s) => a + s.total, 0);
      const pct = all ? Math.round((got / all) * 100) : 0;
      body.replaceChildren(
        h(
          'section',
          { class: 'card exam-summary' },
          h('h2', { class: 'gate-title', text: `Eredmény: ${got} / ${all} (${pct}%)` }),
          h('p', { class: 'gate-info', text: pct >= 85 ? 'Nagyon szép! Ez a ZH-n is jó jegy lenne.' : pct >= 50 ? 'Megvan az alap. Nézd végig a hibás feladatok levezetését, és gyakorold azokat a témaköröket.' : 'Még gyakorolni kell. Nyisd meg a feladatokat, és lépésenként nézd végig a megoldást.' }),
          h(
            'div',
            { class: 'table-wrap' },
            h(
              'table',
              { class: 'value-table exam-table' },
              h('thead', {}, h('tr', {}, h('th', { text: '#' }), h('th', { text: 'Témakör' }), h('th', { text: 'Helyes' }), h('th', { text: 'Helyes válasz' }), h('th', { text: '' }))),
              h(
                'tbody',
                {},
                ...tasks.map((t, i) =>
                  h(
                    'tr',
                    {},
                    h('td', { text: String(i + 1) }),
                    h('td', { text: t.topicName }),
                    h('td', { class: scores[i]!.correct === scores[i]!.total ? 'is-ok-text' : 'is-neg', text: `${scores[i]!.correct} / ${scores[i]!.total}` }),
                    h('td', { class: 'exam-answer', text: t.questions.map((q) => (q.table ? 'táblázat' : q.fields.map((f) => fieldAnswerText(f)).join(', '))).join('; ') }),
                    h('td', {}, button('Megoldás', () => open(i), 'quiet')),
                  ),
                ),
              ),
            ),
          ),
          h('div', { class: 'gate-row' }, button('Új próbavizsga', () => showExamStart(), 'primary')),
        ),
      );
      renderTabs();
    };
    const finish = () => {
      stopTimer();
      submitted = true;
      submitBtn.hidden = true;
      summaryBtn.hidden = false;
      time.textContent = clock(Date.now() - t0);
      showSummary();
    };
    timer = window.setInterval(() => {
      const left = total - (Date.now() - t0);
      time.textContent = clock(left);
      bar.classList.toggle('is-urgent', left < 5 * 60_000);
      if (left % 5000 < 260) renderTabs();
      if (left <= 0) {
        toast('Lejárt az idő: a próbavizsgát beadtam.');
        finish();
      }
    }, 250);
    open(0);
  };

  /** A módszer neve a vizsgafeladat fölé (az Ohm-törvényes alapfeladatnál nem „redukció”). */
  const methodName = (t: Task, m: MethodId): string => {
    if (t.dc?.topic === 'ohm') return 'Ohm-törvény és teljesítmény';
    return methodList(true).find((x) => x.id === m)?.label ?? m;
  };

  /** Egyenáramú feladathoz a legkézenfekvőbb módszer (próbavizsgában ezzel mutatjuk a megoldást). */
  const bestMethod = (t: Task): MethodId => {
    // A tanár úr döntési sorrendje szerint a legkevesebb munkával járó módszer.
    return prescribedMethod(t.dc!);
  };

  // ───────── Napi feladatok ─────────

  let dailyIndex = 0;
  let dailyOpened = 0;
  const showDaily = () => {
    stopTimer();
    const now = new Date();
    const c = dailyChallenge(now, settings.dailyLevel, settings.domain);
    dailyIndex = Math.min(dailyIndex, c.tasks.length - 1);
    const t = c.tasks[dailyIndex]!;
    const done = (id: string) => isDone(c.day, settings.domain, settings.dailyLevel, id);
    const lvl = segmented<DailyLevel>(
      'Nehézség',
      DAILY_LEVELS.map((l) => ({ value: l.id, label: l.label })),
      settings.dailyLevel,
      (v) => {
        update({ dailyLevel: v });
        dailyIndex = 0;
        showDaily();
      },
      'sm',
    );
    const chips = h(
      'div',
      { class: 'daily-tasks' },
      ...c.tasks.map((x, i) =>
        h(
          'button',
          { class: `daily-chip${i === dailyIndex ? ' is-current' : ''}${done(x.id) ? ' is-done' : ''}`, attrs: { type: 'button', 'aria-pressed': String(i === dailyIndex) }, on: { click: () => ((dailyIndex = i), showDaily()) } },
          h('span', { class: 'daily-chip-num' }, done(x.id) ? icon(ICONS.check, 12) : String(i + 1)),
          x.title,
        ),
      ),
    );
    const doneCount = c.tasks.filter((x) => done(x.id)).length;
    const st = streak(loadProgress(), c.day, (o) => dayKey(new Date(now.getFullYear(), now.getMonth(), now.getDate() - o)));
    const left = msUntilNext(now);
    const date = now.toLocaleDateString('hu-HU', { month: 'long', day: 'numeric', weekday: 'long' });
    const banner = h(
      'section',
      { class: 'card daily' },
      h('div', { class: 'daily-top' }, h('div', {}, h('h2', { class: 'daily-title', text: 'Napi feladatok' }), h('p', { class: 'daily-sub', text: `${date} · ${settings.domain === 'dc' ? 'Egyenáram' : 'Váltóáram'} · mindenkinek ugyanez a sor` })), h('div', { class: 'daily-stats' }, h('span', { text: `${doneCount} / ${c.tasks.length} kész` }), h('span', { text: `${st} napos sorozat` }), h('span', { text: `Új sor: ${Math.floor(left / 3_600_000)} óra ${Math.floor((left % 3_600_000) / 60_000)} perc múlva` }))),
      lvl.el,
      chips,
      h('p', { class: 'daily-tip' }, h('strong', { text: 'Tipp ehhez a feladathoz: ' }), t.tip),
      h('p', { class: 'daily-tip' }, h('strong', { text: 'A nap tudnivalója: ' }), c.studyTip),
    );
    let task: Task;
    try {
      if (t.dc) {
        // Napi feladatnál csak az a kérdés marad, amire a nap módszere választ ad.
        const p = dailyProblem(t);
        const r = solveWith(p, t.dc.method);
        const answered = r.ok ? new Set(r.solution.answers.map((a) => a.questionId)) : null;
        const kept = answered ? p.questions.filter((q) => answered.has(q.id)) : p.questions;
        task = dcTask(kept.length ? { ...p, questions: kept } : p);
      } else task = makeTask({ domain: 'ac', topic: t.ac!.topic, level: t.ac!.level, seed: t.seed });
    } catch (e) {
      toast(String(e instanceof Error ? e.message : e));
      return;
    }
    main.replaceChildren(viewer.el);
    dailyOpened = Date.now();
    viewer.load(task, { mode: 'practice', method: t.dc?.method, lockedMethod: !!t.dc, banner });
  };

  const onSolved = () => {
    if (settings.mode !== 'napi') {
      toast('Minden válasz helyes! Új feladat: N');
      return;
    }
    const c = dailyChallenge(new Date(), settings.dailyLevel, settings.domain);
    const t = c.tasks[dailyIndex]!;
    markDone(c.day, settings.domain, settings.dailyLevel, t.id, Math.round((Date.now() - dailyOpened) / 1000));
    const next = c.tasks.findIndex((x, i) => i > dailyIndex && !isDone(c.day, settings.domain, settings.dailyLevel, x.id));
    toast(next >= 0 ? 'Kész! Jöhet a következő napi feladat.' : 'Kész a mai sor! Holnap új jön.');
    window.setTimeout(() => {
      if (settings.mode !== 'napi') return;
      if (next >= 0) dailyIndex = next;
      showDaily();
    }, 1400);
  };

  // ───────── Beállítások ─────────

  const openSettings = () => {
    const dialog = h('dialog', { class: 'sheet', attrs: { 'aria-label': 'Beállítások' } });
    const close = () => {
      dialog.close();
      dialog.remove();
    };
    const themeSeg = segmented<ThemeChoice>(
      'Színmód',
      [
        { value: 'system', label: 'Rendszer' },
        { value: 'light', label: 'Világos' },
        { value: 'dark', label: 'Sötét' },
      ],
      settings.theme,
      (v) => {
        update({ theme: v });
        applyTheme();
      },
      'sm',
    );
    const sdMode = segmented(
      'Csillag-delta irány',
      [
        { value: 'delta-csillag', label: 'Δ → Y' },
        { value: 'csillag-delta', label: 'Y → Δ' },
        { value: 'veletlen', label: 'Véletlen' },
      ],
      settings.starDeltaMode,
      (v) => update({ starDeltaMode: v as Settings['starDeltaMode'] }),
      'sm',
    );
    sdMode.el.hidden = !settings.starDelta;
    const row = (label: string, desc: string, control: HTMLElement) => h('div', { class: 'sheet-row' }, h('div', { class: 'sheet-text' }, h('span', { class: 'sheet-label', text: label }), h('span', { class: 'sheet-desc', text: desc })), control);
    const changed = () => {
      if (settings.mode === 'gyakorlas') newPractice();
    };
    dialog.append(
      h('div', { class: 'sheet-head' }, h('h2', { text: 'Beállítások' }), iconButton('Bezárás', ICONS.close, close)),
      row('Színmód', 'Világos vagy sötét megjelenés.', themeSeg.el),
      row(
        'Animáció sebessége',
        'Milyen gyorsan épüljenek fel a lépések lejátszáskor.',
        slider('Sebesség', 0.5, 2, 0.25, settings.speed, (v) => `${formatNumber(v, 3)}×`, (v) => {
          update({ speed: v });
          viewer.setSpeed(v);
        }),
      ),
      row('Áramkör újrarajzolása', 'Egyenáram: minden összevonás után újrarajzolja az áramkört, az eredő ellenállással.', toggle('', settings.redraw, (v) => update({ redraw: v })).el),
      row(
        'Csillag-delta feladatok',
        'Bekapcsolva a feladatok egy részében (kb. minden harmadikban) hidas hálózat jön, amihez csillag-delta átalakítás kell. A Csillag-delta témakörben mindig.',
        toggle('', settings.starDelta, (v) => {
          update({ starDelta: v, ...(v ? {} : { method: settings.method === 'csillag-delta' ? 'redukcio' : settings.method }) });
          sdMode.el.hidden = !v;
          changed();
        }).el,
      ),
      sdMode.el,
      row('Könnyített grafika', 'Elmosás és díszítő animációk nélkül, ha akadozik a gép.', toggle('', isLite(), (v) => setLite(v)).el),
      h('p', { class: 'sheet-keys', text: 'Billentyűk: N – új feladat, szóköz – lejátszás, ← → – lépések.' }),
    );
    dialog.addEventListener('close', () => dialog.remove());
    dialog.addEventListener('click', (e) => e.target === dialog && close());
    document.body.append(dialog);
    dialog.showModal();
  };

  // ───────── Útvonal ─────────

  const route = () => {
    stopTimer();
    modeSeg.set(settings.mode);
    domainSeg.set(settings.domain);
    document.title = `${MODE_NAMES[settings.mode]} · Villamosságtan`;
    if (settings.mode === 'gyakorlas') showPractice();
    else if (settings.mode === 'idore') showTimed();
    else if (settings.mode === 'vizsga') showExamStart();
    else showDaily();
  };

  document.addEventListener('keydown', (e) => {
    const t = e.target as HTMLElement;
    if (t.closest('input, select, textarea, dialog') || e.metaKey || e.ctrlKey || e.altKey) return;
    if ((e.key === 'n' || e.key === 'N') && settings.mode === 'gyakorlas') {
      e.preventDefault();
      newPractice();
    } else if (e.key === ' ' && !t.closest('button')) {
      e.preventDefault();
      viewer.el.querySelector<HTMLButtonElement>('.dock .icon-btn-primary')?.click();
    } else if (e.key === 'ArrowRight' && !t.closest('[role=radiogroup]')) {
      viewer.el.querySelector<HTMLButtonElement>('.dock [aria-label="Következő lépés"]')?.click();
    } else if (e.key === 'ArrowLeft' && !t.closest('[role=radiogroup]')) {
      viewer.el.querySelector<HTMLButtonElement>('.dock [aria-label="Előző lépés"]')?.click();
    }
  });

  // Éjfélkor új napi sor.
  let day = dayKey(new Date());
  window.setInterval(() => {
    const now = dayKey(new Date());
    if (now === day) return;
    day = now;
    if (settings.mode === 'napi') {
      dailyIndex = 0;
      showDaily();
      toast('Itt az új napi feladatsor!');
    }
  }, 30_000);

  applyTheme();
  route();
}
