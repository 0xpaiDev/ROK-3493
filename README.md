# Void Legion · Kingdom 3493

Static site for weekly fort rankings, GH Events, KvK history and the roster.

Live at **https://0xpaidev.github.io/ROK-3493/**

## Where the data lives

The Kingdom's data lives in Supabase ([ADR 0001](docs/adr/0001-supabase-as-the-only-store.md)).
The site reads it in the browser with the public key in `site/store.js`; row-level security lets
that key read and never write.

- **Schema:** `supabase/migrations/`. A schema change is a new migration file, applied in the
  Supabase SQL editor.
- **Updating data:** the Council admin page is on its way (kingdom-admin tickets 04–10). Until it
  lands, edit rows in the Supabase dashboard's Table Editor.
- **News and next week's rewards** are still hand-edited in `site/data/content.js` (set
  `draft: false` when final).

## Run locally

```
py -m http.server 5173 --directory site
```

Then open http://localhost:5173. The site reads the live Supabase project, even locally.

## Test

```
npm test
```

## Publish

Every push to `main` publishes the `site` folder to GitHub Pages through `.github/workflows/pages.yml`. Data changes in Supabase show up on the next page load, with no publish needed.
