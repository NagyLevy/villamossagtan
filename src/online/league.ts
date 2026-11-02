// Élő ranglista a Supabase-en. Mindenki névtelenül lép be (a böngésző kap egy azonosítót),
// és csak a saját sorát írhatja (ezt az adatbázis szabályai kényszerítik ki). A sorban a
// napló van, nem a pont: a pontot mindenki gépe maga számolja újra, a `sanitize` szűrésével.
// Ha a szerver nem érhető el (pl. a claude.ai-os változatban), a ranglista pontkóddal működik tovább.

import type { SupabaseClient } from '@supabase/supabase-js';
import type { ProgressData } from '../daily/progress';
import { packData, sanitize, type PlayerScore } from '../daily/share';

/** A projekt címe és a nyilvános (publishable) kulcs: ezek a weboldal kódjában szabadon látszhatnak. */
const SUPABASE_URL = 'https://pueqrnspglrxajjcmhez.supabase.co';
const SUPABASE_KEY = 'sb_publishable_LF_-PmOLoVRVom068TQkfA_kkwTPIJm';

export interface OnlineState {
  status: 'off' | 'connecting' | 'online' | 'error';
  /** A saját névtelen azonosítóm (a ranglistán így ismerem fel magam). */
  myId: string | null;
  players: PlayerScore[];
  /** Az utolsó sikeres frissítés ideje (ms). */
  updated: number;
  error?: string;
}

const state: OnlineState = { status: 'off', myId: null, players: [], updated: 0 };
const listeners = new Set<(s: OnlineState) => void>();
let client: SupabaseClient | null = null;
let ready: Promise<SupabaseClient | null> | null = null;

const emit = () => listeners.forEach((f) => f({ ...state }));

function fail(e: unknown): null {
  state.status = 'error';
  state.error = e instanceof Error ? e.message : String(e);
  emit();
  return null;
}

/** Kapcsolódás és névtelen belépés (egyszer; a munkamenet a böngészőben megmarad). */
function connect(): Promise<SupabaseClient | null> {
  ready ??= (async () => {
    state.status = 'connecting';
    emit();
    try {
      const { createClient } = await import('@supabase/supabase-js');
      client = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: true, autoRefreshToken: true, storageKey: 'villamossagtan.auth' } });
      let { data } = await client.auth.getSession();
      if (!data.session) {
        const r = await client.auth.signInAnonymously();
        if (r.error) throw r.error;
        data = { session: r.data.session };
      }
      state.myId = data.session?.user.id ?? null;
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

/** A saját napló feltöltése (késleltetve, és csak ha változott). Becenév nélkül nem tölt fel. */
export function publish(name: string, data: ProgressData): void {
  if (!name) return;
  const body = JSON.stringify({ name, d: packData(data) });
  if (body === lastSent) return;
  clearTimeout(timer);
  timer = window.setTimeout(async () => {
    const c = await connect();
    if (!c || !state.myId) return;
    const { error } = await c.from('players').upsert({ id: state.myId, name: name.slice(0, 24), data: packData(data), updated_at: new Date().toISOString() });
    if (error) return void fail(error);
    lastSent = body;
    await refresh();
  }, 1500);
}

/** Feliratkozás az állapotra; az első feliratkozó elindítja a kapcsolódást és a percenkénti frissítést. */
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
