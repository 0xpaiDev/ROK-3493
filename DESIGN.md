# Design

How the Void Legion site looks and moves. Read this before any UI change, public site or Council admin. Tokens live as CSS variables at the top of `site/styles.css`: use them, never raw hex, px radii or durations. If a value you need is missing, add a token there and a line here.

Reference comps: the canvas "Void Legion · Site polish" (https://claude.ai/code/artifact/a5e497cd-5d7e-44c8-a6d5-0f110ddf009e). It is a sketch; this file and `styles.css` win where they differ.

## Character

Dark, calm, exact. One violet accent on near-black, with metals reserved for honour. It should read like a well-kept public record of the Kingdom's grind, not a game launcher: no glow washes, no bevels, no emoji. Motion rewards attention (a podium rising, bars filling) and never decorates for its own sake.

## Colour

| Role | Token | Use |
|---|---|---|
| Ground | `--bg` | page background |
| Surfaces | `--surface`, `--surface-2` | cards; inputs, pills, raised bars |
| Award surface | `--surface-award` | Weekly Award card only |
| Lines | `--line`, `--line-2`, `--line-strong` | dividers, card borders, chip borders |
| Text | `--text`, `--muted`, `--faint` | body; secondary; tertiary labels and IDs |
| Accent | `--accent`, `--accent-deep`, `--accent-wash` | active tab, primary button, focus ring, bars, selected tile |
| Links | `--link`, `--link-hover` | links, eyebrows |
| Metals | `--gold`, `--silver`, `--bronze` (+ `--on-metal` text) | **only** 1st/2nd/3rd placings and Weekly Awards |
| Live | `--live` on `--live-wash` (`--live-edge` for a ring) | the reset pulse, the Live Week tag and "Linked" / success |
| Notes | `--note` on `--note-wash` | Partial Week and other "how the data works" callouts |
| Gold tags | `--gold` on `--tag-wash` | the Draft and needs ID tags, the only gold outside placings and Weekly Awards |
| Review groups | `--inactive`, `--back`, `--new`, `--renamed` | Roster Snapshot groups (Become Inactive, Back to Current, New Governors, Renamed), as a dot plus count, never a filled card. `--back` is plain ink, not silver: metals stay with honours |
| Elevation | `--shadow-float` | the sticky save bar and anything else that floats over content |
| Deltas | `--up`, `--down` | week-on-week change; `--down` also edges a paste review row that blocks Save |

Rules: one accent per view. Colours that must be told apart also differ in lightness. Text passes 4.5:1 on its background, including 11–12 px labels; `--faint` on `--bg` is the floor, so never go dimmer for text.

## Type

- `--serif` (Instrument Serif, 400): page titles (`h1`, 44–76 px, `clamp`), card titles (`h2`, 28–34 px). Never bold, never for UI controls.
- `--sans` (Geist): everything else. Body 15 px / 1.5; labels 13 px; weights 400 / 500 / 600.
- `--mono` (Geist Mono): Character IDs, dates, the countdown, eyebrows (12 px, `.08em`, uppercase), keyboard hints.
- Every number uses `.num` (tabular figures). A Character ID always sits beside its name in mono and `--faint`.

## Layout

- Public pages: `.wrap` (max 1200 px, 32 px gutters, 16 px under 640 px). Admin: max 1320 px with a sidebar (`flex: 1 1 220px; max-width: 260px`) and content (`flex: 999 1 560px`). Above 760 px the two never wrap; at 760 px and below the sidebar stacks above the content as a 2-column task grid.
- Radii: `--radius` for cards, `--radius-md` for tiles, inputs and callouts, `--radius-sm` for rows and small boxes, `--pill` for buttons, tags and tabs.
- Spacing comes in steps of 4. Use 24 px for card padding (16 on phone), 12–16 px between cards and 32 px between columns.
- Lists of Governors sit flat in a card: rows divided by `--line`, never a card per row.
- Stats are a strip divided by thin lines, not a grid of cards. It goes 4 → 2 columns under 960 px.
- Wide tables scroll inside `.table-wrap`; the page itself never scrolls sideways.
- Breakpoints: 960 px (columns collapse) and 640 px (phone).

## Components

Reuse these before inventing new ones (classes in `styles.css`).

- **Top bar** `.topbar`: brand mark, `.tabs` with an underline on the active `.tab`, `.reset-pill` with `.pulse` and a live countdown to Monday 00:00 UTC.
- **Hero + podium** `.hero`, `.podium`, `.step`, `.medal`: order 2nd · 1st · 3rd. Tied Fort Counts say "tie", never imply a gap.
- **Find your Governor** `.search-box` / `.find`: matches Name History and Character ID; `/` focuses it.
- **Ranking row** `.row` in `.rank-list`: rank in mono (metal colour for top 3), name + bar, Fort Count right-aligned. Ties get a `.tag` "Tie · Council order". With "Main + Farm" on, a Main with Farms shows a total (count with a mono "total" label under it), ranked on that total. The parts that add up to it sit under it as `.row.part` rows: indented, no rank, quieter name, count and bar. The Main's own Fort Count comes first, tagged "Main", then each Farm's, tagged "Farm". An unlinked Farm is its own unranked row tagged "Farm · unlinked".
- **Card** `.card` + `.card-head`: eyebrow in mono, serif title, link on the right.
- **Callout** `.note`: explains a data rule in place (Partial Week, Live Week, Farms). Fairness rules live next to the numbers they affect.
- **Tag** `.tag`: Draft, Partial Week, Live (`.tag.live`, "Live, as of 14:05 UTC", on the Live Week's ranking and hero), Final (`.tag.final`, outlined, on a closed week's hero and home Weekly Ranking card, so home always says which it shows), Migrated, needs ID (`.tag.needs-id`, in Draft's gold), Farm (`.tag.farm`, also "Farm · unlinked", in the ranking and Fort Averages). "needs ID" is always visible, never hidden: in the ranking rows, the podium and the admin page.
- **Buttons** `.btn`: primary = `--accent` fill with dark text (one per view); secondary = outlined; quiet = text only. Minimum height 36 px; anything tapped on a phone is 44 px.
- **Segmented control / chips** `.seg`, `.chip`: filters and view toggles (Mains / Main + Farm).
- **Weekly Award winners** `.tiers.winners` on `.card.award`: place in mono, its metal following the place (`.p1`–`.p3`, so two 1sts are both gold), then the Main, the award and the Council's note stacked in `.aw`. The home page shows the latest awarded Fort Week (no shimmer: the one shimmer stays on the rewards card); Fort Rankings → Awards lists every week, latest first; the Governor popup lists that Main's awards.

Council admin patterns:

- **Task sidebar**: one task visible at a time, each with a status line and a badge (Review / open count / Soon). The task sits in the URL hash.
- **Steps bar**: Upload → Review → Save, with the current step in the accent.
- **Filter tiles**: count + dot + hint; clicking filters the list below (`aria-pressed`).
- **Change lists**: renames read `old (struck through) → new · ID`. An empty group is one line, not a blank box.
- **Sticky save bar**: appears while anything is unsaved and summarises what Save will do; Discard is quiet and Save is primary. Nothing writes before Save.
- **Confirm / Dismiss rows**: the decision becomes a "Linked" / "Dismissed" label with Undo. Group by Main and offer "Confirm all N".
- **Paste review rows** `.fw-row`: rank, the name as pasted, Fort Count, a Governor picker (datalist of "Name (Character ID)"), then the Character ID or a "needs ID" tag. Tied rows get up/down arrows that move them only within the tie. A row that blocks saving gets a `--down` edge on the left. For the Live Week the paste is refused and the rows are the reader's latest reading: only its "needs ID" rows get a picker (a row the reader read two ways gets a `.muted` note instead), no tie arrows, and Save writes the picks to Name History only. A pick the next reading would not match blocks Save and says why.
- **Weekly Awards** `.aw-rows`: on a saved, closed Fort Week, flat rows of place · Main · award and note · quiet Remove (with a confirm), and a secondary "Add award" form whose Main picker lists Mains only. Each award saves on its own, so there is no save bar.
- **Not built yet**: show the planned steps dashed with "Coming soon", never a tall empty card.

## Motion

- Only `transform` and `opacity`, eased with `--ease`. Durations: `--dur-fast` for hover/press, `--dur` for entrances, `--dur-slow` for bars and podium. Stagger list items by `--stagger`.
- Allowed: fade-up reveal on load or section change; podium rises 3rd → 2nd → 1st, then medals pop; bars fill in rank order; numbers count up once (~1.4 s, ease-out); slow orbit rings (90–140 s) and a breathing glow behind the hero; the reset `.pulse`; one shimmer on the Weekly Award card.
- Never: motion on scroll-jacking, looping motion on content the eye reads, or anything that delays data appearing.
- `prefers-reduced-motion: reduce` turns every animation and transition off and shows final values at once. Every new keyframe must be covered by that block.

## Content and safety

- Words come from `GLOSSARY.md`: Governor, Fort Count, Weekly Ranking, Weekly Award, Main, Farm, Migrated. Never "player", "score", "alt".
- Every Governor name goes through `esc()`. Names carry Arabic, Cyrillic, `ᵛø`, `⑦` and the like: ellipsise with `.ell` in tight spots and show the full name in the Governor popup. Never let a name widen a grid.
- No invented data. Missing copy is a placeholder like `[Reward]` or a Draft tag from `content.js`.
- Icons: inline stroke SVG at 1.8–2 px, `aria-hidden` when decorative; icon-only buttons get `aria-label`.
- Real `<button>`, `<a href>`, `<label>` + `<input>`, never a clickable div. The focus ring is the global `:focus-visible`; don't remove it.
