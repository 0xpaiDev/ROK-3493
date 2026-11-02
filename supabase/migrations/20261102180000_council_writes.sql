-- Ticket 04: only the Council can change data.
-- A signed-in user may write only when their email is on council_member.
-- Anonymous visitors keep read-only access; council_member stays unreadable to everyone.

-- Runs as its owner so it can read council_member, which has no policy.
create or replace function public.is_council()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from council_member
    where email = lower(coalesce(auth.jwt() ->> 'email', ''))
  );
$$;

revoke all on function public.is_council() from public, anon;
grant execute on function public.is_council() to authenticated;

do $$
declare t text;
begin
  foreach t in array array['governor', 'governor_name', 'roster_snapshot', 'roster_snapshot_row',
                           'fort_week', 'fort_entry', 'weekly_award', 'gh_event', 'gh_entry']
  loop
    execute format('create policy "council insert" on %I for insert to authenticated with check (public.is_council())', t);
    execute format('create policy "council update" on %I for update to authenticated using (public.is_council()) with check (public.is_council())', t);
    execute format('create policy "council delete" on %I for delete to authenticated using (public.is_council())', t);
    execute format('grant insert, update, delete on %I to authenticated', t);
  end loop;
end $$;

-- Identity columns need their sequences for inserts.
grant usage on all sequences in schema public to authenticated;

-- kvk_entry stays read-only (SPEC: out of scope) and gets no write policy.

insert into council_member (email) values ('petrasstulpinas@gmail.com')
on conflict do nothing;
