-- Roster ticket 01 (ADR 0004): the reader's host saves a Roster Snapshot every day through one function.
-- Safe to run twice: supabase/tests applies it inside a rolled-back transaction.

-- The Roster job is the only writer of Roster Snapshots: the Council no longer uploads the export
-- (Petras, 2026-11-15). Its insert and update rights go; delete stays, to remove a wrong snapshot.
-- One writer means record_roster_snapshot's own check under its lock decides which day is newest.
drop trigger if exists roster_snapshot_is_newest on roster_snapshot;
drop function if exists public.roster_snapshot_is_newest();
drop policy if exists "council insert" on roster_snapshot;
drop policy if exists "council update" on roster_snapshot;
drop policy if exists "council insert" on roster_snapshot_row;
drop policy if exists "council update" on roster_snapshot_row;
revoke insert, update on roster_snapshot, roster_snapshot_row from authenticated;

-- Saves the Lilith stats for one day as a Roster Snapshot, with what it changes, all or nothing.
-- rows: [{ id, name, power, highest_power, kill_points, resources_gathered, alliance_helps }].
-- The rules, as the admin page's upload applied them until now (applyRosterSnapshot, removed); the
-- cases in tests/roster-snapshot-cases.json pin them:
--   * a Governor in the previous snapshot's Top 200 and absent now becomes Inactive, never Migrated;
--   * an Inactive or Migrated Governor present again becomes Current;
--   * a Council status change made after the snapshot's day stands (the latest event wins);
--   * a new Character ID joins as a Governor, a changed name becomes its current name, and every
--     name not yet in Name History joins it, dated from the snapshot.
-- Character ID is the only key: names are never matched here.
-- A day no newer than the latest saved snapshot changes nothing and returns saved: false, so the
-- daily run can ask for the same day again while Lilith hasn't published the next one.
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
  n_rows     integer;
  n_inactive integer;
  n_current  integer;
  n_renamed  integer;
  n_new      integer;
  n_names    integer;
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
  if latest.taken_on >= record_roster_snapshot.taken_on then
    return jsonb_build_object('saved', false, 'taken_on', record_roster_snapshot.taken_on, 'latest', latest.taken_on);
  end if;

  create temp table roster_in on commit drop as
  select r.id::text as character_id, btrim(r.name) as name, r.power, r.highest_power, r.kill_points,
         r.resources_gathered, r.alliance_helps
  from jsonb_to_recordset(record_roster_snapshot.rows)
    as r(id text, name text, power bigint, highest_power bigint, kill_points bigint,
         resources_gathered bigint, alliance_helps bigint);
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

  insert into governor (character_id, current_name)
  select r.character_id, r.name from roster_in r
  where not exists (select 1 from governor g where g.character_id = r.character_id);
  get diagnostics n_new = row_count;

  insert into governor_name (character_id, name, first_seen)
  select r.character_id, r.name, record_roster_snapshot.taken_on from roster_in r
  on conflict (character_id, name) do nothing;
  get diagnostics n_names = row_count;

  insert into roster_snapshot (taken_on, uploaded_by)
  values (record_roster_snapshot.taken_on, auth.jwt() ->> 'email')
  returning id into made;
  insert into roster_snapshot_row (snapshot_id, character_id, power, highest_power, kill_points, resources_gathered, alliance_helps)
  select made, character_id, power, highest_power, kill_points, resources_gathered, alliance_helps from roster_in;

  drop table roster_in;
  return jsonb_build_object('saved', true, 'taken_on', record_roster_snapshot.taken_on, 'rows', n_rows,
    'inactive', n_inactive, 'current', n_current, 'renamed', n_renamed, 'new_governors', n_new, 'new_names', n_names);
end;
$$;

revoke all on function public.record_roster_snapshot(date, jsonb) from public, anon;
grant execute on function public.record_roster_snapshot(date, jsonb) to authenticated;
