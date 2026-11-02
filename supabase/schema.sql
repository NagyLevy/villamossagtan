-- Villamosságtan gyakorló: fiókok (felhasználónév + jelszó, e-mail nélkül) és ranglista.
-- A Supabase SQL Editorában kell lefuttatni (egyben). A korábbi `players` táblát lecseréli.
--
-- Biztonság: a jelszó csak bcrypt-hash-ként tárolódik. A fiók- és munkamenet-táblákhoz a
-- weboldal közvetlenül nem fér hozzá (RLS, szabály nélkül), csak az alábbi függvényeken át.
-- A ranglistát mindenki olvashatja, de írni csak a saját munkamenet-tokennel lehet, és csak a saját sort.

create extension if not exists pgcrypto with schema extensions;

drop table if exists public.players cascade;
drop table if exists public.sessions cascade;
drop table if exists public.accounts cascade;

create table public.accounts (
  id uuid primary key default gen_random_uuid(),
  username text not null unique check (username ~ '^[^[:space:]@]{3,20}$'),
  pass_hash text not null,
  created_at timestamptz not null default now()
);

create table public.sessions (
  token uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table public.players (
  id uuid primary key references public.accounts(id) on delete cascade,
  name text not null,
  data jsonb not null default '{}'::jsonb check (octet_length(data::text) < 200000),
  updated_at timestamptz not null default now()
);

alter table public.accounts enable row level security;
alter table public.sessions enable row level security;
alter table public.players enable row level security;
create policy "mindenki olvashatja" on public.players for select using (true);

-- Munkamenet → fiók (belső segédfüggvény).
create or replace function public._account_of(p_token uuid)
returns public.accounts
language sql stable security definer set search_path = public
as $$
  select a.* from public.sessions s join public.accounts a on a.id = s.account_id where s.token = p_token;
$$;
revoke all on function public._account_of(uuid) from public, anon, authenticated;

create or replace function public.register(p_username text, p_password text)
returns json
language plpgsql security definer set search_path = public, extensions
as $$
declare
  v_name text := lower(trim(p_username));
  v_id uuid;
  v_token uuid;
begin
  if v_name !~ '^[^[:space:]@]{3,20}$' then raise exception 'invalid_username'; end if;
  if coalesce(length(p_password), 0) < 1 then raise exception 'weak_password'; end if;
  begin
    insert into public.accounts (username, pass_hash) values (v_name, crypt(p_password, gen_salt('bf'))) returning id into v_id;
  exception when unique_violation then
    raise exception 'username_taken';
  end;
  insert into public.sessions (account_id) values (v_id) returning token into v_token;
  return json_build_object('id', v_id, 'username', v_name, 'token', v_token);
end;
$$;

create or replace function public.login(p_username text, p_password text)
returns json
language plpgsql security definer set search_path = public, extensions
as $$
declare
  v_acc public.accounts;
  v_token uuid;
begin
  select * into v_acc from public.accounts where username = lower(trim(p_username));
  if v_acc.id is null or crypt(p_password, v_acc.pass_hash) <> v_acc.pass_hash then
    perform pg_sleep(0.5);
    raise exception 'invalid_credentials';
  end if;
  insert into public.sessions (account_id) values (v_acc.id) returning token into v_token;
  return json_build_object('id', v_acc.id, 'username', v_acc.username, 'token', v_token);
end;
$$;

create or replace function public.whoami(p_token uuid)
returns json
language sql stable security definer set search_path = public
as $$
  select json_build_object('id', a.id, 'username', a.username) from public._account_of(p_token) a where a.id is not null;
$$;

create or replace function public.logout(p_token uuid)
returns void
language sql security definer set search_path = public
as $$
  delete from public.sessions where token = p_token;
$$;

create or replace function public.my_progress(p_token uuid)
returns jsonb
language plpgsql stable security definer set search_path = public
as $$
declare
  v_acc public.accounts := public._account_of(p_token);
begin
  if v_acc.id is null then raise exception 'invalid_session'; end if;
  return coalesce((select data from public.players where id = v_acc.id), '{}'::jsonb);
end;
$$;

create or replace function public.save_progress(p_token uuid, p_data jsonb)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_acc public.accounts := public._account_of(p_token);
begin
  if v_acc.id is null then raise exception 'invalid_session'; end if;
  insert into public.players (id, name, data, updated_at) values (v_acc.id, v_acc.username, p_data, now())
  on conflict (id) do update set name = excluded.name, data = excluded.data, updated_at = now();
end;
$$;

grant execute on function public.register(text, text), public.login(text, text), public.whoami(uuid), public.logout(uuid), public.my_progress(uuid), public.save_progress(uuid, jsonb) to anon, authenticated;
