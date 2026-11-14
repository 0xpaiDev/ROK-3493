-- Reward payout, ticket 01: Any Resource joins the reward items, each Reward Promise tier covers a place
-- range (first_place to last_place) with an optional label, and the promise names the ranking it pays on.
-- Safe to run twice. Additive: apply it before the site deploys, then 20261115100000 once the site is live.

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

-- The range takes over from the free-text place. The only promise saved before this, the week of 9 Nov,
-- had six places, "1st" to "5rd" and then "5-15rd": typos, and the last overlapped 5th. They become
-- 1, 2, 3, 4, 5 and 6–15 with no labels. Any other promise keeps one place per position, and a place
-- that isn't the plain ordinal of its position ("Top 10") moves into label, so no text is lost.
-- place itself stays, nullable, so the site still live on Pages keeps loading until the new one deploys;
-- 20261115100000_drop_promise_place.sql drops it after that.
do $$
begin
  if exists (select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'reward_promise_tier' and column_name = 'place') then
    update reward_promise_tier
    set first_place = position,
        last_place = case when week = date '2026-11-09' and position = 6 then 15 else position end,
        label = case when week = date '2026-11-09' then null
                     when btrim(place) ~* ('^' || position || '(st|nd|rd|th)$') then null
                     else btrim(place) end
    where first_place is null;
    alter table reward_promise_tier alter column place drop not null;
  end if;
end $$;

-- Until 20261115100000 drops place, every tier saved also fills it in, so the site still live on Pages and
-- an admin page open from before the deploy read a place, not a blank: the label, else the range written as
-- the site writes it ("1st", "6th–15th").
create or replace function public.reward_promise_tier_fill_place()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  n integer;
  ords text[] := '{}';
begin
  if new.place is null then
    foreach n in array array[new.first_place, new.last_place]
    loop
      ords := ords || (n || case when n % 100 between 11 and 13 then 'th'
                                 when n % 10 = 1 then 'st' when n % 10 = 2 then 'nd' when n % 10 = 3 then 'rd'
                                 else 'th' end);
    end loop;
    new.place := coalesce(new.label,
                          case when new.first_place = new.last_place then ords[1] else ords[1] || '–' || ords[2] end);
  end if;
  return new;
end;
$$;

do $$
begin
  if exists (select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'reward_promise_tier' and column_name = 'place') then
    drop trigger if exists reward_promise_tier_fill_place on reward_promise_tier;
    create trigger reward_promise_tier_fill_place before insert or update on reward_promise_tier
      for each row execute function public.reward_promise_tier_fill_place();
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

-- The old three-argument call, kept for an admin page still open from before the deploy: each place becomes
-- one position wide, its text the label, and the promise keeps the ranking it already pays on.
-- 20261115100000_drop_promise_place.sql drops it with place.
create or replace function public.set_reward_promise(week date, intro text, tiers jsonb)
returns void
language plpgsql
security invoker
set search_path = public
as $$
begin
  perform public.set_reward_promise(
    set_reward_promise.week, set_reward_promise.intro,
    (select p.paid_on from reward_promise p where p.week = set_reward_promise.week),
    (select jsonb_agg(jsonb_build_object('first', e.n, 'last', e.n, 'label', e.x ->> 'place',
                                         'reward', e.x -> 'reward', 'items', e.x -> 'items') order by e.n)
     from jsonb_array_elements(set_reward_promise.tiers) with ordinality as e (x, n)));
end;
$$;

revoke all on function public.set_reward_promise(date, text, jsonb) from public, anon;
grant execute on function public.set_reward_promise(date, text, jsonb) to authenticated;
