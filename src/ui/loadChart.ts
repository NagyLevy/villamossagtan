// Terhelési karakterisztika kártya: csúszkával állítható terhelés, élő Uk és It értékkel.

import type { Problem } from '../generator/generate';
import { loadPoint } from '../methods/realsource';
import { loadChartMax, renderLoadChart } from '../render/loadChart';
import { allElements } from '../solver/model';
import { formatQuantity } from '../units';
import { h } from './dom';

export function loadChart(p: Problem): HTMLElement | null {
  const els = allElements(p.circuit);
  const src = els.find((e) => e.kind === 'V');
  const rb = els.find((e) => e.role === 'internal');
  const rt = els.find((e) => e.role === 'load');
  if (!src || !rb || !rt) return null;
  const U0 = src.value;
  const Rb = rb.value;
  const max = loadChartMax(Rb, rt.value);
  const plot = h('div', { class: 'chart-plot' });
  const readout = h('div', { class: 'chart-readout num' });
  const draw = (Rt: number) => {
    plot.innerHTML = renderLoadChart(U0, Rb, Rt);
    const pt = loadPoint(U0, Rb, Rt);
    readout.replaceChildren(
      h('span', {}, h('i', { attrs: { style: '--c:var(--ink-2)' } }), `Rt = ${formatQuantity(Rt, 'Ω', { sig: 3 })}`),
      h('span', {}, h('i', { attrs: { style: '--c:var(--accent)' } }), `Uk = ${formatQuantity(pt.Uk, 'V', { sig: 3 })}`),
      h('span', {}, h('i', { attrs: { style: '--c:var(--node)' } }), `It = ${formatQuantity(pt.It, 'A', { sig: 3 })}`),
      h('span', {}, h('i', { attrs: { style: '--c:var(--result)' } }), `P = ${formatQuantity(pt.P, 'W', { sig: 3 })}`),
    );
  };
  const input = h('input', {
    class: 'slider chart-slider',
    attrs: { type: 'range', min: 0, max, step: max / 400, value: rt.value, 'aria-label': 'Terhelő ellenállás' },
    on: {
      input: () => {
        input.style.setProperty('--fill', `${(Number(input.value) / max) * 100}%`);
        draw(Number(input.value));
      },
    },
  });
  input.style.setProperty('--fill', `${(rt.value / max) * 100}%`);
  draw(rt.value);
  return h(
    'section',
    { class: 'chart-card', attrs: { 'aria-label': 'Terhelési karakterisztika' } },
    h('h3', { class: 'chart-title', text: 'Terhelési karakterisztika' }),
    plot,
    h('label', { class: 'chart-control' }, h('span', { text: 'Terhelés' }), input),
    readout,
  );
}
