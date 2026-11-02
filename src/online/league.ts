// Fiókok és élő ranglista a Supabase-en. Belépés felhasználónévvel és jelszóval: a Supabase
// e-mail-címet vár, ezért a névből egy ál-címet képzünk (a név bájtjai hexában, így ékezetes
// név is mehet). A haladás a fiókhoz tartozik: belépéskor letöltjük, változáskor feltöltjük.
// Mindenki csak a saját sorát írhatja (az adatbázis szabályai kényszerítik ki). A sorban a
// napló van, nem a pont: a pontot mindenki gépe maga számolja újra, a `sanitize` szűrésével.
// Ha a szerver nem érhető el (pl. a claude.ai-os változatban), az app belépés nélkül, pontkóddal megy.

import type { SupabaseClient } from '@supabase/supabase-js';
import type { ProgressData } from '../daily/progress';
import { packData, sanitize, type PlayerScore } from '../daily/share';

/** A projekt címe és a nyilvános (publishable) kulcs: ezek a weboldal kódjában szabadon látszhatnak. */
const SUPABASE_URL = 'https://pueqrnspglrxajjcmhez.supabase.co';
const SUPABASE_KEY = 'sb_publishable_LF_-PmOLoVRVom068TQkfA_kkwTPIJm';
const EMAIL_DOMAIN = 'villamossagtan.app';

export interface Account {
  id: string;
  username: string;
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

const emit = () => listeners.forEach((f) => f({ ...state }));

function fail(e: unknown): null {
  state.status = 'error';
  state.error = e instanceof Error ? e.message : String(e);
  emit();
  return null;
}

/** Felhasználónév: 3–20 betű, szám, pont, kötőjel vagy aláhúzás (ékezet is lehet). */
export const USERNAME_RULE = /^[\p{L}\p{N}_.-]{3,20}$/u;

export function normalizeUsername(name: string): string {
  return name.trim().toLowerCase();
}

function emailOf(username: string): string {
  const hex = [...new TextEncoder().encode(normalizeUsername(username))].map((b) => b.toString(16).padStart(2, '0')).join('');
  return `u${hex}@${EMAIL_DOMAIN}`;
}

function accountOf(user: { id: string; user_metadata?: Record<string, unknown> } | null | undefined): Account | null {
  if (!user) return null;
  const name = user.user_metadata?.['username'];
  return { id: user.id, username: typeof name === 'string' ? name : 'névtelen' };
}

/** Kapcsolódás (egyszer); a meglévő belépés a böngészőben megmarad. */
export function connect(): Promise<SupabaseClient | null> {
  ready ??= (async () => {
    state.status = 'connecting';
    emit();
    try {
      const { createClient } = await import('@supabase/supabase-js');
      const client = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: true, autoRefreshToken: true, storageKey: 'villamossagtan.auth' } });
      // Elérhető-e a szerver (a claude.ai-os keret például minden külső kérést letilt).
      const probe = await client.from('players').select('id').limit(1);
      if (probe.error) throw probe.error;
      const { data, error } = await client.auth.getSession();
      if (error) throw error;
      // Ha a tárolt munkamenet névtelen (régi változat), kiléptetjük.
      if (data.session?.user.is_anonymous) await client.auth.signOut();
      else state.user = accountOf(data.session?.user);
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
function authError(e: { message?: string; code?: string } | null): string {
  const m = `${e?.code ?? ''} ${e?.message ?? ''}`.toLowerCase();
  if (m.includes('invalid login') || m.includes('invalid_credentials')) return 'Hibás felhasználónév vagy jelszó.';
  if (m.includes('already registered') || m.includes('user_already_exists')) return 'Ez a felhasználónév már foglalt.';
  if (m.includes('weak_password') || m.includes('at least')) return 'Túl gyenge jelszó: legalább 6 karakter legyen.';
  if (m.includes('not confirmed')) return 'A fiók nincs megerősítve: a Supabase-ben ki kell kapcsolni az e-mail-megerősítést.';
  if (m.includes('signups not allowed') || m.includes('signup_disabled') || m.includes('email_provider_disabled')) return 'A regisztráció ki van kapcsolva a Supabase-ben (Email szolgáltató).';
  if (m.includes('rate limit')) return 'Túl sok próbálkozás, várj egy percet.';
  if (m.includes('fetch') || m.includes('network')) return 'Nincs kapcsolat a szerverrel.';
  return e?.message ?? 'Ismeretlen hiba.';
}

export type AuthResult = { ok: true; account: Account } | { ok: false; error: string };

export async function signUp(username: string, password: string): Promise<AuthResult> {
  const name = normalizeUsername(username);
  if (!USERNAME_RULE.test(name)) return { ok: false, error: 'A felhasználónév 3–20 karakter: betű, szám, pont, kötőjel vagy aláhúzás.' };
  if (password.length < 6) return { ok: false, error: 'A jelszó legalább 6 karakter legyen.' };
  const c = await connect();
  if (!c) return { ok: false, error: 'Nincs kapcsolat a szerverrel.' };
  const { data, error } = await c.auth.signUp({ email: emailOf(name), password, options: { data: { username: name } } });
  if (error) return { ok: false, error: authError(error) };
  if (!data.session) return { ok: false, error: authError({ message: 'not confirmed' }) };
  state.user = accountOf(data.user);
  emit();
  return { ok: true, account: state.user! };
}

export async function signIn(username: string, password: string): Promise<AuthResult> {
  const name = normalizeUsername(username);
  if (!name || !password) return { ok: false, error: 'Add meg a felhasználónevet és a jelszót.' };
  const c = await connect();
  if (!c) return { ok: false, error: 'Nincs kapcsolat a szerverrel.' };
  const { data, error } = await c.auth.signInWithPassword({ email: emailOf(name), password });
  if (error) return { ok: false, error: authError(error) };
  state.user = accountOf(data.user);
  emit();
  return { ok: true, account: state.user! };
}

export async function signOut(): Promise<void> {
  const c = await connect();
  await c?.auth.signOut();
  state.user = null;
  lastSent = '';
  emit();
}

/** A saját, szerveren tárolt haladásom (belépéskor ebből töltjük vissza). */
export async function loadMine(): Promise<ProgressData | null> {
  const c = await connect();
  if (!c || !state.user) return null;
  const { data, error } = await c.from('players').select('data').eq('id', state.user.id).maybeSingle();
  if (error) return fail(error);
  return data ? sanitize((data as { data: unknown }).data, Date.now()).data : {};
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
  const user = state.user;
  if (!user) return;
  const body = JSON.stringify({ u: user.id, d: packData(data) });
  if (body === lastSent) return;
  clearTimeout(timer);
  timer = window.setTimeout(async () => {
    const c = await connect();
    if (!c || state.user?.id !== user.id) return;
    const { error } = await c.from('players').upsert({ id: user.id, name: user.username.slice(0, 24), data: packData(data), updated_at: new Date().toISOString() });
    if (error) return void fail(error);
    lastSent = body;
    await refresh();
  }, 1500);
}

export function onlineState(): OnlineState {
  return { ...state };
}

/** Feliratkozás az állapotra; az első feliratkozó elindítja a percenkénti frissítést. */
export function onOnline(f: (s: OnlineState) => void): () => void {
  listeners.add(f);
  f({ ...state });
  if (listeners.size === 1) {
    void refresh();
    window.setInterval(() => document.visibilityState === 'visible' && void refresh(), 60_000);
    document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && void refresh());
  }
  return () => listeners.delete(f);
}
