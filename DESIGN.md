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
| Elevation | `--shadow-float` | the sticky save bar and anything else that floats over content |
| Deltas | `--up`, `--down` | week-on-week change; `--down` also edges a Fort Week row that blocks Save |

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
- **Ranking row** `.row` in `.rank-list`: rank in mono (metal colour for top 3), name + bar, Fort Count right-aligned. Ties get a `.tag` "Tie". With "Main + Farm" on, a Main with Farms shows its Group Score (at most one decimal, "37.5", with a mono "score" label under it), ranked on it. Its parts sit under it as `.row.part` rows at their real Fort Counts: indented, no rank, quieter name, count and bar. The Main's own Fort Count comes first, tagged "Main", then each Farm's, tagged "Farm". An unlinked Farm is its own unranked row tagged "Farm · unlinked".
- **Card** `.card` + `.card-head`: eyebrow in mono, serif title, link on the right.
- **Callout** `.note`: explains a data rule in place (Partial Week, Live Week, Farms). Fairness rules live next to the numbers they affect. During a Fort Pause, Fort Rankings carries `.note.pause-note` under its heading in every view: "Forts paused since 19 Nov 2026, 18:00 UTC." in bold, then why no Fort Week is read.
- **Tag** `.tag`: Draft, Partial Week, Live (`.tag.live`, "Live, as of 14:05 UTC", on the Live Week's ranking and hero), Final (`.tag.final`, outlined, on a closed week's hero and home Weekly Ranking card, so home always says which it shows), Migrated, needs ID (`.tag.needs-id`, in Draft's gold), Farm (`.tag.farm`, also "Farm · unlinked", in the ranking and Fort Averages). "needs ID" is always visible, never hidden: in the ranking rows, the podium and the admin page.
- **Buttons** `.btn`: primary = `--accent` fill with dark text (one per view); secondary = outlined; quiet = text only. Minimum height 36 px; anything tapped on a phone is 44 px.
- **Segmented control / chips** `.seg`, `.chip`: filters and view toggles (Mains / Main + Farm).
- **Reward items** `.reward-items` / `.reward-item`: an award's King's Chests and resources, each as icon (`--reward-icon`, `alt` the item name), amount the way the game writes it ("×2", "2M") and name. They wrap whole, never mid-item. An award from before reward items, or a home tier without items, shows its text instead. The admin picker `.reward-pick` is a grid of `.reward-opt` tiles (`--reward-icon-pick`), one amount input each. Chest art is 114 px, so no icon goes above 48 px.
- **Reward Promise** `.card.award.shine` with `.tiers`: the Live Week's promise from the Council, the one shimmer card. Eyebrow "Reward Promise · Week N" with the reset countdown beside it, title "Fort Grind: 9 – 15 Nov", then each place's label and its reward items or text. No promise for the Live Week, no card: a closed week's promise never stays up.
- **KvK table** on the KvK tab: the KvK's name as the page title, a lede with its state, days, Counting Periods, DKP weights and Power Cutoff, then a `.table-wrap` table: rank (tied DKP shares it), Governor (`.tag.away` for Inactive or Migrated, the row `.is-away`), Start power, DKP in bold, T4 / T5 kills and deaths. Before its start snapshot the card says what it waits for.
- **Weekly Award winners** `.tiers.winners` on `.card.award`: place in mono, its metal following the place (`.p1`–`.p3`, so two 1sts are both gold), then the Main, the award and the Council's note stacked in `.aw`. The home page shows the latest awarded Fort Week (no shimmer: the one shimmer stays on the rewards card); Fort Rankings → Awards lists every week, latest first; the Governor popup lists that Main's awards.

Council admin patterns:

- **Task sidebar**: one task visible at a time, each with a status line and a badge (Review / open count / Soon). The task sits in the URL hash.
- **Sticky save bar**: appears while anything is unsaved and summarises what Save will do; Discard is quiet and Save is primary. Nothing writes before Save.
- **Confirm / Dismiss rows**: the decision becomes a "Linked" / "Dismissed" label with Undo. Group by Main and offer "Confirm all N".
- **Fort Week rows** `.fw-row`: a read week's rows (ADR 0006): rank, the name as read, Fort Count, then the Character ID or a "needs ID" tag. Only a "needs ID" row gets a Governor picker (datalist of "Name (Character ID)") for the Council's Pick. A row a Pick puts on a week twice gets a `--down` edge on the left. On the Live Week, Save writes the Picks to Name History only, and a Pick the next reading would not match blocks Save and says why; on a closed week, Save sets each row's Character ID, and a week with published Weekly Awards says a Pick can move a paid place. No paste and no tie arrows.
- **Weekly Awards** `.aw-rows`: on a saved, closed Fort Week, a draft that opens with the published awards. A secondary "Fill from the promise" button (`.aw-fill`) with a line naming the promise's week and ranking, then a `.note` listing each row Fill skipped. Flat rows of place · Main · award and note · quiet Edit and Remove; the row being edited takes `--accent-wash`. Below, the add / edit form whose Main picker lists Mains only. Every change stays in the draft; the sticky save bar (Discard, Publish) shows while the draft differs from what is published. Fill confirms before overwriting an edited draft, and changing the week or saving the Fort Week confirms before dropping an unpublished one. While a publish runs, the save bar is disabled and Publish reads "Publishing…".
- **KvK editor**: a flat `.aw-rows` list of the KvKs (name, state tag, days in mono, "Waiting for its start snapshot" under one whose start day has no Roster Snapshot, quiet Edit; the one being edited takes `--accent-wash`), then the form as cards stacked in `.admin-stack`: Days and DKP (name, start and end day, Power Cutoff typed like "20M", the four DKP weights), then Counting Periods (a from / to row each, Remove, Add Counting Period). The sticky save bar names the first problem `checkKvk` finds; Delete KvK is quiet, with a confirm.
- **Reward Promise editor**: a week picker that starts on the Live Week (earlier weeks are refused), an optional intro, then one card per place with a place label, the `.reward-pick` grid and an Other text field. A week with no promise starts from the latest earlier one. The sticky save bar says what Save does; Remove promise is quiet, with a confirm.
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
