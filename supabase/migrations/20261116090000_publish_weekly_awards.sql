-- Reward payout, ticket 03: the Council drafts a closed week's Weekly Awards on the admin page and publishes the
-- draft in one step. Safe to run twice.

-- Replaces a Fort Week's Weekly Awards and their items with the draft, in one transaction, so the public never
-- sees a week half published. An empty draft clears the week. Runs as the caller: row-level security still
-- decides, and the Main-only foreign key on weekly_award still refuses a Farm, which rolls the whole publish back.
-- awards: [{ character_id, place, award, note, items: [{ item, amount }] }], in the order given.
create or replace function public.publish_weekly_awards(week date, awards jsonb)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  a record;
  new_id bigint;
begin
  -- Row-level security would let a non-Council delete quietly match no rows; say so instead.
  if not public.is_council() then
    raise exception 'Only the Council can publish Weekly Awards.' using errcode = '42501';
  end if;
  if jsonb_typeof(coalesce(awards, '[]'::jsonb)) <> 'array' then
    raise exception 'The Weekly Awards are a list.' using errcode = '22023';
  end if;
  -- Two publishes of one week take turns on its Fort Week row, so the second deletes what the first wrote
  -- instead of adding to it. A week that is gone locks nothing, and the insert's foreign key refuses it.
  perform 1 from fort_week f where f.starts_on = publish_weekly_awards.week for update;
  delete from weekly_award w where w.week = publish_weekly_awards.week;
  for a in
    select x.character_id, x.place, x.award, x.note, coalesce(x.items, '[]'::jsonb) as items
    from rows from (jsonb_to_recordset(coalesce(awards, '[]'::jsonb))
                    as (character_id text, place integer, award text, note text, items jsonb))
         with ordinality as x (character_id, place, award, note, items, n)
    order by x.n
  loop
    if jsonb_array_length(a.items) = 0 and coalesce(btrim(a.award), '') = '' then
      raise exception 'A Weekly Award needs reward items or its text.' using errcode = '23514';
    end if;
    insert into weekly_award (week, character_id, place, award, note)
    values (publish_weekly_awards.week, a.character_id, a.place, nullif(btrim(a.award), ''), nullif(btrim(a.note), ''))
    returning id into new_id;
    -- In the order given, so the items' ids keep the order the Council listed them in.
    insert into weekly_award_item (award_id, item, amount)
    select new_id, i.item, i.amount
    from rows from (jsonb_to_recordset(a.items) as (item text, amount bigint)) with ordinality as i (item, amount, n)
    order by i.n;
  end loop;
end;
$$;

revoke all on function public.publish_weekly_awards(date, jsonb) from public, anon;
grant execute on function public.publish_weekly_awards(date, jsonb) to authenticated;
