// Az alkalmazás felülete: eszköztár, feladatfej, áramkör-vászon, megoldás panel, lejátszósáv.
// A megoldás lépésenként játszható le: az ábrán a lépéshez tartozó kiemelés, a panelen az
// egyenlet tagonként épül fel.

import { generateProblem, TOPIC_NAMES, type Problem, type Topic } from '../generator/generate';
import { randomSeed } from '../generator/rng';
import { TOPOLOGY_NAMES } from '../generator/templates';
import { LEVEL_NAMES, type Level } from '../generator/values';
import { applicableMethods, solveWith, type Solution } from '../methods';
import { computeLayout, type Layout } from '../render/layout';
import { flowSegments, stateCurrents } from '../render/flow';
import { focusBox, overlaySvg, type OverlayContext } from '../render/overlay';
import { renderCircuitSvg } from '../render/svg';
import type { Circuit } from '../solver/model';
import { toNetlist } from '../solver/netlist';
import { loadChart } from './loadChart';
import { checkAnswer, formatNumber, formatQuantity } from '../units';
import { checkCell, tableTargets, verify, type CellKey, type TableTarget } from '../methods/check';
import { trickHint } from '../simplify/hint';
import { recordAttempt } from './stats';
import { openStats } from './statsSheet';
import { TROPHY_ICON, openLeaderboard } from './leaderboardView';
import { dailyChallenge, dayKey } from '../daily/schedule';
import { loadProgress, openTask, recordEvent, type TaskEvent } from '../daily/progress';
import { PAR_MINUTES } from '../daily/score';
import { MIN_SOLVE_MS } from '../daily/share';
import { dailyBanner } from './daily';
import { dailyProblem } from '../daily/problem';
import type { Account } from '../online/league';
import { button, iconButton, segmented, select, slider, stepBar, toast, toggle, type SegmentOption } from './components';
import { h, icon, ICONS } from './dom';
import { FlowAnimator } from './flow';
import { Player } from './player';
import { loadSettings, methodList, saveSettings, type MethodId, type Settings, type StarDeltaMode, type ThemeChoice } from './settings';
import { stepList, type StepList } from './steps';

const THEME_NEXT: Record<ThemeChoice, ThemeChoice> = { system: 'light', light: 'dark', dark: 'system' };
const THEME_LABEL: Record<ThemeChoice, string> = { system: 'Színmód: rendszer', light: 'Színmód: világos', dark: 'Színmód: sötét' };

/** Kivel fut az app: belépett fiók, vendég (csak gyakorlás), vagy szerver nélkül (pontkódos ranglista). */
export interface AppSession {
  account: Account | null;
  mode: 'online' | 'guest' | 'offline';
  onLogin(): void;
  onLogout(): void;
}

export function startApp(root: HTMLElement, session: AppSession = { account: null, mode: 'offline', onLogin: () => {}, onLogout: () => {} }): void {
  const settings = loadSettings();
  // Vendégként nincs napi kihívás (az a fiókhoz kötött).
  if (session.mode === 'guest') settings.dailyActive = false;
  let seed = randomSeed();
  let problem: Problem | null = null;
  let solution: Solution | null = null;
  let layout: Layout | null = null;
  let overlayCtx: OverlayContext | null = null;
  let steps: StepList | null = null;
  let reverse = false;

  const update = (patch: Partial<Settings>) => {
    Object.assign(settings, patch);
    saveSettings(settings);
  };

  const applyTheme = () => {
    if (settings.theme === 'system') document.documentElement.removeAttribute('data-theme');
    else document.documentElement.setAttribute('data-theme', settings.theme);
    themeBtn.setAttribute('aria-label', THEME_LABEL[settings.theme]);
    themeBtn.title = THEME_LABEL[settings.theme];
  };

  // ───────── Eszköztár ─────────

  /** Melyik témakörben van biztosan ehhez a módszerhez illő feladat. */
  const METHOD_TOPIC: Record<MethodId, Topic> = {
    redukcio: 'eredo',
    kirchhoff: 'kirchhoff',
    hurokaram: 'tobbforras',
    szuperpozicio: 'tobbforras',
    thevenin: 'thevenin',
    'csillag-delta': 'csillag-delta',
    csomoponti: 'tobbforras',
  };

  /** A választott módszer nem illik a feladathoz: új feladatot hozunk, amit ezzel a módszerrel lehet megoldani. */
  const switchToMethod = (m: MethodId) => {
    const why = problem ? solveWith(problem, m) : null;
    const reason = why && !why.ok ? why.reason : '';
    const level = settings.topic === 'zh' ? 'zh' : settings.level;
    // Előbb a mostani témakörben próbálkozunk, aztán abban, ahol ez a módszer biztosan használható.
    for (const topic of [settings.topic, METHOD_TOPIC[m]]) {
      for (let i = 0; i < 25; i++) {
        const s = randomSeed();
        try {
          const p = generateProblem({ seed: s, topic, level: topic === 'zh' ? 'zh' : level === 'zh' ? 'nehez' : level, starDelta: settings.starDelta, starDeltaMode: settings.starDeltaMode });
          if (!applicableMethods(p).includes(m)) continue;
          if (topic !== settings.topic) {
            update({ topic });
            topicSel.setOptions(topicOptions(), topic);
            syncLevel();
          }
          update({ method: m });
          methodSeg.set(m);
          seed = s;
          generate();
          toast(`Ehhez a feladathoz nem jó ez a módszer${reason ? ` (${reason.replace(/\.$/, '')})` : ''}, ezért hoztam egy újat, amihez igen.`);
          return;
        } catch {
          // Ez a seed nem adott érvényes feladatot: jöhet a következő.
        }
      }
    }
    methodSeg.set(settings.method);
    toast('Nem találtam ehhez a módszerhez illő feladatot ebben a témakörben.');
  };

  /** Vizsga mód (beadás után ellenőrzés): csak a napi kihíváson kívül. */
  const isExam = () => settings.mode === 'vizsga' && !settings.dailyActive;
  /** Napi kihívásban a feladat módszere kötött (pl. a szuperpozíciós héten mindig szuperpozíció). */
  const lockedMethod = (): MethodId | null => {
    if (!settings.dailyActive) return null;
    const c = dailyChallenge(new Date(), settings.dailyLevel);
    return c.tasks[Math.min(dailyIndex, c.tasks.length - 1)]?.method ?? null;
  };

  const methodOptions = (): SegmentOption<MethodId>[] => methodList(settings.starDelta).map((m) => ({ value: m.id, label: m.label, badge: m.badge }));
  if (!methodOptions().some((o) => o.value === settings.method)) settings.method = 'redukcio';
  const methodSeg = segmented<MethodId>('Módszer', methodOptions(), settings.method, (v) => {
    const locked = lockedMethod();
    if (locked && v !== locked) {
      methodSeg.set(locked);
      toast(`A napi kihívásban ez a feladat ${methodList(settings.starDelta).find((m) => m.id === locked)?.label ?? locked} módszerrel megy`);
      return;
    }
    if (problem && !settings.dailyActive && !applicableMethods(problem).includes(v)) return switchToMethod(v);
    update({ method: v });
    solveCurrent();
  });

  const topicOptions = () => (Object.keys(TOPIC_NAMES) as Topic[]).filter((t) => t !== 'csillag-delta' || settings.starDelta).map((t) => ({ value: t, label: TOPIC_NAMES[t] }));
  if (!settings.starDelta && settings.topic === 'csillag-delta') settings.topic = 'oszto';
  const topicSel = select<Topic>(
    'Témakör',
    topicOptions(),
    settings.topic,
    (v) => {
      if (settings.dailyActive) setDaily(false);
      update({ topic: v });
      syncLevel();
      newProblem();
    },
  );
  const levelSel = select<Level>(
    'Nehézség',
    (Object.keys(LEVEL_NAMES) as Level[]).map((l) => ({ value: l, label: LEVEL_NAMES[l] })),
    settings.level,
    (v) => {
      if (settings.dailyActive) setDaily(false);
      update({ level: v });
      newProblem();
    },
  );
  const syncLevel = () => {
    const forced = settings.topic === 'zh';
    levelSel.setDisabled(forced);
    levelSel.set(forced ? 'zh' : settings.level);
  };

  const sdMode = segmented<StarDeltaMode>(
    'Csillag-delta irány',
    [
      { value: 'delta-csillag', label: 'Δ → Y' },
      { value: 'csillag-delta', label: 'Y → Δ' },
      { value: 'veletlen', label: 'Véletlen' },
    ],
    settings.starDeltaMode,
    (v) => {
      update({ starDeltaMode: v });
      newProblem();
    },
    'sm',
  );
  sdMode.el.hidden = !settings.starDelta;
  let topicBeforeSd: Topic = settings.topic === 'csillag-delta' ? 'eredo' : settings.topic;
  const sdToggle = toggle('Csillag-delta', settings.starDelta, (v) => {
    update({ starDelta: v });
    sdMode.el.hidden = !v;
    // Bekapcsolva csillag-delta átalakítást igénylő feladatok jönnek; kikapcsolva vissza az előző témakörre.
    if (v && settings.topic !== 'csillag-delta') {
      topicBeforeSd = settings.topic;
      update({ topic: 'csillag-delta' });
    }
    if (!v && settings.method === 'csillag-delta') update({ method: 'redukcio' });
    if (!v && settings.topic === 'csillag-delta') update({ topic: topicBeforeSd });
    topicSel.setOptions(topicOptions(), settings.topic);
    methodSeg.setOptions(methodOptions(), settings.method);
    syncLevel();
    // A napi kihívást a kapcsoló nem érinti (annak a feladatai mindenkinél ugyanazok).
    if (!settings.dailyActive) newProblem();
    else toast('A napi kihívás feladatai ettől nem változnak; a csillag-delta a szabad gyakorlásra vonatkozik.');
  });

  const statsBtn = iconButton('Statisztika', ICONS.stats, () => openStats());
  const leaderBtn = iconButton('Ranglista', TROPHY_ICON, () => openLeaderboard());
  leaderBtn.classList.add('lb-btn');

  // ───────── Napi kihívás ─────────

  let dailyIndex = 0;
  /** Melyik napi feladat van betöltve (nap|fokozat|feladat), vagy null szabad gyakorlásnál. */
  let dailyLoaded: string | null = null;
  let dailyDay = dayKey(new Date());
  const banner = dailyBanner(
    settings.dailyLevel,
    (l) => {
      update({ dailyLevel: l });
      dailyIndex = 0;
      generate();
    },
    (i) => {
      dailyIndex = i;
      generate();
    },
  );
  banner.el.hidden = !settings.dailyActive;
  const setDaily = (on: boolean) => {
    update({ dailyActive: on });
    banner.el.hidden = !on;
    dailyBtn.setAttribute('aria-pressed', String(on));
    dailyIndex = 0;
    if (on) generate();
    else newProblem();
  };
  const dailyBtn = iconButton('Napi kihívás', ICONS.calendar, () => (session.mode === 'guest' ? session.onLogin() : setDaily(!settings.dailyActive)));
  const accountEl = session.account
    ? h(
        'div',
        { class: 'account' },
        h('span', { class: 'account-name', attrs: { title: 'Belépve' }, text: session.account.username }),
        button('Kilépés', session.onLogout, 'quiet'),
      )
    : session.mode === 'guest'
      ? button('Belépés', session.onLogin, 'secondary')
      : null;
  dailyBtn.setAttribute('aria-pressed', String(settings.dailyActive));
  // Éjfélkor új napi kihívás.
  window.setInterval(() => {
    const now = dayKey(new Date());
    if (now === dailyDay) return;
    dailyDay = now;
    if (settings.dailyActive) {
      dailyIndex = 0;
      generate();
      toast('Itt az új napi kihívás!');
    }
  }, 1000);
  /** A napi feladat állapota: kész, ha minden kérdése helyes. */
  /** A kiválasztott napi feladat (napi módban). */
  const dailyTask = () => {
    if (!settings.dailyActive) return null;
    const c = dailyChallenge(new Date(), settings.dailyLevel);
    return { c, t: c.tasks[Math.min(dailyIndex, c.tasks.length - 1)]! };
  };
  /** Az aktuális napi feladat (ha a betöltött feladat az). */
  const currentDaily = () => {
    if (!settings.dailyActive || !problem) return null;
    const c = dailyChallenge(new Date(), settings.dailyLevel);
    const t = c.tasks[Math.min(dailyIndex, c.tasks.length - 1)]!;
    return dailyLoaded === `${c.day}|${settings.dailyLevel}|${t.id}` ? { c, t } : null;
  };
  /** Versenyesemény a napi feladaton (rossz válasz, tipp, trükk-tipp, teljes megoldás). */
  const dailyEvent = (ev: TaskEvent) => {
    const cur = currentDaily();
    if (!cur) return;
    recordEvent(cur.c.day, settings.dailyLevel, cur.t.id, ev);
    banner.render(cur.c, dailyIndex);
  };
  /** Ellenőrzés után: kész, ha minden kérdése helyes; a rossz válasz levonással jár. */
  /** Napi feladat, ami még nincs megoldva: ilyenkor nincs Ellenőrző nézet (az kiírná a választ). */
  const dailyUnsolved = () => {
    const cur = currentDaily();
    return !!cur && !loadProgress()[cur.c.day]?.[settings.dailyLevel]?.[cur.t.id]?.solvedAt;
  };
  const dailyUpdate = (wrongNow: boolean) => {
    const cur = currentDaily();
    if (!cur || !problem) return;
    const ok = (id: string, kind: string) => (kind === 'table' ? summaries.get(id)?.cls.includes('is-correct') : results.get(id)?.status === 'correct');
    const all = problem.questions.every((q) => ok(q.id, q.kind));
    if (all) {
      const before = banner.total();
      const first = !loadProgress()[cur.c.day]?.[settings.dailyLevel]?.[cur.t.id]?.solvedAt;
      recordEvent(cur.c.day, settings.dailyLevel, cur.t.id, 'solved');
      banner.render(cur.c, dailyIndex);
      // Megoldás után már elérhető az Ellenőrző nézet.
      if (first) renderPanel();
      // Első megoldáskor a pontozás-animáció, utána a szokásos jelzés.
      const rec = loadProgress()[cur.c.day]?.[settings.dailyLevel]?.[cur.t.id];
      // A Start utáni 10 mp-en belüli megoldás nem kap pontot (ennyi idő alatt nem lehet kiszámolni).
      const tooFast = !!rec?.solvedAt && rec.solvedAt - rec.opened < MIN_SOLVE_MS;
      const fx = first && !tooFast ? banner.celebrateSolve(cur.c.day, settings.dailyLevel, cur.t.id, cur.t.title, before) : Promise.resolve();
      void fx.then(() =>
        toast(
          tooFast
            ? `Helyes, de ${MIN_SOLVE_MS / 1000} mp-en belül a Start után: ez nem kap pontot.`
            : dailyIndex < cur.c.tasks.length - 1
              ? 'Megvan! Jöhet a következő feladat (N).'
              : 'Kész a mai kihívás!',
        ),
      );
      return;
    }
    if (wrongNow) recordEvent(cur.c.day, settings.dailyLevel, cur.t.id, 'wrong');
    banner.render(cur.c, dailyIndex);
  };
  const themeBtn = iconButton('Színmód', ICONS.theme, () => {
    update({ theme: THEME_NEXT[settings.theme] });
    applyTheme();
    toast(THEME_LABEL[settings.theme]);
  });

  const toolbar = h(
    'header',
    { class: 'toolbar' },
    h(
      'div',
      { class: 'brand' },
      h('span', { class: 'brand-mark', html: '<svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true"><path d="M2 9h3l2-5 4 10 2-5h3" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>' }),
      'Villamosságtan',
    ),
    methodSeg.el,
    h('div', { class: 'toolbar-group' }, dailyBtn, topicSel.el, levelSel.el, sdToggle.el, sdMode.el, leaderBtn, statsBtn, themeBtn, accountEl),
  );

  // ───────── Feladatfej ─────────

  const seedInput = h('input', {
    attrs: { 'aria-label': 'Seed', spellcheck: 'false', autocomplete: 'off' },
    on: {
      keydown: (e) => {
        if (e.key === 'Enter' && seedInput.value.trim()) {
          seed = seedInput.value.trim().toUpperCase();
          generate();
        }
      },
    },
  });
  const seedField = h(
    'span',
    { class: 'seed-field' },
    'seed ',
    seedInput,
    iconButton('Seed másolása', ICONS.copy, () => {
      void navigator.clipboard?.writeText(seed).then(
        () => toast('Seed másolva'),
        () => toast('A másolás nem sikerült'),
      );
    }),
  );
  const metaText = h('span');
  const title = h('h1', { class: 'problem-title' });
  // Új feladat (szabad gyakorlásnál; a napi kihívás feladatai rögzítettek).
  const newBtn = button('Új feladat', () => newProblem(), 'secondary');
  newBtn.classList.add('new-problem');
  newBtn.title = 'Új feladat ugyanebből a témakörből (N)';
  const head = h('div', { class: 'problem-head enter' }, h('div', { class: 'problem-meta' }, metaText, seedField, newBtn), title);

  // ───────── Vászon ─────────

  const canvas = h('div', { class: 'canvas', attrs: { role: 'img', 'aria-label': 'Áramkör' } });
  const exportBtn = iconButton('Ábra mentése SVG-ként', ICONS.download, () => {
    // Tiszta, teljes ábra (animáció és nagyítás nélkül).
    if (!shownCircuit) return;
    const svg = renderCircuitSvg(shownCircuit, { title: title.textContent ?? 'Áramkör' });
    const a = h('a', { attrs: { href: URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' })), download: `aramkor-${seed}.svg` } });
    a.click();
    URL.revokeObjectURL(a.href);
  });
  const legend = h(
    'div',
    { class: 'legend' },
    ...[
      ['var(--accent)', 'Áram, kérdéses elem'],
      ['var(--loop)', 'Hurok'],
      ['var(--node)', 'Csomópont'],
      ['var(--result)', 'Eredmény'],
    ].map(([c, t]) => h('span', {}, h('i', { attrs: { style: `--c:${c}` } }), t!)),
  );
  const canvasCard = h('section', { class: 'card canvas-card enter enter-2', attrs: { 'aria-label': 'Áramkör' } }, h('div', { class: 'card-bar' }, exportBtn), canvas, legend);

  /** Az aktuális lépés kiemelése az ábrán (elemek osztályai és a két kiemelési réteg). */
  /** A vásznon látható áramkör: a feladaté, vagy a lépés saját áramköre (pl. helyettesítő kép). */
  let shownCircuit: Circuit | null = null;
  const flow = new FlowAnimator();
  const showCircuit = (c: Circuit) => {
    if (c === shownCircuit) return;
    shownCircuit = c;
    layout = computeLayout(c);
    overlayCtx = { circuit: c, layout, map: toNetlist(c) };
    canvas.innerHTML = renderCircuitSvg(c, { title: title.textContent ?? 'Áramkör' }, layout);
    flow.attach(canvas.querySelector('svg')!);
    canvas.classList.remove('swap');
    void canvas.offsetWidth;
    canvas.classList.add('swap');
  };

  const applyHighlight = (index: number) => {
    const step = solution?.steps[index];
    if (problem) showCircuit(step?.circuit ?? problem.circuit);
    const svg = canvas.querySelector('svg');
    if (!svg || !overlayCtx) return;
    const hl = step?.highlight ?? {};
    const targets = new Set(step?.circuit ? [] : (problem?.questions.map((q) => q.target).filter(Boolean) as string[]));
    const strong = new Set(hl.elements ?? []);
    const faint = new Set([...(hl.dim ?? []), ...(hl.killed ?? []).map((k) => k.element)]);
    svg.querySelectorAll<SVGGElement>('.el').forEach((g) => {
      const id = g.dataset.id!;
      // A kérdéses elem végig megkülönböztetett marad; a lépés kiemelése erre rárakódik.
      g.classList.toggle('is-target', targets.has(id));
      g.classList.toggle('is-hl', strong.has(id) && !faint.has(id));
      g.classList.toggle('is-faint', faint.has(id));
    });
    const ov = overlaySvg(overlayCtx, hl);
    const under = svg.querySelector('.ov-under')!;
    const over = svg.querySelector('.ov-over')!;
    under.innerHTML = ov.under;
    over.innerHTML = ov.over;
    for (const layer of [under, over]) {
      layer.classList.remove('ov-in');
      void (layer as SVGGElement).getBBox?.();
      layer.classList.add('ov-in');
    }
    // Áramlás az adott állapot szerint: kiiktatott forrásnál, lekötött ágnál másként (vagy sehogy) folyik.
    if (shownCircuit && layout) flow.set(flowSegments(shownCircuit, layout, stateCurrents(shownCircuit, hl)));
    // Kamera: finoman ráközelít a lépés fókuszára.
    moveCamera(svg, focusBox(overlayCtx, hl));
  };

  /** A nézet (viewBox) rugalmas animálása a fókusz köré; ha nincs fókusz, a teljes ábra. */
  let camRaf = 0;
  const moveCamera = (svg: SVGSVGElement, focus: ReturnType<typeof focusBox>) => {
    if (!layout) return;
    const full = layout.viewBox;
    let target = { ...full };
    if (focus) {
      const pad = 70;
      let w = focus.x2 - focus.x1 + 2 * pad;
      let hgt = focus.y2 - focus.y1 + 2 * pad;
      const ratio = full.width / full.height;
      if (w / hgt < ratio) w = hgt * ratio;
      else hgt = w / ratio;
      // Legfeljebb kb. 1,6-szoros nagyítás; ha a fókusz majdnem az egész ábra, nincs nagyítás.
      if (w < full.width * 0.62) {
        w = full.width * 0.62;
        hgt = w / ratio;
      }
      if (w < full.width * 0.88) {
        const cx = (focus.x1 + focus.x2) / 2;
        const cy = (focus.y1 + focus.y2) / 2;
        const x = Math.min(Math.max(cx - w / 2, full.x), full.x + full.width - w);
        const y = Math.min(Math.max(cy - hgt / 2, full.y), full.y + full.height - hgt);
        target = { x, y, width: w, height: hgt };
      }
    }
    const cur = svg.viewBox.baseVal;
    const from = { x: cur.x, y: cur.y, width: cur.width, height: cur.height };
    cancelAnimationFrame(camRaf);
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    const dur = reduced ? 0 : 750;
    const t0 = performance.now();
    const ease = (t: number) => 1 - Math.pow(1 - t, 4);
    const tick = () => {
      const t = dur ? Math.min(1, (performance.now() - t0) / dur) : 1;
      const k = ease(t);
      const v = (a: number, b: number) => (a + (b - a) * k).toFixed(2);
      svg.setAttribute('viewBox', `${v(from.x, target.x)} ${v(from.y, target.y)} ${v(from.width, target.width)} ${v(from.height, target.height)}`);
      if (t < 1) camRaf = requestAnimationFrame(tick);
    };
    tick();
  };

  // ───────── Megoldás panel ─────────

  const panel = h('aside', { class: 'card panel enter enter-3', attrs: { 'aria-label': 'Megoldás' } });
  const panelCount = h('span', { class: 'panel-count' });

  // ───────── Gyakorló / vizsga mód, tipp, válaszok ─────────

  /** Hány lépés látszik a megoldásból (gyakorlóban a tipp egyenként nyitja). */
  let revealed = 0;
  /** A teljes megoldást kérték (módszerváltás után is maradjon látható). */
  let showAll = false;
  /** Vizsga módban beadva-e. */
  let submitted = false;
  let verifyOpen = false;
  let trickText = '';
  let examStart = performance.now();
  /** Beírt értékek, ítéletek, cellák állapota: túlélik a panel újrarajzolását. */
  const typed = new Map<string, string>();
  const results = new Map<string, ReturnType<typeof checkAnswer>>();
  const cellState = new Map<string, 'is-ok' | 'is-bad'>();
  const summaries = new Map<string, { cls: string; text: string }>();
  /** Kérdésenként csak az első ellenőrzés számít a statisztikába. */
  const recorded = new Set<string>();
  const timerEl = h('span', { class: 'timer num', attrs: { 'aria-live': 'off' } });
  window.setInterval(() => {
    if (!isExam() || submitted || !settings.examTimer) return;
    const s = Math.floor((performance.now() - examStart) / 1000);
    timerEl.textContent = `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
  }, 500);

  const record = (correct: boolean, key: string) => {
    if (!problem || recorded.has(key)) return;
    recorded.add(key);
    recordAttempt({ t: Date.now(), topic: problem.topic, level: problem.level, topology: problem.topology, method: settings.method, mode: settings.mode, correct });
  };

  const showVerdict = (verdict: HTMLElement, r: ReturnType<typeof checkAnswer>) => {
    verdict.className = 'verdict';
    verdict.replaceChildren();
    void verdict.offsetWidth;
    if (r.status === 'correct') {
      verdict.classList.add('is-correct');
      verdict.append(icon(ICONS.check, 16), 'Helyes');
    } else if (r.status === 'wrong-sign') {
      verdict.classList.add('is-wrong');
      verdict.append('Az előjel nem jó: figyeld a referenciairányt.');
    } else if (r.status === 'wrong') {
      verdict.classList.add('is-wrong');
      verdict.append('Nem ez az eredmény. Próbáld újra!');
    } else {
      verdict.classList.add('is-wrong');
      verdict.append(r.error);
    }
  };

  /** Beadáskor (vizsga) lefutó ellenőrzések. */
  let submitters: (() => void)[] = [];

  const answersSection = () => {
    if (!problem) return h('div');
    submitters = [];
    const exam = isExam();
    const parts = problem.questions.map((q, i) => {
      if (q.kind === 'table') return tableSection(q.id);
      const verdict = h('div', { class: 'verdict', attrs: { 'aria-live': 'polite' } });
      const input = h('input', {
        class: 'answer-input',
        attrs: { placeholder: q.unit ? `Válasz, pl. ${{ V: '4,5 V', A: '350 mA', Ω: '4,7 kΩ', W: '1,2 W' }[q.unit]}` : '', 'aria-label': `${i + 1}. kérdés válasza`, inputmode: 'decimal', autocomplete: 'off' },
        on: { keydown: (e) => e.key === 'Enter' && !exam && check(), input: () => typed.set(q.id, input.value) },
      });
      // A beírt érték és az ítélet túléli a panel újrarajzolását (pl. beadás, tipp).
      input.value = typed.get(q.id) ?? '';
      const check = () => {
        if (!q.unit) return;
        const r = checkAnswer(input.value, q.answer, q.unit, { magnitudeOnly: q.magnitudeOnly });
        if (r.status !== 'invalid') record(r.status === 'correct', q.id);
        results.set(q.id, r);
        showVerdict(verdict, r);
        dailyUpdate(r.status === 'wrong' || r.status === 'wrong-sign');
      };
      const prev = results.get(q.id);
      if (prev && !(exam && !submitted)) showVerdict(verdict, prev);
      if (exam) submitters.push(check);
      const label = problem!.questions.length > 1 ? `${String.fromCharCode(97 + i)}) ${q.text}` : 'Saját válasz';
      return h(
        'div',
        { class: 'question' },
        h('p', { class: problem!.questions.length > 1 ? 'question-text' : 'question-label', text: label }),
        h('div', { class: 'answer-row' }, input, exam ? null : button('Ellenőrzés', check, 'primary')),
        verdict,
      );
    });
    const submit = exam && !submitted ? button('Beadás', () => submitExam(), 'primary') : null;
    return h('section', { class: 'answers', attrs: { 'aria-label': 'Saját válasz' } }, ...parts, ...(submit ? [h('div', { class: 'submit-row' }, submit)] : []));
  };

  /** Táblázatkitöltős feladat: minden elem U, I, P értéke, cellánként ellenőrizve. */
  const tableSection = (qid: string) => {
    const targets = tableTargets(problem!);
    const cells: { input: HTMLInputElement; target: TableTarget; key: CellKey }[] = [];
    const row = (t: TableTarget) =>
      h(
        'tr',
        {},
        h('td', { text: t.label }),
        ...(['U', 'I', 'P'] as CellKey[]).map((key) => {
          const id = `${qid}|${t.element}|${key}`;
          const input = h('input', {
            class: 'cell-input num',
            attrs: { 'aria-label': `${t.element} ${key}`, inputmode: 'decimal', autocomplete: 'off', placeholder: key === 'U' ? 'V' : key === 'I' ? 'A' : 'W' },
            on: { input: () => typed.set(id, input.value) },
          });
          input.value = typed.get(id) ?? '';
          const st = cellState.get(id);
          if (st && !(isExam() && !submitted)) input.classList.add(st);
          cells.push({ input, target: t, key });
          return h('td', {}, input);
        }),
      );
    const summary = h('div', { class: 'verdict', attrs: { 'aria-live': 'polite' } });
    const check = () => {
      let ok = 0;
      let filled = 0;
      for (const c of cells) {
        c.input.classList.remove('is-ok', 'is-bad');
        if (!c.input.value.trim()) continue;
        filled++;
        const r = checkCell(c.input.value, c.target, c.key);
        const cls = r.status === 'correct' ? 'is-ok' : 'is-bad';
        c.input.classList.add(cls);
        cellState.set(`${qid}|${c.target.element}|${c.key}`, cls);
        if (r.status === 'correct') ok++;
      }
      const text = ok === cells.length ? 'Minden cella helyes' : `${ok} / ${cells.length} cella helyes${filled < cells.length ? ` (${cells.length - filled} üres)` : ''}`;
      const cls = `verdict ${ok === cells.length ? 'is-correct' : 'is-wrong'}`;
      summaries.set(qid, { cls, text });
      summary.className = cls;
      summary.textContent = text;
      dailyUpdate(filled === cells.length && ok !== cells.length);
      if (filled === cells.length) record(ok === cells.length, qid);
    };
    const prevSummary = summaries.get(qid);
    if (prevSummary && !(isExam() && !submitted)) {
      summary.className = prevSummary.cls;
      summary.textContent = prevSummary.text;
    }
    if (isExam()) submitters.push(check);
    return h(
      'div',
      { class: 'question' },
      h('p', { class: 'question-text', text: 'Töltsd ki a táblázatot: minden elem feszültsége, árama és teljesítménye a referenciairány szerint, előjelesen (a forrásé negatív, ha teljesítményt ad le).' }),
      h(
        'div',
        { class: 'table-wrap' },
        h('table', { class: 'value-table fill-table' }, h('thead', {}, h('tr', {}, h('th', { text: 'Elem' }), h('th', { text: 'U' }), h('th', { text: 'I' }), h('th', { text: 'P' }))), h('tbody', {}, ...targets.map(row))),
      ),
      isExam() ? null : h('div', { class: 'answer-row' }, button('Táblázat ellenőrzése', check, 'primary')),
      summary,
    );
  };

  const submitExam = () => {
    for (const s of submitters) s();
    submitted = true;
    revealed = solution?.steps.length ?? 0;
    toast('Beadva: a megoldás most már megnézhető');
    renderPanel();
    loadPlayer();
  };

  const modeSeg = segmented<'gyakorlo' | 'vizsga'>(
    'Mód',
    [
      { value: 'gyakorlo', label: 'Gyakorló' },
      { value: 'vizsga', label: 'Vizsga' },
    ],
    settings.mode,
    (v) => {
      update({ mode: v });
      newProblem();
    },
    'sm',
  );

  /** A tipp-gombok és a rejtett megoldás állapota. */
  const solutionControls = (): HTMLElement | null => {
    if (!solution) return null;
    const total = solution.steps.length;
    if (isExam() && !submitted) {
      return h('p', { class: 'panel-empty' }, 'Vizsga mód: a megoldás a beadás után látható. Írd be a válaszaidat, aztán add be.');
    }
    if (isExam() || revealed >= total) return null;
    const tip = button(revealed === 0 ? 'Tipp: első lépés' : 'Tipp: következő lépés', () => reveal(revealed + 1), 'secondary');
    const all = button('Teljes megoldás', () => reveal(total), 'primary');
    const trick = button(
      'Trükk-tipp',
      () => {
        if (!trickText) dailyEvent('trick');
        trickText = trickHint(problem!, settings.starDelta);
        renderPanel();
      },
      'quiet',
    );
    return h(
      'div',
      { class: 'hint-box' },
      revealed === 0 ? h('p', { class: 'hint-lead', text: 'Próbáld meg előbb magad! Ha elakadsz, a tipp csak a következő lépést mutatja meg.' }) : null,
      h('div', { class: 'hint-actions' }, tip, all, trick),
      trickText ? h('p', { class: 'hint-trick', text: trickText }) : null,
    );
  };

  const reveal = (n: number) => {
    const total = solution?.steps.length ?? 0;
    // Napi kihívásban: minden tipp-lépés levonás, a teljes megoldás nullázza a feladatot.
    if (n >= total) dailyEvent('solution');
    else for (let k = revealed; k < n; k++) dailyEvent('tip');
    revealed = Math.min(n, total);
    if (solution && revealed >= solution.steps.length) showAll = true;
    renderPanel();
    loadPlayer(true);
  };

  /** A lejátszó csak a már felfedett lépéseket kapja. */
  const loadPlayer = (toLast = false) => {
    const visible = solution ? solution.steps.slice(0, revealed) : [];
    player.load(visible);
    setDockEnabled(visible.length > 0);
    if (toLast && visible.length) player.go(visible.length - 1);
    if (!visible.length) applyHighlight(-1);
  };

  /** Ellenőrző nézet: minden alkalmazható módszer eredménye egymás mellett, MNA és mérlegek. */
  const verifyView = (): HTMLElement => {
    const v = verify(problem!);
    const names = new Map(methodList(true).map((m) => [m.id, m.label]));
    const fmt = (x: number | undefined, unit: string | null) => (x === undefined ? '–' : unit ? formatQuantity(x, unit as 'V') : formatNumber(x));
    const ok = (x: number | undefined, ref: number) => x !== undefined && Math.abs(Math.abs(x) - Math.abs(ref)) <= 1e-9 * Math.max(1, Math.abs(ref));
    return h(
      'section',
      { class: 'verify-card', attrs: { 'aria-label': 'Ellenőrző nézet' } },
      h('h3', { class: 'chart-title', text: 'Ellenőrző nézet' }),
      h('p', { class: 'step-note', text: 'Minden alkalmazható módszer saját számolása egymás mellett, és a referencia (MNA). Ha minden pipa zöld, a módszerek egyetértenek.' }),
      h(
        'div',
        { class: 'table-wrap' },
        h(
          'table',
          { class: 'value-table' },
          h('thead', {}, h('tr', {}, h('th', { text: 'Kérdés' }), h('th', { text: 'MNA' }), ...v.methods.map((m) => h('th', { text: names.get(m) ?? m })))),
          h(
            'tbody',
            {},
            ...v.rows.map((r, i) =>
              h(
                'tr',
                {},
                h('td', { text: v.rows.length > 1 ? `${String.fromCharCode(97 + i)})` : '1.' }),
                h('td', { text: fmt(r.reference, r.unit) }),
                ...v.methods.map((m) => h('td', { class: r.byMethod[m] === undefined ? '' : ok(r.byMethod[m], r.reference) ? 'is-ok-text' : 'is-neg', text: r.byMethod[m] === undefined ? '–' : `${fmt(r.byMethod[m], r.unit)} ${ok(r.byMethod[m], r.reference) ? '✓' : '✗'}` })),
              ),
            ),
          ),
        ),
      ),
      h(
        'ul',
        { class: 'step-bullets' },
        h('li', { text: `Teljesítménymérleg: ΣP = ${formatQuantity(Math.abs(v.powerSum) < 1e-9 ? 0 : v.powerSum, 'W')} ${Math.abs(v.powerSum) < 1e-9 ? '✓' : '✗'}` }),
        h('li', { text: `Kirchhoff-törvények: a legnagyobb eltérés ${formatNumber(v.kirchhoffResidual < 1e-12 ? 0 : v.kirchhoffResidual)} ${v.kirchhoffResidual < 1e-9 ? '✓' : '✗'}` }),
      ),
    );
  };

  const renderPanel = (reason?: string, alternatives: MethodId[] = []) => {
    const method = methodList(settings.starDelta).find((m) => m.id === settings.method)!;
    const headRow = h('div', { class: 'panel-head' }, h('h2', { class: 'panel-title', text: solution?.title ?? method.label }), panelCount);
    const modeRow = h(
      'div',
      { class: 'mode-row' },
      settings.dailyActive ? h('span', { class: 'mode-daily', text: 'Napi kihívás: azonnali ellenőrzés, pontozással' }) : modeSeg.el,
      isExam()
        ? toggle('Időmérő', settings.examTimer, (v) => {
            update({ examTimer: v });
            timerEl.textContent = v ? timerEl.textContent : '';
          }).el
        : null,
      isExam() && settings.examTimer ? timerEl : null,
      h('span', { class: 'spacer' }),
      !(isExam() && !submitted) && !dailyUnsolved()
        ? button(
            verifyOpen ? 'Ellenőrzés elrejtése' : 'Ellenőrző nézet',
            () => {
              verifyOpen = !verifyOpen;
              renderPanel();
            },
            'quiet',
          )
        : null,
    );
    const extras: HTMLElement[] = [];
    if (settings.method === 'kirchhoff' && solution) {
      extras.push(
        toggle('Ellentétes körüljárás', reverse, (v) => {
          reverse = v;
          solveCurrent();
        }).el,
      );
    }
    let body: HTMLElement | null;
    const visibleSteps = solution ? solution.steps.slice(0, revealed) : [];
    if (solution) {
      steps = visibleSteps.length
        ? stepList(visibleSteps, (i) => {
            player.pause();
            player.go(i);
          })
        : null;
      body = steps?.el ?? null;
    } else {
      steps = null;
      const names = new Map(methodList(settings.starDelta).map((m) => [m.id, m.label]));
      body = h(
        'div',
        { class: 'panel-empty' },
        h('p', { text: reason ?? 'Ehhez a feladathoz ez a módszer nem alkalmazható.' }),
        alternatives.length
          ? h(
              'div',
              { class: 'alt-methods' },
              ...alternatives.map((m) =>
                button(
                  names.get(m) ?? m,
                  () => {
                    update({ method: m });
                    methodSeg.set(m);
                    solveCurrent();
                  },
                  'quiet',
                ),
              ),
            )
          : null,
      );
    }
    const chart = problem?.topic === 'valodi-gen' ? loadChart(problem) : null;
    const controls = solutionControls();
    panel.replaceChildren(
      headRow,
      modeRow,
      ...extras,
      ...(body ? [body] : []),
      ...(controls ? [controls] : []),
      ...(verifyOpen && problem && !(isExam() && !submitted) && !dailyUnsolved() ? [verifyView()] : []),
      ...(chart ? [chart] : []),
      answersSection(),
    );
    panel.classList.remove('swap');
    void panel.offsetWidth;
    panel.classList.add('swap');
  };

  // ───────── Lejátszósáv ─────────

  const bar = stepBar((i) => {
    player.pause();
    player.go(i);
  });
  const playBtn = iconButton('Lejátszás', ICONS.play, () => player.toggle(), 'primary', true);
  const prevBtn = iconButton('Előző lépés', ICONS.prev, () => {
    player.pause();
    player.prev();
  });
  const nextBtn = iconButton('Következő lépés', ICONS.next, () => {
    player.pause();
    player.next();
  });
  const restartBtn = iconButton('Újrakezdés', ICONS.restart, () => player.restart());
  const count = h('span', { class: 'dock-count', text: '0 / 0' });

  const player = new Player({
    onStep: (i) => {
      steps?.show(i, player.getSpeed(), true);
      applyHighlight(i);
      count.textContent = `${i + 1} / ${player.count}`;
      panelCount.textContent = solution ? `${i + 1} / ${player.count}` : '';
      prevBtn.setAttribute('aria-disabled', String(i <= 0));
      nextBtn.setAttribute('aria-disabled', String(i >= player.count - 1));
    },
    onProgress: (i, p) => bar.update(player.count, i, p),
    onPlaying: (playing) => {
      playBtn.replaceChildren(icon(playing ? ICONS.pause : ICONS.play, 16, true));
      playBtn.setAttribute('aria-label', playing ? 'Szünet' : 'Lejátszás');
      playBtn.title = playing ? 'Szünet' : 'Lejátszás';
    },
  });
  player.setSpeed(settings.speed);

  const dock = h(
    'nav',
    { class: 'dock', attrs: { 'aria-label': 'Lejátszás' } },
    restartBtn,
    prevBtn,
    playBtn,
    nextBtn,
    bar.el,
    count,
    slider('Sebesség', 0.5, 2, 0.25, settings.speed, (v) => `${formatNumber(v, 3)}×`, (v) => {
      update({ speed: v });
      player.setSpeed(v);
    }),
  );

  const setDockEnabled = (on: boolean) => {
    for (const b of [playBtn, prevBtn, nextBtn, restartBtn]) b.setAttribute('aria-disabled', String(!on));
    if (!on) {
      bar.update(0, 0);
      count.textContent = '0 / 0';
    }
  };

  // ───────── Feladat és megoldás ─────────

  const solveCurrent = () => {
    if (!problem) return;
    const usable = applicableMethods(problem);
    const locked = lockedMethod();
    if (locked && settings.method !== locked) {
      update({ method: locked });
      methodSeg.set(locked);
    }
    // Ha a választott módszer nem illik a feladathoz, de van más, arra váltunk (napi módban nem).
    if (!locked && !usable.includes(settings.method) && usable.length) {
      update({ method: usable[0]! });
      methodSeg.set(usable[0]!);
    }
    const prefer = settings.starDeltaMode === 'veletlen' ? undefined : settings.starDeltaMode;
    const r = solveWith(problem, settings.method, { reverse, prefer });
    solution = r.ok ? r.solution : null;
    const reasonText = r.ok ? undefined : usable.length ? r.reason : 'Ehhez a feladathoz nincs alkalmazható módszer.';
    const alternatives = locked ? [] : usable.filter((m) => m !== settings.method);
    // Ha már minden látszott (vagy beadták), módszerváltáskor is minden látszik.
    if (solution && (showAll || submitted)) revealed = solution.steps.length;
    else revealed = Math.min(revealed, solution?.steps.length ?? 0);
    renderPanel(reasonText, alternatives);
    loadPlayer();
  };

  const generate = () => {
    try {
      if (settings.dailyActive) {
        const c = dailyChallenge(new Date(), settings.dailyLevel);
        dailyIndex = Math.min(dailyIndex, c.tasks.length - 1);
        const t = c.tasks[dailyIndex]!;
        problem = dailyProblem(t);
        seed = problem.seed;
        dailyLoaded = `${c.day}|${settings.dailyLevel}|${t.id}`;
        // Napi módban csak az a kérdés marad, amire a nap módszere választ ad.
        const r = solveWith(problem, t.method);
        if (r.ok) {
          const answered = new Set(r.solution.answers.map((a) => a.questionId));
          const kept = problem.questions.filter((q) => answered.has(q.id));
          if (kept.length) problem = { ...problem, questions: kept };
        }
        if (settings.method !== t.method) {
          update({ method: t.method });
          methodSeg.set(t.method);
        }
        banner.render(c, dailyIndex);
      } else {
        dailyLoaded = null;
        problem = generateProblem({ seed, topic: settings.topic, level: settings.level, starDelta: settings.starDelta, starDeltaMode: settings.starDeltaMode });
      }
    } catch (e) {
      toast(String(e instanceof Error ? e.message : e));
      return;
    }
    seedInput.value = seed;
    newBtn.hidden = settings.dailyActive;
    reverse = false;
    revealed = 0;
    showAll = false;
    submitted = false;
    trickText = '';
    recorded.clear();
    typed.clear();
    results.clear();
    cellState.clear();
    summaries.clear();
    examStart = performance.now();
    timerEl.textContent = isExam() && settings.examTimer ? '00:00' : '';
    const p = problem;
    const parts = [TOPIC_NAMES[p.topic], LEVEL_NAMES[p.level], p.topology === 'egyedi' ? null : TOPOLOGY_NAMES[p.topology], `${p.stats.sources} forrás`, `${p.stats.resistors} ellenállás`];
    metaText.textContent = parts.filter(Boolean).join(' · ');
    title.textContent = p.questions.length === 1 ? p.questions[0]!.text : `${TOPIC_NAMES[p.topic]}: ${p.questions.length} részkérdés`;
    shownCircuit = null;
    showCircuit(p.circuit);
    syncGate();
    solveCurrent();
  };

  const newProblem = () => {
    seed = randomSeed();
    generate();
  };

  // ───────── Billentyűk ─────────

  document.addEventListener('keydown', (e) => {
    const t = e.target as HTMLElement;
    if (t.closest('input, select, textarea') || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === 'n' || e.key === 'N') {
      e.preventDefault();
      if (settings.dailyActive) {
        const len = dailyChallenge(new Date(), settings.dailyLevel).tasks.length;
        dailyIndex = (dailyIndex + 1) % len;
        generate();
      } else newProblem();
    } else if ((e.key === 'm' || e.key === 'M') && !lockedMethod()) {
      e.preventDefault();
      const opts = methodOptions();
      const i = opts.findIndex((o) => o.value === settings.method);
      const next = opts[(i + 1) % opts.length]!.value;
      update({ method: next });
      methodSeg.set(next);
      solveCurrent();
    } else if (e.key === ' ' && !t.closest('button')) {
      e.preventDefault();
      player.toggle();
    } else if (e.key === 'ArrowRight' && !t.closest('[role=radiogroup]')) {
      e.preventDefault();
      player.pause();
      player.next();
    } else if (e.key === 'ArrowLeft' && !t.closest('[role=radiogroup]')) {
      e.preventDefault();
      player.pause();
      player.prev();
    }
  });

  // Napi kihívásban a feladat (rajz, kérdés, megoldás) csak a Start után látszik; az óra is akkor indul.
  const workspace = h('div', { class: 'workspace' }, canvasCard, panel);
  const gateTitle = h('h3', { class: 'daily-gate-title' });
  const gateInfo = h('p', { class: 'daily-gate-info' });
  const startBtn = button('Start', () => {
    const cur = dailyTask();
    if (!cur) return;
    openTask(cur.c.day, settings.dailyLevel, cur.t.id);
    syncGate();
    banner.render(cur.c, dailyIndex);
  }, 'primary');
  startBtn.classList.add('daily-gate-start');
  const gate = h('section', { class: 'card daily-gate enter', attrs: { 'aria-label': 'Feladat indítása' } }, gateTitle, gateInfo, startBtn);
  function syncGate() {
    const cur = dailyTask();
    const waiting = !!cur && !loadProgress()[cur.c.day]?.[settings.dailyLevel]?.[cur.t.id];
    gate.hidden = !waiting;
    workspace.hidden = waiting;
    head.hidden = waiting;
    dock.hidden = waiting;
    if (!waiting || !cur) return;
    gateTitle.textContent = `${cur.c.tasks.indexOf(cur.t) + 1}. feladat: ${cur.t.title}`;
    gateInfo.textContent = `Csak akkor nyomd meg, ha neki is állsz: az óra a Start megnyomásakor indul, és utána nem áll meg (újratöltéskor sem). Célidő: ${PAR_MINUTES[settings.dailyLevel]} perc, a felén belül dupla pont.`;
    if (document.activeElement === document.body) startBtn.focus();
  }

  root.replaceChildren(toolbar, h('main', { class: 'main' }, banner.el, gate, head, workspace), dock);
  applyTheme();
  syncLevel();
  generate();
}
