# Kingdom 3493

Public site for the Void Legion (Rise of Kingdoms, Kingdom 3493): Fort rankings, GH Events, roster. Plain HTML/CSS/JS in `site/`, no build step. Every push to `main` publishes it to GitHub Pages.

## Language

Speak the glossary. [GLOSSARY.md](GLOSSARY.md) is the vocabulary for code, UI and tickets: Governor, Fort Count, Main, Farm, Complete Week. When a new term settles, add it there.

## Design

Read [DESIGN.md](DESIGN.md) before any UI change. Use the tokens at the top of `site/styles.css`, never raw hex, radii or durations; a missing value becomes a new token plus a line in DESIGN.md.

## Identity

Character ID is the only key for a Governor; names change. When a name can't be matched to a Character ID, leave it flagged "needs ID". Two Governors merged by a guessed name is the worst data bug this project can have.

## Work in flight

Work lines live under `.scratch/` (git-ignored), one folder each: `fort-reader/` (the reader and Roster job on the Oracle A1, the active line), `kingdom-admin/` (the Council admin page) and `reward-payout/` (Reward Promise, Group Score, Fill). In the line the task belongs to, read `STATE.md` first, then `SPEC.md` and the ticket under `issues/` that `Next:` names. `.scratch/pre-existing.md` collects bugs found in passing.

Architecture decisions live in `docs/adr/`:

- 0001: all data is in Supabase. The site reads it through `site/store.js`, the schema lives in `supabase/migrations/`, and row-level security lets only Council emails write.
- 0002: the reader's own sign-in writes the Live Week, through `record_live_week` only.
- 0003: the reader runs nightly on the Oracle A1 under Redroid.
- 0004: the Roster job saves a Roster Snapshot every day through `record_roster_snapshot`, the same sign-in. It is the only writer; the admin page no longer uploads.
- 0005: a reading taken on Sunday from 22:00 UTC closes the Live Week Complete, any earlier one leaves it Partial.
- 0006: Fort Weeks are never logged by hand. The Council only Picks Governors for "needs ID" rows. Every Pick goes through `pick_governor`, the Council's only way to write Name History.

Only `site/data/content.js` is hand-edited: news posts and the Reward Promise card's standing intro and rules. The promise itself is set on the admin page.

## Tests

- Site rules: `npm test` (Node's test runner over `tests/`).
- Reader and Roster job: from `tools/fort-reader/`, `.venv\Scripts\python.exe -m unittest test_capture test_merge test_game test_navigate test_alert test_roster`.
- Database functions: `py -m unittest discover -s supabase/tests` with psycopg on `PYTHONPATH`. They run against the live project inside a rolled-back transaction. `tests/name-matching-cases.json` and `tests/roster-snapshot-cases.json` are shared by the JS and SQL tests so the two can't drift.

## Gotchas

- Python is `py`; `python` is a Store stub. Scripts that print Governor names need `sys.stdout.reconfigure(encoding="utf-8")`, since names carry exotic Unicode.
- Serve the site over HTTP (the `site` entry in `.claude/launch.json`); `file://` won't load the data scripts.
- Governor names are user-controlled text: escape them wherever they reach HTML.
- You can run SQL against Supabase yourself, including applying migrations: `.env` holds `SUPABASE_DB_URL` (session pooler). There is no psql or Supabase CLI; install `psycopg[binary]` into the scratchpad and connect with that. Never print the URL. Test writes inside a transaction you roll back.
- The A1 is reached from WSL only: `wsl -d Ubuntu -- ssh fort-reader '<command>'`. WSL's shell expands `$(...)` and `$VAR` before ssh sends them, so send anything with substitutions as a script on stdin (`... ssh fort-reader bash -s < script.sh`). The host's address and the VM's details are in `.scratch/fort-reader/oracle-vm.md`, never in the repo. Code reaches the host only by a hand `git pull` there.
- `gh` lives at `C:\Program Files\GitHub CLI\gh.exe` and may be missing from PATH in older shells.
