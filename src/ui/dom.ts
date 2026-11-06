// Minimális DOM-segéd: elemek létrehozása attribútumokkal, eseményekkel és gyerekekkel.

type Child = Node | string | null | undefined | false;

export interface Props {
  class?: string;
  attrs?: Record<string, string | number | boolean | undefined>;
  on?: Partial<{ [K in keyof HTMLElementEventMap]: (e: HTMLElementEventMap[K]) => void }>;
  text?: string;
  html?: string;
}

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, props: Props = {}, ...children: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (props.class) el.className = props.class;
  for (const [k, v] of Object.entries(props.attrs ?? {})) {
    if (v === undefined || v === false) continue;
    el.setAttribute(k, v === true ? '' : String(v));
  }
  for (const [k, fn] of Object.entries(props.on ?? {})) el.addEventListener(k, fn as EventListener);
  if (props.text !== undefined) el.textContent = props.text;
  if (props.html !== undefined) el.innerHTML = props.html;
  for (const c of children) if (c !== null && c !== undefined && c !== false) el.append(c);
  return el;
}

/** Inline SVG ikon (vonalas, a szöveg színét veszi fel). */
export function icon(path: string, size = 16, filled = false): SVGSVGElement {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('viewBox', '0 0 16 16');
  svg.setAttribute('aria-hidden', 'true');
  const p = document.createElementNS(ns, 'path');
  p.setAttribute('d', path);
  if (filled) p.setAttribute('fill', 'currentColor');
  else {
    p.setAttribute('fill', 'none');
    p.setAttribute('stroke', 'currentColor');
    p.setAttribute('stroke-width', '1.6');
    p.setAttribute('stroke-linecap', 'round');
    p.setAttribute('stroke-linejoin', 'round');
  }
  svg.append(p);
  return svg;
}

export const ICONS = {
  play: 'M5 3.5v9l7.5-4.5z',
  pause: 'M4.5 3h2.5v10H4.5zM9 3h2.5v10H9z',
  prev: 'M10 3L5 8l5 5',
  next: 'M6 3l5 5-5 5',
  restart: 'M3 8a5 5 0 1 0 1.6-3.7M3 2.5v2.8h2.8',
  chevron: 'M4 6l4 4 4-4',
  copy: 'M5.5 5.5V3.5a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1h-2M3.5 5.5h6a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1h-6a1 1 0 0 1-1-1v-6a1 1 0 0 1 1-1z',
  download: 'M8 2.5v8M4.5 7L8 10.5 11.5 7M3 13.5h10',
  refresh: 'M13 8a5 5 0 1 1-1.5-3.6M13 2.5v3h-3',
  theme: 'M8 2a6 6 0 1 0 0 12A6 6 0 0 0 8 2zM8 2v12',
  check: 'M3.5 8.5l3 3 6-7',
  stats: 'M3 13V9M6.5 13V5M10 13V7.5M13.5 13V3',
  calendar: 'M3 4.5h10v9H3zM3 7.5h10M5.5 2.5v3M10.5 2.5v3',
  settings: 'M2.5 4.5h11M2.5 11.5h11M5.5 2.8v3.4M10.5 9.8v3.4',
  close: 'M4 4l8 8M12 4l-8 8',
  timer: 'M8 4.5V8l2.2 1.6M8 14a5.5 5.5 0 1 0 0-11 5.5 5.5 0 0 0 0 11zM6.5 1.5h3',
  back: 'M10 3L5 8l5 5',
};
