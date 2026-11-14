-- Ticket 12: a Weekly Award is built from reward items, the four King's Chests and the four resources,
-- each with an amount. weekly_award.award becomes optional, the free-text fallback for anything outside
-- the list. Safe to run twice.

alter table weekly_award alter column award drop not null;

-- One reward item on a Weekly Award. The item ids are the ones in site/rewards.js: adding an item means
-- changing both. Removing the award removes its items.
create table if not exists weekly_award_item (
  id       bigint generated always as identity primary key,
  award_id bigint not null references weekly_award (id) on delete cascade,
  item     text not null check (item in ('chest-legendary', 'chest-epic', 'chest-elite', 'chest-advanced',
                                         'rss-food', 'rss-wood', 'rss-stone', 'rss-gold')),
  amount   bigint not null check (amount > 0) -- a count for a chest, units for a resource (2M Food = 2000000)
);
create index if not exists weekly_award_item_award on weekly_award_item (award_id);

-- Public read, Council writes: the same policies as every other public table.
alter table weekly_award_item enable row level security;
drop policy if exists "public read" on weekly_award_item;
drop policy if exists "council insert" on weekly_award_item;
drop policy if exists "council update" on weekly_award_item;
drop policy if exists "council delete" on weekly_award_item;
create policy "public read" on weekly_award_item for select to anon, authenticated using (true);
create policy "council insert" on weekly_award_item for insert to authenticated with check (public.is_council());
create policy "council update" on weekly_award_item for update to authenticated using (public.is_council()) with check (public.is_council());
create policy "council delete" on weekly_award_item for delete to authenticated using (public.is_council());
grant select on weekly_award_item to anon, authenticated;
grant insert, update, delete on weekly_award_item to authenticated;
revoke insert, update, delete, truncate on weekly_award_item from anon;

-- Adds a Weekly Award and its items in one transaction, so an award never lands without the items it
-- was given with. Runs as the caller: row-level security still decides, so only the Council can add one.
-- items: [{ item, amount }]. An award needs items or text. Returns the new award's id.
create or replace function public.add_weekly_award(week date, character_id text, place integer, award text, note text, items jsonb)
returns bigint
language plpgsql
security invoker
set search_path = public
as $$
declare
  new_id bigint;
begin
  if coalesce(jsonb_array_length(items), 0) = 0 and coalesce(btrim(award), '') = '' then
    raise exception 'A Weekly Award needs reward items or its text.' using errcode = '23514';
  end if;
  insert into weekly_award (week, character_id, place, award, note)
  values (add_weekly_award.week, add_weekly_award.character_id, add_weekly_award.place,
          nullif(btrim(add_weekly_award.award), ''), add_weekly_award.note)
  returning id into new_id;
  insert into weekly_award_item (award_id, item, amount)
  select new_id, x.item, x.amount
  -- In the order given, so the items' ids keep the order the Council listed them in.
  from rows from (jsonb_to_recordset(coalesce(items, '[]'::jsonb)) as (item text, amount bigint))
       with ordinality as x (item, amount, n)
  order by x.n;
  return new_id;
end;
$$;

revoke all on function public.add_weekly_award(date, text, integer, text, text, jsonb) from public, anon;
grant execute on function public.add_weekly_award(date, text, integer, text, text, jsonb) to authenticated;
