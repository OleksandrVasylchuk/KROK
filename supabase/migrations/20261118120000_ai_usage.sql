-- KROK: durable AI usage accounting, per-user limits and a global budget with a stop switch.
-- Idempotent: safe to re-run; existing counters and adjusted limits are kept.
-- The hosted API has no service-role key. It calls the two SECURITY DEFINER functions below
-- through PostgREST with the signed-in user's own JWT; clients get no direct write access.
-- Days are UTC dates. A reservation is counted even when the model call later fails.

-- Single-row configuration. The defaults are placeholders the owner adjusts in the dashboard,
-- not approved pricing or a promised allowance.
-- Stop switch:  update public.krok_ai_limits set paused = true, updated_at = now();
create table if not exists public.krok_ai_limits (
  id boolean primary key default true check (id),
  paused boolean not null default false,
  user_daily_requests integer not null default 40 check (user_daily_requests >= 0),
  user_monthly_tokens bigint not null default 1500000 check (user_monthly_tokens >= 0),
  global_daily_requests integer not null default 500 check (global_daily_requests >= 0),
  global_monthly_tokens bigint not null default 20000000 check (global_monthly_tokens >= 0),
  -- Micro-USD per 1K tokens; 0 = price unknown.
  input_micros_per_1k integer not null default 0 check (input_micros_per_1k >= 0),
  output_micros_per_1k integer not null default 0 check (output_micros_per_1k >= 0),
  -- Estimated micro-USD per UTC month; 0 = money budget not enforced. Needs the prices above.
  global_monthly_budget_micros bigint not null default 0 check (global_monthly_budget_micros >= 0),
  updated_at timestamptz not null default now()
);
insert into public.krok_ai_limits (id) values (true) on conflict (id) do nothing;

create table if not exists public.krok_ai_usage (
  user_id uuid not null references auth.users(id) on delete cascade,
  day date not null,
  requests integer not null default 0 check (requests >= 0),
  settled integer not null default 0 check (settled >= 0 and settled <= requests),
  input_tokens bigint not null default 0 check (input_tokens >= 0),
  output_tokens bigint not null default 0 check (output_tokens >= 0),
  primary key (user_id, day)
);

create table if not exists public.krok_ai_usage_global (
  day date primary key,
  requests integer not null default 0 check (requests >= 0),
  input_tokens bigint not null default 0 check (input_tokens >= 0),
  output_tokens bigint not null default 0 check (output_tokens >= 0)
);

alter table public.krok_ai_limits enable row level security;
alter table public.krok_ai_usage enable row level security;
alter table public.krok_ai_usage_global enable row level security;

-- No insert/update/delete policies: only the definer functions write.
drop policy if exists krok_ai_usage_select_own on public.krok_ai_usage;
create policy krok_ai_usage_select_own on public.krok_ai_usage
  for select to authenticated using ((select auth.uid()) = user_id);

revoke all on table public.krok_ai_limits, public.krok_ai_usage, public.krok_ai_usage_global from public, anon, authenticated;
grant select on table public.krok_ai_usage to authenticated;

-- Checks every limit and counts one request atomically. Denials do not increment.
create or replace function public.krok_ai_reserve(p_kind text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_day date := (pg_catalog.now() at time zone 'utc')::date;
  v_month date := pg_catalog.date_trunc('month', pg_catalog.now() at time zone 'utc')::date;
  v_limits public.krok_ai_limits%rowtype;
  v_requests bigint;
  v_tokens numeric;
  v_input numeric;
  v_output numeric;
begin
  if v_user is null or coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) then
    raise exception 'krok_ai: sign-in required' using errcode = '28000';
  end if;
  -- Informational only; validated so a caller cannot store arbitrary text later.
  if p_kind is null or p_kind not in ('chat', 'plan', 'actions') then
    raise exception 'krok_ai: unknown request kind' using errcode = '22023';
  end if;
  -- One lock for all callers: the global counters are part of every decision.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('public.krok_ai_usage', 0));

  select * into v_limits from public.krok_ai_limits where id;
  if not found then
    raise exception 'krok_ai: limits are not configured';
  end if;
  if v_limits.paused then
    return pg_catalog.jsonb_build_object('allowed', false, 'reason', 'paused');
  end if;

  select coalesce(sum(u.requests), 0) into v_requests
    from public.krok_ai_usage as u where u.user_id = v_user and u.day = v_day;
  if v_requests >= v_limits.user_daily_requests then
    return pg_catalog.jsonb_build_object('allowed', false, 'reason', 'user_daily');
  end if;

  select coalesce(sum(u.input_tokens + u.output_tokens), 0) into v_tokens
    from public.krok_ai_usage as u where u.user_id = v_user and u.day >= v_month;
  if v_tokens >= v_limits.user_monthly_tokens then
    return pg_catalog.jsonb_build_object('allowed', false, 'reason', 'user_monthly');
  end if;

  select coalesce(sum(g.requests), 0) into v_requests
    from public.krok_ai_usage_global as g where g.day = v_day;
  if v_requests >= v_limits.global_daily_requests then
    return pg_catalog.jsonb_build_object('allowed', false, 'reason', 'global_daily');
  end if;

  select coalesce(sum(g.input_tokens), 0), coalesce(sum(g.output_tokens), 0) into v_input, v_output
    from public.krok_ai_usage_global as g where g.day >= v_month;
  if v_input + v_output >= v_limits.global_monthly_tokens then
    return pg_catalog.jsonb_build_object('allowed', false, 'reason', 'global_monthly');
  end if;
  if v_limits.global_monthly_budget_micros > 0
     and (v_input * v_limits.input_micros_per_1k + v_output * v_limits.output_micros_per_1k) / 1000
         >= v_limits.global_monthly_budget_micros then
    return pg_catalog.jsonb_build_object('allowed', false, 'reason', 'global_budget');
  end if;

  insert into public.krok_ai_usage as u (user_id, day, requests) values (v_user, v_day, 1)
    on conflict (user_id, day) do update set requests = u.requests + 1
    returning u.requests into v_requests;
  insert into public.krok_ai_usage_global as g (day, requests) values (v_day, 1)
    on conflict (day) do update set requests = g.requests + 1;

  return pg_catalog.jsonb_build_object(
    'allowed', true, 'user_requests_today', v_requests, 'user_daily_requests', v_limits.user_daily_requests);
end;
$$;

-- Records the token usage of one reserved request. Every authenticated user can call this
-- directly with their own JWT, so the reported numbers are untrusted: they are clamped per call
-- and each reserve permits exactly one settle. A malicious user can therefore inflate the global
-- counters only up to their own per-user limits, never without bound.
create or replace function public.krok_ai_settle(p_input integer, p_output integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_today date := (pg_catalog.now() at time zone 'utc')::date;
  v_input integer := least(greatest(coalesce(p_input, 0), 0), 60000);
  v_output integer := least(greatest(coalesce(p_output, 0), 0), 4000);
  v_day date;
begin
  if v_user is null then
    raise exception 'krok_ai: sign-in required' using errcode = '28000';
  end if;
  -- Today's open reservation first; yesterday's covers a request that crossed UTC midnight.
  update public.krok_ai_usage as u
     set settled = u.settled + 1, input_tokens = u.input_tokens + v_input, output_tokens = u.output_tokens + v_output
   where u.user_id = v_user and u.settled < u.requests
     and u.day = (select s.day from public.krok_ai_usage as s
                   where s.user_id = v_user and s.day >= v_today - 1 and s.settled < s.requests
                   order by s.day desc limit 1)
  returning u.day into v_day;
  if v_day is null then
    return pg_catalog.jsonb_build_object('recorded', false);
  end if;
  insert into public.krok_ai_usage_global as g (day, input_tokens, output_tokens) values (v_day, v_input, v_output)
    on conflict (day) do update set input_tokens = g.input_tokens + excluded.input_tokens,
                                    output_tokens = g.output_tokens + excluded.output_tokens;
  return pg_catalog.jsonb_build_object('recorded', true);
end;
$$;

revoke execute on function public.krok_ai_reserve(text), public.krok_ai_settle(integer, integer) from public, anon;
grant execute on function public.krok_ai_reserve(text), public.krok_ai_settle(integer, integer) to authenticated;

-- Make the new functions visible to PostgREST without waiting for its next schema reload.
notify pgrst, 'reload schema';
