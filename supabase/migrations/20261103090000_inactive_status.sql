-- Ticket 05: the Lilith export leaves out inactive Governors as well as those who left, so a
-- Governor missing from a Roster Snapshot is Inactive, not Migrated. Migrated is now set only
-- by the Council. Three statuses: current, inactive, migrated.

alter table governor drop constraint governor_status_check;
alter table governor add constraint governor_status_check
  check (status in ('current', 'inactive', 'migrated'));
