-- Ticket 06: the Council dismisses a Farm link suggestion and it stays hidden.
-- One row per dismissed Farm→Main pair. Only the Council reads or writes it: the public site
-- never shows suggestions.

create table farm_link_dismissal (
  farm_character_id text not null references governor (character_id),
  main_character_id text not null references governor (character_id),
  dismissed_by      text default (auth.jwt() ->> 'email'),
  dismissed_at      timestamptz not null default now(),
  primary key (farm_character_id, main_character_id)
);

alter table farm_link_dismissal enable row level security;
create policy "council read" on farm_link_dismissal for select to authenticated using (public.is_council());
create policy "council insert" on farm_link_dismissal for insert to authenticated with check (public.is_council());
create policy "council delete" on farm_link_dismissal for delete to authenticated using (public.is_council());
grant select, insert, delete on farm_link_dismissal to authenticated;
revoke all on farm_link_dismissal from anon;
