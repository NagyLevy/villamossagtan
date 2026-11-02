// Napi kihívás sáv: nehézség, a nap feladatai állapottal, élő óra és pontok, tippek,
// sorozat, ZH-láz szorzó, achievementek, visszaszámlálók és a ranglista (pontkóddal vagy
// meghívó linkkel, fiókoktól függetlenül; a barát pontját a naplójából mi számoljuk újra).

import { ACHIEVEMENTS, TASK_MULT, fullScore, projectedFull, type FullScore } from '../daily/achievements';
import { dayDone, loadProgress, type ProgressData } from '../daily/progress';
import { BASE_POINTS, PAR_MINUTES, formatMult, formatPoints, hypeMultiplier } from '../daily/score';
import { DAILY_LEVELS, ZH_DAY, dailyChallenge, dayKey, daysUntilZh, msUntilNext, type DailyChallenge, type DailyLevel } from '../daily/schedule';
import { addFriend, decodeScore, encodeScore, inviteLink, loadLeague, saveLeague, type PlayerScore } from '../daily/share';
import { onOnline, publish, type OnlineState } from '../online/league';
import { button, segmented, toast } from './components';
import { h, icon } from './dom';
import { playScoreFx } from './scoreFx';

const FLAME = 'M8 14.5c2.6 0 4.5-1.8 4.5-4.4 0-2.9-2.5-4.3-2.9-7.6-1.6 1-2.6 2.6-2.6 4.4-.9-.6-1.4-1.6-1.4-2.6C4 5.6 3.5 7.6 3.5 10.1c0 2.6 1.9 4.4 4.5 4.4z';
const TROPHY = 'M5 2.5h6v4a3 3 0 0 1-6 0zM5 3.5H2.5v1A2.5 2.5 0 0 0 5 7M11 3.5h2.5v1A2.5 2.5 0 0 1 11 7M8 9.5v2.5M5.5 13.5h5';

export interface DailyBanner {
  el: HTMLElement;
  /** Újrarajzolás (haladás, aktuális feladat). */
  render(challenge: DailyChallenge, current: number): void;
  /** Megoldás után: a pontozás animációja (a pont szorzóról szorzóra nő). */
  celebrateSolve(day: string, lvl: DailyLevel, task: string, title: string, totalBefore: number): Promise<void>;
  /** A jelenlegi összpont (az animáció kiinduló értékéhez). */
  total(): number;
}

function hms(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(Math.floor(s / 3600))}:${p(Math.floor((s % 3600) / 60))}:${p(s % 60)}`;
}

function ms(msVal: number): string {
  const s = Math.max(0, Math.floor(msVal / 1000));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

const pts = (n: number) => `${formatPoints(n)} pont`;
const mult = formatMult;
const taskCount = (day: string, lvl: DailyLevel) => dailyChallenge(new Date(`${day}T12:00:00`), lvl).tasks.length;
const scoreOf = (data: ProgressData) => fullScore(data, new Date(), taskCount);

/** A saját pontom ugyanazzal az ellenőrzéssel, mint a barátoké (így igazságos az összevetés). */
function mePlayer(): PlayerScore {
  const league = loadLeague();
  const at = Date.now();
  const r = decodeScore(encodeScore({ name: league.me.name || 'Én', id: league.me.id, at, data: loadProgress() }));
  return r.ok ? r.score : { name: league.me.name || 'Én', id: league.me.id, at, data: {}, dropped: 0 };
}

/** Meghívó link: ha a címben pontkód van, a küldő magától felkerül a ranglistára. */
function importFromHash(): void {
  const hash = decodeURIComponent(location.hash.slice(1));
  if (!hash.startsWith('VT')) return;
  const r = decodeScore(hash);
  if (!r.ok) return toast(r.error);
  saveLeague(addFriend(loadLeague(), r.score));
  toast(`${r.score.name} felkerült a ranglistára`);
  try {
    history.replaceState(null, '', location.pathname + location.search);
  } catch {
    // Ha a keret nem engedi, nem baj: újra felvenni ugyanazt a kódot ártalmatlan.
  }
}

export function dailyBanner(level: DailyLevel, onLevel: (l: DailyLevel) => void, onTask: (i: number) => void): DailyBanner {
  const el = h('section', { class: 'daily enter', attrs: { 'aria-label': 'Napi kihívás' } });
  const levelSeg = segmented<DailyLevel>('Nehézség', DAILY_LEVELS.map((l) => ({ value: l.id, label: l.label })), level, onLevel, 'sm');
  const countdown = h('span', { class: 'daily-count num' });
  const live = h('div', { class: 'daily-live num', attrs: { 'aria-live': 'off' } });
  let last: { c: DailyChallenge; current: number } | null = null;
  let online: OnlineState = { status: 'off', user: null, players: [], updated: 0 };
  onOnline((st) => {
    const changed = st.status !== online.status || st.updated !== online.updated;
    online = st;
    if (changed && last) render(last.c, last.current);
  });
  /** A lenyíló részek nyitva maradnak újrarajzoláskor is. */
  const openBoxes = new Set<string>();
  const box = (key: string, summary: string, ...content: (HTMLElement | null)[]) => {
    const d = h('details', { class: 'league-box' }, h('summary', { text: summary }), ...content) as HTMLDetailsElement;
    d.open = openBoxes.has(key);
    d.addEventListener('toggle', () => (d.open ? openBoxes.add(key) : openBoxes.delete(key)));
    return d;
  };
  importFromHash();
  window.addEventListener('hashchange', () => {
    importFromHash();
    if (last) render(last.c, last.current);
  });

  // Másodpercenként: visszaszámlálás éjfélig, az aktuális feladat órája és az elérhető pont.
  const tick = () => {
    countdown.textContent = `Új kihívás: ${hms(msUntilNext(new Date()))}`;
    if (!last) return;
    const { c, current } = last;
    const t = c.tasks[current]!;
    const rec = loadProgress()[c.day]?.[c.level]?.[t.id];
    if (!rec) return void live.replaceChildren();
    const elapsed = (rec.solvedAt ?? Date.now()) - rec.opened;
    const par = PAR_MINUTES[c.level] * 60_000;
    const value = projectedFull(scoreOf(mePlayer().data), c.day, c.level, rec);
    live.className = `daily-live num ${rec.solvedAt ? 'is-done' : elapsed <= par / 2 ? 'is-hot' : elapsed >= 2 * par ? 'is-cold' : ''}`;
    live.replaceChildren(
      h('span', { class: 'daily-clock', text: ms(elapsed) }),
      h('span', { text: rec.solvedAt ? 'Megoldva' : rec.solution ? 'Megnézted a megoldást: 0 pont' : `Most megoldva: ${pts(value)}` }),
      h('span', { class: 'daily-par', text: `célidő ${PAR_MINUTES[c.level]} perc · alap ${BASE_POINTS[c.level]} · ×2 a célidő felén belül · minden szorzóval együtt` }),
    );
  };
  window.setInterval(tick, 1000);

  /** Achievement rács: a szorzójuk, és ahol számlálós, a haladás. */
  const achievementGrid = (score: FullScore) => {
    const got = new Set(score.achievements.map((u) => u.id));
    return h(
      'div',
      { class: 'ach-grid' },
      ...ACHIEVEMENTS.map((a) => {
        const has = got.has(a.id);
        const prog = a.progress?.(score.ctx);
        return h(
          'div',
          { class: `ach ${has ? 'is-got' : ''}` },
          h('span', { class: 'ach-icon' }, icon(TROPHY, 18)),
          h(
            'div',
            { class: 'ach-body' },
            h('div', { class: 'ach-name', text: a.name }),
            h('div', { class: 'ach-desc', text: a.desc }),
            prog && !has
              ? h('div', { class: 'ach-bar', attrs: { title: `${prog[0]} / ${prog[1]}` } }, h('span', { attrs: { style: `width:${(100 * prog[0]) / prog[1]}%` } }), h('em', { class: 'num', text: `${prog[0]}/${prog[1]}` }))
              : null,
          ),
          h('div', { class: 'ach-points num', text: formatMult(a.mult) }),
        );
      }),
    );
  };

  /** Ranglista: én + a beillesztett barátok, összpont szerint (mindenkié a naplóból újraszámolva). */
  const leaderboard = (c: DailyChallenge) => {
    const league = loadLeague();
    const live = online.status === 'online';
    const me = { ...mePlayer(), ...(live && online.user ? { id: online.user.id, name: online.user.username } : {}) };
    const others = live ? online.players.filter((p) => p.id !== me.id) : league.friends;
    const rows = [me, ...others]
      .map((p) => ({ p, s: scoreOf(p.data) }))
      .sort((a, b) => b.s.total - a.s.total);
    const nameInput = h('input', {
      class: 'answer-input league-name',
      attrs: { id: 'league-name', placeholder: 'Beceneved', maxlength: 24, 'aria-label': 'Becenév' },
      on: {
        change: () => {
          saveLeague({ ...loadLeague(), me: { ...league.me, name: nameInput.value.trim().slice(0, 24) } });
          if (last) render(last.c, last.current);
        },
      },
    });
    nameInput.value = league.me.name;
    const codeInput = h('input', { class: 'answer-input', attrs: { id: 'league-code', placeholder: 'Barát pontkódja vagy meghívó linkje', 'aria-label': 'Barát pontkódja', spellcheck: 'false' } });
    const add = () => {
      const r = decodeScore(codeInput.value);
      if (!r.ok) return toast(r.error);
      saveLeague(addFriend(loadLeague(), r.score));
      toast(r.score.dropped ? `${r.score.name} felkerült (${r.score.dropped} gyanús rekord kihagyva)` : `${r.score.name} felkerült a ranglistára`);
      if (last) render(last.c, last.current);
    };
    const copy = (link: boolean) => () => {
      if (!league.me.name) return toast('Előbb adj meg egy becenevet');
      const code = encodeScore({ name: league.me.name, id: league.me.id, at: Date.now(), data: loadProgress() });
      const text = link ? inviteLink(code) : code;
      const fallback = () => {
        codeInput.value = text;
        codeInput.select();
        toast('Nem sikerült másolni: kijelöltem a mezőben, másold ki kézzel');
      };
      if (!navigator.clipboard) return fallback();
      navigator.clipboard.writeText(text).then(() => toast(link ? 'Meghívó link másolva: küldd el a haverodnak' : 'Pontkód másolva'), fallback);
    };
    const remove = (id: string) => () => {
      const l = loadLeague();
      saveLeague({ ...l, friends: l.friends.filter((f) => f.id !== id) });
      if (last) render(last.c, last.current);
    };
    return h(
      'div',
      { class: 'league' },
      h(
        'div',
        { class: 'league-scroll' },
        h(
          'table',
          { class: 'value-table league-table' },
          h('thead', {}, h('tr', {}, h('th', { text: '#' }), h('th', { text: 'Játékos' }), h('th', { text: 'Ma' }), h('th', { text: 'Sorozat' }), h('th', { text: 'Szorzó' }), h('th', { text: 'Összes' }), h('th', {}))),
          h(
            'tbody',
            {},
            ...rows.map(({ p, s }, i) => {
              const isMe = p.id === me.id;
              const age = Math.round((Date.now() - p.at) / 3_600_000);
              return h(
                'tr',
                { class: isMe ? 'is-me' : '' },
                h('td', { text: String(i + 1) }),
                h(
                  'td',
                  {},
                  isMe ? `${p.name} (te)` : p.name,
                  !isMe ? h('span', { class: 'league-age', text: age < 1 ? ' · friss' : ` · ${age} órás kód` }) : null,
                  p.dropped ? h('span', { class: 'league-warn', text: ` · ${p.dropped} gyanús rekord kihagyva` }) : null,
                ),
                h('td', { class: 'num', text: formatPoints(s.perDay[c.day] ?? 0) }),
                h('td', { class: 'num', text: `${s.streak} nap` }),
                h('td', { class: 'num', text: formatMult(s.mult) }),
                h('td', { class: 'league-total num', text: formatPoints(s.total) }),
                h(
                  'td',
                  {},
                  isMe || live
                    ? null
                    : h('button', {
                        class: 'league-remove',
                        text: '×',
                        attrs: { type: 'button', 'aria-label': `${p.name} törlése`, title: 'Törlés a ranglistáról' },
                        on: { click: remove(p.id) },
                      }),
                ),
              );
            }),
          ),
        ),
      ),
      h('p', { class: `league-status ${live ? 'is-live' : ''}`, text: onlineText(online, !!online.user) }),
      live ? null : h('div', { class: 'league-actions' }, nameInput, button('Meghívó link másolása', copy(true), 'primary'), button('Csak a kód', copy(false), 'quiet')),
      live ? null : h('div', { class: 'league-actions' }, codeInput, button('Hozzáadás', add, 'secondary')),
      h('p', {
        class: 'step-note',
        text: live
          ? 'A ranglista élő: minden megoldás után magától feltöltődik a naplód, és percenként frissül. A pontot mindenkinek a saját gépe számolja a naplóból, és kidobja a lehetetlen rekordokat (rossz nap, nem létező feladat, 10 mp alatti megoldás).'
          : 'A meghívó linket megnyitva a haverod appja magától felvesz téged; ugyanígy fordítva. A kódban nincs pontszám, csak a napló: a pontot mindkét app maga számolja, és kidobja a lehetetlen rekordokat (rossz nap, nem létező feladat, 10 mp alatti megoldás). Frissíteni új link küldésével lehet.',
      }),
    );
  };

  const render = (c: DailyChallenge, current: number) => {
    last = { c, current };
    const data = loadProgress();
    publish(data);
    const res = data[c.day]?.[c.level] ?? {};
    const doneCount = c.tasks.filter((t) => res[t.id]?.solvedAt).length;
    const allDone = doneCount === c.tasks.length;
    const score = scoreOf(mePlayer().data);
    const today = dayDone(data, c.day, (l) => taskCount(c.day, l));
    const zh = daysUntilZh(new Date());
    const date = new Date(`${c.day}T12:00:00`).toLocaleDateString('hu-HU', { month: 'long', day: 'numeric', weekday: 'long' });
    const task = c.tasks[current]!;
    const hype = hypeMultiplier(c.day);
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const hypeNext = hypeMultiplier(dayKey(tomorrow));

    el.replaceChildren(
      h(
        'div',
        { class: 'daily-head' },
        h('div', { class: 'daily-title' }, h('h2', { text: 'Napi kihívás' }), h('span', { class: 'daily-sub', text: `${date} · ${c.theme}` })),
        h(
          'div',
          { class: 'daily-stats' },
          h('span', { class: `daily-streak ${today ? 'is-lit' : ''}`, attrs: { title: 'Egymás utáni kész napok' } }, icon(FLAME, 16, true), `${score.streak} napos sorozat`),
          h('span', { class: 'daily-hype num', attrs: { title: `A mai pontok és achievementek szorzója; holnap ${mult(hypeNext)}, a ZH napjáig (${ZH_DAY}) minden nap ×2,5` } }, `ZH-láz ${mult(hype)}`),
          h('span', { class: 'daily-zh num', text: zh > 0 ? `ZH-ig: ${zh} nap` : zh === 0 ? 'Ma van a ZH!' : 'A ZH már lement' }),
          countdown,
        ),
      ),
      h(
        'div',
        { class: 'daily-score' },
        h('div', { class: 'daily-score-main' }, h('span', { class: 'daily-score-label', text: 'Összes pont' }), h('span', { class: 'daily-score-value num', text: formatPoints(score.total) })),
        h('div', { class: 'daily-score-mult' }, h('span', { class: 'daily-score-label', text: 'Szorzód' }), h('span', { class: 'daily-score-x num', text: formatMult(score.mult) })),
        h(
          'div',
          { class: 'daily-score-side num' },
          h('span', { text: `Ma: ${pts(score.perDay[c.day] ?? 0)}` }),
          h('span', { text: `Achievementek: ${score.achievements.length}/${ACHIEVEMENTS.length}` }),
          h('span', { text: `Egy ${DAILY_LEVELS.find((l) => l.id === c.level)?.label ?? ''} feladat: ${formatMult(TASK_MULT[c.level])} szorzó` }),
        ),
      ),
      h('div', { class: 'daily-row' }, levelSeg.el, h('span', { class: 'daily-progress num', text: `${doneCount} / ${c.tasks.length} kész` })),
      h(
        'ol',
        { class: 'daily-tasks' },
        ...c.tasks.map((t, i) => {
          const r = res[t.id];
          const state = r?.solvedAt ? 'is-done' : r && (r.wrong || r.solution) ? 'is-wrong' : '';
          const got = score.steps.find((st) => st.day === c.day && st.lvl === c.level && st.task === t.id);
          return h(
            'li',
            {},
            h(
              'button',
              { class: `daily-task ${i === current ? 'is-current' : ''} ${state}`, attrs: { type: 'button', 'aria-current': i === current ? 'true' : undefined }, on: { click: () => onTask(i) } },
              h('span', { class: 'daily-num num', text: r?.solvedAt ? '✓' : String(i + 1) }),
              h('span', { text: t.title }),
              got ? h('span', { class: 'daily-task-pts num', text: `+${formatPoints(got.points)}` }) : null,
            ),
          );
        }),
      ),
      live,
      allDone
        ? h('p', { class: 'daily-done', text: 'Kész a mai kihívás. Szép munka! Holnap 00:00-kor jön az új; addig próbáld ki egy nehezebb fokozaton is (a nap a legjobb fokozatod pontját kapja).' })
        : h('div', { class: 'daily-tips' }, h('p', {}, h('strong', { text: 'Tipp ehhez a feladathoz: ' }), task.tip), h('p', {}, h('strong', { text: 'A nap tudnivalója: ' }), c.studyTip)),
      box('ach', `Achievementek (${score.achievements.length}/${ACHIEVEMENTS.length})`, achievementGrid(score)),
      box('league', online.status === 'online' ? `Élő ranglista (${online.players.filter((p) => p.id !== online.user?.id).length + 1} játékos)` : 'Ranglista és pontozás', leaderboard(c), scoringHelp()),
    );
    levelSeg.set(c.level);
    tick();
  };

  const celebrateSolve = (day: string, lvl: DailyLevel, task: string, title: string, totalBefore: number) => {
    const score = scoreOf(mePlayer().data);
    const step = score.steps.find((st) => st.day === day && st.lvl === lvl && st.task === task);
    return step ? playScoreFx(step, score, { title, totalBefore }) : Promise.resolve();
  };

  return { el, render, celebrateSolve, total: () => scoreOf(mePlayer().data).total };
}

function onlineText(st: OnlineState, hasName: boolean): string {
  if (st.status === 'online') {
    const t = new Date(st.updated || Date.now()).toLocaleTimeString('hu-HU', { hour: '2-digit', minute: '2-digit' });
    return hasName ? `● Élő · frissítve ${t}` : '● Élő · lépj be, hogy felkerülj a ranglistára';
  }
  if (st.status === 'connecting') return 'Kapcsolódás a ranglistához…';
  if (st.status === 'error') return `Az élő ranglista nem érhető el (${st.error ?? 'hálózati hiba'}). Addig pontkóddal is összemérhetitek magatokat.`;
  return '';
}

function scoringHelp(): HTMLElement {
  return h(
    'ul',
    { class: 'step-bullets' },
    h('li', { text: 'Egy feladat pontja = alappont × időbónusz × (1 − levonás) × sorozat × ZH-láz × a szorzód.' }),
    h('li', { text: 'Alappont: Free elo 100, Közepes 200, Tryhard 350, Kurva nehéz 600. Időbónusz: a célidő felén belül ×2, a kétszeresénél ×1.' }),
    h('li', { text: 'Levonás: rossz válasz −15% (legfeljebb −60%), tipp-lépés −20%, trükk-tipp −10%. A teljes megoldás megnézése 0 pont, és szorzót sem ad.' }),
    h('li', { text: 'Minden megoldott feladat növeli a szorzódat: Free elo ×1,01, Közepes ×1,03, Tryhard ×1,06, Kurva nehéz ×1,1. Minden fokozat számít.' }),
    h('li', { text: 'Minden achievement végleges szorzót ad (×1,1-től ×5-ig), és ezek összeszorzódnak.' }),
    h('li', { text: 'Sorozat: minden egymás utáni kész nap +5%, legfeljebb +50%. ZH-láz: minden nap ×2 az előzőhöz képest, a ZH napjáig.' }),
  );
}
