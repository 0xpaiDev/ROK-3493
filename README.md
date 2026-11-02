# Void Legion · Kingdom 3493

Static site for weekly fort rankings, 20GH events, KvK history and the roster.

Live at **https://0xpaidev.github.io/ROK-3493/**

## Update the data

> Temporary: the Excel workflow below is being replaced by Supabase and a Council admin page
> ([ADR 0001](docs/adr/0001-supabase-as-the-only-store.md)). It stays valid until that move lands.

1. Add the new week to the Excel "Fort Weekly Log" sheet as a new block to the right (same 6 columns).
2. Regenerate the data file:

   ```
   py tools/build_data.py "path/to/3493 Data.xlsx"
   ```

   It prints warnings for duplicate players in a week and rows with no Character ID.
3. Edit news and next week's rewards in `site/data/content.js` (set `draft: false` when final).

## Run locally

```
py -m http.server 5173 --directory site
```

Then open http://localhost:5173.

## Publish

Every push to `main` publishes the `site` folder to GitHub Pages through `.github/workflows/pages.yml`. To publish an update: regenerate the data, commit, push.
