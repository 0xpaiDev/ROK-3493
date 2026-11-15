---
status: accepted
---

# Supabase is the only store; the front end stays static

The Council needs to edit data from an admin page (Farm links, Fort Weeks, Weekly Awards, GH Events, Roster Snapshots). A static site on GitHub Pages can't save anything, so we moved the data from the Excel workbook to Supabase in this iteration rather than later. The front end stays static on GitHub Pages and talks to Supabase directly; row-level security, not server code of our own, decides who may write. There are two exceptions, each a single database function that only the reader's sign-in may call: the reader writes the Live Week (ADR 0002), and the Roster job saves Roster Snapshots (ADR 0004). Since ADR 0004 the Council no longer writes Roster Snapshots and can only delete one.

## Considered options

- **Admin page downloads a file to commit and rebuild.** No backend, but only one editor at a time and a manual step every week.
- **Excel stays the source; admin page only suggests.** No new infrastructure, but every edit is copied by hand and the screenshot bot would have nothing to write into.
- **Self-hosted app with SQL (e.g. an Oracle free VM).** Full control, but a server to run and patch for a hobby project.

## Consequences

- The Excel workbook and its converter were retired after a one-time migration (ticket 03 of `kingdom-admin`).
- Supabase's free tier pauses a project after about a week with no activity. The reader's nightly run and the Roster job's two runs a day keep it awake. If it pauses anyway, both jobs fail and email Petras, and someone resumes it from the dashboard.
- Moving off Supabase later means porting the schema, the row-level security rules and the magic-link login.
