---
status: accepted
---

# The reading's time decides whether the Live Week closes Complete

The Fort Average counts a Governor missing from a Complete Week as 0, and skips a Partial Week they weren't ranked in. So a week must close Complete only when its last reading saw the full ranking at the end of the week. A run that failed, a run by hand on Sunday morning, or a host that was off must leave it Partial. Then nobody's average drops for forts they may have joined after the reading.

`record_live_week` sets the completeness itself, from when the reader took its screenshots. A reading taken on the week's Sunday from 22:00 UTC closes the week Complete. Any earlier reading leaves it Partial. The reader sends no flag for this, and the Council doesn't set it for a week the reader read.

The final run therefore lands between 22:00 UTC and the Monday reset. `install.sh` accepts a run time from 22:00 to 23:50 UTC (23:45 by default), since a run takes about 10 minutes and the function refuses a reading taken after the reset. The timer has no catch-up run after the host was off (`Persistent=false`), so a missed night never produces a reading at a time nobody chose.

## Considered options

- **The reader marks its own final run.** That flag would be one more thing to trust from the host. The time is already sent and already checked against the database's clock.
- **The Council closes each week by hand.** That defeats the point of a Live Week that needs nobody at a PC.
- **A final run after the reset, reading last week's ranking.** It would allow a run at any time on Monday, but nobody has checked that the game still shows last week's ranking after the reset (ADR 0003). The window before the reset needs no such check.

## Consequences

- When Sunday's run fails, the week keeps its last reading and is saved as Partial. The failure email reaches Petras and the Council. Nobody pastes the week: the reader gets fixed, and the week stays Partial (ADR 0006).
- A failed weekday run changes nothing but leaves the "as of" time stale.
- The rule lives in SQL and the run window in `install.sh`. Changing either alone breaks the other: a run time before 22:00 would close no week Complete, and one after 23:50 risks being refused.
- The site shows a week's Partial tag only after the week has closed.
