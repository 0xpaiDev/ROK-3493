-- KvK tab, "show all" (kvk SPEC, ticket 04): kvk_standings also reads a Governor counted in a Counting
-- Period but not in the KvK Start Snapshot, with no starting power (null). Still nothing until the start
-- snapshot arrives: a KvK waiting for it reads no rows.

create or replace function public.kvk_standings(kvk_id bigint)
returns table (character_id text, name text, status text, start_power bigint,
               t4_kills bigint, t5_kills bigint, t4_deaths bigint, t5_deaths bigint)
language sql
stable
set search_path = public
as $$
  with k as (select * from kvk where id = kvk_standings.kvk_id),
  start as (
    select r.character_id, r.power
    from k
    join roster_snapshot s on s.taken_on = k.starts_on
    join roster_snapshot_row r on r.snapshot_id = s.id
  ),
  counted as (
    select r.character_id, r.t4_kills, r.t5_kills, r.t4_deaths, r.t5_deaths
    from k
    join kvk_counting_period p on p.kvk_id = k.id
    join roster_snapshot s on s.taken_on between p.starts_on and coalesce(p.ends_on, k.ends_on)
    join roster_snapshot_row r on r.snapshot_id = s.id
  ),
  totals as (
    select c.character_id, sum(c.t4_kills)::bigint as t4_kills, sum(c.t5_kills)::bigint as t5_kills,
           sum(c.t4_deaths)::bigint as t4_deaths, sum(c.t5_deaths)::bigint as t5_deaths
    from counted c group by c.character_id
  ),
  taking as (
    select coalesce(st.character_id, t.character_id) as character_id, st.power,
           t.t4_kills, t.t5_kills, t.t4_deaths, t.t5_deaths
    from start st
    full join totals t on t.character_id = st.character_id
    where exists (select 1 from start)
  )
  select x.character_id, g.current_name, g.status, x.power,
         coalesce(x.t4_kills, 0), coalesce(x.t5_kills, 0), coalesce(x.t4_deaths, 0), coalesce(x.t5_deaths, 0)
  from taking x
  join governor g on g.character_id = x.character_id
  order by x.power desc nulls last, x.character_id;
$$;

revoke all on function public.kvk_standings(bigint) from public;
grant execute on function public.kvk_standings(bigint) to anon, authenticated;
