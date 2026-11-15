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
| login_failed_loading | none, waits 5 s | "Network disconnected / Login failed ... REGISTER_AND_LOGING" over the loading screen. A BlueStacks bug: CONFIRM pressed now restarts into the same box, so the reader waits for the city to load behind it |
| login_failed | CONFIRM (800, 588) | the same box over the city; CONFIRM restarts the game, and this time it loads |
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
- **the same screen tapped three times** without moving on, such as a "Login failed" box over the city that keeps coming back (the account is open somewhere else).

It never guesses a tap and never types a password. Starting the game from closed takes about 1 to 2 minutes on BlueStacks.

## Send to the Live Week

`.venv\Scripts\python.exe fort_reader.py --send` signs in as the reader's own Supabase user and calls `record_live_week`. Fort Rankings then shows the week marked "live, as of HH:MM UTC". The reading is sent only when the run found no problems; otherwise the Live Week keeps its last reading.

Needs `FORT_READER_EMAIL` and `FORT_READER_PASSWORD` in the repo's `.env`: a Supabase user whose email is on `fort_reader` and not on `council_member`. The database matches names exactly against Name History, leaves the rest "needs ID", and refuses any week but the Live Week. The reading counts as of its first screenshot, so `--from` with `--send` works only for a run taken in the Live Week and no older than the saved reading, and a run that crosses the Monday reset is refused: paste that week by hand once it closes. A "needs ID" name the Council resolves in the admin page, Live Week included, goes into Name History, so the next reading matches it.

Screenshots and `paste.txt` are kept under `runs/`. To re-read a run without the game: `fort_reader.py --from runs\<folder>`.

## Email when a run fails

With `--send`, a run that ends without sending its reading emails Petras the reason and the newest screenshot of the run (`stopped-<screen>.png` when it stopped on a screen). That covers problems found in the reading, a stop on a screen the reader won't tap past, and a crash. A run that sends its reading emails nobody, and a run without `--send` only prints. A run that started on a Sunday (UTC) is the final run that closes the Fort Week, so its failure also goes to the Council addresses.

The mail goes out over Gmail SMTP with an app password. In the repo's `.env`:

```
FORT_READER_GMAIL=<the Gmail address that sends the alert>
FORT_READER_GMAIL_APP_PASSWORD=<its 16-letter app password>
FORT_READER_ALERT_TO=<Petras's address>
FORT_READER_ALERT_COUNCIL=<Council addresses, comma-separated>
```

Without the first three, the reader runs as before and prints the failure only. The Council addresses live here because Council emails in the database are private and the reader's sign-in can't read them.

**Create the app password.** The sending Gmail account needs 2-Step Verification on. Signed in as that account, open https://myaccount.google.com/apppasswords, name it `fort-reader` and copy the 16 letters into `FORT_READER_GMAIL_APP_PASSWORD`. Google shows it once. It goes only in `.env`, never in the repo or a chat.

**Revoke or rotate it.** On the same page, delete `fort-reader`; the next failed run then prints `Couldn't email the failure` and carries on. To rotate, create a new one, put it in `.env`, then delete the old one. Turning off 2-Step Verification or changing the account password also revokes every app password.

## The nightly run on the server

On the Oracle A1 `fort-reader` (ADR 0003; its address is in `.scratch/fort-reader/oracle-vm.md`, never in this repo), a systemd timer starts one run a day at 23:45 UTC: `host/run.sh` starts the `redroid` Android container, runs `fort_reader.py --send`, and systemd stops the container afterwards, whatever happened. Each reading sets the Live Week's completeness from its day: a reading taken on the week's Sunday (UTC) closes it Complete, any earlier one leaves it Partial. So when Sunday's run fails, or the host is down, the week keeps its last reading and is saved as Partial, and the failure email reaches Petras and the Council addresses. A failed weekday run only leaves a stale "as of" time. The site shows the Partial tag only once the week has closed.

**Move the run time.** Set `FORT_READER_RUN_AT=HH:MM` (UTC) in `.env` and run `tools/fort-reader/host/install.sh` again; it prints the next run. Keep it late on Sunday but early enough to send before 00:00 UTC: a run takes about 10 minutes, and a reading sent after the reset is refused. A run missed while the host was off is not made up later.

**Watch a run.** `journalctl -u fort-reader -n 100` shows the last run's output; `systemctl list-timers fort-reader.timer` the next one. To run one now: `sudo systemctl start fort-reader`. Screenshots stay under `tools/fort-reader/runs/`.

### Setup (once)

1. Docker and Android: `sudo apt install docker.io adb`, add the user to the `docker` group, load `binder_linux` at boot (`/etc/modules-load.d/redroid.conf`) and mount binderfs at `/dev/binderfs` from fstab, as ticket 03 records. Create the container once; `run.sh` only starts and stops it:

   ```
   docker run -d --name redroid --privileged -v /opt/redroid/data:/data -p 127.0.0.1:5555:5555 \
     redroid/redroid:13.0.0_64only-latest androidboot.redroid_width=1600 androidboot.redroid_height=900 \
     androidboot.redroid_dpi=450 androidboot.redroid_gpu_mode=guest androidboot.use_memfd=true
   docker stop redroid
   ```

   ADB listens on the host's loopback only. `/opt/redroid/data` keeps the game and the login between runs.
2. The code: `git clone` this repo into the user's home, then `cd tools/fort-reader && python3 -m venv .venv && .venv/bin/pip install -r requirements.txt`.
3. The secrets, in the repo's `.env` on the host only (`install.sh` makes it readable by this user alone):

   ```
   ANTHROPIC_API_KEY=<a key made for this host>
   FORT_READER_EMAIL=<the reader's Supabase sign-in>
   FORT_READER_PASSWORD=<its password>
   FORT_READER_GMAIL=<the four mail settings, see "Email when a run fails">
   FORT_READER_GMAIL_APP_PASSWORD=...
   FORT_READER_ALERT_TO=...
   FORT_READER_ALERT_COUNCIL=...
   FORT_READER_ADB=127.0.0.1:5555
   FORT_READER_MIN_SWIPE_MS=4000
   FORT_READER_RUN_AT=23:45
   ```

   `FORT_READER_MIN_SWIPE_MS` stretches every swipe to at least 4 s: Redroid on the A1 ignores quicker ones.
4. Install the timer: `tools/fort-reader/host/install.sh`.
5. Close the game in BlueStacks at home, then log the Reader Account in once (below). The account must be open in one place only, or the game shows "Login failed, REGISTER_AND_LOGING".

**Code updates.** After a reader change merges, `git pull` on the host by hand. Nothing pulls before a run.

### Log in once over scrcpy

From the home PC, tunnel ADB and drive the container's screen:

```
ssh -L 5555:127.0.0.1:5555 <the host>
docker start redroid
```

Then on the PC, in a second terminal: `adb connect 127.0.0.1:5555` and `scrcpy -s 127.0.0.1:5555`. Start the game (`adb shell am start -n com.lilithgame.roc.gp/com.harry.engine.MainActivity`; it is not in the launcher), log in with the Reader Account's Lilith email and password, wait for the city, then `docker stop redroid` on the host. Do the same when a run stopped on **login**.

### Install a game update by hand

Redroid has no Play Store. When a run stops on **update**, download the new version's universal bundle from APKMirror (Lilith offers no APK), unzip the `.apkm`, copy `base.apk`, `split_RawAssets.apk` and `split_config.arm64_v8a.apk` to the host, and with the container running:

```
adb -s 127.0.0.1:5555 install-multiple -r base.apk split_config.arm64_v8a.apk split_RawAssets.apk
```

It should print `Success`. Then `docker stop redroid`; the next run carries on. The reader itself never downloads an APK.

### Rotate a secret

Each one lives only in the host's `.env`. Put the new value there; the next run uses it.

- **Anthropic key.** In the Anthropic Console, in a workspace with a low monthly spend limit, create a key named `fort-reader host`, put it in `ANTHROPIC_API_KEY`, then delete the old key. A leaked key can spend only up to that limit.
- **The reader's Supabase sign-in.** In the Supabase dashboard, Authentication > Users, give the reader's user a new password and put it in `FORT_READER_PASSWORD`. To replace the user itself, add the new email to `fort_reader`, remove the old one and delete the old user. Whoever holds it can only rewrite the Live Week (ADR 0002).
- **Gmail app password.** See "Revoke or rotate it" above.
- **Council addresses.** Edit `FORT_READER_ALERT_COUNCIL`.

## What it checks

Rows from overlapping screens are joined by rank. The run lists problems instead of guessing: ranks with gaps, a Fort Count read two different ways, a Fort Count that rises down the list, or your pinned row disagreeing with the list. A name read two ways with one Fort Count (names in odd scripts, such as `CƦУ㋾`, read differently per screen) is not a problem: the row is kept and sent flagged, so the database leaves it "needs ID" and never matches it by either spelling. Names are copied as read; the admin page matches them against Name History and flags the rest "needs ID".

Swiping the game from a script is automation, which Lilith's terms forbid. Run it on an account you can afford to lose.

Tests: `.venv\Scripts\python.exe -m unittest test_merge test_game test_navigate test_alert`
