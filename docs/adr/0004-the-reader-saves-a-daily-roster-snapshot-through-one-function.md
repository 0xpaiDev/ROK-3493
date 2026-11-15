---
status: accepted
---

# The Roster job saves every Roster Snapshot through one database function

Roster Snapshots came from Lilith's stats export, which a Council member downloaded and uploaded on the admin page. We want one every day with nobody at a PC. Lilith's RoK Toolkit (rok-game-tools-global.lilith.com) has a JSON API behind its export, `/api/kindomMember`, and it takes the same login token the site keeps after you sign in. The Roster job on the Oracle A1 asks it for the newest day (`/api/kindomInformation`) and saves the rows through `record_roster_snapshot`. Only the reader's Supabase sign-in may call that function, the same one ADR 0002 gave the Live Week. The function applies the rules the admin page's upload used, in one transaction: statuses, new Governors, renames, Name History, then the snapshot and its rows.

The Roster job is the only writer of Roster Snapshots. The admin page's upload is gone, and the Council can no longer insert or update a snapshot (Petras, 2026-11-15: the Council has no business uploading once the job does). The Council still sets a Governor's status by hand. Its database right to delete a snapshot stays, but the admin page has no control for it: Petras removes a wrong one with SQL.

## Considered options

- **Download the .xlsx and parse it, as the admin page did.** The file and the JSON hold the same values. The JSON needs no spreadsheet parser and arrives with Character IDs as text.
- **Run the admin page's JavaScript on the host and give the reader Council rights.** No rules in SQL, but a stolen reader sign-in could then rewrite anything the Council can.
- **A second sign-in just for the roster.** Cleaner separation, but one more secret on the same host, where the reader's sign-in already lives.
- **Keep the Council's upload beside the job.** Two writers race: the admin page saved in several requests with no transaction, so a job run in the middle of a Council save compared against a half-written snapshot. Moving the upload into the same function would fix that but keep a path nobody needs.

## Consequences

- The Roster Snapshot rules live only in SQL now. `tests/roster-snapshot-cases.json` pins them. `top200` stays in `site/kingdom.js` for the site's Top 200 flag, with the same tie-break as the function: equal power goes by Character ID as plain text.
- Anyone holding the reader's sign-in can now also save a Roster Snapshot, but only for a day newer than the latest one and not in the future. The rows are theirs to choose, so they can rename any Governor, flip statuses, add Governors and add names to Name History. Those writes are permanent: unlike the Live Week, no later run overwrites them. A made-up name in Name History is the dangerous one, since `record_live_week` matches against it and could tie a Fort Count to the wrong Character ID.
- Deleting a snapshot removes only its rows. Everything else the function wrote that day stays. Running the job again afterwards corrects statuses and current names from Lilith's real data. It does not remove Name History rows or Governors that the bad day added. To clean those up by hand, delete the `governor_name` rows dated that day (`first_seen`) that Lilith's real data doesn't show, then the Governors that only that day introduced and nothing else refers to. A day from Lilith itself needs none of this. Its names come keyed by Character ID, so they are true, and a day with missing rows only marks Governors Inactive until the next run marks them Current again. Making the cleanup automatic, by having each Name History row record the snapshot that added it, was considered on 2026-11-15 and not built.
- When the job stops (an expired token, Lilith down, the host off), no Roster Snapshot is saved until it runs again. The admin page shows the latest day and flags it after 3 days; the job emails Petras on any failure. A missed day is not made up: the next run saves the newest day.
- The Lilith token lasts 30 days and sits in the host's `.env`. Its payload carries a Lilith session token for the account that signed in, so the Reader Account is the safer source. The first token is from Petras's own account, his choice on 2026-11-15. Until the reader can refresh it from the game's notice board, someone signs in to the RoK Toolkit once a month and copies it over. The job emails five days before it expires.
- The job keeps only the columns `roster_snapshot_row` has. Deaths and per-tier kills stay at Lilith.
- A row with no Character ID or no name refuses the whole day, loudly. A Governor is never saved under an empty or made-up name.
