-- KvK, ticket 05: the Fort Pause (ADR 0007). The Council pauses Forts on the admin page, usually for a KvK, and
-- resumes them after; the switch is not tied to any KvK. While Forts are paused record_live_week refuses
-- readings, so no Fort Week exists inside a pause (Fort Weeks come only from readings, ADR 0006) and Fort
-- Average, which counts only weeks that exist, skips them. The week a pause starts keeps its last reading,
-- Complete or Partial by ADR 0005; the week Forts resume is an ordinary Live Week. Safe to run twice.

-- One span with no Fort Rankings: from starts_at until ends_at, or still going while ends_at is null.
create table if not exists fort_pause (
  id        bigint generated always as identity primary key,
  starts_at timestamptz not null,
  ends_at   timestamptz,
  check (ends_at >= starts_at)
);
comment on table public.fort_pause is
  'Fort Pauses (ADR 0007): no Live Week reading is taken from starts_at until ends_at (null while still paused). Written only through set_fort_pause.';
-- At most one pause still going.
create unique index if not exists fort_pause_one_open on fort_pause ((true)) where ends_at is null;

-- Public read; the Council writes through set_fort_pause only, so a pause always starts and ends now.
alter table fort_pause enable row level security;
drop policy if exists "public read" on fort_pause;
create policy "public read" on fort_pause for select to anon, authenticated using (true);
grant select on fort_pause to anon, authenticated;
revoke insert, update, delete, truncate on fort_pause from anon, authenticated;

-- The Council's Fort Pause switch. paused true pauses Forts from now, false resumes them now. Returns when the
-- pause in effect started, or null once Forts run. Refuses pausing paused Forts and resuming running ones.
-- Runs as its owner, after checking the caller is the Council, so the table takes no direct writes.
create or replace function public.set_fort_pause(paused boolean)
returns timestamptz
language plpgsql
security definer
set search_path = public
as $$
declare
  open_since timestamptz;
  -- clock_timestamp, not now(): a pause and a resume in one transaction still come in order.
  at timestamptz := clock_timestamp();
begin
  if not public.is_council() then
    raise exception 'Only the Council can pause or resume Forts.' using errcode = '42501';
  end if;
  select starts_at into open_since from fort_pause where ends_at is null for update;
  if paused then
    if open_since is not null then
      raise exception 'Forts are already paused since % UTC.', to_char(open_since at time zone 'utc', 'YYYY-MM-DD HH24:MI')
        using errcode = '22023';
    end if;
    insert into fort_pause (starts_at) values (at);
    return at;
  end if;
  if open_since is null then
    raise exception 'Forts are not paused, so there is nothing to resume.' using errcode = '22023';
  end if;
  update fort_pause set ends_at = greatest(at, starts_at) where ends_at is null;
  return null;
end;
$$;

revoke all on function public.set_fort_pause(boolean) from public, anon;
grant execute on function public.set_fort_pause(boolean) to authenticated;

-- Replaces the Live Week's Weekly Ranking with a reading and stamps its "as of" time.
-- A reading taken while Forts are paused is refused (ADR 0007).
-- Its completeness comes from the reading's time: Complete from the week's Sunday 22:00 UTC, Partial before.
-- read_at: when the reader took the first screenshot. Its Fort Week must be the Live Week.
-- entries: [{ rank, name, fort_count, names?, needs_id? }]. Names match by the rule in
-- tests/name-matching-cases.json (the same as liveReadingIds in site/kingdom.js): a row whose spellings
-- (names, or else its name) are held, exactly, by exactly one Governor, in Name History or as its current
-- name, gets that Character ID; anything else, including a name on two rows or two rows that lead to one
-- Governor, is "needs ID". A matched row keeps the spelling that matched. An entry with needs_id: true is
-- "needs ID". read_two_ways marks a row read more than one way or flagged needs_id, and spellings holds its
-- spellings. It never writes Name History or Governors.
create or replace function public.record_live_week(read_at timestamptz, entries jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  reading_week date := date_trunc('week', record_live_week.read_at at time zone 'utc')::date;
  paused_since timestamptz;
  saved integer;
  resolved integer;
begin
  if not public.is_reader() then
    raise exception 'Only the reader''s sign-in may record the Live Week.' using errcode = '42501';
  end if;
  select p.starts_at into paused_since from fort_pause p
  where p.starts_at <= record_live_week.read_at and (p.ends_at is null or p.ends_at > record_live_week.read_at);
  if paused_since is not null then
    raise exception 'Forts are paused since % UTC: the Council paused them, so no Fort Week is read until they resume Forts.',
      to_char(paused_since at time zone 'utc', 'YYYY-MM-DD HH24:MI') using errcode = '22023';
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

  with reading as (
    select n as entry, e ->> 'name' as name, (e ->> 'fort_count')::integer as fort_count,
           coalesce((e ->> 'needs_id')::boolean, false) as flagged,
           coalesce(jsonb_array_length(e -> 'names') > 1, false) as read_two_ways,
           case when jsonb_array_length(e -> 'names') > 1
                then array(select jsonb_array_elements_text(e -> 'names')) end as spellings,
           row_number() over (order by (e ->> 'rank')::integer, n) - 1 as tie_order
    from jsonb_array_elements(record_live_week.entries) with ordinality as t(e, n)
  ),
  -- Every spelling of each row, in the order sent; a row without names has its name alone.
  spelling as (
    select r.entry, s.name, s.k
    from reading r
    cross join lateral (
      select x as name, k from jsonb_array_elements_text(
        coalesce(record_live_week.entries -> (r.entry::integer - 1) -> 'names', jsonb_build_array(r.name))) with ordinality as y(x, k)
    ) s
  ),
  seen as (
    select character_id, name from governor_name
    union
    select character_id, current_name from governor
  ),
  matched as (
    select r.*,
      case when not r.flagged
            and (select count(*) from reading o where o.name = r.name) = 1
            and (select count(distinct s.character_id) from seen s join spelling p on p.name = s.name where p.entry = r.entry) = 1
           then (select min(s.character_id) from seen s join spelling p on p.name = s.name where p.entry = r.entry)
      end as character_id
    from reading r
  ),
  shown as (
    select m.*,
      -- A matched row shows the spelling that matched, the first one sent when more than one did.
      coalesce((select p.name from spelling p join seen s on s.name = p.name
                where m.character_id is not null and p.entry = m.entry order by p.k limit 1), m.name) as shown_name
    from matched m
  )
  -- Two rows whose names lead to one Governor: neither gets it, so a week never holds a Governor twice.
  insert into fort_entry (week, character_id, name, fort_count, tie_order, read_two_ways, spellings)
  select reading_week,
         case when count(*) over (partition by character_id) = 1 then character_id end,
         case when count(*) over (partition by character_id) = 1 then shown_name else name end,
         fort_count, tie_order, read_two_ways or flagged, spellings
  from shown;

  select count(*), count(character_id) into saved, resolved
  from fort_entry where fort_entry.week = reading_week;
  return jsonb_build_object('rows', saved, 'matched', resolved, 'needs_id', saved - resolved);
end;
$$;

revoke all on function public.record_live_week(timestamptz, jsonb) from public, anon;
grant execute on function public.record_live_week(timestamptz, jsonb) to authenticated;
