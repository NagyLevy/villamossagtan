// A megoldás panel lépéslistája: az aktuális lépés kiemelve és kibontva, a többi halványabb.
// Az egyenlet tagonként, finom áttűnéssel épül fel; utána a behelyettesítés és az eredmény.

import katex from 'katex';
import type { Step, TableRow } from '../methods/types';
import { formatQuantity } from '../units';
import { h } from './dom';
import { stepTimeline } from './player';
import { renderInset } from '../render/inset';

function tex(src: string, display = false): string {
  return katex.renderToString(src, { throwOnError: false, displayMode: display, strict: false });
}

/** Részeredmény KaTeX-ben: jel = érték előtaggal és mértékegységgel. */
function resultTex(r: NonNullable<Step['result']>): string {
  if (r.tex) return tex(`${r.symbol} = ${r.tex}`);
  // Előbb a tizedesvessző, aztán a szóköz: a `\,` vesszőjét már nem szabad átírni.
  const q = formatQuantity(r.value, r.unit)
    .replace(',', '{,}')
    .replace(/ /g, '\\,')
    .replace('Ω', '\\Omega')
    .replace('µ', '\\mu ')
    .replace('−', '-');
  return tex(`${r.symbol} = ${q}`);
}

function reducedMotion(): boolean {
  return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
}

function tableEl(rows: TableRow[]): HTMLElement {
  const fmt = (x: number, u: 'V' | 'A' | 'W') => formatQuantity(Math.abs(x) < 1e-12 ? 0 : x, u);
  return h(
    'div',
    { class: 'table-wrap' },
    h(
      'table',
      { class: 'value-table' },
      h('thead', {}, h('tr', {}, h('th', { text: 'Elem' }), h('th', { text: 'U' }), h('th', { text: 'I' }), h('th', { text: 'P' }))),
      h(
        'tbody',
        {},
        ...rows.map((r) =>
          h('tr', {}, h('td', { text: r.label }), h('td', { text: fmt(r.U, 'V') }), h('td', { text: fmt(r.I, 'A') }), h('td', { class: r.P < -1e-12 ? 'is-neg' : '', text: fmt(r.P, 'W') })),
        ),
      ),
    ),
  );
}

export interface StepList {
  el: HTMLElement;
  /** Az i. lépés legyen az aktuális; `speed` szerint épül fel. */
  show(index: number, speed: number, animate: boolean): void;
}

export function stepList(steps: Step[], onSelect: (i: number) => void): StepList {
  const items = steps.map((s, i) =>
    h(
      'li',
      { class: 'step is-future' },
      h(
        'button',
        { class: 'step-head', attrs: { type: 'button' }, on: { click: () => onSelect(i) } },
        h('span', { class: 'step-num', text: String(i + 1) }),
        h('span', { class: 'step-title', text: s.title }),
        s.result ? h('span', { class: 'step-chip num', html: resultTex(s.result) }) : null,
      ),
      h('div', { class: 'step-body' }),
    ),
  );
  // Fejezetcímek: ahol a lépés csoportja megváltozik, egy cím kerül elé.
  const rows: HTMLElement[] = [];
  steps.forEach((s, i) => {
    if (s.group && s.group !== steps[i - 1]?.group) rows.push(h('li', { class: 'step-group', attrs: { 'aria-hidden': 'true' }, text: s.group }));
    rows.push(items[i]!);
  });
  const el = h('ol', { class: 'steps' }, ...rows);
  let timers: number[] = [];

  const fill = (li: HTMLElement, s: Step, speed: number, animate: boolean) => {
    const body = li.querySelector('.step-body')!;
    const parts: HTMLElement[] = [h('p', { class: 'step-text', text: s.text })];
    if (s.bullets?.length) parts.push(h('ul', { class: 'step-bullets' }, ...s.bullets.map((b) => h('li', { text: b }))));
    if (s.inset) parts.push(h('div', { class: 'inset-card', html: renderInset(s.inset.kind, s.inset.before, s.inset.after) }));
    const reveal: { el: HTMLElement; at: number }[] = [];
    const tl = stepTimeline(s);
    if (s.terms?.length) {
      const terms = s.terms.map((t, i) => {
        const span = h('span', { class: 'eq-term', html: tex(t) });
        reveal.push({ el: span, at: tl.terms[i]! });
        return span;
      });
      parts.push(h('div', { class: 'eq' }, ...terms));
    }
    if (s.subst) {
      const sub = h('div', { class: 'eq eq-subst eq-term', html: tex(s.subst) });
      reveal.push({ el: sub, at: tl.subst });
      parts.push(sub);
    }
    if (s.result) {
      const r = h('div', { class: 'step-result num eq-term', html: resultTex(s.result) });
      reveal.push({ el: r, at: tl.result });
      parts.push(r);
    }
    if (s.note) parts.push(h('p', { class: 'step-note', text: s.note }));
    if (s.table) parts.push(tableEl(s.table));
    body.replaceChildren(...parts);
    if (!animate || reducedMotion()) {
      for (const r of reveal) r.el.classList.add('is-in');
      return;
    }
    for (const r of reveal) timers.push(window.setTimeout(() => r.el.classList.add('is-in'), r.at / speed));
  };

  return {
    el,
    show(index, speed, animate) {
      for (const t of timers) clearTimeout(t);
      timers = [];
      items.forEach((li, i) => {
        li.classList.toggle('is-current', i === index);
        li.classList.toggle('is-past', i < index);
        li.classList.toggle('is-future', i > index);
        li.toggleAttribute('aria-current', i === index);
        if (i !== index) li.querySelector('.step-body')!.replaceChildren();
      });
      const li = items[index];
      if (!li) return;
      fill(li, steps[index]!, speed, animate);
      // Csak a lista görög, az oldal nem: az aktuális lépés a lista tetejéhez közel kerüljön.
      const top = li.offsetTop - 12;
      if (top < el.scrollTop || li.offsetTop + li.offsetHeight > el.scrollTop + el.clientHeight) {
        el.scrollTo({ top: Math.max(0, top), behavior: reducedMotion() ? 'auto' : 'smooth' });
      }
    },
  };
}
