// Kör alakú témaválasztó: a témakörök egy gyűrű cikkei, középen a kijelölt témakör neve és a nehézség.
// Egérrel: rámutatás kijelöl, kattintás választ. Billentyűkkel: ← → témakör, ↑ ↓ nehézség, Enter választ,
// Esc bezár. A <dialog> elem adja a fókuszcsapdát és a háttér lezárását.

import { h } from './dom';

export interface WheelItem {
  id: string;
  name: string;
  hint: string;
}

export interface WheelLevel {
  id: string;
  name: string;
}

export interface WheelOptions {
  items: WheelItem[];
  current: string;
  levels: WheelLevel[];
  level: string;
  /** Témakör, amelynél a nehézség kötött (pl. ZH): ott a szintváltó helyén ez a felirat áll. */
  fixedLevel?: (id: string) => string | null;
  onPick: (id: string, level: string) => void;
}

/**
 * Rajzolt jelek a cikkekbe, a feladatok rajzának IEC-jeleivel (ellenállás: téglalap; feszültségforrás:
 * kör, a vonal a vezeték mentén; áramforrás: kör, a vonal a vezetékre merőleges). Betűjel helyett, mert az
 * Ug, Uü, Rt máshol mást jelent. Minden rajz közepe a (0, 0), kb. 46 × 28 egység; előbb a vezetékek,
 * utána a kitöltött elemek (így a vezeték nem látszik át rajtuk).
 */
const icon = (body: string) => `<svg:g fill="none" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">${body}</svg:g>`;
/** Ellenállás (téglalap) a megadott bal felső sarokkal és mérettel. */
const res = (x: number, y: number, w: number, h: number) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="1" class="wheel-icon-fill"/>`;

const ICONS: Record<string, string> = {
  // Egy ellenállás, fölötte az áram nyila: U = R · I.
  ohm: icon(`<path d="M-22 4H22M-9 -11H9M5 -15L9 -11L5 -7"/>${res(-11, -2, 22, 12)}`),
  // Két párhuzamos ellenállás: összevonás eredővé.
  eredo: icon(`<path d="M-22 0H-14M14 0H22M-14 -9V9M14 -9V9M-14 -9H14M-14 9H14"/>${res(-8, -14, 16, 10)}${res(-8, 4, 16, 10)}`),
  // Két soros ellenállás, középen megcsapolva: osztó.
  oszto: icon(`<path d="M-8 -15V15M-8 0H12"/>${res(-13, -12, 10, 9)}${res(-13, 3, 10, 9)}<circle cx="15" cy="0" r="3" class="wheel-icon-fill"/>`),
  // Csomópont: egy áram befolyik, kettő kifolyik.
  kirchhoff: icon(
    `<path d="M-22 0H-4M-11 -4L-6 0L-11 4M0 0L18 -12M0 0L18 12M10 -12H18V-5M10 12H18V5"/><circle cx="0" cy="0" r="4" class="wheel-icon-dot"/>`,
  ),
  // Táblázat: minden elem U, I, P értéke.
  halozat: icon(`<rect x="-19" y="-13" width="38" height="26" rx="2"/><path d="M-19 -4H19M-19 5H19M-7 -13V13M6 -13V13"/>`),
  // Helyettesítő generátor: forrás, belső ellenállás és a két kapocs.
  thevenin: icon(
    `<path d="M-15 -12H17M-15 12H17M-15 -12V12"/><circle cx="-15" cy="0" r="7" class="wheel-icon-fill"/><path d="M-15 -7V7"/>${res(-4, -17, 14, 10)}` +
      `<circle cx="20" cy="-12" r="3" class="wheel-icon-fill"/><circle cx="20" cy="12" r="3" class="wheel-icon-fill"/>`,
  ),
  // Hurok egy feszültség- és egy áramforrással.
  tobbforras: icon(
    `<path d="M-14 -14H14M-14 14H14M-14 -14V14M14 -14V-8M14 8V14"/><circle cx="-14" cy="0" r="8" class="wheel-icon-fill"/><path d="M-14 -8V8"/>` +
      `<circle cx="14" cy="0" r="8" class="wheel-icon-fill"/><path d="M6 0H22"/>`,
  ),
  // Delta (háromszög), benne a csillag.
  'csillag-delta': icon(`<path d="M0 -15L17 13H-17Z"/><path d="M0 4V-15M0 4L-17 13M0 4L17 13"/><circle cx="0" cy="4" r="2.5" class="wheel-icon-dot"/>`),
  // Nagy, több ablakos hálózat sok ellenállással.
  zh: icon(`<path d="M-20 -12H20V12H-20ZM-7 -12V12M7 -12V12"/>${res(-17, -15, 7, 6)}${res(-3.5, -15, 7, 6)}${res(10, -15, 7, 6)}${res(-10, -4, 6, 8)}${res(4, -4, 6, 8)}${res(-3.5, 9, 7, 6)}`),
};

/** Rövid felirat a cikkekbe, és betűjel ott, ahol (még) nincs rajz (a teljes név középen látszik). */
const SHORT: Record<string, [string, string]> = {
  ohm: ['Ω', 'Ohm'],
  eredo: ['Rₑ', 'Eredő'],
  oszto: ['U÷I', 'Osztók'],
  kirchhoff: ['ΣI', 'Kirchhoff'],
  halozat: ['U·I·P', 'Analízis'],
  'valodi-gen': ['Rb', 'Generátor'],
  thevenin: ['A–B', 'Thevenin'],
  tobbforras: ['', 'Több forrás'],
  tanari: ['ZH', 'Tanári'],
  'csillag-delta': ['Y–Δ', 'Csillag-delta'],
  zh: ['ZH', 'Nagy hálózat'],
  'ac-impedancia': ['Z', 'Impedancia'],
  'ac-fazor': ['Û', 'Fazorok'],
  'ac-teljesitmeny': ['P·Q·S', 'Teljesítmény'],
  'ac-helyettesito': ['A–B', 'Helyettesítő'],
  'ac-rezonancia': ['ω₀', 'Rezgőkör'],
  tranziens: ['τ', 'Bekapcsolás'],
};

const R_OUT = 196;
const R_IN = 96;
const GAP = 1.6; // fok a cikkek között

const polar = (r: number, deg: number): [number, number] => {
  const a = (deg * Math.PI) / 180;
  return [r * Math.cos(a), r * Math.sin(a)];
};

const f = (x: number) => x.toFixed(2);

/** Gyűrűcikk körvonala a két szög között. */
function sector(a0: number, a1: number): string {
  const [x0, y0] = polar(R_OUT, a0);
  const [x1, y1] = polar(R_OUT, a1);
  const [x2, y2] = polar(R_IN, a1);
  const [x3, y3] = polar(R_IN, a0);
  const large = a1 - a0 > 180 ? 1 : 0;
  return `M${f(x0)} ${f(y0)}A${R_OUT} ${R_OUT} 0 ${large} 1 ${f(x1)} ${f(y1)}L${f(x2)} ${f(y2)}A${R_IN} ${R_IN} 0 ${large} 0 ${f(x3)} ${f(y3)}Z`;
}

export function openTopicWheel(o: WheelOptions): void {
  const n = o.items.length;
  const step = 360 / n;
  let hover = Math.max(0, o.items.findIndex((t) => t.id === o.current));
  let level = o.level;

  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '-200 -200 400 400');
  svg.setAttribute('class', 'wheel-svg');
  svg.setAttribute('aria-hidden', 'true');

  const segs = o.items.map((t, i) => {
    const mid = -90 + i * step;
    const g = document.createElementNS(NS, 'g');
    g.setAttribute('class', `wheel-seg${t.id === o.current ? ' is-current' : ''}`);
    const path = document.createElementNS(NS, 'path');
    path.setAttribute('d', sector(mid - step / 2 + GAP / 2, mid + step / 2 - GAP / 2));
    const [tx, ty] = polar((R_OUT + R_IN) / 2, mid);
    const [letters, label] = SHORT[t.id] ?? [t.name.slice(0, 2), t.name.split(' ')[0]!];
    const sym = ICONS[t.id] ?? letters;
    let s: SVGElement;
    if (sym.startsWith('<svg:')) {
      // Rajzolt jel: a cikk közepe fölé tolva, a betűjelek helyén.
      s = document.createElementNS(NS, 'g');
      s.setAttribute('class', 'wheel-icon');
      s.setAttribute('transform', `translate(${f(tx)} ${f(ty - 12)})`);
      s.innerHTML = sym.replaceAll('svg:', '');
    } else {
      s = document.createElementNS(NS, 'text');
      s.setAttribute('class', 'wheel-sym');
      s.setAttribute('x', f(tx));
      s.setAttribute('y', f(ty - 2));
      s.textContent = sym;
    }
    const l = document.createElementNS(NS, 'text');
    l.setAttribute('class', 'wheel-label');
    l.setAttribute('x', f(tx));
    l.setAttribute('y', f(ty + 17));
    l.textContent = label;
    g.append(path, s, l);
    g.addEventListener('pointerenter', () => setHover(i));
    g.addEventListener('click', () => pick(i));
    svg.append(g);
    return g;
  });

  const name = h('strong', { class: 'wheel-name' });
  const hint = h('span', { class: 'wheel-hint' });
  const levelName = h('span', { class: 'wheel-level-name' });
  const prev = h('button', { class: 'wheel-step', attrs: { type: 'button', 'aria-label': 'Könnyebb' }, text: '‹', on: { click: () => shiftLevel(-1) } });
  const next = h('button', { class: 'wheel-step', attrs: { type: 'button', 'aria-label': 'Nehezebb' }, text: '›', on: { click: () => shiftLevel(1) } });
  const levelRow = h('div', { class: 'wheel-level' }, prev, levelName, next);
  const go = h('button', { class: 'wheel-go', attrs: { type: 'button' }, text: 'Ezt kérem', on: { click: () => pick(hover) } });
  const hub = h('div', { class: 'wheel-hub', attrs: { 'aria-live': 'polite' } }, name, hint, levelRow, go);

  const keys = h('p', { class: 'wheel-keys', text: '← → témakör · ↑ ↓ nehézség · Enter: választ · Esc: bezár' });
  const stage = h('div', { class: 'wheel-stage' }, svg as unknown as HTMLElement, hub);
  const dlg = h('dialog', { class: 'wheel', attrs: { 'aria-label': 'Témakör választása' } }, stage, keys) as HTMLDialogElement;

  const render = () => {
    const t = o.items[hover]!;
    segs.forEach((g, i) => g.classList.toggle('is-hover', i === hover));
    name.textContent = t.name;
    hint.textContent = t.hint;
    const fixed = o.fixedLevel?.(t.id) ?? null;
    levelName.textContent = fixed ?? o.levels.find((l) => l.id === level)?.name ?? '';
    prev.hidden = next.hidden = !!fixed || o.levels.length < 2;
    const li = o.levels.findIndex((l) => l.id === level);
    prev.disabled = li <= 0;
    next.disabled = li >= o.levels.length - 1;
  };
  const setHover = (i: number) => {
    hover = (i + n) % n;
    render();
  };
  const shiftLevel = (d: number) => {
    if (o.fixedLevel?.(o.items[hover]!.id)) return;
    const li = o.levels.findIndex((l) => l.id === level);
    const ni = Math.min(o.levels.length - 1, Math.max(0, li + d));
    level = o.levels[ni]!.id;
    render();
  };
  const close = () => {
    dlg.close();
    dlg.remove();
  };
  const pick = (i: number) => {
    const t = o.items[i]!;
    close();
    o.onPick(t.id, level);
  };

  dlg.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowRight') setHover(hover + 1);
    else if (e.key === 'ArrowLeft') setHover(hover - 1);
    else if (e.key === 'ArrowUp') shiftLevel(1);
    else if (e.key === 'ArrowDown') shiftLevel(-1);
    else if (e.key === 'Enter') pick(hover);
    else return;
    e.preventDefault();
  });
  // Kattintás a kerék mellé: bezár, változtatás nélkül.
  dlg.addEventListener('click', (e) => {
    if (e.target === dlg) close();
  });
  dlg.addEventListener('close', () => dlg.remove());

  document.body.append(dlg);
  render();
  dlg.showModal();
  go.focus();
}
