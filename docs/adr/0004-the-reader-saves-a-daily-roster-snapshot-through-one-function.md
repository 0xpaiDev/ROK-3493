---
status: proposed
---

# The reader's host saves a daily Roster Snapshot through one database function

Roster Snapshots come from Lilith's stats export, which a Council member downloads and uploads on the admin page. We want one every day with nobody at a PC. Lilith's RoK Toolkit (rok-game-tools-global.lilith.com) has a JSON API behind its export, `/api/kindomMember`, and it takes the same login token the site keeps after you sign in. A job on the Oracle A1 asks it for the newest day (`/api/kindomInformation`) and saves the rows through `record_roster_snapshot`. Only the reader's Supabase sign-in may call that function, the same one ADR 0002 gave the Live Week. The function applies the admin page's rules (`applyRosterSnapshot`) in one transaction: statuses, new Governors, renames, Name History, then the snapshot and its rows.

## Considered options

- **Download the .xlsx and parse it, as the admin page does.** The file and the JSON hold the same values. The JSON needs no spreadsheet parser and arrives with Character IDs as text.
- **Run the admin page's JavaScript on the host and give the reader Council rights.** No rules in SQL, but a stolen reader sign-in could then rewrite anything the Council can.
- **A second sign-in just for the roster.** Cleaner separation, but one more secret on the same host, where the reader's sign-in already lives.

## Consequences

- The Roster Snapshot rules now exist twice, in `site/kingdom.js` and in SQL. `tests/roster-snapshot-cases.json` runs against both, as the name-matching cases do for the Live Week.
- Anyone holding the reader's sign-in can now also save a Roster Snapshot, but only for a day newer than the latest one and not in the future. A wrong one is fixed by deleting it and running the job again.
- The Lilith token lasts 30 days and sits in the host's `.env`. Its payload carries a Lilith session token for the account that signed in, so the Reader Account is the safer source. The first token is from Petras's own account, his choice on 2026-11-15. Until the reader can refresh it from the game's notice board, someone signs in to the RoK Toolkit once a month and copies it over. The job emails five days before it expires.
- The job keeps only the columns `roster_snapshot_row` has. Deaths and per-tier kills stay at Lilith.
- The Council can still upload an export by hand. With two writers, the admin page's own check (against the latest snapshot when the page loaded) is no longer enough, so the database now refuses any Roster Snapshot on or before the latest one, whoever saves it.
- A row with no Character ID or no name refuses the whole day, loudly, where the admin page would save a blank name. A Governor is never saved under an empty or made-up name.
