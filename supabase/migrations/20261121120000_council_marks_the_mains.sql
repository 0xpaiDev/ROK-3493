-- KvK ticket 07: the Council marks the Mains; nobody is a Main by default.
-- A Governor is 'unmarked' until the Council marks them a Main, or links them as a Farm.
-- Every Governor goes back to unmarked and every Farm link is wiped: the Council marks its
-- verified Mains, then links Farms again from the suggestions, which now offer only marked Mains.
-- Dismissed suggestion pairs stay: they are the Council's "no".

alter table governor drop constraint governor_kind_check;
update governor set kind = 'unmarked', main_character_id = null;
alter table governor add constraint governor_kind_check check (kind in ('unmarked', 'main', 'farm'));
alter table governor alter column kind set default 'unmarked';

-- A Farm's link points at a marked Main, never at a Farm or an unmarked Governor. main_kind is
-- 'main' whenever there is a link, so the pair must match a Main's (character_id, kind). Unmarking
-- a Main that still has Farms is refused (23503) until its Farms are unlinked.
alter table governor add column main_kind text generated always as
  (case when main_character_id is not null then 'main' end) stored;
alter table governor add constraint governor_farm_of_a_main
  foreign key (main_character_id, main_kind) references governor (character_id, kind);
