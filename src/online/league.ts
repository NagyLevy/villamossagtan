// Fiókok és élő ranglista a Supabase-en. Belépés felhasználónévvel és jelszóval, e-mail nélkül:
// a fiókokat az adatbázis saját függvényei kezelik (supabase/schema.sql), a jelszó ott csak
// bcrypt-hash-ként tárolódik. Belépéskor munkamenet-tokent kapunk; ezzel lehet a saját haladást
// letölteni és menteni, más sorát nem. A sorban a napló van, nem a pont: a pontot mindenki
// gépe maga számolja újra, a `sanitize` szűrésével.
// Ha a szerver nem érhető el (pl. a claude.ai-os változatban), az app belépés nélkül, pontkóddal megy.

import type { SupabaseClient } from '@supabase/supabase-js';
import type { ProgressData } from '../daily/progress';
import { packData, sanitize, type PlayerScore } from '../daily/share';

/** A projekt címe és a nyilvános (publishable) kulcs: ezek a weboldal kódjában szabadon látszhatnak. */
const SUPABASE_URL = 'https://pueqrnspglrxajjcmhez.supabase.co';
const SUPABASE_KEY = 'sb_publishable_LF_-PmOLoVRVom068TQkfA_kkwTPIJm';
const SESSION_KEY = 'villamossagtan.session';
/** A ranglista ilyen gyakran frissül, amíg az oldal látszik. */
const REFRESH_MS = 20_000;

export interface Account {
  id: string;
  username: string;
}

interface Session extends Account {
  token: string;
}

export interface OnlineState {
  status: 'off' | 'connecting' | 'online' | 'error';
  user: Account | null;
  players: PlayerScore[];
  /** Az utolsó sikeres frissítés ideje (ms). */
  updated: number;
  error?: string;
}

const state: OnlineState = { status: 'off', user: null, players: [], updated: 0 };
const listeners = new Set<(s: OnlineState) => void>();
let ready: Promise<SupabaseClient | null> | null = null;
let session: Session | null = null;

const emit = () => listeners.forEach((f) => f({ ...state }));

function fail(e: unknown): null {
  state.status = 'error';
  state.error = e instanceof Error ? e.message : String((e as { message?: string })?.message ?? e);
  emit();
  return null;
}

function loadSession(): Session | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    return raw ? (JSON.parse(raw) as Session) : null;
  } catch {
    return null;
  }
}

function saveSession(s: Session | null): void {
  session = s;
  state.user = s ? { id: s.id, username: s.username } : null;
  try {
    if (s) localStorage.setItem(SESSION_KEY, JSON.stringify(s));
    else localStorage.removeItem(SESSION_KEY);
  } catch {
    // A tárolás nem kötelező.
  }
}

/** Felhasználónév: 3–20 karakter, szóköz és @ nélkül (ékezet is lehet). */
export const USERNAME_RULE = /^[^\s@]{3,20}$/u;

export function normalizeUsername(name: string): string {
  return name.trim().toLowerCase();
}

/** Kapcsolódás (egyszer); a tárolt belépést a szerverrel ellenőrizzük. */
export function connect(): Promise<SupabaseClient | null> {
  ready ??= (async () => {
    state.status = 'connecting';
    emit();
    try {
      const { createClient } = await import('@supabase/supabase-js');
      const client = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
      // Elérhető-e a szerver (a claude.ai-os keret például minden külső kérést letilt).
      const probe = await client.from('players').select('id').limit(1);
      if (probe.error) throw probe.error;
      const stored = loadSession();
      if (stored) {
        const { data, error } = await client.rpc('whoami', { p_token: stored.token });
        saveSession(!error && data ? { ...(data as Account), token: stored.token } : null);
      }
      state.status = 'online';
      emit();
      return client;
    } catch (e) {
      ready = null;
      return fail(e);
    }
  })();
  return ready;
}

/** Hibaüzenetek magyarul. */
function authError(e: { message?: string } | null): string {
  const m = (e?.message ?? '').toLowerCase();
  if (m.includes('invalid_credentials')) return 'Hibás felhasználónév vagy jelszó.';
  if (m.includes('username_taken')) return 'Ez a felhasználónév már foglalt.';
  if (m.includes('invalid_username')) return 'A felhasználónév 3–20 karakter, szóköz és @ nélkül.';
  if (m.includes('weak_password')) return 'Adj meg jelszót.';
  if (m.includes('could not find the function') || m.includes('schema cache')) return 'A szerveren még nincs beállítva a belépés (le kell futtatni a schema.sql-t).';
  if (m.includes('fetch') || m.includes('network')) return 'Nincs kapcsolat a szerverrel.';
  return e?.message ?? 'Ismeretlen hiba.';
}

export type AuthResult = { ok: true; account: Account } | { ok: false; error: string };

async function auth(fn: 'register' | 'login', username: string, password: string): Promise<AuthResult> {
  const name = normalizeUsername(username);
  if (fn === 'register' && !USERNAME_RULE.test(name)) return { ok: false, error: 'A felhasználónév 3–20 karakter, szóköz és @ nélkül.' };
  if (!name || !password) return { ok: false, error: 'Add meg a felhasználónevet és a jelszót.' };
  const c = await connect();
  if (!c) return { ok: false, error: 'Nincs kapcsolat a szerverrel.' };
  const { data, error } = await c.rpc(fn, { p_username: name, p_password: password });
  if (error || !data) return { ok: false, error: authError(error) };
  saveSession(data as Session);
  emit();
  return { ok: true, account: state.user! };
}

export const signUp = (username: string, password: string) => auth('register', username, password);
export const signIn = (username: string, password: string) => auth('login', username, password);

export async function signOut(): Promise<void> {
  const c = await connect();
  if (c && session) await c.rpc('logout', { p_token: session.token });
  saveSession(null);
  lastSent = '';
  emit();
}

/** A saját, szerveren tárolt haladásom (belépéskor ebből töltjük vissza). */
export async function loadMine(): Promise<ProgressData | null> {
  const c = await connect();
  if (!c || !session) return null;
  const { data, error } = await c.rpc('my_progress', { p_token: session.token });
  if (error) return fail(error);
  return sanitize(data ?? {}, Date.now()).data;
}

/** Az összes játékos letöltése (a pontot a hívó számolja a naplóból). */
export async function refresh(): Promise<void> {
  const c = await connect();
  if (!c) return;
  const { data, error } = await c.from('players').select('id, name, data, updated_at').order('updated_at', { ascending: false }).limit(200);
  if (error) return void fail(error);
  state.players = (data ?? []).map((row: { id: string; name: string; data: unknown; updated_at: string }) => {
    const at = Date.parse(row.updated_at) || Date.now();
    const clean = sanitize(row.data, at);
    return { name: String(row.name).slice(0, 24), id: row.id, at, data: clean.data, dropped: clean.dropped };
  });
  state.updated = Date.now();
  state.status = 'online';
  emit();
}

let lastSent = '';
let timer = 0;

/** A saját napló feltöltése (késleltetve, és csak ha változott). Belépés nélkül nem tölt fel. */
export function publish(data: ProgressData): void {
  const s = session;
  if (!s) return;
  const packed = packData(data);
  const body = JSON.stringify({ u: s.id, d: packed });
  if (body === lastSent) return;
  clearTimeout(timer);
  timer = window.setTimeout(async () => {
    const c = await connect();
    if (!c || session?.token !== s.token) return;
    const { error } = await c.rpc('save_progress', { p_token: s.token, p_data: packed });
    if (error) return void fail(error);
    lastSent = body;
    await refresh();
  }, 1000);
}

export function onlineState(): OnlineState {
  return { ...state };
}

/** Feliratkozás az állapotra; az első feliratkozó elindítja a rendszeres frissítést. */
export function onOnline(f: (s: OnlineState) => void): () => void {
  listeners.add(f);
  f({ ...state });
  if (listeners.size === 1) {
    void refresh();
    window.setInterval(() => document.visibilityState === 'visible' && void refresh(), REFRESH_MS);
    document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && void refresh());
  }
  return () => listeners.delete(f);
}
