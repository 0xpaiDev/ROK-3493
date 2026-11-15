-- Fort reader: a row the reader read more than one way is sent with every spelling (names), and matches
-- when those spellings, exactly, lead to one Governor. Until now such a row was flagged needs_id and never
-- matched, which left a third of the Live Week's "needs ID" rows unmatched though one spelling was in Name
-- History (week 2026-11-09: ᵛøDarkBFarm1, ᵛø J4KU, CRY㋾). Still no folding: a spelling matches only as
-- written. needs_id: true from an older reader is still never matched. fort_entry.spellings keeps every
-- spelling of a row read more than one way, so the admin can tell whether a Council pick will match at the
-- next reading. Safe to run twice.

alter table public.fort_entry add column if not exists spellings text[];
comment on column public.fort_entry.spellings is
  'Every spelling the reader read for a Live Week row read more than one way, in the order sent; null otherwise.';

-- Replaces the Live Week's Weekly Ranking with a reading and stamps its "as of" time.
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
