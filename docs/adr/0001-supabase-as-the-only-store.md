---
status: accepted
---

# Supabase is the only store; the front end stays static

The Council needs to edit data from an admin page (Farm links, Fort Weeks, Weekly Awards, GH Events, Roster Snapshots). A static site on GitHub Pages can't save anything, so we moved the data from the Excel workbook to Supabase in this iteration rather than later. The front end stays static on GitHub Pages and talks to Supabase directly; row-level security, not server code of our own, decides who may write.

## Considered options

- **Admin page downloads a file to commit and rebuild.** No backend, but only one editor at a time and a manual step every week.
- **Excel stays the source; admin page only suggests.** No new infrastructure, but every edit is copied by hand and the screenshot bot would have nothing to write into.
- **Self-hosted app with SQL (e.g. an Oracle free VM).** Full control, but a server to run and patch for a hobby project.

## Consequences

- The Excel workbook and its converter are retired after a one-time migration. The README still describes the converter as the way to update data until ticket 03 of `kingdom-admin` replaces that section.
- Supabase's free tier pauses a project after about a week with no activity. Weekly logging keeps it awake; after a long break someone resumes it from the dashboard.
- Moving off Supabase later means porting the schema, the row-level security rules and the magic-link login.
