-- KvK ticket 03: the Council sets up a KvK and its Counting Periods, and the site reads each Governor's
-- totals over them. Every number comes from the Roster Snapshots, so moving a Counting Period moves the
-- standings with it. Safe to run twice: supabase/tests applies it inside a rolled-back transaction.

-- A KvK: its days (UTC dates, both ends included; the start day's Roster Snapshot is its KvK Start
-- Snapshot), its Power Cutoff and its DKP weights. The defaults match KVK_DEFAULTS in site/kingdom.js.
create table if not exists kvk (
  id               bigint generated always as identity primary key,
  name             text not null check (btrim(name) <> ''),
  starts_on        date not null,
  ends_on          date not null check (ends_on >= starts_on),
  power_cutoff     bigint not null default 20000000 check (power_cutoff >= 0),
  weight_t4_kill   numeric not null default 1 check (weight_t4_kill >= 0),
  weight_t5_kill   numeric not null default 2 check (weight_t5_kill >= 0),
  weight_t4_death  numeric not null default 4 check (weight_t4_death >= 0),
  weight_t5_death  numeric not null default 8 check (weight_t5_death >= 0),
  updated_at       timestamptz not null default now()
);

-- A Counting Period: whole UTC days, both ends included; ends_on null while it is open. An open period runs
-- to the KvK's end day, and in the totals to the newest Roster Snapshot.
create table if not exists kvk_counting_period (
  id        bigint generated always as identity primary key,
  kvk_id    bigint not null references kvk (id) on delete cascade,
  starts_on date not null,
  ends_on   date check (ends_on is null or ends_on >= starts_on)
);
create index if not exists kvk_counting_period_kvk on kvk_counting_period (kvk_id);

-- Public read. No write policy and no write grant: the Council writes only through save_kvk and delete_kvk,
-- so their checks always run.
do $$
declare t text;
begin
  foreach t in array array['kvk', 'kvk_counting_period']
  loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists "public read" on %I', t);
    execute format('create policy "public read" on %I for select to anon, authenticated using (true)', t);
    execute format('grant select on %I to anon, authenticated', t);
    execute format('revoke insert, update, delete, truncate on %I from anon, authenticated', t);
  end loop;
end $$;

-- A day as the Council reads it in a refusal: "9 Jan 2020", as dayLabel in site/kingdom.js writes it.
-- Only save_kvk calls it, as its owner, so nobody else may.
create or replace function public.kvk_day(d date)
returns text
language sql
immutable
set search_path = public
as $$ select to_char(d, 'FMDD Mon YYYY') $$;

revoke all on function public.kvk_day(date) from public, anon, authenticated;

-- Saves a KvK with its Counting Periods in one call: a new one when id is null, else replaces that KvK's days,
-- Power Cutoff, weights and Counting Periods. Returns the KvK's id. Only the Council may call it.
-- kvk: { id, name, starts_on, ends_on, power_cutoff, weights: { t4_kill, t5_kill, t4_death, t5_death },
--        periods: [{ starts_on, ends_on }] }; a missing power_cutoff or weight takes the default.
-- It refuses, with a sentence saying why, what checkKvk in site/kingdom.js refuses (tests/kvk-cases.json
-- keeps the two together): no name or days, an end day before the start day, a bad cutoff or weight, a
-- Counting Period outside the KvK's days or ending before it starts, overlapping Counting Periods, and a
-- KvK whose days overlap another.
create or replace function public.save_kvk(kvk jsonb)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  k_id     bigint;
  k_name   text := btrim(coalesce(kvk ->> 'name', ''));
  k_start  date;
  k_end    date;
  k_cutoff bigint;
  w        jsonb := coalesce(kvk -> 'weights', '{}'::jsonb);
  w4k numeric; w5k numeric; w4d numeric; w5d numeric;
  days     text;
  p        record;
  q        record;
  clash    record;
begin
  if not public.is_council() then
    raise exception 'Only the Council can set up a KvK.' using errcode = '42501';
  end if;
  if jsonb_typeof(kvk -> 'id') = 'number' then
    k_id := (kvk ->> 'id')::bigint;
  end if;

  if k_name = '' then
    raise exception 'A KvK needs a name.' using errcode = '22023';
  end if;
  begin
    k_start := (kvk ->> 'starts_on')::date;
    k_end := (kvk ->> 'ends_on')::date;
  exception when others then
    k_start := null;
  end;
  if k_start is null or k_end is null then
    raise exception 'A KvK needs a start day and an end day.' using errcode = '22023';
  end if;
  if k_end < k_start then
    raise exception 'The KvK ends on %, before it starts on %.', kvk_day(k_end), kvk_day(k_start) using errcode = '22023';
  end if;
  if kvk ? 'power_cutoff' and jsonb_typeof(kvk -> 'power_cutoff') <> 'null' then
    if jsonb_typeof(kvk -> 'power_cutoff') <> 'number'
       or (kvk ->> 'power_cutoff')::numeric < 0 or (kvk ->> 'power_cutoff')::numeric <> trunc((kvk ->> 'power_cutoff')::numeric) then
      raise exception 'The Power Cutoff is a whole number from 0 up.' using errcode = '22023';
    end if;
    k_cutoff := (kvk ->> 'power_cutoff')::bigint;
  else
    k_cutoff := 20000000;
  end if;
  if exists (select 1 from jsonb_each(w) e
             where e.key in ('t4_kill', 't5_kill', 't4_death', 't5_death')
               and (jsonb_typeof(e.value) <> 'number' or (e.value #>> '{}')::numeric < 0)) then
    raise exception 'Each DKP weight is a number from 0 up.' using errcode = '22023';
  end if;
  w4k := coalesce((w ->> 't4_kill')::numeric, 1);
  w5k := coalesce((w ->> 't5_kill')::numeric, 2);
  w4d := coalesce((w ->> 't4_death')::numeric, 4);
  w5d := coalesce((w ->> 't5_death')::numeric, 8);

  -- The Counting Periods as given, numbered from 1. An open one runs to the KvK's end day.
  create temp table kvk_in on commit drop as
  select x.n::integer as n, x.starts_on, x.ends_on
  from rows from (jsonb_to_recordset(coalesce(kvk -> 'periods', '[]'::jsonb)) as (starts_on date, ends_on date))
    with ordinality as x (starts_on, ends_on, n);
  days := format('the KvK''s days, %s to %s', kvk_day(k_start), kvk_day(k_end));
  for p in select * from kvk_in order by n loop
    if p.starts_on is null then
      raise exception 'Counting Period % needs a start day.', p.n using errcode = '22023';
    end if;
    if p.ends_on < p.starts_on then
      raise exception 'Counting Period % ends on %, before it starts on %.', p.n, kvk_day(p.ends_on), kvk_day(p.starts_on) using errcode = '22023';
    end if;
    if p.starts_on < k_start or p.starts_on > k_end then
      raise exception 'Counting Period % starts on %, outside %.', p.n, kvk_day(p.starts_on), days using errcode = '22023';
    end if;
    if p.ends_on > k_end then
      raise exception 'Counting Period % ends on %, outside %.', p.n, kvk_day(p.ends_on), days using errcode = '22023';
    end if;
  end loop;
  -- Both ends are included, so two periods sharing one day overlap.
  select a.n as a, b.n as b, greatest(a.starts_on, b.starts_on) as day into q
  from kvk_in a join kvk_in b on a.n < b.n
  where a.starts_on <= coalesce(b.ends_on, k_end) and b.starts_on <= coalesce(a.ends_on, k_end)
  order by a.n, b.n limit 1;
  if found then
    raise exception 'Counting Periods % and % overlap on %. No day counts twice.', q.a, q.b, kvk_day(q.day) using errcode = '22023';
  end if;

  -- One save at a time, so two KvKs saved together can't both miss each other.
  lock table public.kvk in share row exclusive mode;
  if k_id is not null and not exists (select 1 from public.kvk o where o.id = k_id) then
    raise exception 'There is no KvK %. Reload the page.', k_id using errcode = '22023';
  end if;
  select o.name, o.starts_on, o.ends_on into clash from public.kvk o
  where o.id is distinct from k_id and o.starts_on <= k_end and k_start <= o.ends_on
  order by o.starts_on limit 1;
  if found then
    raise exception 'Its days overlap %, % to %. Only one KvK runs at a time.', clash.name, kvk_day(clash.starts_on), kvk_day(clash.ends_on)
      using errcode = '22023';
  end if;

  if k_id is null then
    insert into public.kvk (name, starts_on, ends_on, power_cutoff, weight_t4_kill, weight_t5_kill, weight_t4_death, weight_t5_death)
    values (k_name, k_start, k_end, k_cutoff, w4k, w5k, w4d, w5d)
    returning id into k_id;
  else
    update public.kvk o
    set name = k_name, starts_on = k_start, ends_on = k_end, power_cutoff = k_cutoff,
        weight_t4_kill = w4k, weight_t5_kill = w5k, weight_t4_death = w4d, weight_t5_death = w5d, updated_at = now()
    where o.id = k_id;
    delete from kvk_counting_period c where c.kvk_id = k_id;
  end if;
  insert into kvk_counting_period (kvk_id, starts_on, ends_on)
  select k_id, i.starts_on, i.ends_on from kvk_in i order by i.n;
  drop table kvk_in;
  return k_id;
end;
$$;

revoke all on function public.save_kvk(jsonb) from public, anon;
grant execute on function public.save_kvk(jsonb) to authenticated;

-- Deletes a KvK and its Counting Periods. Only the Council may call it. The Roster Snapshots stay.
create or replace function public.delete_kvk(kvk_id bigint)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_council() then
    raise exception 'Only the Council can delete a KvK.' using errcode = '42501';
  end if;
  delete from public.kvk k where k.id = delete_kvk.kvk_id;
  if not found then
    raise exception 'There is no KvK %. Reload the page.', delete_kvk.kvk_id using errcode = '22023';
  end if;
end;
$$;

revoke all on function public.delete_kvk(bigint) from public, anon;
grant execute on function public.delete_kvk(bigint) to authenticated;

-- A KvK's totals, one row per Governor in its KvK Start Snapshot (the Roster Snapshot of its start day; none
-- yet, no rows): starting power, current status, and T4/T5 kills and deaths summed over the Roster Snapshots
-- of its Counting Periods' days. An open period runs to the newest snapshot; a day a Governor is missing from
-- adds nothing. DKP, the Power Cutoff and the order are rules in site/kingdom.js, so the site loads these
-- totals and never the daily rows.
create or replace function public.kvk_standings(kvk_id bigint)
returns table (character_id text, name text, status text, start_power bigint,
               t4_kills bigint, t5_kills bigint, t4_deaths bigint, t5_deaths bigint)
language sql
stable
set search_path = public
as $$
  with k as (select * from kvk where id = kvk_standings.kvk_id),
  counted as (
    select r.character_id, r.t4_kills, r.t5_kills, r.t4_deaths, r.t5_deaths
    from k
    join kvk_counting_period p on p.kvk_id = k.id
    join roster_snapshot s on s.taken_on between p.starts_on and coalesce(p.ends_on, k.ends_on)
    join roster_snapshot_row r on r.snapshot_id = s.id
  ),
  totals as (
    select c.character_id, sum(c.t4_kills)::bigint as t4_kills, sum(c.t5_kills)::bigint as t5_kills,
           sum(c.t4_deaths)::bigint as t4_deaths, sum(c.t5_deaths)::bigint as t5_deaths
    from counted c group by c.character_id
  )
  select r.character_id, g.current_name, g.status, r.power,
         coalesce(t.t4_kills, 0), coalesce(t.t5_kills, 0), coalesce(t.t4_deaths, 0), coalesce(t.t5_deaths, 0)
  from k
  join roster_snapshot s on s.taken_on = k.starts_on
  join roster_snapshot_row r on r.snapshot_id = s.id
  join governor g on g.character_id = r.character_id
  left join totals t on t.character_id = r.character_id
  order by r.power desc nulls last, r.character_id;
$$;

revoke all on function public.kvk_standings(bigint) from public;
grant execute on function public.kvk_standings(bigint) to anon, authenticated;
