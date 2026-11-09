# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

- **Kingdom members** of the Void Legion (Rise of Kingdoms, Kingdom 3493). They open the public site from a shared link, on phone and desktop about equally, to see where they placed in the Weekly Ranking, their Fort Average, GH Event results, Weekly Award winners, and the roster. Mostly fluent in English.
- **The Council** (the King and officers). They sign in to the admin page with a magic link to log Fort Weeks, record Weekly Awards, log GH Events, upload Roster Snapshots, and link Farms to Mains.
- **Outsiders** looking at the Kingdom, such as Governors considering joining. They see the same public site.

## Product Purpose

The site is the Kingdom's public record of the weekly Fort grind and its events. It does three jobs at once:

1. **Recognition.** Members see their grind acknowledged in public, which drives the weekly Fort push.
2. **Fair bookkeeping.** The Council gets a trustworthy record (Mains ranked apart from Farms, Fort Average counting only weeks the data can vouch for, ties ordered by the Council) to decide Weekly Awards from.
3. **Recruitment.** Outsiders see an organised, active Kingdom.

Success: members check it after each Fort Week without asking an officer, and the Council updates it from the admin page with no spreadsheet or script.

## Positioning

A Kingdom-specific record built on the Kingdom's own rules. Character ID is the only identity key, so renamed Governors keep their history and two Governors are never merged by a guessed name. Farms are credited under their Main but never added to its total. Complete and Partial Weeks are treated differently, so old incomplete logs never punish anyone. A generic stats tracker or a shared spreadsheet does none of this.

## Operating Context

- The Fort Week runs Monday 00:00 UTC to the next Monday. Rankings close at reset; the Council logs the week from the in-game ranking page and gives out Weekly Awards (King's Chests or resources) after.
- Roster data comes from the official Lilith stats export, uploaded as a dated Roster Snapshot.
- GH Events pay Golden Heads to the top 10, usually 20/10/5/4×7.
- The link is shared in alliance chat and similar channels; visits cluster after each reset and event.

## Capabilities and Constraints

- Plain HTML/CSS/JS in `site/`, no build step; published to GitHub Pages on every push to `main`.
- All data lives in Supabase (ADR 0001). The public reads with the anon key; only Council emails can write, plus the reader's own sign-in, which can only replace the Live Week (ADR 0002). Only `site/data/content.js` (news, next week's rewards) is hand-edited.
- Public sections: Home, Fort Rankings, Events, Roster, plus a Governor popup. Council section: `admin.html`.
- Vocabulary is fixed by `GLOSSARY.md`: Governor, Character ID, Main, Farm, Migrated, Fort Week, Fort Count, Weekly Ranking, Complete / Partial Week, Fort Average, Weekly Award, GH Event, Roster Snapshot, Top 200. UI never says "Fort Score", "player" or "alt".
- Governor names are user-controlled and carry exotic Unicode: they must be escaped and must render without breaking layout.
- Unmatched names stay flagged "needs ID" until the Council resolves them by hand.
- Migrated Governors stay visible (greyed, tagged) rather than deleted. The roster defaults to the Top 200.
- Kill Points and Alliance Helps are stored but not shown (the export reports 0 Kill Points).
- A reader reads the in-game ranking and keeps the Live Week current on Fort Rankings, marked with the time of its last reading; Fort Average leaves the Live Week out until the Monday reset closes it (ADR 0002).
- Out of scope for now: power history charts, admin entry for KvK results, structured award types.

## Brand Commitments

- The names **Void Legion** and **Kingdom 3493** are fixed.
- The "V" mark, the "Enter the void." tagline and `site/assets/poster.png` are not binding and may change.

## Evidence on Hand

- Real Kingdom data in Supabase: Fort Weeks (weeks 43 and 44 are Partial), Governors with Name History, the 20GH event, KvK history, Roster Snapshots.
- `site/data/content.js` holds news and rewards copy that is still marked draft; reward tiers say "Reward to be announced". Do not invent reward amounts, news, or results.
- No testimonials or member quotes exist.

## Product Principles

1. **Identity is sacred.** Never imply two Governors are one, or show a guessed match as fact. "needs ID" is visible, not hidden.
2. **Fair before flattering.** Rankings and averages show what the data can vouch for; the rules behind them should be easy to find.
3. **Recognition is public.** Placing well and receiving a Weekly Award should be something a member wants to share.
4. **One glance after reset.** A member opening the link on any device finds their own standing quickly.
5. **The Council's work stays light.** Admin tasks are paste, check, confirm; never a spreadsheet.

## Accessibility & Inclusion

No product-specific standard was set. Phone and desktop use are equal, so every public view must work fully at phone width.
