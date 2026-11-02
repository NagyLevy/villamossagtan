// Megoldás-animáció: a feladat pontja szorzóról szorzóra nő a szemed előtt
// (alappont → időbónusz → levonás → sorozat → ZH-láz → minden achievement → feladatszorzó),
// aztán a pont berepül az összesbe, és jönnek az új szorzók. Kattintásra átugorható.

import { ACHIEVEMENTS, type FullScore, type Step } from '../daily/achievements';
import { formatCompact, formatMult } from '../daily/score';
import { DAILY_LEVELS } from '../daily/schedule';
import { h } from './dom';

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const easeOut = (t: number) => 1 - (1 - t) ** 3;

/** Számláló, ami az új értékre "pörög", és közben megugrik. */
function counter(el: HTMLElement, fmt: (n: number) => string) {
  let value = 0;
  let raf = 0;
  return {
    get value() {
      return value;
    },
    to(target: number, ms = 420): Promise<void> {
      cancelAnimationFrame(raf);
      const from = value;
      const t0 = performance.now();
      el.classList.remove('is-punch');
      void el.offsetWidth;
      el.classList.add('is-punch');
      return new Promise((done) => {
        let over = false;
        const finish = () => {
          if (over) return;
          over = true;
          cancelAnimationFrame(raf);
          value = target;
          el.textContent = fmt(target);
          done();
        };
        const frame = (t: number) => {
          const k = Math.min(1, (t - t0) / ms);
          // Logaritmikusan tweenelünk, így a ×1000-es ugrás is szépen pörög.
          const v = from > 0 && target > 0 ? Math.exp(Math.log(from) + (Math.log(target) - Math.log(from)) * easeOut(k)) : from + (target - from) * easeOut(k);
          el.textContent = fmt(v);
          if (k < 1) raf = requestAnimationFrame(frame);
          else finish();
        };
        raf = requestAnimationFrame(frame);
        // Háttérben lévő lapon a böngésző nem rajzol: időzítővel akkor is véget ér.
        setTimeout(finish, ms + 80);
      });
    },
  };
}

/** Konfetti a kártya körül (canvas, a végén eltűnik). */
function confetti(host: HTMLElement, strong: boolean): void {
  const canvas = h('canvas', { class: 'fx-confetti' }) as HTMLCanvasElement;
  host.append(canvas);
  const dpr = window.devicePixelRatio || 1;
  const W = (canvas.width = host.clientWidth * dpr);
  const H = (canvas.height = host.clientHeight * dpr);
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const styles = getComputedStyle(document.documentElement);
  const colors = ['--result', '--accent', '--node', '--loop'].map((v) => styles.getPropertyValue(v).trim() || '#0a84ff');
  const parts = Array.from({ length: strong ? 220 : 120 }, () => {
    const a = Math.random() * Math.PI * 2;
    const sp = (6 + Math.random() * (strong ? 16 : 11)) * dpr;
    return { x: W / 2, y: H * 0.42, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 6 * dpr, r: (3 + Math.random() * 4) * dpr, c: colors[Math.floor(Math.random() * colors.length)]!, rot: Math.random() * 6, vr: Math.random() * 0.4 - 0.2 };
  });
  const t0 = performance.now();
  const frame = (t: number) => {
    const life = (t - t0) / 1600;
    ctx.clearRect(0, 0, W, H);
    for (const p of parts) {
      p.vy += 0.45 * dpr;
      p.vx *= 0.985;
      p.x += p.vx;
      p.y += p.vy;
      p.rot += p.vr;
      ctx.save();
      ctx.globalAlpha = Math.max(0, 1 - life);
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.fillStyle = p.c;
      ctx.fillRect(-p.r, -p.r / 2, p.r * 2, p.r);
      ctx.restore();
    }
    if (life < 1) requestAnimationFrame(frame);
    else canvas.remove();
  };
  requestAnimationFrame(frame);
}

export interface FxInfo {
  title: string;
  /** Az összpont a megoldás előtt. */
  totalBefore: number;
}

/** Lejátssza egy megoldás pontozását. A visszatérő ígéret a bezáráskor teljesül. */
export function playScoreFx(step: Step, score: FullScore, info: FxInfo): Promise<void> {
  const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  let skip = false;
  const wait = (ms: number) => (skip ? Promise.resolve() : sleep(ms));

  const value = h('div', { class: 'fx-value num', text: '0' });
  const chips = h('div', { class: 'fx-chips' });
  const totalEl = h('div', { class: 'fx-total num' });
  const multEl = h('div', { class: 'fx-mult num' });
  const news = h('div', { class: 'fx-news' });
  const hint = h('div', { class: 'fx-hint', text: 'Kattints a folytatáshoz' });
  const lvlName = DAILY_LEVELS.find((l) => l.id === step.lvl)?.label ?? step.lvl;
  const card = h(
    'div',
    { class: 'fx-card' },
    h('div', { class: 'fx-kicker', text: `${info.title} · ${lvlName} · megoldva` }),
    value,
    chips,
    h('div', { class: 'fx-foot' }, h('div', {}, h('div', { class: 'fx-label', text: 'Összes pont' }), totalEl), h('div', {}, h('div', { class: 'fx-label', text: 'Szorzód' }), multEl)),
    news,
    hint,
  );
  const overlay = h('div', { class: 'fx-overlay', attrs: { role: 'dialog', 'aria-label': 'Pontozás' } }, card);
  document.body.append(overlay);
  requestAnimationFrame(() => overlay.classList.add('is-in'));

  const num = counter(value, (n) => formatCompact(n));
  const tot = counter(totalEl, (n) => formatCompact(n));
  const mul = counter(multEl, (n) => formatMult(n));
  totalEl.textContent = formatCompact(info.totalBefore);
  multEl.textContent = formatMult(step.mult);
  void tot.to(info.totalBefore, 1);
  void mul.to(step.mult, 1);

  let done!: () => void;
  const closed = new Promise<void>((r) => (done = r));
  let finished = false;
  const close = () => {
    overlay.classList.remove('is-in');
    setTimeout(() => overlay.remove(), 350);
    done();
  };
  overlay.addEventListener('click', () => (finished ? close() : (skip = true)));
  const onKey = (e: KeyboardEvent) => {
    if (e.key !== 'Escape' && e.key !== 'Enter' && e.key !== ' ') return;
    e.preventDefault();
    if (finished) {
      window.removeEventListener('keydown', onKey);
      close();
    } else skip = true;
  };
  window.addEventListener('keydown', onKey);

  const chip = (label: string, val: string, kind = '') => {
    const c = h('span', { class: `fx-chip ${kind}` }, h('span', { class: 'fx-chip-label', text: label }), h('span', { class: 'fx-chip-val num', text: val }));
    chips.append(c);
    requestAnimationFrame(() => c.classList.add('is-in'));
    return c;
  };

  const run = async () => {
    await wait(reduced ? 0 : 350);
    let v = step.base;
    chip('Alappont', formatCompact(step.base));
    await num.to(v, skip || reduced ? 1 : 500);
    await wait(250);
    const apply = async (label: string, factor: number, kind = '', ms = 420) => {
      if (Math.abs(factor - 1) < 1e-9) return;
      v *= factor;
      chip(label, kind === 'is-minus' ? `−${Math.round((1 - factor) * 100)}%` : formatMult(factor), kind);
      await num.to(v, skip || reduced ? 1 : ms);
      await wait(Math.min(220, ms / 2));
    };
    await apply('Időbónusz', step.time, 'is-time');
    await apply('Levonás', 1 - step.penalty, 'is-minus');
    await apply('Sorozat', step.streak, 'is-streak');
    await apply('ZH-láz', step.hype, 'is-hype', 600);
    // A szorzód: minden addig feloldott achievement külön, aztán a feladatok szorzója.
    const before = score.achievements.filter((u) => u.at < step.at || (u.at === step.at && !step.unlocked.includes(u.id)));
    const achProduct = before.reduce((p, u) => p * u.mult, 1);
    const per = Math.max(70, Math.min(320, 1800 / Math.max(1, before.length)));
    for (const u of before) await apply(ACHIEVEMENTS.find((a) => a.id === u.id)?.name ?? u.id, u.mult, 'is-ach', per);
    await apply('Feladatok', step.mult / achProduct, 'is-task');
    v = step.points;
    await num.to(v, 1);

    // Berepül az összesbe.
    value.classList.add('is-final');
    if (!reduced) confetti(overlay, step.unlocked.length > 0);
    await wait(450);
    await tot.to(step.totalAfter, skip || reduced ? 1 : 900);

    // Új szorzók: a feladat saját szorzója és az új achievementek.
    const newsItem = (title: string, sub: string, val: string, big: boolean) => {
      const n = h('div', { class: `fx-new ${big ? 'is-big' : ''}` }, h('div', {}, h('div', { class: 'fx-new-title', text: title }), h('div', { class: 'fx-new-sub', text: sub })), h('div', { class: 'fx-new-val num', text: val }));
      news.append(n);
      requestAnimationFrame(() => n.classList.add('is-in'));
    };
    newsItem(`${lvlName} feladat`, 'Minden megoldás növeli a szorzódat', formatMult(step.taskMult), false);
    let m = step.mult * step.taskMult;
    await mul.to(m, skip || reduced ? 1 : 500);
    for (const id of step.unlocked) {
      const a = ACHIEVEMENTS.find((x) => x.id === id)!;
      await wait(380);
      newsItem(`Új szorzó: ${a.name}`, a.desc, formatMult(a.mult), true);
      m *= a.mult;
      if (!reduced) confetti(overlay, true);
      await mul.to(m, skip || reduced ? 1 : 650);
    }
    finished = true;
    hint.textContent = 'Kattints vagy nyomj Entert a bezáráshoz';
    hint.classList.add('is-ready');
  };
  void run();
  return closed;
}
