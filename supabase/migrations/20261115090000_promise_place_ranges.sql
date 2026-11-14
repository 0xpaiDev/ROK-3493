-- Reward payout, ticket 01: Any Resource joins the reward items, each Reward Promise tier covers a place
-- range (first_place to last_place) with an optional label, and the promise names the ranking it pays on.
-- Safe to run twice.

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

-- A tier covers places first_place to last_place (1–1, 6–15). label is optional: without one the site
-- writes the range ("1st", "6th–15th").
alter table reward_promise_tier add column if not exists first_place integer;
alter table reward_promise_tier add column if not exists last_place integer;
alter table reward_promise_tier add column if not exists label text;

-- The free-text place gives way to the range. The only promise saved before this, the week of 9 Nov,
-- had six places, "1st" to "5rd" and then "5-15rd": typos, and the last overlapped 5th. They become
-- 1, 2, 3, 4, 5 and 6–15 with no labels. Any other promise keeps one place per position.
do $$
begin
  if exists (select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'reward_promise_tier' and column_name = 'place') then
    update reward_promise_tier
    set first_place = position,
        last_place = case when week = date '2026-11-09' and position = 6 then 15 else position end
    where first_place is null;
    alter table reward_promise_tier drop column place;
  end if;
end $$;

alter table reward_promise_tier alter column first_place set not null;
alter table reward_promise_tier alter column last_place set not null;
alter table reward_promise_tier drop constraint if exists reward_promise_tier_range_check;
alter table reward_promise_tier add constraint reward_promise_tier_range_check check (first_place >= 1 and first_place <= last_place);
alter table reward_promise_tier drop constraint if exists reward_promise_tier_label_check;
alter table reward_promise_tier add constraint reward_promise_tier_label_check check (label is null or btrim(label) <> '');

-- Sets a week's Reward Promise: its intro, the ranking it pays on and its tiers, replacing any it had, in one
-- transaction so the public never sees a promise half saved. Refuses two tiers that cover the same place;
-- a gap is fine. Runs as the caller: row-level security still decides, so only the Council can set one.
-- tiers: [{ first, last, label, reward, items: [{ item, amount }] }], in the order shown.
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
  insert into reward_promise (week, intro, paid_on, updated_at)
  values (set_reward_promise.week, nullif(btrim(set_reward_promise.intro), ''), coalesce(set_reward_promise.paid_on, 'mains'), now())
  -- By constraint name: the parameter "week" would make a bare (week) ambiguous.
  on conflict on constraint reward_promise_pkey
  do update set intro = excluded.intro, paid_on = excluded.paid_on, updated_at = excluded.updated_at;
  delete from reward_promise_tier t where t.week = set_reward_promise.week;
  insert into reward_promise_tier (week, position, first_place, last_place, label, reward, items)
  select set_reward_promise.week, x.n, x."first", x."last", nullif(btrim(x.label), ''), nullif(btrim(x.reward), ''),
         coalesce(x.items, '[]'::jsonb)
  from rows from (jsonb_to_recordset(tiers) as ("first" integer, "last" integer, label text, reward text, items jsonb))
       with ordinality as x ("first", "last", label, reward, items, n);
  if exists (
    select 1 from reward_promise_tier a
    join reward_promise_tier b on b.week = a.week and b.position > a.position
                              and a.first_place <= b.last_place and b.first_place <= a.last_place
    where a.week = set_reward_promise.week
  ) then
    raise exception 'Two places on this Reward Promise cover the same place. Each place is promised once.' using errcode = '23514';
  end if;
end;
$$;

revoke all on function public.set_reward_promise(date, text, text, jsonb) from public, anon;
grant execute on function public.set_reward_promise(date, text, text, jsonb) to authenticated;
