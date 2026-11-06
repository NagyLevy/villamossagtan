// Egy feladat megjelenítése: cím és adatok, áramkör-vászon a lejátszóval, megoldás panel és a
// saját válasz mezői. Gyakorló módban azonnal ellenőriz, tippet ad; teszt módban (időre, próbavizsga)
// a megoldás csak beadás után látszik. Egyenáramú és szinuszos feladatot is ugyanígy kezel.

import katex from 'katex';
import { applicableMethods, solveWith, type Solution } from '../methods';
import { methodFit } from '../methods/fit';
import { checkCell, tableTargets, verify, type CellKey, type TableTarget } from '../methods/check';
import { computeLayout, type Layout } from '../render/layout';
import { flowSegments, stateCurrents } from '../render/flow';
import { overlaySvg, type OverlayContext } from '../render/overlay';
import { renderCircuitSvg } from '../render/svg';
import { allElements, type Circuit } from '../solver/model';
import { toNetlist } from '../solver/netlist';
import { trickHint } from '../simplify/hint';
import { checkField, verdictText, type FieldResult } from '../tasks/check';
import type { Task } from '../tasks/types';
import { formatNumber, formatQuantity } from '../units';
import { button, iconButton, select, stepBar, toggle } from './components';
import { h, icon, ICONS } from './dom';
import { FlowAnimator } from './flow';
import { loadChart } from './loadChart';
import { Player } from './player';
import { methodList, type MethodId, type Settings } from './settings';
import { stepList, type StepList } from './steps';

export type ViewerMode = 'practice' | 'test';

export interface LoadOptions {
  mode: ViewerMode;
  /** Egyenáramú feladatnál a választott módszer. */
  method?: MethodId;
  /** A módszer nem választható (napi feladatsor). */
  lockedMethod?: boolean;
  /** Korábban beírt válaszok (próbavizsgában a feladatok közti váltáskor). */
  answers?: Map<string, string>;
  /** Beadva: a megoldás és az ítéletek látszanak. */
  submitted?: boolean;
  /** Napi feladatnál: a feladat felett megjelenő sáv (tipp, haladás). */
  banner?: HTMLElement | null;
  /** Látszik-e az "Új feladat" gomb (csak szabad gyakorlásnál). */
  allowNew?: boolean;
}

export interface ViewerHooks {
  settings: () => Settings;
  /** Minden kérdésre helyes válasz érkezett (gyakorló módban). */
  onAllCorrect?: () => void;
  /** Gyakorlásnál a módszerválasztás: a hívó dönti el, kell-e hozzá új feladat. */
  onMethodPick?: (m: MethodId) => void;
  /** Új feladat kérése (gyakorlásnál a fejlécben). */
  onNewTask?: () => void;
}

/** Egy kérdés eredménye: helyes mezők / összes mező. */
export interface Score {
  correct: number;
  total: number;
}

function tex(src: string): string {
  return katex.renderToString(src, { throwOnError: false, displayMode: false, strict: false });
}

export class TaskViewer {
  readonly el: HTMLElement;
  private task: Task | null = null;
  private solution: Solution | null = null;
  private reason = '';
  private alternatives: MethodId[] = [];
  private method: MethodId = 'redukcio';
  private mode: ViewerMode = 'practice';
  private lockedMethod = false;
  private submitted = false;
  private revealed = 0;
  private showAll = false;
  private verifyOpen = false;
  private trickText = '';
  private reverse = false;
  private answers = new Map<string, string>();
  private results = new Map<string, FieldResult>();
  private cellState = new Map<string, 'is-ok' | 'is-bad'>();
  private tableSummary = new Map<string, { ok: boolean; text: string }>();
  private allCorrectFired = false;

  // Vászon
  private layout: Layout | null = null;
  private overlayCtx: OverlayContext | null = null;
  private shownCircuit: Circuit | null = null;
  private flow = new FlowAnimator();
  private pendingMerge = 0;
  private lastIndex = -1;
  private steps: StepList | null = null;

  private readonly head: HTMLElement;
  private readonly metaText: HTMLElement;
  private readonly title: HTMLElement;
  private readonly given: HTMLElement;
  private readonly fitText: HTMLElement;
  private readonly bannerSlot: HTMLElement;
  private readonly canvas: HTMLElement;
  private readonly canvasCard: HTMLElement;
  private readonly panel: HTMLElement;
  private readonly panelCount: HTMLElement;
  private readonly newBtn: HTMLButtonElement;
  private readonly player: Player;
  private readonly bar: ReturnType<typeof stepBar>;
  private readonly playBtn: HTMLButtonElement;
  private readonly prevBtn: HTMLButtonElement;
  private readonly nextBtn: HTMLButtonElement;
  private readonly restartBtn: HTMLButtonElement;
  private readonly count: HTMLElement;
  private readonly dock: HTMLElement;

  constructor(private readonly hooks: ViewerHooks) {
    this.metaText = h('span', { class: 'meta-text' });
    this.title = h('h1', { class: 'problem-title' });
    this.given = h('div', { class: 'given' });
    this.fitText = h('p', { class: 'method-fit' });
    this.bannerSlot = h('div', { class: 'banner-slot' });
    this.newBtn = button('Új feladat', () => this.hooks.onNewTask?.(), 'secondary');
    this.newBtn.classList.add('new-problem');
    this.newBtn.title = 'Új feladat ugyanebből a témakörből (N)';
    this.head = h('div', { class: 'problem-head' }, h('div', { class: 'problem-meta' }, this.metaText, this.newBtn), this.title, this.given, this.fitText);

    this.canvas = h('div', { class: 'canvas', attrs: { role: 'img', 'aria-label': 'Áramkör' } });
    const exportBtn = iconButton('Ábra mentése SVG-ként', ICONS.download, () => this.exportSvg());
    const legend = h(
      'div',
      { class: 'legend' },
      ...[
        ['var(--accent)', 'Kérdéses / aktuális elem'],
        ['var(--loop)', 'Hurok'],
        ['var(--node)', 'Csomópont'],
        ['var(--result)', 'Eredmény'],
      ].map(([c, t]) => h('span', {}, h('i', { attrs: { style: `--c:${c}` } }), t!)),
    );

    // Lejátszó: a rajz alatt, a kártyán belül (nem takar ki semmit).
    this.bar = stepBar((i) => {
      this.player.pause();
      this.player.go(i);
    });
    this.playBtn = iconButton('Lejátszás', ICONS.play, () => this.player.toggle(), 'primary', true);
    this.prevBtn = iconButton('Előző lépés', ICONS.prev, () => {
      this.player.pause();
      this.player.prev();
    });
    this.nextBtn = iconButton('Következő lépés', ICONS.next, () => {
      this.player.pause();
      this.player.next();
    });
    this.restartBtn = iconButton('Elölről', ICONS.restart, () => this.player.restart());
    this.count = h('span', { class: 'dock-count', text: '0 / 0' });
    this.panelCount = h('span', { class: 'panel-count' });
    this.player = new Player({
      onStep: (i) => {
        this.steps?.show(i, this.player.getSpeed(), true);
        this.applyHighlight(i);
        this.count.textContent = `${i + 1} / ${this.player.count}`;
        this.panelCount.textContent = this.solution && i >= 0 ? `${i + 1} / ${this.player.count}` : '';
        this.prevBtn.setAttribute('aria-disabled', String(i <= 0));
        this.nextBtn.setAttribute('aria-disabled', String(i >= this.player.count - 1));
      },
      onProgress: (i, p) => this.bar.update(this.player.count, i, p),
      onPlaying: (playing) => {
        this.playBtn.replaceChildren(icon(playing ? ICONS.pause : ICONS.play, 16, true));
        this.playBtn.setAttribute('aria-label', playing ? 'Szünet' : 'Lejátszás');
        this.playBtn.title = playing ? 'Szünet' : 'Lejátszás';
      },
    });
    this.player.setSpeed(this.hooks.settings().speed);
    this.dock = h('nav', { class: 'dock', attrs: { 'aria-label': 'Lépések lejátszása' } }, this.restartBtn, this.prevBtn, this.playBtn, this.nextBtn, this.bar.el, this.count);
    this.canvasCard = h('section', { class: 'card canvas-card', attrs: { 'aria-label': 'Áramkör' } }, h('div', { class: 'card-bar' }, exportBtn), this.canvas, this.dock, legend);
    this.panel = h('aside', { class: 'card panel', attrs: { 'aria-label': 'Megoldás' } });
    this.el = h('div', { class: 'viewer' }, this.bannerSlot, this.head, h('div', { class: 'workspace' }, this.canvasCard, this.panel));
  }

  setSpeed(v: number): void {
    this.player.setSpeed(v);
  }

  get current(): Task | null {
    return this.task;
  }

  /** A beírt válaszok (próbavizsgában a feladatok közti váltáshoz). */
  get typed(): Map<string, string> {
    return this.answers;
  }

  load(task: Task, opts: LoadOptions): void {
    this.task = task;
    // Fejlesztéskor a böngésző konzoljából elérhető (teszteléshez); élesben nincs.
    if (import.meta.env.DEV) (window as unknown as { __task?: Task }).__task = task;
    this.mode = opts.mode;
    this.method = opts.method ?? this.method;
    this.lockedMethod = !!opts.lockedMethod;
    this.submitted = !!opts.submitted;
    this.answers = opts.answers ?? new Map();
    this.results.clear();
    this.cellState.clear();
    this.tableSummary.clear();
    this.allCorrectFired = false;
    this.revealed = 0;
    this.showAll = false;
    this.verifyOpen = false;
    this.trickText = '';
    this.reverse = false;
    this.lastIndex = -1;
    this.bannerSlot.replaceChildren(...(opts.banner ? [opts.banner] : []));
    // A feladat kódja (seed) hibabejelentéshez: ugyanazzal a kóddal ugyanez a feladat jön.
    this.metaText.textContent = [task.topicName, task.meta, `kód: ${task.seed}`].filter(Boolean).join(' · ');
    this.title.textContent = task.title;
    this.given.replaceChildren(...(task.given ?? []).map((g) => h('span', { class: 'given-item', html: tex(g) })));
    this.given.hidden = !task.given?.length;
    this.newBtn.hidden = !this.hooks.onNewTask || !opts.allowNew;
    this.shownCircuit = null;
    if (task.circuit) this.showCircuit(task.circuit);
    else this.canvas.replaceChildren();
    this.canvasCard.hidden = !task.circuit;
    if (this.submitted) this.evaluateAll();
    this.solveCurrent();
  }

  /** Módszerváltás ugyanazon a feladaton (egyenáram). */
  setMethod(m: MethodId): void {
    this.method = m;
    this.solveCurrent();
  }

  /** Beadás (teszt mód): minden mező ellenőrzése, a megoldás felfedése. */
  submit(): Score {
    this.submitted = true;
    const s = this.evaluateAll();
    this.solveCurrent();
    return s;
  }

  /** A mostani válaszok pontszáma (beadás nélkül is számolható, pl. a próbavizsga összesítőjéhez). */
  score(): Score {
    return scoreTask(this.task!, this.answers);
  }

  private evaluateAll(): Score {
    const t = this.task!;
    for (const q of t.questions) {
      for (const f of q.fields) {
        const v = this.answers.get(f.id) ?? '';
        if (v.trim()) this.results.set(f.id, checkField(v, f));
        else this.results.delete(f.id);
      }
      if (q.table && t.dc) this.checkTable(q.id, null);
    }
    return scoreTask(t, this.answers);
  }

  // ───────── Megoldás ─────────

  private solveCurrent(): void {
    const t = this.task;
    if (!t) return;
    this.alternatives = [];
    this.reason = '';
    if (t.dc) {
      const usable = applicableMethods(t.dc);
      if (!this.lockedMethod && !usable.includes(this.method) && usable.length) this.method = this.hooks.settings().starDelta && usable.includes('csillag-delta') ? 'csillag-delta' : usable[0]!;
      const s = this.hooks.settings();
      const prefer = s.starDeltaMode === 'veletlen' ? undefined : s.starDeltaMode;
      const r = solveWith(t.dc, this.method, { reverse: this.reverse, prefer });
      this.solution = r.ok ? r.solution : null;
      this.reason = r.ok ? '' : usable.length ? r.reason : 'Ehhez a feladathoz nincs alkalmazható módszer.';
      this.alternatives = this.lockedMethod ? [] : usable.filter((m) => m !== this.method);
      // Teszt módban (időre, próbavizsga) a "melyik módszer illik" mondat tipp lenne: nem írjuk ki.
      const fit = this.lockedMethod || (this.mode === 'test' && !this.submitted) ? null : methodFit(this.method, t.dc, true);
      this.fitText.textContent = fit?.ok && fit.why ? fit.why : '';
    } else {
      this.solution = t.solution ?? null;
      this.fitText.textContent = '';
    }
    this.fitText.hidden = !this.fitText.textContent;
    const total = this.solution?.steps.length ?? 0;
    if (this.submitted || this.showAll) this.revealed = total;
    else this.revealed = Math.min(this.revealed, total);
    this.renderPanel();
    this.loadPlayer();
  }

  private reveal(n: number): void {
    const total = this.solution?.steps.length ?? 0;
    this.revealed = Math.min(n, total);
    if (this.revealed >= total) this.showAll = true;
    this.renderPanel();
    this.loadPlayer(true);
  }

  private loadPlayer(toLast = false): void {
    const visible = this.solution ? this.solution.steps.slice(0, this.revealed) : [];
    this.player.load(visible);
    this.dock.classList.toggle('is-idle', visible.length === 0);
    this.dock.hidden = this.mode === 'test' && !this.submitted;
    for (const b of [this.playBtn, this.prevBtn, this.nextBtn, this.restartBtn]) b.setAttribute('aria-disabled', String(visible.length === 0));
    if (!visible.length) {
      this.bar.update(0, 0);
      this.count.textContent = '0 / 0';
      this.applyHighlight(-1);
    }
    if (toLast && visible.length) this.player.go(visible.length - 1);
  }

  // ───────── Panel ─────────

  private renderPanel(): void {
    const t = this.task!;
    const testHidden = this.mode === 'test' && !this.submitted;
    const titleText = t.dc ? 'Megoldás' : (this.solution?.title ?? 'Megoldás');
    const headRow = h('div', { class: 'panel-head' }, h('h2', { class: 'panel-title', text: titleText }), this.panelCount);
    const parts: HTMLElement[] = [headRow];

    if (t.dc && !testHidden) {
      // Módszerválasztó: egy legördülő a sok fül helyett.
      const opts = methodList(this.hooks.settings().starDelta).map((m) => ({ value: m.id, label: m.label }));
      const sel = select<MethodId>('Megoldási módszer', opts, this.method, (v) => {
        if (this.hooks.onMethodPick && this.mode === 'practice') this.hooks.onMethodPick(v);
        else this.setMethod(v);
      });
      if (this.lockedMethod) sel.setDisabled(true);
      const row = h('div', { class: 'method-row' }, h('span', { class: 'method-label', text: 'Módszer' }), sel.el);
      if (this.method === 'kirchhoff' && this.solution)
        row.append(
          toggle('Ellentétes körüljárás', this.reverse, (v) => {
            this.reverse = v;
            this.solveCurrent();
          }).el,
        );
      parts.push(row);
    }

    if (testHidden) {
      parts.push(h('p', { class: 'panel-empty', text: 'A megoldás a beadás után látszik. Írd be a válaszaidat lent, aztán add be.' }));
    } else if (this.solution) {
      const visible = this.solution.steps.slice(0, this.revealed);
      this.steps = visible.length
        ? stepList(visible, (i) => {
            this.player.pause();
            this.player.go(i);
          })
        : null;
      if (this.steps) parts.push(this.steps.el);
      const ctl = this.solutionControls();
      if (ctl) parts.push(ctl);
    } else {
      this.steps = null;
      const names = new Map(methodList(true).map((m) => [m.id, m.label]));
      parts.push(
        h(
          'div',
          { class: 'panel-empty' },
          h('p', { text: this.reason || 'Ehhez a feladathoz ez a módszer nem alkalmazható.' }),
          this.alternatives.length
            ? h('div', { class: 'alt-methods' }, h('span', { class: 'alt-label', text: 'Ezzel menne:' }), ...this.alternatives.map((m) => button(names.get(m) ?? m, () => this.setMethod(m), 'quiet')))
            : null,
        ),
      );
    }
    if (t.dc && this.verifyOpen && !testHidden) parts.push(this.verifyView());
    if (t.dc?.topic === 'valodi-gen' && !testHidden) {
      const chart = loadChart(t.dc);
      if (chart) parts.push(chart);
    }
    parts.push(this.answersSection());
    this.panel.replaceChildren(...parts);
  }

  private solutionControls(): HTMLElement | null {
    const total = this.solution!.steps.length;
    const t = this.task!;
    const extras: HTMLElement[] = [];
    if (t.dc && (this.submitted || this.revealed >= total || this.mode === 'practice'))
      extras.push(
        button(
          this.verifyOpen ? 'Ellenőrzés elrejtése' : 'Ellenőrzés más módszerekkel',
          () => {
            this.verifyOpen = !this.verifyOpen;
            this.renderPanel();
          },
          'quiet',
        ),
      );
    if (this.revealed >= total) return extras.length ? h('div', { class: 'hint-actions' }, ...extras) : null;
    const tip = button(this.revealed === 0 ? 'Tipp: első lépés' : 'Következő lépés', () => this.reveal(this.revealed + 1), 'secondary');
    const all = button('Teljes megoldás', () => this.reveal(total), 'primary');
    const trick = t.dc
      ? button(
          'Trükk-tipp',
          () => {
            this.trickText = trickHint(t.dc!, this.hooks.settings().starDelta);
            this.renderPanel();
          },
          'quiet',
        )
      : null;
    return h(
      'div',
      { class: 'hint-box' },
      this.revealed === 0 ? h('p', { class: 'hint-lead', text: 'Próbáld meg előbb magad! Ha elakadsz, a tipp mindig csak a következő lépést mutatja meg.' }) : null,
      h('div', { class: 'hint-actions' }, tip, all, ...(trick ? [trick] : []), ...extras),
      this.trickText ? h('p', { class: 'hint-trick', text: this.trickText }) : null,
    );
  }

  private verifyView(): HTMLElement {
    const v = verify(this.task!.dc!);
    const names = new Map(methodList(true).map((m) => [m.id, m.label]));
    const fmt = (x: number | undefined, unit: string | null) => (x === undefined ? '–' : unit ? formatQuantity(x, unit as 'V') : formatNumber(x));
    const ok = (x: number | undefined, ref: number) => x !== undefined && Math.abs(Math.abs(x) - Math.abs(ref)) <= 1e-9 * Math.max(1, Math.abs(ref));
    return h(
      'section',
      { class: 'verify-card', attrs: { 'aria-label': 'Ellenőrzés' } },
      h('h3', { class: 'chart-title', text: 'Ellenőrzés más módszerekkel' }),
      h('p', { class: 'step-note', text: 'Minden alkalmazható módszer saját számolása egymás mellett, és egy független számítógépes megoldás (MNA). Ha minden pipa zöld, a módszerek egyetértenek.' }),
      h(
        'div',
        { class: 'table-wrap' },
        h(
          'table',
          { class: 'value-table' },
          h('thead', {}, h('tr', {}, h('th', { text: 'Kérdés' }), h('th', { text: 'Gépi (MNA)' }), ...v.methods.map((m) => h('th', { text: names.get(m) ?? m })))),
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
  }

  // ───────── Válaszok ─────────

  private answersSection(): HTMLElement {
    const t = this.task!;
    const test = this.mode === 'test';
    const showVerdict = !test || this.submitted;
    const many = t.questions.length > 1;
    const parts = t.questions.map((q, qi) => {
      if (q.table) return this.tableSection(q.id, showVerdict);
      const verdict = h('div', { class: 'verdict', attrs: { 'aria-live': 'polite' } });
      const inputs: HTMLInputElement[] = [];
      const check = () => {
        for (const [i, f] of q.fields.entries()) {
          const v = inputs[i]!.value;
          if (!v.trim()) {
            this.results.delete(f.id);
            continue;
          }
          this.results.set(f.id, checkField(v, f));
        }
        paint();
        this.afterCheck();
      };
      const rows = q.fields.map((f, i) => {
        const input = h('input', {
          class: 'answer-input',
          attrs: { placeholder: f.example ? `pl. ${f.example}` : '', 'aria-label': `${f.label} (${qi + 1}. kérdés)`, inputmode: f.kind === 'element' ? 'text' : 'decimal', autocomplete: 'off', spellcheck: 'false' },
          on: {
            keydown: (e) => {
              if (e.key !== 'Enter') return;
              if (i < q.fields.length - 1) inputs[i + 1]!.focus();
              else if (!test) check();
            },
            input: () => this.answers.set(f.id, input.value),
          },
        });
        input.value = this.answers.get(f.id) ?? '';
        if (this.submitted || this.mode === 'practice') {
          const r = this.results.get(f.id);
          if (r && showVerdict) input.classList.add(r.status === 'correct' ? 'is-ok' : 'is-bad');
        }
        if (test && this.submitted) input.readOnly = true;
        inputs.push(input);
        const unitHint = f.kind === 'phase' ? '°' : f.kind === 'element' ? 'H vagy F' : f.unit;
        return h('label', { class: 'field' }, q.fields.length > 1 ? h('span', { class: 'field-label', text: f.label }) : null, input, unitHint ? h('span', { class: 'field-unit', text: unitHint }) : null);
      });
      const paint = () => {
        verdict.className = 'verdict';
        verdict.replaceChildren();
        const rs = q.fields.map((f) => this.results.get(f.id));
        q.fields.forEach((f, i) => {
          const r = this.results.get(f.id);
          inputs[i]!.classList.remove('is-ok', 'is-bad');
          if (r && showVerdict) inputs[i]!.classList.add(r.status === 'correct' ? 'is-ok' : 'is-bad');
        });
        if (!showVerdict || rs.every((r) => !r)) return;
        if (rs.every((r) => r?.status === 'correct')) {
          verdict.classList.add('is-correct');
          verdict.append(icon(ICONS.check, 16), 'Helyes');
          return;
        }
        verdict.classList.add('is-wrong');
        const bad = q.fields.map((f, i) => ({ f, r: rs[i] })).filter((x) => x.r && x.r.status !== 'correct');
        const missing = rs.some((r) => !r);
        verdict.append(bad.map((x) => (q.fields.length > 1 ? `${x.f.label}: ${verdictText(x.r!)}` : verdictText(x.r!))).join(' ') + (missing && !bad.length ? 'Tölts ki minden mezőt.' : ''));
        if (test && this.submitted) verdict.append(h('span', { class: 'verdict-answer', text: ` Helyes: ${q.fields.map((f) => fieldAnswerText(f)).join(', ')}` }));
      };
      paint();
      return h(
        'div',
        { class: 'question' },
        h('p', { class: many ? 'question-text' : 'question-label', text: many ? `${String.fromCharCode(97 + qi)}) ${q.text}` : 'Saját válasz' }),
        h('div', { class: `answer-fields${q.fields.length > 1 ? ' is-multi' : ''}` }, ...rows),
        h('div', { class: 'answer-row' }, test ? null : button('Ellenőrzés', check, 'primary')),
        verdict,
      );
    });
    return h('section', { class: 'answers', attrs: { 'aria-label': 'Saját válasz' } }, ...parts);
  }

  private afterCheck(): void {
    if (this.mode !== 'practice' || this.allCorrectFired) return;
    const t = this.task!;
    const all = t.questions.every((q) => (q.table ? this.tableSummary.get(q.id)?.ok : q.fields.every((f) => this.results.get(f.id)?.status === 'correct')));
    if (all) {
      this.allCorrectFired = true;
      this.hooks.onAllCorrect?.();
    }
  }

  /** Táblázatkitöltős feladat (egyenáram): minden elem U, I, P értéke, cellánként ellenőrizve. */
  private tableSection(qid: string, showVerdict: boolean): HTMLElement {
    const p = this.task!.dc!;
    const targets = tableTargets(p);
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
            on: { input: () => this.answers.set(id, input.value) },
          });
          input.value = this.answers.get(id) ?? '';
          const st = this.cellState.get(id);
          if (st && showVerdict) input.classList.add(st);
          if (this.mode === 'test' && this.submitted) input.readOnly = true;
          cells.push({ input, target: t, key });
          return h('td', {}, input);
        }),
      );
    const summary = h('div', { class: 'verdict', attrs: { 'aria-live': 'polite' } });
    const prev = this.tableSummary.get(qid);
    if (prev && showVerdict) {
      summary.className = `verdict ${prev.ok ? 'is-correct' : 'is-wrong'}`;
      summary.textContent = prev.text;
    }
    const check = () => {
      this.checkTable(qid, cells);
      const s = this.tableSummary.get(qid)!;
      summary.className = `verdict ${s.ok ? 'is-correct' : 'is-wrong'}`;
      summary.textContent = s.text;
      this.afterCheck();
    };
    return h(
      'div',
      { class: 'question' },
      h('p', { class: 'question-text', text: 'Töltsd ki a táblázatot: minden elem feszültsége, árama és teljesítménye a referenciairány szerint, előjelesen (a forrásé negatív, ha teljesítményt ad le).' }),
      h('div', { class: 'table-wrap' }, h('table', { class: 'value-table fill-table' }, h('thead', {}, h('tr', {}, h('th', { text: 'Elem' }), h('th', { text: 'U' }), h('th', { text: 'I' }), h('th', { text: 'P' }))), h('tbody', {}, ...targets.map(row)))),
      this.mode === 'test' ? null : h('div', { class: 'answer-row' }, button('Táblázat ellenőrzése', check, 'primary')),
      summary,
    );
  }

  private checkTable(qid: string, cells: { input: HTMLInputElement; target: TableTarget; key: CellKey }[] | null): void {
    const p = this.task!.dc!;
    const list = cells ?? tableTargets(p).flatMap((t) => (['U', 'I', 'P'] as CellKey[]).map((key) => ({ input: null as HTMLInputElement | null, target: t, key })));
    let ok = 0;
    let filled = 0;
    for (const c of list) {
      const id = `${qid}|${c.target.element}|${c.key}`;
      const v = this.answers.get(id) ?? '';
      c.input?.classList.remove('is-ok', 'is-bad');
      if (!v.trim()) continue;
      filled++;
      const r = checkCell(v, c.target, c.key);
      const cls = r.status === 'correct' ? 'is-ok' : 'is-bad';
      c.input?.classList.add(cls);
      this.cellState.set(id, cls);
      if (r.status === 'correct') ok++;
    }
    const n = list.length;
    this.tableSummary.set(qid, { ok: ok === n, text: ok === n ? 'Minden cella helyes' : `${ok} / ${n} cella helyes${filled < n ? ` (${n - filled} üres)` : ''}` });
  }

  // ───────── Vászon ─────────

  private exportSvg(): void {
    if (!this.shownCircuit) return;
    const svg = renderCircuitSvg(this.shownCircuit, { title: this.title.textContent ?? 'Áramkör' });
    const a = h('a', { attrs: { href: URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' })), download: `aramkor-${this.task?.seed ?? 'abra'}.svg` } });
    a.click();
    URL.revokeObjectURL(a.href);
  }

  private showCircuit(c: Circuit, merged = false): void {
    if (c === this.shownCircuit) return;
    this.shownCircuit = c;
    this.layout = computeLayout(c);
    this.overlayCtx = { circuit: c, layout: this.layout, map: toNetlist(c) };
    this.canvas.innerHTML = renderCircuitSvg(c, { title: this.title.textContent ?? 'Áramkör' }, this.layout);
    this.flow.attach(this.canvas.querySelector('svg')!);
    this.canvas.classList.remove('swap');
    // Összeolvadás után nincs áttűnés: a rajz a helyén marad.
    if (merged) return;
    void this.canvas.offsetWidth;
    this.canvas.classList.add('swap');
  }

  /**
   * Összeolvadás ("Áramkör újrarajzolása" beállításnál): a régi rajzon az eltűnő ellenállások
   * odacsúsznak a megmaradóhoz és elhalványulnak; utána jön az új rajz. A nézet nem mozdul el.
   */
  private mergeInto(next: Circuit, keep: string | undefined, kind: 'series' | 'parallel', then: () => void): boolean {
    const svg = this.canvas.querySelector('svg');
    if (!svg || !keep || !this.layout || !this.shownCircuit || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return false;
    const keepG = svg.querySelector<SVGGElement>(`.el[data-id="${keep}"]`);
    const stay = new Set(allElements(next).map((e) => e.id));
    const gone = [...svg.querySelectorAll<SVGGElement>('.el')].filter((g) => !stay.has(g.dataset.id!));
    if (!keepG || gone.length === 0) return false;
    const center = (b: DOMRect) => ({ x: b.x + b.width / 2, y: b.y + b.height / 2 });
    const kc = center(keepG.getBBox());
    keepG.classList.add('merge-target');
    const nextBranches = new Set(next.branches.map((b) => b.id));
    const removed = new Set(this.shownCircuit.branches.filter((b) => !nextBranches.has(b.id)).map((b) => b.id));
    const segD = (keepIt: boolean) =>
      this.layout!.wires
        .filter((w) => removed.has(w.branchId) !== keepIt && (w.a.x !== w.b.x || w.a.y !== w.b.y))
        .map((w) => `M${w.a.x} ${w.a.y}L${w.b.x} ${w.b.y}`)
        .join('');
    const wirePath = svg.querySelector('.wires .wire');
    let fadingWire: SVGPathElement | null = null;
    if (wirePath && removed.size) {
      wirePath.setAttribute('d', segD(true));
      fadingWire = wirePath.cloneNode() as SVGPathElement;
      fadingWire.setAttribute('d', segD(false));
      fadingWire.classList.add('merge-fade');
      wirePath.after(fadingWire);
    }
    const gc = gone.map((g) => center(g.getBBox()));
    const mid = { x: (kc.x + gc.reduce((a, p) => a + p.x, 0) / gc.length) / 2, y: (kc.y + gc.reduce((a, p) => a + p.y, 0) / gc.length) / 2 };
    const op = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    op.setAttribute('class', 'merge-op');
    op.setAttribute('x', String(mid.x));
    op.setAttribute('y', String(mid.y));
    op.setAttribute('text-anchor', 'middle');
    op.setAttribute('dominant-baseline', 'central');
    op.textContent = kind === 'parallel' ? '×' : '+';
    svg.querySelector('.ov-over')?.append(op);
    this.pendingMerge = window.setTimeout(() => {
      op.classList.add('is-on');
      this.pendingMerge = window.setTimeout(() => {
        for (const g of gone) {
          const branch = this.shownCircuit!.branches.find((b) => b.elements.some((e) => e.id === g.dataset.id));
          g.classList.add('merging');
          if (branch && removed.has(branch.id)) {
            const c = center(g.getBBox());
            g.style.transform = `translate(${kc.x - c.x}px, ${kc.y - c.y}px) scale(0.4)`;
          }
          g.style.opacity = '0';
        }
        if (fadingWire) fadingWire.style.opacity = '0';
        op.classList.add('is-out');
        this.pendingMerge = window.setTimeout(() => {
          this.pendingMerge = 0;
          then();
        }, 600);
      }, 380);
    }, 250);
    return true;
  }

  private applyHighlight(index: number): void {
    window.clearTimeout(this.pendingMerge);
    this.pendingMerge = 0;
    const t = this.task;
    if (!t?.circuit) return;
    const step = this.solution?.steps[index];
    const rd = this.hooks.settings().redraw && !step?.circuit ? step?.redraw : undefined;
    const next = step?.circuit ?? rd?.circuit ?? t.circuit;
    // Előre lépve az összevont ellenállások "összeolvadnak", mielőtt az új rajz megjelenik.
    if (rd && next !== this.shownCircuit && index > this.lastIndex) {
      const keep = rd.highlight.elements?.[0];
      this.lastIndex = index;
      if (this.mergeInto(next, keep, rd.kind ?? 'series', () => this.drawStep(index, keep))) return;
    }
    this.lastIndex = index;
    this.drawStep(index);
  }

  private drawStep(index: number, popId?: string): void {
    const t = this.task!;
    const step = this.solution?.steps[index];
    const rd = this.hooks.settings().redraw && !step?.circuit ? step?.redraw : undefined;
    this.showCircuit(step?.circuit ?? rd?.circuit ?? t.circuit!, !!popId);
    const svg = this.canvas.querySelector('svg');
    if (!svg || !this.overlayCtx) return;
    const hl = rd?.highlight ?? step?.highlight ?? {};
    const targets = new Set(step?.circuit ? [] : (t.questions.map((q) => q.target).filter(Boolean) as string[]));
    const strong = new Set(hl.elements ?? []);
    const faint = new Set([...(hl.dim ?? []), ...(hl.killed ?? []).map((k) => k.element)]);
    svg.querySelectorAll<SVGGElement>('.el').forEach((g) => {
      const id = g.dataset.id!;
      g.classList.toggle('is-target', targets.has(id));
      g.classList.toggle('is-hl', strong.has(id) && !faint.has(id));
      g.classList.toggle('is-faint', faint.has(id));
    });
    const ov = overlaySvg(this.overlayCtx, hl);
    const under = svg.querySelector('.ov-under')!;
    const over = svg.querySelector('.ov-over')!;
    under.innerHTML = ov.under;
    over.innerHTML = ov.over;
    for (const layer of [under, over]) {
      layer.classList.remove('ov-in');
      void (layer as SVGGElement).getBBox?.();
      layer.classList.add('ov-in');
    }
    // Áramlás-animáció csak egyenáramú feladatnál (szinuszosnál az irány időben változik).
    if (this.shownCircuit && this.layout && t.domain === 'dc') this.flow.set(flowSegments(this.shownCircuit, this.layout, stateCurrents(this.shownCircuit, hl)));
    else this.flow.set([]);
    // A nézet mindig a teljes ábra: nincs nagyítás és ugráló kamera.
    const vb = this.layout!.viewBox;
    svg.setAttribute('viewBox', `${vb.x} ${vb.y} ${vb.width} ${vb.height}`);
  }
}

/** Egy feladat pontszáma a beírt válaszokból (mezőnként; a táblázat egy pont, ha minden cellája jó). */
export function scoreTask(t: Task, answers: Map<string, string>): Score {
  let correct = 0;
  let total = 0;
  for (const q of t.questions) {
    if (q.table && t.dc) {
      total++;
      const targets = tableTargets(t.dc);
      const all = targets.every((tt) => (['U', 'I', 'P'] as CellKey[]).every((k) => checkCell(answers.get(`${q.id}|${tt.element}|${k}`) ?? '', tt, k).status === 'correct'));
      if (all) correct++;
      continue;
    }
    for (const f of q.fields) {
      total++;
      const v = answers.get(f.id) ?? '';
      if (v.trim() && checkField(v, f).status === 'correct') correct++;
    }
  }
  return { correct, total };
}

/** A helyes válasz kiírva (próbavizsga kiértékelésénél). */
export function fieldAnswerText(f: Task['questions'][number]['fields'][number]): string {
  if (f.kind === 'phase') return `${formatNumber(f.answer, 4)}°`;
  if (f.unit === '') return formatNumber(f.answer, 4);
  return formatQuantity(f.answer, f.unit);
}

