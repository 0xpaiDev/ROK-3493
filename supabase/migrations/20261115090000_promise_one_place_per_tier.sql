-- Reward payout, ticket 01: Any Resource joins the reward items, each Reward Promise tier pays exactly one
-- place, and the promise names the ranking it pays on. Safe to run twice.
-- Apply it, then merge right away. Until Pages deploys, the old home reads a tier's place as "6" rather than
-- "6th", and an admin page open from before can't save a promise (its three-argument call is gone).

-- Any Resource ("rss-any"): a resource the winner picks. The item ids are the ones in site/rewards.js.
alter table weekly_award_item drop constraint if exists weekly_award_item_item_check;
alter table weekly_award_item add constraint weekly_award_item_item_check
  check (item in ('chest-legendary', 'chest-epic', 'chest-elite', 'chest-advanced',
                  'rss-food', 'rss-wood', 'rss-stone', 'rss-gold', 'rss-any'));

create or replace function public.valid_reward_items(items jsonb)
returns boolean
language sql
immutable
set search_path = public
as $$
  select jsonb_typeof(items) = 'array' and not exists (
    select 1 from jsonb_array_elements(items) as x
    where jsonb_typeof(x) <> 'object'
       or coalesce(x ->> 'item', '') not in ('chest-legendary', 'chest-epic', 'chest-elite', 'chest-advanced',
                                             'rss-food', 'rss-wood', 'rss-stone', 'rss-gold', 'rss-any')
       -- The cast only runs on a number, so a string amount is refused rather than raising.
       or not coalesce(case when jsonb_typeof(x -> 'amount') = 'number'
                            then (x -> 'amount')::numeric > 0 and (x -> 'amount')::numeric = trunc((x -> 'amount')::numeric)
                       end, false)
  );
$$;

-- The ranking a promise pays on: the Mains ranking, or the Main + Farm ranking.
alter table reward_promise add column if not exists paid_on text not null default 'mains';
alter table reward_promise drop constraint if exists reward_promise_paid_on_check;
alter table reward_promise add constraint reward_promise_paid_on_check check (paid_on in ('mains', 'main_farm'));

-- A tier pays one place, a whole number, so a promise matches the ranking place for place. The free-text place
-- ("1st") becomes that number. The only promise saved before this, the week of 9 Nov, had six places, "1st" to
-- "5rd" and then "5-15rd": typos, and the last overlapped 5th. It becomes fifteen places, 1 to 15, where 6 to 15
-- each get what "5-15rd" promised. Any other promise, and 9 Nov if it was saved again since, must already read
-- exactly 1st, 2nd, 3rd… in order, or this stops rather than guess at its places.
do $$
begin
  if (select data_type from information_schema.columns
      where table_schema = 'public' and table_name = 'reward_promise_tier' and column_name = 'place') = 'text' then
    if exists (select 1 from reward_promise_tier
               where lower(btrim(place)) <> position || case when position % 100 between 11 and 13 then 'th'
                                                             when position % 10 = 1 then 'st' when position % 10 = 2 then 'nd'
                                                             when position % 10 = 3 then 'rd' else 'th' end
                 and not (week = date '2026-11-09'
                          and (select array_agg(u.place order by u.position) from reward_promise_tier u where u.week = date '2026-11-09')
                              = array['1st', '2nd', '3rd', '4rd', '5rd', '5-15rd'])) then
      raise exception 'A Reward Promise has a place that is not its position written as 1st, 2nd, 3rd…, and is not the 9 Nov promise as saved. Move it by hand.';
    end if;
    insert into reward_promise_tier (week, position, place, reward, items)
    select t.week, g, g::text, t.reward, t.items
    from reward_promise_tier t cross join generate_series(7, 15) as g
    where t.week = date '2026-11-09' and t.position = 6 and t.place = '5-15rd'
      and not exists (select 1 from reward_promise_tier u where u.week = t.week and u.position = g);
    alter table reward_promise_tier drop constraint if exists reward_promise_tier_place_check;
    alter table reward_promise_tier alter column place type integer using position;
  end if;
end $$;

alter table reward_promise_tier drop constraint if exists reward_promise_tier_place_check;
alter table reward_promise_tier add constraint reward_promise_tier_place_check check (place between 1 and 1000);
alter table reward_promise_tier drop constraint if exists reward_promise_tier_week_place_key;
alter table reward_promise_tier add constraint reward_promise_tier_week_place_key unique (week, place);

-- Sets a week's Reward Promise: its intro, the ranking it pays on and its tiers, replacing any it had, in one
-- transaction so the public never sees a promise half saved. Refuses a place promised twice; a gap is fine.
-- Runs as the caller: row-level security still decides, so only the Council can set one.
-- tiers: [{ place, reward, items: [{ item, amount }] }], in the order shown.
drop function if exists public.set_reward_promise(date, text, jsonb);
create or replace function public.set_reward_promise(week date, intro text, paid_on text, tiers jsonb)
returns void
language plpgsql
security invoker
set search_path = public
as $$
begin
  if coalesce(jsonb_array_length(tiers), 0) = 0 then
    raise exception 'A Reward Promise needs at least one place.' using errcode = '23514';
  end if;
  if exists (select 1 from jsonb_array_elements(tiers) as x group by x ->> 'place' having count(*) > 1) then
    raise exception 'A place is on this Reward Promise twice. Each place is promised once.' using errcode = '23514';
  end if;
  insert into reward_promise (week, intro, paid_on, updated_at)
  values (set_reward_promise.week, nullif(btrim(set_reward_promise.intro), ''), coalesce(set_reward_promise.paid_on, 'mains'), now())
  -- By constraint name: the parameter "week" would make a bare (week) ambiguous.
  on conflict on constraint reward_promise_pkey
  do update set intro = excluded.intro, paid_on = excluded.paid_on, updated_at = excluded.updated_at;
  delete from reward_promise_tier t where t.week = set_reward_promise.week;
  insert into reward_promise_tier (week, position, place, reward, items)
  select set_reward_promise.week, x.n, x.place, nullif(btrim(x.reward), ''), coalesce(x.items, '[]'::jsonb)
  from rows from (jsonb_to_recordset(tiers) as (place integer, reward text, items jsonb))
       with ordinality as x (place, reward, items, n);
end;
$$;

revoke all on function public.set_reward_promise(date, text, text, jsonb) from public, anon;
grant execute on function public.set_reward_promise(date, text, text, jsonb) to authenticated;
