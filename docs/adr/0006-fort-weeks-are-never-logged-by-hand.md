---
status: accepted
---

# Fort Weeks are never logged by hand

The reader reads every Fort Week (ADRs 0002, 0003, 0005), so the admin page's pasted Fort Week is no longer used. It goes, along with its tie arrows and its Complete/Partial choice. The Council's only Fort Week task is the Pick: choosing the Governor for a "needs ID" row the reader could not match, on the Live Week or on a closed week.

A Pick on the Live Week adds the name to Name History and nothing else, because only the reader writes the Live Week (ADR 0002). A Pick on a closed week also sets that row's Character ID, since no later reading comes. It goes through one Council-only function that writes the row and Name History in one transaction, and refuses the Live Week and a Governor who already has a row that week.

## Considered options

- **Keep paste as the fallback for a failed final reading.** It was the only thing the paste was still for. A failed reading means the reader needs fixing, and the week stays Partial meanwhile, which Fort Average already handles (ADR 0005). A week that really needs re-entering is done in a Claude Code session from screenshots, not from the page.
- **Resolve closed-week "needs ID" rows only through Name History.** Nothing rereads a closed week, so the row would never change.

## Consequences

- When Sunday's run fails, the week stays Partial. Nobody pastes it.
- A Pick on a closed week with published Weekly Awards can change who stands at a paid place. The page says so; the Council decides whether to re-run Fill. Nothing changes the awards on its own.
- `matchNames`, `parseFortRows`, `moveInTie` and the browser-side multi-request Fort Week save are deleted. Name matching has one rule left, the reader's, and the shared name-matching cases no longer need `liveOnly`.
