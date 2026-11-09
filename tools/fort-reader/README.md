# Fort reader

Reads the in-game Fort Destroyer Rankings and prints the Weekly Ranking in the admin page's Fort Week paste format: one Governor per line, name then Fort Count. With `--send` it also writes the reading to the public site as the Live Week (ADR 0002).

## Setup (once)

```
py -m venv .venv
.venv\Scripts\python.exe -m pip install -r requirements.txt
```

Needs `ANTHROPIC_API_KEY` in the repo's `.env`. Each screen is read with Claude Haiku, a few cents per week.

The game runs in BlueStacks 5, because the PC client ignores input from programs. BlueStacks instance settings: 1600x900, DPI 450, Advanced > Android Debug Bridge enabled. The instance is found by its display name, `ROK` (override with `BLUESTACKS_INSTANCE`). `adb` comes from Android platform-tools, or BlueStacks' own `HD-Adb.exe`.

## Run

1. In BlueStacks, open the Fort Destroyer Rankings.
2. From this folder: `.venv\Scripts\python.exe fort_reader.py`
3. It swipes through the list on its own; the PC's mouse is free.
4. Paste the result, already on the clipboard, into the admin page's Fort Week.

## Send to the Live Week

`.venv\Scripts\python.exe fort_reader.py --send` signs in as the reader's own Supabase user and calls `record_live_week`. Fort Rankings then shows the week marked "live, as of HH:MM UTC". The reading is sent only when the run found no problems; otherwise the Live Week keeps its last reading.

Needs `FORT_READER_EMAIL` and `FORT_READER_PASSWORD` in the repo's `.env`: a Supabase user whose email is on `fort_reader` and not on `council_member`. The database matches names exactly against Name History, leaves the rest "needs ID", and refuses any week but the Live Week. A name the Council resolves in the admin page goes into Name History, so the next reading matches it.

Screenshots and `paste.txt` are kept under `runs/`. To re-read a run without the game: `fort_reader.py --from runs\<folder>`.

## What it checks

Rows from overlapping screens are joined by rank. The run lists problems instead of guessing: ranks with gaps, a Fort Count read two different ways, a Fort Count that rises down the list, or your pinned row disagreeing with the list. A name read two ways with one Fort Count (names in odd scripts, such as `CƦУ㋾`, read differently per screen) is not a problem: the row is kept and sent flagged, so the database leaves it "needs ID" and never matches it by either spelling. Names are copied as read; the admin page matches them against Name History and flags the rest "needs ID".

Swiping the game from a script is automation, which Lilith's terms forbid. Run it on an account you can afford to lose.

Tests: `.venv\Scripts\python.exe -m unittest test_merge`
