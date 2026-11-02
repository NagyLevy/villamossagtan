// Ranglista: teljes képernyős nézet dobogóval (1–3. hely), alatta a többiek. Élőben frissül,
// amíg nyitva van. Mindenki pontját a naplójából számoljuk (ugyanúgy, mint a sajátunkat).
// Az "Összesen" és a "Ma" fül között lehet váltani; alul látszik, mennyi kell a következő helyhez.

import { ACHIEVEMENTS, fullScore } from '../daily/achievements';
import { loadProgress, type ProgressData } from '../daily/progress';
import { formatCompact, formatMult } from '../daily/score';
import { dailyChallenge, dayKey, type DailyLevel } from '../daily/schedule';
import { SHARE_URL, decodeScore, encodeScore, loadLeague } from '../daily/share';
import { onOnline, type OnlineState } from '../online/league';
import { button, toast } from './components';
import { h, icon } from './dom';

export const TROPHY_ICON = 'M5 2.5h6v4a3 3 0 0 1-6 0zM5 3.5H2.5v1A2.5 2.5 0 0 0 5 7M11 3.5h2.5v1A2.5 2.5 0 0 1 11 7M8 9.5v2.5M5.5 13.5h5';
const CROWN = 'M2 12.5h12M2.5 11 1.5 4.5 5.5 7.5 8 2.5l2.5 5 4-3-1 6.5z';
const FLAME = 'M8 14.5c2.6 0 4.5-1.8 4.5-4.4 0-2.9-2.5-4.3-2.9-7.6-1.6 1-2.6 2.6-2.6 4.4-.9-.6-1.4-1.6-1.4-2.6C4 5.6 3.5 7.6 3.5 10.1c0 2.6 1.9 4.4 4.5 4.4z';

interface Row {
  id: string;
  name: string;
  isMe: boolean;
  total: number;
  today: number;
  streak: number;
  mult: number;
  ach: number;
  dropped: number;
}

type Sort = 'total' | 'today';

const taskCount = (day: string, lvl: DailyLevel) => dailyChallenge(new Date(`${day}T12:00:00`), lvl).tasks.length;

function rowOf(id: string, name: string, data: ProgressData, isMe: boolean, dropped: number): Row {
  const s = fullScore(data, new Date(), taskCount);
  return { id, name, isMe, total: s.total, today: s.perDay[dayKey(new Date())] ?? 0, streak: s.streak, mult: s.mult, ach: s.achievements.length, dropped };
}

/** A saját napló ugyanazzal a szűréssel, mint a többieké (igazságos összevetés). */
function myData(): ProgressData {
  const r = decodeScore(encodeScore({ name: 'én', id: 'me', at: Date.now(), data: loadProgress() }));
  return r.ok ? r.score.data : {};
}

function collect(st: OnlineState): Row[] {
  if (st.status === 'online') {
    const others = st.players.filter((p) => p.id !== st.user?.id).map((p) => rowOf(p.id, p.name, p.data, false, p.dropped));
    return st.user ? [rowOf(st.user.id, st.user.username, myData(), true, 0), ...others] : others;
  }
  // Szerver nélkül: én + a pontkóddal felvett barátok.
  const league = loadLeague();
  return [rowOf(league.me.id, league.me.name || 'Én', myData(), true, 0), ...league.friends.map((f) => rowOf(f.id, f.name, f.data, false, f.dropped))];
}

/** Név → állandó szín (a kezdőbetűs korongokhoz). */
function hue(id: string): number {
  let x = 0;
  for (const ch of id) x = (x * 31 + ch.charCodeAt(0)) >>> 0;
  return x % 360;
}

function avatar(r: Row, size: 'lg' | 'sm'): HTMLElement {
  return h('span', { class: `lb-avatar lb-avatar-${size}`, attrs: { style: `--h:${hue(r.id)}`, 'aria-hidden': 'true' }, text: (r.name.trim()[0] ?? '?').toUpperCase() });
}

/** Szám "felpörgetése" a megnyitáskor. */
function countUp(el: HTMLElement, target: number, delay: number, animate: boolean): void {
  if (!animate || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
    el.textContent = formatCompact(target);
    return;
  }
  el.textContent = '0';
  const t0 = performance.now() + delay;
  const dur = 1100;
  const step = (t: number) => {
    const k = Math.max(0, Math.min(1, (t - t0) / dur));
    const e = 1 - (1 - k) ** 4;
    el.textContent = formatCompact(target * e);
    if (k < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
  setTimeout(() => (el.textContent = formatCompact(target)), delay + dur + 100);
}

export function openLeaderboard(): void {
  const dialog = h('dialog', { class: 'sheet lb', attrs: { 'aria-label': 'Ranglista' } }) as HTMLDialogElement;
  let sort: Sort = 'total';
  let st: OnlineState = { status: 'off', user: null, players: [], updated: 0 };
  let first = true;

  const render = () => {
    const animate = first;
    first = false;
    const rows = collect(st).sort((a, b) => b[sort] - a[sort] || b.total - a.total || a.name.localeCompare(b.name));
    const val = (r: Row) => r[sort];
    const live = st.status === 'online';
    const time = new Date(st.updated || Date.now()).toLocaleTimeString('hu-HU', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

    const tab = (s: Sort, label: string) =>
      h('button', {
        class: `lb-tab ${sort === s ? 'is-on' : ''}`,
        attrs: { type: 'button', role: 'tab', 'aria-selected': String(sort === s) },
        text: label,
        on: {
          click: () => {
            sort = s;
            first = true;
            render();
          },
        },
      });

    // Dobogó: 2. – 1. – 3. sorrendben, különböző magasságban.
    const podiumSlot = (r: Row | undefined, place: 1 | 2 | 3) => {
      if (!r) return h('div', { class: `lb-slot lb-slot-${place} is-empty` }, h('div', { class: 'lb-block' }, h('span', { class: 'lb-place', text: String(place) })));
      const score = h('span', { class: 'lb-podium-score num' });
      countUp(score, val(r), 250 + (3 - place) * 120, animate);
      return h(
        'div',
        { class: `lb-slot lb-slot-${place} ${r.isMe ? 'is-me' : ''}`, attrs: { style: `--d:${(3 - place) * 140}ms` } },
        place === 1 ? h('span', { class: 'lb-crown' }, icon(CROWN, 30)) : null,
        avatar(r, 'lg'),
        h('span', { class: 'lb-podium-name', text: r.isMe ? `${r.name} (te)` : r.name }),
        score,
        h('span', { class: 'lb-podium-sub num', text: `${formatMult(r.mult)} · ${r.streak} nap` }),
        h('div', { class: 'lb-block' }, h('span', { class: 'lb-place', text: String(place) })),
      );
    };

    const rest = rows.slice(3).map((r, i) => {
      const score = h('span', { class: 'lb-score num' });
      countUp(score, val(r), 500 + i * 60, animate);
      return h(
        'li',
        { class: `lb-row ${r.isMe ? 'is-me' : ''}`, attrs: { style: `--d:${400 + i * 60}ms` } },
        h('span', { class: 'lb-rank num', text: String(i + 4) }),
        avatar(r, 'sm'),
        h('span', { class: 'lb-name' }, r.isMe ? `${r.name} (te)` : r.name, r.dropped ? h('span', { class: 'lb-warn', text: ` · ${r.dropped} gyanús rekord kihagyva` }) : null),
        h('span', { class: 'lb-meta num' }, h('span', { class: 'lb-flame' }, icon(FLAME, 13, true), String(r.streak)), h('span', { text: formatMult(r.mult) }), h('span', { text: `${r.ach}/${ACHIEVEMENTS.length}` })),
        score,
      );
    });

    // Hol állok: mennyi kell a következő helyhez, vagy mekkora az előnyöm.
    const myIdx = rows.findIndex((r) => r.isMe);
    let standing: HTMLElement | null = null;
    if (myIdx >= 0 && rows.length > 1) {
      const me = rows[myIdx]!;
      const text =
        myIdx === 0
          ? `Te vezetsz! Előnyöd a 2. helyezett előtt: ${formatCompact(val(me) - val(rows[1]!))} pont.`
          : `${myIdx + 1}. vagy. A ${myIdx}. helyhez még ${formatCompact(val(rows[myIdx - 1]!) - val(me) + 1)} pont kell.`;
      standing = h('div', { class: `lb-standing ${myIdx === 0 ? 'is-lead' : ''}` }, avatar(me, 'sm'), h('span', { text }));
    }

    const invite = () => {
      const fallback = () => toast(`Másold ki: ${SHARE_URL}`);
      if (!navigator.clipboard) return fallback();
      navigator.clipboard.writeText(SHARE_URL).then(() => toast('Link másolva: küldd el, és regisztráljon!'), fallback);
    };

    const parts: (HTMLElement | null)[] = [
      h('div', { class: 'lb-glow', attrs: { 'aria-hidden': 'true' } }),
      h(
        'div',
        { class: 'lb-head' },
        h('div', {}, h('h2', { class: 'lb-title', text: 'Ranglista' }), h('span', { class: `lb-live ${live ? 'is-live' : ''}`, text: live ? `ÉLŐ · ${time}` : st.status === 'connecting' ? 'Kapcsolódás…' : 'Szerver nélkül (pontkóddal)' })),
        button('Bezárás', () => dialog.close(), 'secondary'),
      ),
      h('div', { class: 'lb-tabs', attrs: { role: 'tablist', 'aria-label': 'Rendezés' } }, tab('total', 'Összesen'), tab('today', 'Ma')),
      rows.length
        ? h('div', { class: `lb-podium ${animate ? 'is-anim' : ''}` }, podiumSlot(rows[1], 2), podiumSlot(rows[0], 1), podiumSlot(rows[2], 3))
        : h('p', { class: 'lb-empty', text: 'Még senki sincs a ranglistán. Lépj be, és oldd meg az első napi feladatot!' }),
      rest.length ? h('ol', { class: `lb-list ${animate ? 'is-anim' : ''}` }, ...rest) : null,
      standing,
      rows.length < 2 ? h('div', { class: 'lb-invite' }, h('span', { text: 'Egyedül vagy. Hívd meg a haverodat!' }), button('Link másolása', invite, 'primary')) : null,
    ];
    dialog.replaceChildren(...parts.filter((x): x is HTMLElement => !!x));
  };

  const off = onOnline((s) => {
    const changed = s.updated !== st.updated || s.status !== st.status;
    st = s;
    if (changed && dialog.isConnected) render();
  });
  render();
  dialog.addEventListener('close', () => {
    off();
    dialog.remove();
  });
  dialog.addEventListener('click', (e) => {
    if (e.target === dialog) dialog.close();
  });
  document.body.append(dialog);
  dialog.showModal();
}
