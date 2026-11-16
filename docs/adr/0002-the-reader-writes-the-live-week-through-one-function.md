---
status: accepted
---

# The reader writes the Live Week through one database function

The goal for the Fort Week is a Live Week that the reader refreshes once a day with no Council member signed in. Under ADR 0001 only Council sign-ins can write. We add one exception and no server of our own: a database function that only the reader's own sign-in may call. It replaces the Live Week's rows, its "as of" time and its completeness (ADR 0005), and nothing else. It matches names exactly against Name History and current names, by the same rule as `liveReadingIds` in `site/kingdom.js`: a row matches when its spelling, or every spelling the reader read for it, leads to exactly one Governor. It never writes Name History or Governors.

## Considered options

- **A Supabase Edge Function.** Same reach, but it is a second runtime to deploy and test, in place of one function in a migration.
- **Our own API on the Oracle VM.** This brings back the server ADR 0001 turned down.
- **Send the paste text to the Council.** Nothing new in Supabase, but there is no Live Week, and someone still pastes every week.

## Consequences

- Exact name matching now exists twice, in the site's rules module and in SQL. One shared file of test cases runs against both, so they can't drift apart.
- The reader sends when it took its screenshots. The function takes the week and the "as of" time from that, so old screenshots or a run that crosses the Monday reset cannot land in the Live Week.
- The reader's sign-in is a secret on the reader's machine. Through this function, anyone who steals it can only rewrite the Live Week, and the next reading overwrites that. Since ADR 0004 the same sign-in also saves Roster Snapshots, which reach Governors and Name History and are permanent. That ADR covers what a stolen sign-in can then do.
- The admin page never writes the Live Week's rows. The Council resolves its "needs ID" rows with Picks, which go into Name History only, so the next reading matches them (ADR 0006).
