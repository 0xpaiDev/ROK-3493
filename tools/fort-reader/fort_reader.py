"""Read the in-game Fort Destroyer Rankings into Fort Week paste text.

Open the ranking in Rise of Kingdoms running in BlueStacks, then run:
    .venv\\Scripts\\python.exe fort_reader.py
It swipes the list to the end over ADB, reads every screen with Claude Haiku, and prints the
rows for the admin page's Fort Week paste (also copied to the clipboard). The PC's mouse is not
used, so you can keep working while it runs.

    fort_reader.py --from runs\\<folder>   re-reads screenshots saved by an earlier run
    fort_reader.py --send                 also sends the reading to the public site as the Live Week,
                                          only when the run found no problems
"""
import argparse
import os
import subprocess
import sys
import time
from pathlib import Path

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


def capture(run_dir, client, read_screen):
    import game

    device = game.Device()
    # Check before any swiping: a swipe over the map would pan it instead.
    if not read_screen(client, device.screenshot()).is_fort_ranking:
        raise SystemExit("The Fort Destroyer Rankings panel isn't open in BlueStacks. Open it and run again.")
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
    subprocess.run("clip", input=("﻿" + text).encode("utf-16-le"), check=False)


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--from", dest="source", help="folder of screenshots from an earlier run")
    ap.add_argument("--send", action="store_true", help="send the reading to Supabase as the Live Week")
    args = ap.parse_args()

    load_env()
    from read import make_client, read_screen
    client = make_client()

    if args.source:
        run_dir = Path(args.source)
        shots = [Image.open(p) for p in sorted(run_dir.glob("screen-*.png"))]
        if not shots:
            raise SystemExit(f"No screen-*.png files in {run_dir}.")
        screens = []
        for i, shot in enumerate(shots, start=1):
            print(f"  reading screen {i}/{len(shots)}", end="\r")
            screens.append(read_screen(client, shot))
    else:
        run_dir = HERE / "runs" / time.strftime("%Y-%m-%d_%H%M%S")
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
    copy_to_clipboard(text)

    print(f"\n{len(rows)} Governors read. Copied to the clipboard and saved to {run_dir / 'paste.txt'}.\n")
    print(text)
    if problems:
        print("Check these before saving the Fort Week:")
        for p in problems:
            print("  -", p)
    else:
        print("No problems found: ranks run 1 to", len(rows), "with no gaps.")

    if args.send:
        # A reading with problems is not sent: a stale "as of" time is better than a wrong ranking.
        if problems or not rows:
            raise SystemExit("Not sent to the Live Week: fix the problems above, or paste the week by hand once it closes.")
        from send import send_live_week
        result = send_live_week(rows)
        print(f"Sent to the Live Week: {result['rows']} rows, {result['matched']} matched, "
              f"{result['needs_id']} \"needs ID\".")


if __name__ == "__main__":
    main()
