-- Ticket 16: the Reward Promise, what each place will get for a Fort Week, set by the Council before the
-- week closes so Governors have something to compete for. Home shows the Live Week's promise. Safe to run twice.

-- Reward items as a jsonb list [{ item, amount }]: an array of objects, each item an id from site/rewards.js
-- (the same ids as weekly_award_item.item) and each amount a whole number above 0.
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
                                             'rss-food', 'rss-wood', 'rss-stone', 'rss-gold')
       -- The cast only runs on a number, so a string amount is refused rather than raising.
       or not coalesce(case when jsonb_typeof(x -> 'amount') = 'number'
                            then (x -> 'amount')::numeric > 0 and (x -> 'amount')::numeric = trunc((x -> 'amount')::numeric)
                       end, false)
  );
$$;

-- One promise per Fort Week. No foreign key to fort_week: the promise comes before the week has rows.
create table if not exists reward_promise (
  week       date primary key check (extract(isodow from week) = 1), -- a Fort Week's Monday
  intro      text,                                                   -- optional; home falls back to content.js
  updated_at timestamptz not null default now()
);

-- One place on a promise. place is a label ("1st", "Top 10"), since a promise can cover a range of places.
create table if not exists reward_promise_tier (
  id       bigint generated always as identity primary key,
  week     date not null references reward_promise (week) on delete cascade,
  position integer not null check (position > 0),
  place    text not null check (btrim(place) <> ''),
  reward   text,                                                     -- free text for anything outside the items
  items    jsonb not null default '[]'::jsonb check (public.valid_reward_items(items)),
  unique (week, position),
  check (jsonb_array_length(items) > 0 or coalesce(btrim(reward), '') <> '')
);

-- Public read, Council writes: the same policies as every other public table.
do $$
declare t text;
begin
  foreach t in array array['reward_promise', 'reward_promise_tier']
  loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists "public read" on %I', t);
    execute format('drop policy if exists "council insert" on %I', t);
    execute format('drop policy if exists "council update" on %I', t);
    execute format('drop policy if exists "council delete" on %I', t);
    execute format('create policy "public read" on %I for select to anon, authenticated using (true)', t);
    execute format('create policy "council insert" on %I for insert to authenticated with check (public.is_council())', t);
    execute format('create policy "council update" on %I for update to authenticated using (public.is_council()) with check (public.is_council())', t);
    execute format('create policy "council delete" on %I for delete to authenticated using (public.is_council())', t);
    execute format('grant select on %I to anon, authenticated', t);
    execute format('grant insert, update, delete on %I to authenticated', t);
    execute format('revoke insert, update, delete, truncate on %I from anon', t);
  end loop;
end $$;
grant usage on all sequences in schema public to authenticated;

-- Sets a week's Reward Promise: its intro and its tiers, replacing any it had, in one transaction so the
-- public never sees a promise half saved. Runs as the caller: row-level security still decides, so only
-- the Council can set one. tiers: [{ place, reward, items: [{ item, amount }] }], in the order shown.
create or replace function public.set_reward_promise(week date, intro text, tiers jsonb)
returns void
language plpgsql
security invoker
set search_path = public
as $$
begin
  if coalesce(jsonb_array_length(tiers), 0) = 0 then
    raise exception 'A Reward Promise needs at least one place.' using errcode = '23514';
  end if;
  insert into reward_promise (week, intro, updated_at)
  values (set_reward_promise.week, nullif(btrim(set_reward_promise.intro), ''), now())
  -- By constraint name: the parameter "week" would make a bare (week) ambiguous.
  on conflict on constraint reward_promise_pkey do update set intro = excluded.intro, updated_at = excluded.updated_at;
  delete from reward_promise_tier t where t.week = set_reward_promise.week;
  insert into reward_promise_tier (week, position, place, reward, items)
  select set_reward_promise.week, x.n, btrim(x.place), nullif(btrim(x.reward), ''), coalesce(x.items, '[]'::jsonb)
  from rows from (jsonb_to_recordset(tiers) as (place text, reward text, items jsonb)) with ordinality as x (place, reward, items, n);
end;
$$;

revoke all on function public.set_reward_promise(date, text, jsonb) from public, anon;
grant execute on function public.set_reward_promise(date, text, jsonb) to authenticated;
