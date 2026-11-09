-- Fort reader ticket 01: the reader sends when it took the screenshots, and record_live_week takes the
-- week and the "as of" time from that, not from when the reading arrives. Old screenshots, a run that
-- crosses the Monday reset, and a reading older than the saved one are refused. Safe to run twice.

drop function if exists public.record_live_week(date, jsonb);

-- Replaces the Live Week's Weekly Ranking with a reading and stamps its "as of" time.
-- read_at: when the reader took the first screenshot. Its Fort Week must be the Live Week.
-- entries: [{ rank, name, fort_count, needs_id? }]. Names match by the rule in tests/name-matching-cases.json
-- (the same as matchNames in site/kingdom.js): an exact name held by exactly one Governor, in Name
-- History or as its current name, gets that Character ID; anything else, including a name on two
-- rows or two names that lead to one Governor, is "needs ID". So is an entry with needs_id: true,
-- which the reader sends for a name it read two ways: a misreading must never match by spelling.
-- It never writes Name History or Governors.
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

  insert into fort_week (starts_on, read_at) values (reading_week, record_live_week.read_at)
  on conflict (starts_on) do update set read_at = excluded.read_at;
  delete from fort_entry where fort_entry.week = reading_week;

  with reading as (
    select e ->> 'name' as name, (e ->> 'fort_count')::integer as fort_count,
           coalesce((e ->> 'needs_id')::boolean, false) as unsure,
           row_number() over (order by (e ->> 'rank')::integer, n) - 1 as tie_order
    from jsonb_array_elements(record_live_week.entries) with ordinality as t(e, n)
  ),
  seen as (
    select character_id, name from governor_name
    union
    select character_id, current_name from governor
  ),
  matched as (
    select r.*,
      case when not r.unsure
            and (select count(*) from reading o where o.name = r.name) = 1
            and (select count(distinct s.character_id) from seen s where s.name = r.name) = 1
           then (select min(s.character_id) from seen s where s.name = r.name)
      end as character_id
    from reading r
  )
  -- Two rows whose names lead to one Governor: neither gets it, so a week never holds a Governor twice.
  insert into fort_entry (week, character_id, name, fort_count, tie_order)
  select reading_week,
         case when count(*) over (partition by character_id) = 1 then character_id end,
         name, fort_count, tie_order
  from matched;

  select count(*), count(character_id) into saved, resolved
  from fort_entry where fort_entry.week = reading_week;
  return jsonb_build_object('rows', saved, 'matched', resolved, 'needs_id', saved - resolved);
end;
$$;

revoke all on function public.record_live_week(timestamptz, jsonb) from public, anon;
grant execute on function public.record_live_week(timestamptz, jsonb) to authenticated;
