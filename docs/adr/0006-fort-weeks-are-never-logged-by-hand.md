---
status: accepted
---

# Fort Weeks are never logged by hand

The reader reads every Fort Week (ADRs 0002, 0003, 0005), so the admin page's pasted Fort Week is no longer used. It goes, along with its tie arrows and its Complete/Partial choice. The Council's only Fort Week task is the Pick: choosing the Governor for a "needs ID" row the reader could not match, on the Live Week or on a closed week.

A Pick on the Live Week adds the name to Name History and nothing else, because only the reader writes the Live Week (ADR 0002). A Pick on a closed week also sets that row's Character ID, since no later reading comes. A name another row of the week has, or was also read as, stays out of Name History: it may belong to two Governors, and under one of them alone the reader would hand the other's later rows to it.

Every Pick, on either kind of week, goes through one Council-only function, `pick_governor`. It decides from the clock whether the week is the Live Week, and it takes all of a week's Picks in one transaction, so they save together or not at all. It refuses a week not yet begun, a row that already has a Character ID, and a Governor who already has a row that week. On the Live Week it also refuses a Pick the reader's next reading would not match, judged by the same SQL matcher `record_live_week` uses. It is the Council's only way to write Name History: the Council has no direct write on `governor_name`, so a bug in the page can't get around the rule that keeps two Governors from sharing a name. The page's `checkPicks` says what the function will refuse before Save is pressed, but the function is what refuses. (Amended 17 Nov 2026: Live Week Picks used to write Name History straight from the page, which left the rule enforced only in the browser. Ticket kingdom-admin/18.)

## Considered options

- **Keep paste as the fallback for a failed final reading.** It was the only thing the paste was still for. A failed reading means the reader needs fixing, and the week stays Partial meanwhile, which Fort Average already handles (ADR 0005). A week that really needs re-entering is done in a Claude Code session from screenshots, not from the page.
- **Resolve closed-week "needs ID" rows only through Name History.** Nothing rereads a closed week, so the row would never change.
- **Live Week Picks write Name History from the page; only closed-week Picks use the function.** This was the first version. The page decided which path to take, and the rules for Name History were checked only in the browser.
- **A second function just for Live Week Picks.** Each function would be simpler, but the page would still choose between them, and both would repeat the rule about names on other rows.

## Consequences

- When Sunday's run fails, the week stays Partial. Nobody pastes it.
- A Pick on a closed week with published Weekly Awards can change who stands at a paid place. The page says so; the Council decides whether to re-run Fill. Nothing changes the awards on its own.
- `matchNames`, `parseFortRows`, `moveInTie` and the browser-side multi-request Fort Week save are deleted. Name matching has one rule left, the reader's, and the shared name-matching cases no longer need `liveOnly`.
