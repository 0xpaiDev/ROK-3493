---
status: accepted
---

# The reader writes the Live Week through one database function

The goal for the Fort Week is a Live Week that the reader refreshes once a day with no Council member signed in. Under ADR 0001 only Council sign-ins can write. We add one exception and no server of our own: a database function that only the reader's own sign-in may call. It replaces the Live Week's rows and its "as of" time, and nothing else. It matches names by the same exact Name History rule as the admin page, and never writes Name History or Governors.

## Considered options

- **A Supabase Edge Function.** Same reach, but it is a second runtime to deploy and test, in place of one function in a migration.
- **Our own API on the Oracle VM.** This brings back the server ADR 0001 turned down.
- **Send the paste text to the Council.** Nothing new in Supabase, but there is no Live Week, and someone still pastes every week.

## Consequences

- Exact name matching now exists twice, in the site's rules module and in SQL. One shared file of test cases runs against both, so they can't drift apart.
- The reader sends when it took its screenshots. The function takes the week and the "as of" time from that, so old screenshots or a run that crosses the Monday reset cannot land in the Live Week.
- The reader's sign-in is a secret on the reader's machine. Anyone who steals it can only rewrite the Live Week, and the next reading overwrites that.
- During the Live Week, the admin page refuses a pasted Fort Week for that week. The Council resolves "needs ID" at any time and sets tie order only after the week closes.
