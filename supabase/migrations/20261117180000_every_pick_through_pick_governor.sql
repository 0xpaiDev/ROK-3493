-- Kingdom admin, ticket 18: every Pick goes through pick_governor (ADR 0006, amended 17 Nov 2026). It takes all
-- of a week's Picks in one call, so they save together or not at all, and it is the Council's only way to write
-- Name History. Safe to run twice.

drop function if exists public.pick_governor(date, bigint, text);

-- The reader's matching rule, in one place for record_live_week and pick_governor. Not granted to anyone: those
-- two call it as its owner. entries: a reading's rows in reading order, [{ name, names?, needs_id? }]. Returns,
-- for each row n (from 1), the Character ID it gets and the name it shows. By the rule in
-- tests/name-matching-cases.json (the same as liveReadingIds in site/kingdom.js), a row whose spellings (names, or
-- else its name) are held, exactly, by exactly one Governor, in Name History or as its current name, gets that
-- Character ID; anything else, including a name on two rows or two rows that lead to one Governor, is "needs ID".
-- A matched row shows the spelling that matched, the first one sent when more than one did. A row with
-- needs_id: true (an older reader) is never matched.
create or replace function public.live_week_matches(entries jsonb)
returns table (n bigint, character_id text, shown_name text)
language sql
stable
set search_path = public
as $$
  with reading as (
    select t.n, t.e ->> 'name' as name, coalesce((t.e ->> 'needs_id')::boolean, false) as flagged,
           coalesce(t.e -> 'names', jsonb_build_array(t.e ->> 'name')) as names
    from jsonb_array_elements(entries) with ordinality as t(e, n)
  ),
  -- Every spelling of each row, in the order sent; a row without names has its name alone.
  spelling as (
    select r.n, s.name, s.k
    from reading r cross join lateral jsonb_array_elements_text(r.names) with ordinality as s(name, k)
  ),
  seen as (
    select g.character_id, g.name from governor_name g
    union
    select g.character_id, g.current_name from governor g
  ),
  matched as (
    select r.n, r.name,
      case when not r.flagged
            and (select count(*) from reading o where o.name = r.name) = 1
            and (select count(distinct s.character_id) from seen s join spelling p on p.name = s.name where p.n = r.n) = 1
           then (select min(s.character_id) from seen s join spelling p on p.name = s.name where p.n = r.n)
      end as character_id
    from reading r
  ),
  shown as (
    select m.*,
      coalesce((select p.name from spelling p join seen s on s.name = p.name
                where m.character_id is not null and p.n = m.n order by p.k limit 1), m.name) as shown_name
    from matched m
  )
  -- Two rows whose names lead to one Governor: neither gets it, so a week never holds a Governor twice.
  select h.n,
         case when count(*) over (partition by h.character_id) = 1 then h.character_id end,
         case when count(*) over (partition by h.character_id) = 1 then h.shown_name else h.name end
  from shown h;
$$;

revoke all on function public.live_week_matches(jsonb) from public, anon, authenticated;

-- Replaces the Live Week's Weekly Ranking with a reading and stamps its "as of" time.
-- Its completeness comes from the reading's time: Complete from the week's Sunday 22:00 UTC, Partial before.
-- read_at: when the reader took the first screenshot. Its Fort Week must be the Live Week.
-- entries: [{ rank, name, fort_count, names?, needs_id? }], matched by live_week_matches. read_two_ways marks a row
-- read more than one way or flagged needs_id, and spellings holds its spellings. It never writes Name History or
-- Governors.
create or replace function public.record_live_week(read_at timestamptz, entries jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  reading_week date := date_trunc('week', record_live_week.read_at at time zone 'utc')::date;
  saved integer;
  resolved integer;
begin
  if not public.is_reader() then
    raise exception 'Only the reader''s sign-in may record the Live Week.' using errcode = '42501';
  end if;
  -- A few minutes of slack for the home PC's clock running ahead of the database's.
  if record_live_week.read_at > now() + interval '5 minutes' then
    raise exception 'The reading is stamped %, which is in the future. Check the PC''s clock.', record_live_week.read_at
      using errcode = '22023';
  end if;
  -- The Live Week is the Fort Week now falls in: Monday 00:00 UTC to the next reset.
  if reading_week is distinct from date_trunc('week', now() at time zone 'utc')::date then
    raise exception 'The screenshots were taken in the week of %, which is not the Live Week. The reader writes only the Fort Week now in progress.', reading_week
      using errcode = '22023';
  end if;
  if exists (select 1 from fort_week where starts_on = reading_week and fort_week.read_at > record_live_week.read_at) then
    raise exception 'The Live Week already holds a later reading than this one.' using errcode = '22023';
  end if;

  insert into fort_week (starts_on, read_at, completeness) values (reading_week, record_live_week.read_at,
          case when record_live_week.read_at >= (reading_week + 6)::timestamp at time zone 'utc' + interval '22 hours'
               then 'complete' else 'partial' end)
  on conflict (starts_on) do update set read_at = excluded.read_at, completeness = excluded.completeness;
  delete from fort_entry where fort_entry.week = reading_week;

  insert into fort_entry (week, character_id, name, fort_count, tie_order, read_two_ways, spellings)
  select reading_week, m.character_id, m.shown_name, (t.e ->> 'fort_count')::integer,
         row_number() over (order by (t.e ->> 'rank')::integer, t.n) - 1,
         coalesce(jsonb_array_length(t.e -> 'names') > 1, false) or coalesce((t.e ->> 'needs_id')::boolean, false),
         case when jsonb_array_length(t.e -> 'names') > 1 then array(select jsonb_array_elements_text(t.e -> 'names')) end
  from jsonb_array_elements(record_live_week.entries) with ordinality as t(e, n)
  join public.live_week_matches(record_live_week.entries) m on m.n = t.n;

  select count(*), count(character_id) into saved, resolved
  from fort_entry where fort_entry.week = reading_week;
  return jsonb_build_object('rows', saved, 'matched', resolved, 'needs_id', saved - resolved);
end;
$$;

revoke all on function public.record_live_week(timestamptz, jsonb) from public, anon;
grant execute on function public.record_live_week(timestamptz, jsonb) to authenticated;

-- The Council's Picks on a read Fort Week: each sets a "needs ID" row to a Governor. The week is the Live Week or
-- closed by the clock, not by the page. A Live Week Pick adds the row's name to Name History and nothing else, since
-- only the reader writes the Live Week (ADR 0002). A closed-week Pick also sets the row's Character ID, since no
-- later reading comes. A name another row of the week carries, or was also read as, stays out of Name History: it
-- may belong to two Governors, and under one of them alone the reader would hand the other's later rows to it.
-- Names go in first seen the week's Monday. One call is one statement, so any refused Pick saves none of the call's.
-- week: the Fort Week's Monday. picks: [{ entry, character_id }], entry the fort_entry row's id.
create or replace function public.pick_governor(week date, picks jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_variable
declare
  live_week date := date_trunc('week', now() at time zone 'utc')::date;
  p record;
  reading jsonb;
  read_ids bigint[];
  slips text[];
begin
  if not public.is_council() then
    raise exception 'Only the Council can Pick a Governor.' using errcode = '42501';
  end if;
  if week > live_week then
    raise exception 'The week of % has not begun, so it has no reading to Pick on.', week using errcode = '22023';
  end if;
  -- Holds the week's rows still while the Picks are judged and saved.
  perform 1 from fort_entry e where e.week = pick_governor.week for update;

  for p in
    select x.n, (x.v ->> 'entry')::bigint as entry, x.v ->> 'character_id' as character_id,
           e.id as found, e.name, e.character_id as row_id,
           count(*) over (partition by x.v ->> 'character_id') as times,
           count(*) over (partition by x.v ->> 'entry') as row_times
    from jsonb_array_elements(picks) with ordinality as x(v, n)
    left join fort_entry e on e.id = (x.v ->> 'entry')::bigint and e.week = pick_governor.week
    order by x.n
  loop
    if p.found is null then
      raise exception 'The week of % has no row %. Reload the page.', week, p.entry using errcode = '22023';
    end if;
    -- Two Governors Picked for one row would both get its name in Name History.
    if p.row_times > 1 then
      raise exception 'Row "%" is Picked more than once. A row gets one Governor.', p.name using errcode = '22023';
    end if;
    if p.row_id is not null then
      raise exception 'Row "%" already has Character ID %. A Pick resolves a "needs ID" row only.', p.name, p.row_id
        using errcode = '22023';
    end if;
    -- The unique key on (week, character_id) would refuse a closed week's too; this says why in the Council's words.
    if p.times > 1 or exists (select 1 from fort_entry e where e.week = pick_governor.week and e.character_id = p.character_id) then
      raise exception '% is on more than one row of the week of %. A Governor appears once per Fort Week.',
        coalesce((select g.current_name from governor g where g.character_id = p.character_id), p.character_id), week
        using errcode = '22023';
    end if;
  end loop;

  insert into governor_name (character_id, name, first_seen)
  select x ->> 'character_id', e.name, week
  from jsonb_array_elements(picks) x
  join fort_entry e on e.id = (x ->> 'entry')::bigint
  where not exists (select 1 from fort_entry o where o.week = pick_governor.week and o.id <> e.id
                    and e.name = any(coalesce(o.spellings, array[o.name])))
    -- A Governor's current name already counts as seen (live_week_matches, checkPicks): nothing to add.
    and not exists (select 1 from governor g where g.character_id = x ->> 'character_id' and g.current_name = e.name)
  on conflict do nothing;

  if week = live_week then
    -- The reader's next reading of the same rows, judged now by its own rule: a Pick it would not match is a slip,
    -- and the whole call is refused. The rows go back as the reader sent them: a row read more than one way with
    -- every spelling, the first leading, and one an older reader flagged with needs_id.
    select jsonb_agg(jsonb_build_object('name', coalesce(e.spellings[1], e.name))
                     || case when e.spellings is not null then jsonb_build_object('names', to_jsonb(e.spellings)) else '{}'::jsonb end
                     || case when e.read_two_ways and e.spellings is null and e.character_id is null
                             then '{"needs_id": true}'::jsonb else '{}'::jsonb end
                     order by e.tie_order, e.id),
           array_agg(e.id order by e.tie_order, e.id)
      into reading, read_ids
    from fort_entry e where e.week = pick_governor.week;
    select array_agg(e.name order by e.tie_order, e.id) into slips
    from jsonb_array_elements(picks) x
    join fort_entry e on e.id = (x ->> 'entry')::bigint
    join public.live_week_matches(reading) m on m.n = array_position(read_ids, e.id)
    where m.character_id is distinct from x ->> 'character_id';
    if slips is not null then
      raise exception '% would still be "needs ID" at the next reading: % on another row, as written or as read, or already % to another Governor. Clear the Pick and Pick it again once the week closes.',
        array_to_string(slips, ', '),
        case when cardinality(slips) = 1 then 'its name is' else 'their names are' end,
        case when cardinality(slips) = 1 then 'belongs' else 'belong' end
        using errcode = '22023';
    end if;
    -- Only the reader writes the Live Week's rows (ADR 0002).
    return;
  end if;

  update fort_entry e set character_id = x ->> 'character_id'
  from jsonb_array_elements(picks) x
  where e.id = (x ->> 'entry')::bigint;
end;
$$;

revoke all on function public.pick_governor(date, jsonb) from public, anon;
grant execute on function public.pick_governor(date, jsonb) to authenticated;

-- pick_governor is the Council's only way into Name History, so a bug in the page can't get around the rule that
-- keeps two Governors from sharing a name. Everyone still reads it; the Roster job writes through
-- record_roster_snapshot (ADR 0004).
drop policy if exists "council insert" on public.governor_name;
drop policy if exists "council update" on public.governor_name;
drop policy if exists "council delete" on public.governor_name;
