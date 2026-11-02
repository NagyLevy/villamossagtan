// Statisztika lap (felugró üveglap): megoldott feladatok, helyes arány, bontásokban, törlési lehetőséggel.

import { TOPIC_NAMES, type Topic } from '../generator/generate';
import { TOPOLOGY_NAMES, type Topology } from '../generator/templates';
import { LEVEL_NAMES, type Level } from '../generator/values';
import { renderBars } from '../render/bars';
import { button, toggle } from './components';
import { isLite, setLite } from './perf';
import { h } from './dom';
import { methodList } from './settings';
import { clearAttempts, loadAttempts, summarize } from './stats';

export function openStats(): void {
  const dialog = h('dialog', { class: 'sheet', attrs: { 'aria-label': 'Statisztika' } });
  const methodNames = new Map(methodList(true).map((m) => [m.id as string, m.label]));
  const render = () => {
    const s = summarize(loadAttempts());
    const pct = s.total ? Math.round((s.correct / s.total) * 100) : 0;
    const section = (title: string, svg: string) => h('section', { class: 'sheet-section' }, h('h3', { class: 'chart-title', text: title }), h('div', { class: 'sheet-chart', html: svg }));
    let armed = false;
    const clearBtn = button(
      'Statisztika törlése',
      () => {
        if (!armed) {
          armed = true;
          clearBtn.textContent = 'Biztosan törlöd? Kattints újra';
          return;
        }
        clearAttempts();
        render();
      },
      'quiet',
    );
    dialog.replaceChildren(
      h(
        'div',
        { class: 'sheet-head' },
        h('h2', { class: 'panel-title', text: 'Statisztika' }),
        button('Kész', () => dialog.close(), 'secondary'),
      ),
      h(
        'div',
        { class: 'sheet-kpis' },
        h('div', {}, h('span', { class: 'kpi num', text: String(s.total) }), h('span', { class: 'kpi-label', text: 'megoldott kérdés' })),
        h('div', {}, h('span', { class: 'kpi num', text: `${pct}%` }), h('span', { class: 'kpi-label', text: 'helyes arány' })),
        h('div', {}, h('span', { class: 'kpi num', text: String(s.correct) }), h('span', { class: 'kpi-label', text: 'helyes válasz' })),
      ),
      section('Témakörönként', renderBars(s.byTopic, (k) => TOPIC_NAMES[k as Topic] ?? k)),
      section('Nehézség szerint', renderBars(s.byLevel, (k) => LEVEL_NAMES[k as Level] ?? k)),
      section('Módszerenként', renderBars(s.byMethod, (k) => methodNames.get(k) ?? k)),
      section('Topológiánként', renderBars(s.byTopology, (k) => (k === 'egyedi' ? 'Egyedi' : TOPOLOGY_NAMES[k as Topology] ?? k))),
      h('div', { class: 'sheet-foot' }, toggle('Könnyített grafika (ha akad az oldal)', isLite(), (v) => setLite(v)).el, clearBtn),
    );
  };
  render();
  dialog.addEventListener('close', () => dialog.remove());
  dialog.addEventListener('click', (e) => {
    if (e.target === dialog) dialog.close();
  });
  document.body.append(dialog);
  dialog.showModal();
}
