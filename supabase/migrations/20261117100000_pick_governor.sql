-- Kingdom admin, ticket 17: the Council's Pick on a closed Fort Week (ADR 0006). Nothing rereads a closed week,
-- so a Pick there sets the "needs ID" row's Character ID itself, and adds the row's name to Name History so the
-- Governor is found under it from then on. A Pick on the Live Week goes to Name History only (ADR 0002) and
-- never comes here. Safe to run twice.

-- Sets a closed Fort Week's "needs ID" row to a Governor and adds the row's name to Name History, first seen
-- the week's Monday, in one transaction. Runs as the caller: row-level security still decides.
-- week: the Fort Week's Monday. entry: the fort_entry row's id. character_id: the Governor the Council picked.
create or replace function public.pick_governor(week date, entry bigint, character_id text)
returns void
language plpgsql
security invoker
set search_path = public
as $$
#variable_conflict use_variable
declare
  row_name text;
  row_id text;
begin
  -- Row-level security would hide the row from anyone else, and the Pick would read as a missing row.
  if not public.is_council() then
    raise exception 'Only the Council can Pick a Governor.' using errcode = '42501';
  end if;
  -- Only the reader writes the Live Week (ADR 0002), and a week not yet begun has no reading to pick on.
  if week >= date_trunc('week', now() at time zone 'utc')::date then
    raise exception 'The week of % is the Live Week or later. A Live Week Pick goes into Name History only, and the reader''s next reading matches it.', week
      using errcode = '22023';
  end if;
  select e.name, e.character_id into row_name, row_id from fort_entry e where e.id = entry and e.week = pick_governor.week for update;
  if not found then
    raise exception 'The week of % has no row %. Reload the page.', week, entry using errcode = '22023';
  end if;
  if row_id is not null then
    raise exception 'Row "%" already has Character ID %. A Pick resolves a "needs ID" row only.', row_name, row_id
      using errcode = '22023';
  end if;
  -- The unique key on (week, character_id) would refuse it too; this says why in the Council's words.
  if exists (select 1 from fort_entry e where e.week = pick_governor.week and e.character_id = pick_governor.character_id) then
    raise exception '% already has a row in the week of %. A Governor appears once per Fort Week.',
      coalesce((select g.current_name from governor g where g.character_id = pick_governor.character_id), character_id), week
      using errcode = '22023';
  end if;
  update fort_entry e set character_id = pick_governor.character_id where e.id = entry;
  -- A name another row of the week also carries belongs to two Governors: under one of them alone in Name
  -- History, the reader would hand the other's later rows to it. The row is set; the name stays out.
  if not exists (select 1 from fort_entry e where e.week = pick_governor.week and e.name = row_name and e.id <> entry) then
    insert into governor_name (character_id, name, first_seen) values (pick_governor.character_id, row_name, pick_governor.week)
    on conflict do nothing;
  end if;
end;
$$;

revoke all on function public.pick_governor(date, bigint, text) from public, anon;
grant execute on function public.pick_governor(date, bigint, text) to authenticated;
