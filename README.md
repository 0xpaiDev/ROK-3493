# Void Legion · Kingdom 3493

Static site for weekly fort rankings, GH Events, KvK history and the roster.

Live at **https://0xpaidev.github.io/ROK-3493/**

## Where the data lives

The Kingdom's data lives in Supabase ([ADR 0001](docs/adr/0001-supabase-as-the-only-store.md)).
The site reads it in the browser with the public key in `site/store.js`; row-level security lets
that key read and never write.

- **Schema:** `supabase/migrations/`. A schema change is a new migration file, applied to the
  project with a SQL client or in the Supabase SQL editor.
- **The Council** edits data on the admin page (`site/admin.html`, magic-link sign-in): Farm links,
  Picks for "needs ID" rows, Weekly Awards, Governor status and the Reward Promise.
- **The reader** on an Oracle A1 reads the in-game Fort Destroyer Rankings every night and writes
  the Live Week; Sunday's run lets it close Complete ([ADR 0002](docs/adr/0002-the-reader-writes-the-live-week-through-one-function.md),
  [0003](docs/adr/0003-the-reader-runs-on-the-oracle-a1-under-redroid.md),
  [0005](docs/adr/0005-the-reading-time-decides-whether-the-live-week-closes-complete.md)).
  The **Roster job** on the same host saves a Roster Snapshot every day from Lilith's stats
  ([ADR 0004](docs/adr/0004-the-reader-saves-a-daily-roster-snapshot-through-one-function.md)).
  Both are in `tools/fort-reader/`; its README covers the host.
- **News** and the Reward Promise card's standing intro and rules are hand-edited in
  `site/data/content.js` (set a post's `draft: false` when final).

## Run locally

```
py -m http.server 5173 --directory site
```

Then open http://localhost:5173. The site reads the live Supabase project, even locally.

## Test

```
npm test
```

The reader's and the database's tests are listed in `CLAUDE.md`.

## Publish

Every push to `main` publishes the `site` folder to GitHub Pages through `.github/workflows/pages.yml`. Data changes in Supabase show up on the next page load, with no publish needed.
