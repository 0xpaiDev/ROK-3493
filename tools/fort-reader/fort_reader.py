"""Read the in-game Fort Destroyer Rankings into Fort Week paste text.

With Rise of Kingdoms in BlueStacks, or on the device FORT_READER_ADB names, run:
    .venv\\Scripts\\python.exe fort_reader.py
It restarts the game, taps through to the Fort Destroyer Rankings, swipes the list to the end over ADB, reads every screen with Claude Haiku, and prints the
rows for the admin page's Fort Week paste (also copied to the clipboard on Windows). The PC's mouse is not
used, so you can keep working while it runs.

    fort_reader.py --from runs\\<folder>   re-reads screenshots saved by an earlier run
    fort_reader.py --send                 also sends the reading to the public site as the Live Week,
                                          only when the run found no problems
"""
import argparse
import datetime
import os
import shutil
import subprocess
import sys
import time
from pathlib import Path

import anthropic

from PIL import Image

from merge import check_pinned, merge_frames, paste_text

HERE = Path(__file__).resolve().parent
SWIPE = (0.80, 0.40)  # each step drags the list up ~3.5 of its ~6 visible rows: 2+ rows overlap,
                      # so a row cut off at the edge of one screen is whole on the next
MAX_SCREENS = 40


def load_env():
    env = HERE.parent.parent / ".env"
    if env.exists():
        for line in env.read_text(encoding="utf-8").splitlines():
            key, sep, value = line.partition("=")
            if sep and not key.strip().startswith("#"):
                os.environ.setdefault(key.strip(), value.strip().strip('"'))


class Navigator:
    """The device as navigate.open_ranking sees it: each look screenshots the device and has
    Haiku name the screen. The last screenshot is kept for a stopped run."""

    def __init__(self, device, client):
        from read import name_screen
        self.device, self.client, self.name_screen = device, client, name_screen
        self.shot = None

    def look(self):
        self.shot = self.device.screenshot()
        screen = self.name_screen(self.client, self.shot)
        print(f"  {time.strftime('%H:%M:%S')} {screen}")
        return screen

    def tap(self, x, y):
        self.device.tap(x, y)

    def wait(self, seconds):
        time.sleep(seconds)

    def now(self):
        return time.monotonic()


def stopped(run_dir, shot, screen, reason):
    """End the run, keeping the screen it stopped on as stopped-<screen>.png."""
    path = run_dir / f"stopped-{screen}.png"
    if shot is not None:
        shot.save(path)
    raise SystemExit(f"Stopped on the {screen} screen: {reason}\n"
                     f"Screenshot: {path if shot is not None else 'none taken'}. Nothing was sent.")


def open_from_closed(run_dir, device, client):
    """Restart the game and tap through to the Fort Destroyer Rankings. A screen that needs
    Petras (a login, an app update, a download past its limit, a screen it doesn't know) ends
    the run with its name and a saved screenshot, before anything is read or sent."""
    from navigate import Stopped, open_ranking

    limit = float(os.environ.get("FORT_READER_LOADING_LIMIT", "600"))
    print("Restarting the game and opening the Fort Destroyer Rankings:")
    device.restart_game()
    time.sleep(5)  # the game takes a moment to come to the front: until then the launcher shows
    nav = Navigator(device, client)
    try:
        open_ranking(nav, loading_limit=limit)
    except Stopped as stop:
        stopped(run_dir, nav.shot, stop.screen, stop.reason)
    except (anthropic.APIError, subprocess.SubprocessError) as e:
        # No network for Haiku, or ADB lost the device: the last screen seen is still worth keeping.
        stopped(run_dir, nav.shot, "last", f"the run failed while opening the ranking ({e}).")
    time.sleep(2)  # let the list draw before the first screenshot


def capture(run_dir, client, read_screen):
    import game

    device = game.Device()
    open_from_closed(run_dir, device, client)
    # Check before any swiping: a swipe over the map would pan it instead.
    shot = device.screenshot()
    if not read_screen(client, shot).is_fort_ranking:
        stopped(run_dir, shot, "fort_ranking", "the reader opened the Fort Destroyer Rankings, "
                "but the screen doesn't read as that panel.")
    # Back to the top: swipe down until the list stops moving.
    before = device.screenshot()
    for _ in range(MAX_SCREENS):
        device.swipe(0.35, 0.90, ms=400)
        after = device.screenshot()
        if not game.list_changed(before, after):
            break
        before = after
    shots, screens = [], []
    ended_without_zeros = False
    while len(shots) < MAX_SCREENS:
        shot = device.screenshot()
        if shots:
            for _ in range(3):  # a swipe is now and then ignored: retry before calling it the end
                device.swipe(*SWIPE)
                shot = device.screenshot()
                if game.list_changed(shots[-1], shot):
                    break
            else:
                ended_without_zeros = True
                break  # the list stopped moving: we're at the end
        screen = read_screen(client, shot)
        for _ in range(3):  # the first screen must show rank 1; the list can stop short of the top
            if shots or any(r.rank == 1 for r in screen.rows):
                break
            device.swipe(0.35, 0.90, ms=600)
            time.sleep(1)
            shot = device.screenshot()
            screen = read_screen(client, shot)
        shot.save(run_dir / f"screen-{len(shots) + 1:02d}.png")
        shots.append(shot)
        screens.append(screen)
        print(f"  screen {len(shots)} read", end="\r")
        # Sorted by Fort Count, so once 0s show up everyone below has 0 too. Two of them, not one:
        # a cut-off row at the bottom edge is sometimes misread as 0.
        if sum(r.forts == 0 for r in screens[-1].rows) >= 2:
            break
    else:
        print(f"Stopped at the {MAX_SCREENS}-screen limit before the list ended.")
        screens.append("limit")  # tells main() the ranking may continue
    if ended_without_zeros:
        screens.append("no-zeros")
    print(f"Captured and read {len(shots)} screens.")
    return screens


def copy_to_clipboard(text):
    """Copy to the Windows clipboard; returns False where there is none (Linux, a server)."""
    if not shutil.which("clip"):
        return False
    subprocess.run("clip", input=("﻿" + text).encode("utf-16-le"), check=False)
    return True


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--from", dest="source", help="folder of screenshots from an earlier run")
    ap.add_argument("--send", action="store_true", help="send the reading to Supabase as the Live Week")
    args = ap.parse_args()

    load_env()
    started_at = datetime.datetime.now(datetime.timezone.utc)
    run_dir = Path(args.source) if args.source else HERE / "runs" / started_at.strftime("%Y-%m-%d_%H%M%S")
    failure = None
    try:
        run(args, run_dir)
    except KeyboardInterrupt:
        raise  # stopped by hand: nobody to tell
    except SystemExit as e:
        if e.code not in (None, 0):
            failure = str(e.code)
        raise
    except Exception as e:
        failure = f"The reader crashed: {type(e).__name__}: {e}"
        raise
    finally:
        if args.send:  # the scheduled run: nobody is watching the console
            alert_after_run(failure, run_dir, started_at)


def alert_after_run(failure, run_dir, started_at):
    """Email the failure with the newest screenshot of the run (stopped-<screen>.png when the
    run stopped on a screen). A failed email is printed, never raised over the run's own failure."""
    import smtplib
    from alert import MAIL_SETTINGS, after_run
    if failure and not all(os.environ.get(k) for k in MAIL_SETTINGS):
        print("No mail settings in .env, so nobody was emailed about this failure.")
        return
    shots = sorted(run_dir.glob("*.png"), key=lambda p: p.stat().st_mtime) if run_dir.is_dir() else []
    try:
        after_run(failure, shots[-1] if shots else None, os.environ, started_at)
    except (smtplib.SMTPException, OSError) as e:
        print(f"Couldn't email the failure: {e}")
        return
    if failure:
        print("Emailed the failure" + (", Council included (Sunday's final run)." if started_at.weekday() == 6 else "."))


def run(args, run_dir):
    from read import make_client, read_screen
    client = make_client()

    if args.source:
        shots = [Image.open(p) for p in sorted(run_dir.glob("screen-*.png"))]
        if not shots:
            raise SystemExit(f"No screen-*.png files in {run_dir}.")
        screens = []
        for i, shot in enumerate(shots, start=1):
            print(f"  reading screen {i}/{len(shots)}", end="\r")
            screens.append(read_screen(client, shot))
    else:
        run_dir.mkdir(parents=True)
        screens = capture(run_dir, client, read_screen)

    flags = [s for s in screens if isinstance(s, str)]
    screens = [s for s in screens if not isinstance(s, str)]
    # A Complete Week leaves out 0-fort Governors: anyone missing from it had 0.
    frames = [[r.model_dump() for r in s.rows if r.forts > 0] for s in screens if s.is_fort_ranking]
    pinned = next((s.pinned.model_dump() for s in screens if s.pinned), None)
    if pinned and pinned["forts"] == 0:
        pinned = None

    rows, problems = merge_frames(frames)
    problems += check_pinned(pinned, rows)
    if "limit" in flags:
        problems.insert(0, f"The run hit the {MAX_SCREENS}-screen limit: Governors below rank {len(rows)} may be missing.")
    if "no-zeros" in flags:
        problems.insert(0, f"The list stopped moving before any 0-fort Governors showed up: check that rank {len(rows)} is really the last.")
    text = paste_text(rows)
    (run_dir / "paste.txt").write_text(text, encoding="utf-8")
    copied = "Copied to the clipboard and saved" if copy_to_clipboard(text) else "Saved"

    print(f"\n{len(rows)} Governors read. {copied} to {run_dir / 'paste.txt'}.\n")
    print(text)
    unsure = [r for r in rows if r.get("needs_id")]
    if unsure:
        print("Read two ways, so sent as \"needs ID\" for the Council to resolve: "
              + ", ".join(f'rank {r["rank"]} ({r["name"]})' for r in unsure) + ".")
    if problems:
        print("Check these before saving the Fort Week:")
        for p in problems:
            print("  -", p)
    else:
        print("No problems found: ranks run 1 to", len(rows), "with no gaps.")

    if args.send:
        # A reading with problems is not sent: a stale "as of" time is better than a wrong ranking.
        if problems or not rows:
            found = "\n".join(f"  - {p}" for p in problems) if problems else "  - No Governors were read."
            raise SystemExit("Not sent to the Live Week: the run found problems. Fix them, or paste the "
                             f"week by hand once it closes.\n{found}")
        from send import send_live_week
        # The reading is as of its first screenshot, not of when it is sent: the database refuses
        # screenshots from a week that has closed, such as an old run read again with --from.
        first = min(run_dir.glob("screen-*.png"))
        read_at = datetime.datetime.fromtimestamp(first.stat().st_mtime, datetime.timezone.utc)
        result = send_live_week(rows, read_at)
        print(f"Sent to the Live Week: {result['rows']} rows, {result['matched']} matched, "
              f"{result['needs_id']} \"needs ID\".")


if __name__ == "__main__":
    main()
