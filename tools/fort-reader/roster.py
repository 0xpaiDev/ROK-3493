"""The daily Roster Snapshot (ADR 0004): fetch the newest day of the Lilith stats export (its JSON) and
save it through record_roster_snapshot, which applies the same rules as the admin page's upload.

    .venv/bin/python roster.py              fetch the newest day and save it
    .venv/bin/python roster.py --dry-run    fetch and print, save nothing
    .venv/bin/python roster.py --day 2026-11-14

Lilith's stats tools sign in with a token (a JWT, valid 30 days) that the RoK Toolkit site keeps
after a login. It goes in LILITH_PAUTH in the repo's .env. Saving uses the reader's own Supabase
sign-in (FORT_READER_EMAIL, FORT_READER_PASSWORD). A run that saves nothing new is not a failure:
Lilith publishes each day late, so asking again for a saved day is normal.

A failure, a token close to expiry and Lilith data gone stale each email FORT_READER_ALERT_TO
(alert.py's mail settings); without them they only print.
"""
import argparse
import base64
import datetime
import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

from alert import mail
from send import send_roster_snapshot

HERE = Path(__file__).resolve().parent
API = "https://plat-rok-gametools-global-api.lilithgames.com"
# Lilith's internal server id for Kingdom 3493 (the game shows 3493; the API wants 2493).
SERVER_ID = "2493"
WARN_DAYS = 5     # email when the token has fewer days left than this
STALE_DAYS = 3    # email when Lilith's newest day is this many days old or more
# The API's field for each roster_snapshot_row column. Deaths and per-tier kills are not kept.
FIELDS = {"power": "power", "highest_power": "max_power", "kill_points": "kill",
          "resources_gathered": "collect", "alliance_helps": "help"}


class RosterError(Exception):
    """A run that can't save, with a sentence that says what to do."""


def load_env():
    env = HERE.parent.parent / ".env"
    if env.exists():
        for line in env.read_text(encoding="utf-8").splitlines():
            key, sep, value = line.partition("=")
            if sep and not key.strip().startswith("#"):
                os.environ.setdefault(key.strip(), value.strip().strip('"'))


def token_expiry(token):
    """When the Lilith token expires (aware datetime), read from its JWT payload without checking it."""
    try:
        payload = token.split(".")[1]
        claims = json.loads(base64.urlsafe_b64decode(payload + "=" * (-len(payload) % 4)))
        return datetime.datetime.fromtimestamp(claims["exp"], datetime.timezone.utc)
    except (IndexError, ValueError, KeyError, TypeError):
        raise RosterError("LILITH_PAUTH in .env is not a Lilith token. Copy it again (README: Roster Snapshot).")


def get(path, params, token, opener=urllib.request.urlopen):
    req = urllib.request.Request(
        f"{API}{path}?{urllib.parse.urlencode(params)}",
        headers={"Authorization": f"Bearer {token}", "Lang": "en_US", "version": "1.0",
                 "Accept": "application/json", "User-Agent": "Mozilla/5.0 (roster job)"})
    try:
        with opener(req, timeout=60) as res:
            body = json.loads(res.read())
    except urllib.error.HTTPError as e:
        if e.code == 401:
            raise RosterError("Lilith refused the token (401). It expired or was signed out: put a new one in LILITH_PAUTH.")
        raise RosterError(f"Lilith answered {path} with HTTP {e.code}.")
    except urllib.error.URLError as e:
        raise RosterError(f"Couldn't reach Lilith's API: {e.reason}.")
    if body.get("code") != 200 or body.get("msg") != "OK":
        raise RosterError(f"Lilith answered {path} with code {body.get('code')}: {body.get('msg')}.")
    return body


def newest_day(token, opener=urllib.request.urlopen):
    """The newest day Lilith has stats for, as an ISO date."""
    day = get("/api/kindomInformation", {"server_id": SERVER_ID}, token, opener)["data"].get("day")
    try:
        return datetime.date.fromisoformat(day).isoformat()
    except (TypeError, ValueError):
        raise RosterError(f"Lilith's newest day is {day!r}, not a date.")


def fetch_rows(day, token, opener=urllib.request.urlopen):
    """One day of the Lilith stats export as roster_snapshot_row values, Character ID as text."""
    body = get("/api/kindomMember", {"start": day, "end": day, "search": "", "server_id": SERVER_ID}, token, opener)
    data = body.get("data") or []
    if not data:
        raise RosterError(f"Lilith has no member data for {day}.")
    if body.get("total") not in (None, len(data)):
        raise RosterError(f"Lilith sent {len(data)} of {body['total']} Governors for {day}; the rest would read as Inactive.")
    rows = []
    for m in data:
        # A null must read as missing, never as the text "None": that would rename a Governor.
        row = {"id": str(m.get("id") or "").strip(), "name": str(m.get("name") or "").strip()}
        for column, field in FIELDS.items():
            value = m.get(field)
            if value is not None and not (isinstance(value, int) and value >= 0):
                raise RosterError(f"Governor {row['id']}: {field} is {value!r}, not a whole number.")
            row[column] = value
        rows.append(row)
    return rows


def run(args, now, opener=urllib.request.urlopen, send=send_roster_snapshot, notify=None):
    """One run. Returns the lines to print. notify(subject, body) emails."""
    notify = notify or (lambda subject, body: mail(subject, body, os.environ))
    lines = []

    def note(subject, body, fact, sent):
        # A reminder that can't be mailed must neither stop the save nor make a saved run look failed.
        try:
            notify(subject, body)
            lines.append(f"{fact}; {sent}.")
        except Exception as e:
            lines.append(f"{fact}; couldn't email it: {e}")

    token = os.environ.get("LILITH_PAUTH", "").strip()
    if not token:
        raise RosterError("Add LILITH_PAUTH (the RoK Toolkit's login token) to .env.")
    expires = token_expiry(token)
    if expires <= now:
        raise RosterError(f"The Lilith token expired on {expires:%Y-%m-%d}: put a new one in LILITH_PAUTH.")
    left = expires - now
    if left < datetime.timedelta(days=WARN_DAYS):
        note(f"Roster job: the Lilith token expires {expires:%Y-%m-%d}",
             f"The token in LILITH_PAUTH stops working on {expires:%Y-%m-%d %H:%M} UTC. Log in to the RoK Toolkit, "
             f"copy a new one into .env on the host (README: Roster Snapshot), or the daily Roster Snapshot stops.",
             f"Token expires {expires:%Y-%m-%d %H:%M} UTC", "emailed a reminder")

    day = args.day or newest_day(token, opener)
    age = (now.date() - datetime.date.fromisoformat(day)).days
    rows = fetch_rows(day, token, opener)
    lines.append(f"Lilith has {len(rows)} Governors for {day}.")
    if args.dry_run:
        lines.append("Dry run: nothing saved.")
        return lines
    result = send(day, rows)
    if result.get("saved"):
        lines.append(f"Saved the {day} Roster Snapshot: {result['rows']} Governors, {result['new_governors']} new, "
                     f"{result['renamed']} renamed, {result['inactive']} became Inactive, {result['current']} back to Current.")
    else:
        lines.append(f"Nothing new: the latest Roster Snapshot is already {result.get('latest')}.")
    if not args.day and age >= STALE_DAYS:
        note(f"Roster job: Lilith's newest stats are from {day}",
             f"Lilith's stats tools still have nothing newer than {day} ({age} days ago), so the roster isn't moving. "
             f"Nothing is wrong on our side; it usually catches up by itself.",
             f"Lilith's newest day is {age} days old", "emailed a note")
    return lines


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    load_env()
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--dry-run", action="store_true", help="fetch and print, save nothing")
    parser.add_argument("--day", help="a day to fetch (YYYY-MM-DD) instead of Lilith's newest")
    args = parser.parse_args()
    now = datetime.datetime.now(datetime.timezone.utc)
    try:
        lines = run(args, now)
    except (Exception, SystemExit) as e:
        # A RosterError or a Supabase refusal says what to do; anything else is a crash, named by its type.
        reason = str(e) if isinstance(e, (RosterError, SystemExit)) else f"The job crashed: {type(e).__name__}: {e}"
        print(reason)
        if not args.dry_run:
            try:
                if mail(f"Roster job: {reason.splitlines()[0]}",
                        f"The run at {now:%Y-%m-%d %H:%M} UTC saved no Roster Snapshot.\n\n{reason}\n", os.environ):
                    print("Emailed the failure.")
            except Exception as m:  # the failure is printed already, and journalctl keeps it
                print(f"Couldn't email the failure: {m}")
        return 1
    print("\n".join(lines))
    return 0


if __name__ == "__main__":
    sys.exit(main())
