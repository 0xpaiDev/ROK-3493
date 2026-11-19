-- KvK ticket 02: the Roster job runs twice a day and fetches any day it missed from Lilith's history,
-- so a missed night never leaves a hole in a Counting Period. record_roster_snapshot now saves a
-- missing day older than the latest, without touching any Governor's status or current name, and
-- roster_days_missing lists the holes.
-- Safe to run twice: supabase/tests applies it inside a rolled-back transaction.

-- Saves the Lilith stats for one day as a Roster Snapshot, with what it changes, all or nothing.
-- rows: [{ id, name, power, highest_power, kill_points, resources_gathered, alliance_helps,
--          t4_kills, t5_kills, t4_deaths, t5_deaths }].
-- The rules for a day newer than the latest (tests/roster-snapshot-cases.json pins them):
--   * a Governor in the previous snapshot's Top 200 and absent now becomes Inactive, never Migrated;
--   * an Inactive or Migrated Governor present again becomes Current;
--   * a Council status change made after the snapshot's day stands (the latest event wins);
--   * a new Character ID joins as a Governor, a changed name becomes its current name, and every
--     name not yet in Name History joins it, dated from the snapshot.
-- A missing day older than the latest (olderDayCases) is saved, but it is not today: no status and no
-- current name changes. Its names join Name History, or are dated back to it, and a Character ID seen
-- only that day joins as Inactive, since the newest snapshot doesn't have it.
-- Character ID is the only key: names are never matched here.
-- A day already saved returns saved: false and only fills its null T4/T5 values (filled: how many
-- rows), so a second run of the day changes nothing and the days saved before the four values
-- existed can be filled.
create or replace function public.record_roster_snapshot(taken_on date, rows jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  latest     roster_snapshot%rowtype;
  made       bigint;
  -- The export covers its whole day, so the snapshot's moment is the midnight that ends it.
  ends_at    timestamptz := (record_roster_snapshot.taken_on + 1)::timestamp at time zone 'utc';
  older      boolean;
  n_rows     integer;
  n_inactive integer := 0;
  n_current  integer := 0;
  n_renamed  integer := 0;
  n_new      integer;
  n_names    integer;
  n_filled   integer;
  saved_id   bigint;
begin
  if not public.is_reader() then
    raise exception 'Only the reader''s sign-in may record a Roster Snapshot.' using errcode = '42501';
  end if;
  if record_roster_snapshot.taken_on > (now() at time zone 'utc')::date then
    raise exception 'A Roster Snapshot for % is in the future.', record_roster_snapshot.taken_on using errcode = '22023';
  end if;

  -- One run at a time: the second waits, then finds the day saved.
  lock table roster_snapshot in share row exclusive mode;
  select * into latest from roster_snapshot order by roster_snapshot.taken_on desc limit 1;
  create temp table roster_in on commit drop as
  select r.id::text as character_id, btrim(r.name) as name, r.power, r.highest_power, r.kill_points,
         r.resources_gathered, r.alliance_helps,
         r.t4_kills, r.t5_kills, r.t4_deaths, r.t5_deaths
  from jsonb_to_recordset(record_roster_snapshot.rows)
    as r(id text, name text, power bigint, highest_power bigint, kill_points bigint,
         resources_gathered bigint, alliance_helps bigint,
         t4_kills bigint, t5_kills bigint, t4_deaths bigint, t5_deaths bigint);
  select count(*) into n_rows from roster_in;
  if n_rows = 0 then
    raise exception 'The Roster Snapshot for % has no rows.', record_roster_snapshot.taken_on using errcode = '22023';
  end if;
  if exists (select 1 from roster_in where character_id is null or character_id !~ '^[0-9]+$' or coalesce(name, '') = '') then
    raise exception 'Every row needs a numeric Character ID and a name.' using errcode = '22023';
  end if;
  if (select count(distinct character_id) from roster_in) <> n_rows then
    raise exception 'A Character ID appears twice in the Roster Snapshot for %.', record_roster_snapshot.taken_on using errcode = '22023';
  end if;

  -- A day already saved keeps everything it holds; only its null T4/T5 values are filled, for the
  -- Governors already on that day. Saving it again changes nothing.
  select s.id into saved_id from roster_snapshot s where s.taken_on = record_roster_snapshot.taken_on;
  if saved_id is not null then
    update roster_snapshot_row p
    set t4_kills  = coalesce(p.t4_kills, r.t4_kills),
        t5_kills  = coalesce(p.t5_kills, r.t5_kills),
        t4_deaths = coalesce(p.t4_deaths, r.t4_deaths),
        t5_deaths = coalesce(p.t5_deaths, r.t5_deaths)
    from roster_in r
    where p.snapshot_id = saved_id and p.character_id = r.character_id
      and ((p.t4_kills is null and r.t4_kills is not null) or (p.t5_kills is null and r.t5_kills is not null)
        or (p.t4_deaths is null and r.t4_deaths is not null) or (p.t5_deaths is null and r.t5_deaths is not null));
    get diagnostics n_filled = row_count;
    drop table roster_in;
    return jsonb_build_object('saved', false, 'taken_on', record_roster_snapshot.taken_on, 'latest', latest.taken_on,
                              'filled', n_filled);
  end if;
  older := latest.taken_on > record_roster_snapshot.taken_on;

  if not older then
    -- Statuses first, against the Governors and the snapshot as they were.
    update governor g
    set status = 'inactive', status_set_by = 'snapshot', status_set_at = ends_at
    where g.status = 'current'
      and not (g.status_set_by = 'council' and g.status_set_at >= ends_at)
      and g.character_id in (
        -- The previous snapshot's Top 200: its 200 highest-power Governors, equal power by Character ID
        -- as plain text (top200 in site/kingdom.js).
        select p.character_id from roster_snapshot_row p
        where p.snapshot_id = latest.id
        order by coalesce(p.power, 0) desc, p.character_id collate "C"
        limit 200)
      and not exists (select 1 from roster_in r where r.character_id = g.character_id);
    get diagnostics n_inactive = row_count;

    update governor g
    set status = 'current', status_set_by = 'snapshot', status_set_at = ends_at
    where g.status <> 'current'
      and not (g.status_set_by = 'council' and g.status_set_at >= ends_at)
      and exists (select 1 from roster_in r where r.character_id = g.character_id);
    get diagnostics n_current = row_count;

    update governor g
    set current_name = r.name
    from roster_in r
    where r.character_id = g.character_id and g.current_name <> r.name;
    get diagnostics n_renamed = row_count;
  end if;

  insert into governor (character_id, current_name, status, status_set_by, status_set_at)
  select r.character_id, r.name, case when older then 'inactive' else 'current' end, 'snapshot',
         case when older then ends_at else now() end
  from roster_in r
  where not exists (select 1 from governor g where g.character_id = r.character_id);
  get diagnostics n_new = row_count;

  if older then
    -- A known name seen earlier than its first sighting is dated back to this day.
    update governor_name n
    set first_seen = record_roster_snapshot.taken_on
    from roster_in r
    where n.character_id = r.character_id and n.name = r.name and n.first_seen > record_roster_snapshot.taken_on;
  end if;
  insert into governor_name (character_id, name, first_seen)
  select r.character_id, r.name, record_roster_snapshot.taken_on from roster_in r
  on conflict (character_id, name) do nothing;
  get diagnostics n_names = row_count;

  insert into roster_snapshot (taken_on, uploaded_by)
  values (record_roster_snapshot.taken_on, auth.jwt() ->> 'email')
  returning id into made;
  insert into roster_snapshot_row (snapshot_id, character_id, power, highest_power, kill_points, resources_gathered,
                                   alliance_helps, t4_kills, t5_kills, t4_deaths, t5_deaths)
  select made, character_id, power, highest_power, kill_points, resources_gathered,
         alliance_helps, t4_kills, t5_kills, t4_deaths, t5_deaths from roster_in;

  drop table roster_in;
  return jsonb_build_object('saved', true, 'taken_on', record_roster_snapshot.taken_on, 'rows', n_rows,
    'inactive', n_inactive, 'current', n_current, 'renamed', n_renamed, 'new_governors', n_new, 'new_names', n_names);
end;
$$;

revoke all on function public.record_roster_snapshot(date, jsonb) from public, anon;
grant execute on function public.record_roster_snapshot(date, jsonb) to authenticated;

-- The days from `since` on, oldest first, that have no Roster Snapshot although days before and after
-- them do: the nights the Roster job missed, which it fetches from Lilith's history. Days before the
-- first snapshot were never the store's, so they aren't missed.
create or replace function public.roster_days_missing(since date)
returns date[]
language sql
stable
set search_path = public
as $$
  select coalesce(array_agg(d::date order by d), '{}')
  from (select min(taken_on) as first, max(taken_on) as last from roster_snapshot) b,
       generate_series(greatest(b.first, since), b.last, interval '1 day') d
  where not exists (select 1 from roster_snapshot s where s.taken_on = d::date);
$$;

revoke all on function public.roster_days_missing(date) from public, anon;
grant execute on function public.roster_days_missing(date) to authenticated;
