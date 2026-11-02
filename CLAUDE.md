# Kingdom 3493

Public site for the Void Legion (Rise of Kingdoms, Kingdom 3493): Fort rankings, GH Events, roster. Plain HTML/CSS/JS in `site/`, no build step. Every push to `main` publishes it to GitHub Pages.

## Language

Speak the glossary. [GLOSSARY.md](GLOSSARY.md) is the vocabulary for code, UI and tickets: Governor, Fort Count, Main, Farm, Complete Week. When a new term settles, add it there.

## Design

Read [DESIGN.md](DESIGN.md) before any UI change. Use the tokens at the top of `site/styles.css`, never raw hex, radii or durations; a missing value becomes a new token plus a line in DESIGN.md.

## Identity

Character ID is the only key for a Governor; names change. When a name can't be matched to a Character ID, leave it flagged "needs ID". Two Governors merged by a guessed name is the worst data bug this project can have.

## Work in flight

The current work line is `.scratch/kingdom-admin/`: read `STATE.md` first, then `SPEC.md` and the ticket under `issues/` that `Next:` names. Architecture decisions live in `docs/adr/`. ADR 0001 moves all data to Supabase: the site reads it through `site/store.js`, and the schema lives in `supabase/migrations/`. Only `site/data/content.js` (news, rewards) is still hand-edited.

## Gotchas

- Python is `py`; `python` is a Store stub. Scripts that print Governor names need `sys.stdout.reconfigure(encoding="utf-8")`, since names carry exotic Unicode.
- Serve the site over HTTP (the `site` entry in `.claude/launch.json`); `file://` won't load the data scripts.
- Governor names are user-controlled text: escape them wherever they reach HTML.
- You can run SQL against Supabase yourself, including applying migrations: `.env` holds `SUPABASE_DB_URL` (session pooler). There is no psql or Supabase CLI; install `psycopg[binary]` into the scratchpad and connect with that. Never print the URL. Test writes inside a transaction you roll back.
- `gh` lives at `C:\Program Files\GitHub CLI\gh.exe` and may be missing from PATH in older shells.
