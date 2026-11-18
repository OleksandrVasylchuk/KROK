-- KROK profile sync: one JSON document per account, replaced as a whole.
-- Safe to run more than once. Apply in Supabase Dashboard → SQL Editor.
-- The client uses only the publishable key and the signed-in user's session;
-- row level security below is the isolation boundary between accounts.

create table if not exists public.krok_profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  revision bigint not null default 1 check (revision >= 1),
  state jsonb not null check (jsonb_typeof(state) = 'object' and octet_length(state::text) <= 4000000),
  device text not null default '' check (char_length(device) <= 80),
  updated_at timestamptz not null default now()
);

comment on table public.krok_profiles is 'KROK progress per account. The uploaded profile photo is never included by the client.';

alter table public.krok_profiles enable row level security;

revoke all on public.krok_profiles from anon;
revoke all on public.krok_profiles from authenticated;
grant select, insert, update, delete on public.krok_profiles to authenticated;

drop policy if exists krok_profiles_select_own on public.krok_profiles;
create policy krok_profiles_select_own on public.krok_profiles
  for select to authenticated using ((select auth.uid()) = user_id);

drop policy if exists krok_profiles_insert_own on public.krok_profiles;
create policy krok_profiles_insert_own on public.krok_profiles
  for insert to authenticated with check ((select auth.uid()) = user_id);

drop policy if exists krok_profiles_update_own on public.krok_profiles;
create policy krok_profiles_update_own on public.krok_profiles
  for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

drop policy if exists krok_profiles_delete_own on public.krok_profiles;
create policy krok_profiles_delete_own on public.krok_profiles
  for delete to authenticated using ((select auth.uid()) = user_id);

-- The client sends "update ... where revision = <last seen>". This trigger makes
-- the revision strictly sequential, so two devices can never both overwrite the
-- same copy: the slower one updates zero rows and must ask the person.
create or replace function public.krok_profiles_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.revision := 1;
  else
    if new.user_id <> old.user_id then
      raise exception 'krok_profiles: the owner cannot change';
    end if;
    if new.revision <> old.revision + 1 then
      raise exception 'krok_profiles: revision must advance by one';
    end if;
  end if;
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists krok_profiles_guard on public.krok_profiles;
create trigger krok_profiles_guard
  before insert or update on public.krok_profiles
  for each row execute function public.krok_profiles_guard();
