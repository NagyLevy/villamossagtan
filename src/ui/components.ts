// Saját, Apple-stílusú vezérlők (külső UI-könyvtár nélkül): szegmentált vezérlő, kapcsoló,
// legördülő választó, csúszka, lépéssáv, ikonos gomb. Mind billentyűzettel is kezelhető.

import { h, icon, ICONS } from './dom';

export interface SegmentOption<T extends string> {
  value: T;
  label: string;
  /** Kis jelvény a felirat mellett (pl. "Hamarosan"). */
  badge?: string;
  /** Nem választható (szürke); a `hint` jelenik meg rámutatáskor. */
  disabled?: boolean;
  hint?: string;
}

export interface Segmented<T extends string> {
  el: HTMLElement;
  set(value: T): void;
  setOptions(options: SegmentOption<T>[], value: T): void;
}

/**
 * iOS/macOS szegmentált vezérlő. A kijelölt szegmens alatt egy rugós mozgású "tolóka" csúszik;
 * radiogroup szerepkör, nyilakkal lehet lépkedni.
 */
export function segmented<T extends string>(label: string, options: SegmentOption<T>[], value: T, onChange: (v: T) => void, size: 'sm' | 'md' = 'md'): Segmented<T> {
  const thumb = h('span', { class: 'seg-thumb', attrs: { 'aria-hidden': 'true' } });
  const el = h('div', { class: `seg seg-${size}`, attrs: { role: 'radiogroup', 'aria-label': label } }, thumb);
  let current = value;
  let buttons: HTMLButtonElement[] = [];

  const place = (animate: boolean) => {
    const btn = buttons.find((b) => b.dataset.value === current);
    if (!btn) return;
    if (!animate) thumb.style.transition = 'none';
    thumb.style.width = `${btn.offsetWidth}px`;
    thumb.style.transform = `translateX(${btn.offsetLeft - 3}px)`;
    if (!animate) {
      void thumb.offsetWidth;
      thumb.style.transition = '';
    }
  };

  const select = (v: T, focus = false) => {
    current = v;
    for (const b of buttons) {
      const on = b.dataset.value === v;
      b.setAttribute('aria-checked', String(on));
      b.tabIndex = on ? 0 : -1;
      if (on && focus) b.focus();
    }
    place(true);
  };

  const build = (opts: SegmentOption<T>[]) => {
    for (const b of buttons) b.remove();
    buttons = opts.map((o) =>
      h(
        'button',
        {
          class: `seg-btn${o.disabled ? ' is-disabled' : ''}`,
          attrs: { type: 'button', role: 'radio', 'data-value': o.value, ...(o.disabled ? { 'aria-disabled': 'true', title: o.hint ?? 'Nem elérhető' } : {}) },
          on: {
            click: () => {
              if (o.disabled) return;
              if (current !== o.value) {
                select(o.value);
                onChange(o.value);
              }
            },
            keydown: (e) => {
              const i = opts.findIndex((x) => x.value === current);
              let j = -1;
              if (e.key === 'ArrowRight' || e.key === 'ArrowDown') j = (i + 1) % opts.length;
              if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') j = (i - 1 + opts.length) % opts.length;
              if (j >= 0 && opts[j]!.disabled) j = -1;
              if (j >= 0) {
                e.preventDefault();
                e.stopPropagation();
                select(opts[j]!.value, true);
                onChange(opts[j]!.value);
              }
            },
          },
        },
        h('span', { class: 'seg-label', text: o.label }),
        o.badge ? h('span', { class: 'badge', text: o.badge }) : null,
      ),
    );
    el.append(...buttons);
  };

  build(options);
  select(value);
  // Az első elhelyezés a betűtípus betöltése után (különben rossz szélességet mérnénk).
  requestAnimationFrame(() => place(false));
  void document.fonts?.ready.then(() => place(false));
  new ResizeObserver(() => place(false)).observe(el);

  return {
    el,
    set: (v) => select(v),
    setOptions: (opts, v) => {
      build(opts);
      current = v;
      select(v);
      requestAnimationFrame(() => place(false));
    },
  };
}

/** iOS-stílusú kapcsoló (role="switch"), felirattal. */
export function toggle(label: string, checked: boolean, onChange: (v: boolean) => void): { el: HTMLElement; set(v: boolean): void } {
  const sw = h('button', {
    class: 'switch',
    attrs: { type: 'button', role: 'switch', 'aria-checked': String(checked) },
    on: {
      click: () => {
        const v = sw.getAttribute('aria-checked') !== 'true';
        sw.setAttribute('aria-checked', String(v));
        onChange(v);
      },
    },
  });
  const id = `sw-${Math.random().toString(36).slice(2, 8)}`;
  const lab = h('span', { class: 'switch-label', text: label, attrs: { id } });
  sw.setAttribute('aria-labelledby', id);
  const el = h('div', { class: 'switch-row', on: { click: (e) => e.target === lab && sw.click() } }, lab, sw);
  return { el, set: (v) => sw.setAttribute('aria-checked', String(v)) };
}

/** Legördülő választó: natív <select> (akadálymentes), gombszerű megjelenéssel. */
export function select<T extends string>(
  label: string,
  options: { value: T; label: string }[],
  value: T,
  onChange: (v: T) => void,
): { el: HTMLElement; set(v: T): void; setDisabled(d: boolean): void; setOptions(o: { value: T; label: string }[], v: T): void } {
  const sel = h('select', { attrs: { 'aria-label': label }, on: { change: () => onChange(sel.value as T) } });
  const fill = (opts: { value: T; label: string }[]) => sel.replaceChildren(...opts.map((o) => h('option', { attrs: { value: o.value }, text: o.label })));
  fill(options);
  sel.value = value;
  const el = h('label', { class: 'select' }, sel, icon(ICONS.chevron, 12));
  return {
    el,
    set: (v) => {
      sel.value = v;
    },
    setOptions: (opts, v) => {
      fill(opts);
      sel.value = v;
    },
    setDisabled: (d) => {
      sel.disabled = d;
      el.classList.toggle('is-disabled', d);
    },
  };
}

/** Kerek ikonos gomb (az ikonos gomboknak mindig van aria-label-je). */
export function iconButton(label: string, path: string, onClick: () => void, variant: 'plain' | 'primary' = 'plain', filled = false): HTMLButtonElement {
  return h('button', { class: `icon-btn icon-btn-${variant}`, attrs: { type: 'button', 'aria-label': label, title: label }, on: { click: onClick } }, icon(path, 16, filled));
}

export function button(label: string, onClick: () => void, variant: 'primary' | 'secondary' | 'quiet' = 'secondary'): HTMLButtonElement {
  return h('button', { class: `btn btn-${variant}`, attrs: { type: 'button' }, on: { click: onClick }, text: label });
}

/** Vékony csúszka; a kitöltött rész CSS-változóból jön, így folyamatosan követi az értéket. */
export function slider(label: string, min: number, max: number, step: number, value: number, format: (v: number) => string, onInput: (v: number) => void): HTMLElement {
  const out = h('output', { class: 'slider-value', text: format(value) });
  const input = h('input', {
    class: 'slider',
    attrs: { type: 'range', min, max, step, value, 'aria-label': label },
    on: {
      input: () => {
        const v = Number(input.value);
        input.style.setProperty('--fill', `${((v - min) / (max - min)) * 100}%`);
        out.textContent = format(v);
        onInput(v);
      },
    },
  });
  input.style.setProperty('--fill', `${((value - min) / (max - min)) * 100}%`);
  return h('label', { class: 'slider-row' }, input, out);
}

export interface StepBar {
  el: HTMLElement;
  update(count: number, current: number, progress?: number): void;
}

/** Vékony lépéssáv: szegmensenként egy gomb, kattintással az adott lépésre ugrik. */
export function stepBar(onSeek: (i: number) => void): StepBar {
  const el = h('div', { class: 'stepbar', attrs: { role: 'group', 'aria-label': 'Lépéssáv' } });
  return {
    el,
    update(count, current, progress = 1) {
      if (el.childElementCount !== count) {
        el.replaceChildren(
          ...Array.from({ length: count }, (_, i) =>
            h('button', { class: 'stepbar-seg', attrs: { type: 'button', 'aria-label': `${i + 1}. lépés` }, on: { click: () => onSeek(i) } }, h('span', { class: 'stepbar-fill' })),
          ),
        );
      }
      [...el.children].forEach((seg, i) => {
        const fill = i < current ? 1 : i === current ? progress : 0;
        (seg as HTMLElement).style.setProperty('--p', String(fill));
        seg.toggleAttribute('aria-current', i === current);
      });
      el.classList.toggle('is-empty', count === 0);
    },
  };
}

/** Halk, rövid értesítés alul (pl. "Seed másolva"). */
export function toast(message: string): void {
  const el = h('div', { class: 'toast', attrs: { role: 'status' }, text: message });
  document.body.append(el);
  requestAnimationFrame(() => el.classList.add('is-in'));
  // Hosszabb szöveg tovább marad kint, hogy el lehessen olvasni (1,6–6 másodperc).
  setTimeout(() => {
    el.classList.remove('is-in');
    setTimeout(() => el.remove(), 400);
  }, Math.min(6000, Math.max(1600, message.length * 55)));
}
