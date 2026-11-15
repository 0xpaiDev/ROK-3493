# Fort reader

Reads the in-game Fort Destroyer Rankings and prints the Weekly Ranking in the admin page's Fort Week paste format: one Governor per line, name then Fort Count. With `--send` it also writes the reading to the public site as the Live Week (ADR 0002).

## Setup (once)

```
py -m venv .venv
.venv\Scripts\python.exe -m pip install -r requirements.txt
```

Needs `ANTHROPIC_API_KEY` in the repo's `.env`. Each screen is read with Claude Haiku, a few cents per week.

The game runs in BlueStacks 5, because the PC client ignores input from programs. BlueStacks instance settings: 1600x900, DPI 450, Advanced > Android Debug Bridge enabled. The instance is found by its display name, `ROK` (override with `BLUESTACKS_INSTANCE`). `adb` comes from Android platform-tools, or BlueStacks' own `HD-Adb.exe`.

On any other Android device (Redroid on a server, a phone), set `FORT_READER_ADB` in the repo's `.env` to its ADB address, such as `127.0.0.1:5555`; the reader then talks to that device and never looks for BlueStacks. The screen must be 1600x900 whatever the device: the reader checks it before any swipe and stops, naming the size it found, if not. Where there is no Windows clipboard (Linux), the result is only saved to `paste.txt`.

## Run

1. Have BlueStacks running with the game installed and the Reader Account logged in. The game may be open on any screen, or closed.
2. From this folder: `.venv\Scripts\python.exe fort_reader.py`
3. It restarts the game, taps through to the Fort Destroyer Rankings and swipes through the list on its own; the PC's mouse is free.
4. Paste the result, already on the clipboard, into the admin page's Fort Week.

## Opening the ranking from a closed game

Every run force-stops the game, starts it again, and has Haiku name each screen on the way (`read.name_screen`). Each screen it knows has one fixed tap (`navigate.PATH`, for a 1600x900 screen):

| Screen | Tap | What it is |
|---|---|---|
| loading | none, waits 5 s | black screen, title art with a progress bar, a spinner over the city |
| login_failed | CONFIRM (800, 588) | "Network disconnected / Login failed ... REGISTER_AND_LOGING"; the game restarts |
| city_bar_closed | menu button (1540, 820) | city with the bottom bar folded away |
| city | Alliance (1160, 840) | city with Items, Alliance, Commander, Mail showing |
| alliance | gear tab (90, 490) | the Alliance window on any tab |
| alliance_settings | Rankings (1170, 380) | the gear tab; Quit Alliance is on this page, well below |
| alliance_rankings | Fort Destroyer (400, 690) | the Rankings tiles |
| fort_ranking | done | the Fort Destroyer Rankings |

The run stops, saves `stopped-<screen>.png` in its `runs\` folder and sends nothing when it meets:

- **login**: log the Reader Account in by hand.
- **update**: install the new game version by hand.
- **loading** for longer than `FORT_READER_LOADING_LIMIT` seconds in all (default 600): a large download or no network.
- **unknown**: any screen not in the table, such as a new popup. Close it by hand and, if it comes back, add it to `navigate.PATH`.
- **the same screen tapped three times** without moving on, such as a "Login failed" box that keeps coming back (the account is open somewhere else).

It never guesses a tap and never types a password. Starting the game from closed takes about 1 to 2 minutes on BlueStacks.

## Send to the Live Week

`.venv\Scripts\python.exe fort_reader.py --send` signs in as the reader's own Supabase user and calls `record_live_week`. Fort Rankings then shows the week marked "live, as of HH:MM UTC". The reading is sent only when the run found no problems; otherwise the Live Week keeps its last reading.

Needs `FORT_READER_EMAIL` and `FORT_READER_PASSWORD` in the repo's `.env`: a Supabase user whose email is on `fort_reader` and not on `council_member`. The database matches names exactly against Name History, leaves the rest "needs ID", and refuses any week but the Live Week. The reading counts as of its first screenshot, so `--from` with `--send` works only for a run taken in the Live Week and no older than the saved reading, and a run that crosses the Monday reset is refused: paste that week by hand once it closes. A "needs ID" name the Council resolves in the admin page, Live Week included, goes into Name History, so the next reading matches it.

Screenshots and `paste.txt` are kept under `runs/`. To re-read a run without the game: `fort_reader.py --from runs\<folder>`.

## What it checks

Rows from overlapping screens are joined by rank. The run lists problems instead of guessing: ranks with gaps, a Fort Count read two different ways, a Fort Count that rises down the list, or your pinned row disagreeing with the list. A name read two ways with one Fort Count (names in odd scripts, such as `CƦУ㋾`, read differently per screen) is not a problem: the row is kept and sent flagged, so the database leaves it "needs ID" and never matches it by either spelling. Names are copied as read; the admin page matches them against Name History and flags the rest "needs ID".

Swiping the game from a script is automation, which Lilith's terms forbid. Run it on an account you can afford to lose.

Tests: `.venv\Scripts\python.exe -m unittest test_merge test_game test_navigate`
