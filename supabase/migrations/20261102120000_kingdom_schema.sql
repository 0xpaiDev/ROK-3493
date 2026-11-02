-- Kingdom 3493 schema (ADR 0001, kingdom-admin SPEC "Data shape").
-- Character ID is the only key for a Governor; names live in Name History.
-- The public reads every table except council_member. Nobody writes yet:
-- Council writes arrive with ticket 04 as row-level security policies.

create table governor (
  character_id      text primary key check (character_id ~ '^[0-9]+$'),
  current_name      text not null,
  kind              text not null default 'main' check (kind in ('main', 'farm')),
  main_character_id text references governor (character_id),
  status            text not null default 'current' check (status in ('current', 'migrated')),
  status_set_by     text not null default 'snapshot' check (status_set_by in ('snapshot', 'council')),
  status_set_at     timestamptz not null default now(),
  check (kind = 'farm' or main_character_id is null),
  check (main_character_id is distinct from character_id),
  unique (character_id, kind) -- lets weekly_award require a Main
);

-- Name History: every name a Governor has been seen under.
create table governor_name (
  character_id text not null references governor (character_id),
  name         text not null,
  first_seen   date, -- null when the source had no date (KvK names carried from the Excel)
  primary key (character_id, name)
);

create table roster_snapshot (
  id          bigint generated always as identity primary key,
  taken_on    date not null unique, -- from the export filename 3493_YYYYMMDD_…
  uploaded_by text,
  uploaded_at timestamptz not null default now()
);

create table roster_snapshot_row (
  snapshot_id        bigint not null references roster_snapshot (id) on delete cascade,
  character_id       text not null references governor (character_id),
  power              bigint,
  highest_power      bigint,
  kill_points        bigint,
  resources_gathered bigint,
  alliance_helps     bigint,
  primary key (snapshot_id, character_id)
);

-- A Fort Week runs Monday 00:00 UTC to the next Monday.
create table fort_week (
  starts_on    date primary key check (extract(isodow from starts_on) = 1),
  completeness text not null default 'complete' check (completeness in ('complete', 'partial'))
);

create table fort_entry (
  id           bigint generated always as identity primary key,
  week         date not null references fort_week (starts_on) on delete cascade,
  character_id text references governor (character_id), -- null while "needs ID"
  name         text not null, -- as pasted
  fort_count   integer not null check (fort_count >= 0),
  tie_order    integer not null default 0, -- Council's order among equal Fort Counts
  unique (week, character_id)
);

create table weekly_award (
  id           bigint generated always as identity primary key,
  week         date not null references fort_week (starts_on) on delete cascade,
  character_id text not null,
  kind         text not null default 'main' check (kind = 'main'), -- Farms never receive one
  place        integer not null check (place > 0),
  award        text not null,
  note         text,
  foreign key (character_id, kind) references governor (character_id, kind) on update cascade
);

create table gh_event (
  id        bigint generated always as identity primary key,
  name      text not null,
  starts_on date not null,
  ends_on   date not null check (ends_on >= starts_on)
);

create table gh_entry (
  event_id     bigint not null references gh_event (id) on delete cascade,
  place        integer not null check (place between 1 and 10),
  character_id text references governor (character_id), -- null while "needs ID"
  name         text not null, -- as pasted, alliance tag split off
  alliance     text,
  golden_heads integer not null check (golden_heads >= 0),
  primary key (event_id, place)
);

-- Carried over read-only from the Excel "KvK History" sheet. Its Character IDs are not
-- tied to governor: the sheet is a historical record, kept as it was.
create table kvk_entry (
  rank               integer primary key,
  character_id       text not null,
  name               text not null,
  status             text not null check (status in ('Current', 'Migrated')),
  power              bigint,
  highest_power      bigint,
  kill_points        bigint,
  resources_gathered bigint
);

create table council_member (
  email text primary key check (email = lower(email))
);

-- Row-level security: anonymous and signed-in visitors may read the public tables.
-- No write policy exists, so every insert, update and delete is refused.
do $$
declare t text;
begin
  foreach t in array array['governor', 'governor_name', 'roster_snapshot', 'roster_snapshot_row',
                           'fort_week', 'fort_entry', 'weekly_award', 'gh_event', 'gh_entry', 'kvk_entry']
  loop
    execute format('alter table %I enable row level security', t);
    execute format('create policy "public read" on %I for select to anon, authenticated using (true)', t);
    execute format('grant select on %I to anon, authenticated', t);
  end loop;
end $$;

-- Council emails stay private: RLS on, no policy for anyone.
alter table council_member enable row level security;
revoke all on council_member from anon;

revoke insert, update, delete, truncate on all tables in schema public from anon;
