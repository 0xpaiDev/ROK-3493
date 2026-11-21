-- KvK ticket 19: a KvK names its Season of Conquest Story, by slug, so the KvK tab can show its key art and
-- the admin page's setup wizard can start from it. A new KvK needs one; a KvK set up before this (KvK 64) may
-- have none until the Council edits it. Safe to run twice: supabase/tests applies it in a rolled-back transaction.

-- The Stories the site knows (site/kvk-stories.js, KVK_STORIES); adding one means changing both.
-- supabase/tests/test_kvk.py checks the two lists match.
create or replace function public.is_kvk_story(slug text)
returns boolean
language sql
immutable
set search_path = public
as $$
  select slug in ('heroic-anthem', 'strife-of-the-eight', 'desert-conquest', 'king-of-the-nile', 'siege-of-orleans',
                  'warriors-unbound', 'storm-of-stratagems', 'tides-of-war', 'alliance-invictus', 'keener-blades',
                  'shifting-gears', 'king-of-all-britain', 'song-of-troy', 'mighty-assembly')
$$;

alter table kvk add column if not exists story text;
alter table kvk drop constraint if exists kvk_story_known;
alter table kvk add constraint kvk_story_known check (story is null or public.is_kvk_story(story));

-- Saves a KvK with its Counting Periods in one call: a new one when id is null, else replaces that KvK's Story, days,
-- Power Cutoff, weights and Counting Periods. Returns the KvK's id. Only the Council may call it.
-- kvk: { id, story, name, starts_on, ends_on, power_cutoff, weights: { t4_kill, t5_kill, t4_death, t5_death },
--        periods: [{ starts_on, ends_on }] }; a missing power_cutoff or weight takes the default.
-- It refuses, with a sentence saying why, what checkKvk in site/kingdom.js refuses (tests/kvk-cases.json
-- keeps the two together): no name, a new KvK without its Story or a Story it doesn't know, no days, an end day before the start day, a bad cutoff or weight, a
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
  k_story  text := nullif(btrim(coalesce(kvk ->> 'story', '')), '');
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
  -- Only a KvK set up before Stories may have none.
  if k_story is null and k_id is null then
    raise exception 'A new KvK needs its Story.' using errcode = '22023';
  end if;
  if k_story is not null and not public.is_kvk_story(k_story) then
    raise exception 'There is no Story "%".', k_story using errcode = '22023';
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
    insert into public.kvk (story, name, starts_on, ends_on, power_cutoff, weight_t4_kill, weight_t5_kill, weight_t4_death, weight_t5_death)
    values (k_story, k_name, k_start, k_end, k_cutoff, w4k, w5k, w4d, w5d)
    returning id into k_id;
  else
    update public.kvk o
    set story = k_story, name = k_name, starts_on = k_start, ends_on = k_end, power_cutoff = k_cutoff,
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
