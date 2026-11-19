"""Send a reading to Supabase as the Live Week (ADR 0002).

Signs in as the reader's own Supabase user (FORT_READER_EMAIL and FORT_READER_PASSWORD in the
repo's .env; never a Council member) and calls record_live_week with the reading and when its
screenshots were taken. The database matches names, takes the week from that time and refuses any
week but the Live Week; this side only sends what was read.
"""
import json
import os
import urllib.error
import urllib.request

# The same project and publishable key as site/store.js: safe to ship, it can only read.
SUPABASE_URL = "https://xjgswlqzdpmnhhnitucr.supabase.co"
SUPABASE_KEY = "sb_publishable_UZPl9wsrFKR7oV1YEAHBbg_AnqyQLSe"


def _post(path, body, token=None):
    req = urllib.request.Request(
        SUPABASE_URL + path, data=json.dumps(body).encode(), method="POST",
        headers={"apikey": SUPABASE_KEY, "Content-Type": "application/json",
                 "Authorization": f"Bearer {token or SUPABASE_KEY}"})
    try:
        with urllib.request.urlopen(req, timeout=30) as res:
            return json.loads(res.read() or b"null")
    except urllib.error.HTTPError as e:
        detail = e.read().decode(errors="replace")
        try:
            detail = json.loads(detail).get("message") or json.loads(detail).get("msg") or detail
        except (ValueError, AttributeError):
            pass
        raise SystemExit(f"Supabase refused {path.split('?')[0]}: {e.code} {detail}")


def send_live_week(rows, read_at):
    """rows: the merged reading, each {rank, name, forts, names?}; read_at: when its first screenshot
    was taken (an aware datetime). Returns {rows, matched, needs_id}.
    A row read two ways is sent with every spelling (names); it matches only when they lead to one Governor."""
    email, password = os.environ.get("FORT_READER_EMAIL"), os.environ.get("FORT_READER_PASSWORD")
    if not email or not password:
        raise SystemExit("Add FORT_READER_EMAIL and FORT_READER_PASSWORD (the reader's Supabase sign-in) to .env.")
    token = _post("/auth/v1/token?grant_type=password", {"email": email, "password": password})["access_token"]
    entries = [{"rank": r["rank"], "name": r["name"], "fort_count": r["forts"],
                **({"names": r["names"]} if r.get("names") else {})} for r in rows]
    return _post("/rest/v1/rpc/record_live_week", {"read_at": read_at.isoformat(), "entries": entries}, token)


def _sign_in():
    email, password = os.environ.get("FORT_READER_EMAIL"), os.environ.get("FORT_READER_PASSWORD")
    if not email or not password:
        raise SystemExit("Add FORT_READER_EMAIL and FORT_READER_PASSWORD (the reader's Supabase sign-in) to .env.")
    return _post("/auth/v1/token?grant_type=password", {"email": email, "password": password})["access_token"]


def send_roster_snapshot(taken_on, rows):
    """Saves one day's Lilith stats as a Roster Snapshot (ADR 0004), signed in as the reader.
    taken_on: an ISO date; rows: [{id, name, power, highest_power, kill_points, resources_gathered,
    alliance_helps, t4_kills, t5_kills, t4_deaths, t5_deaths}]. Returns {saved, taken_on, ...}; saved is
    false when that day is already saved, and then filled counts the rows whose null T4/T5 values it filled."""
    return _post("/rest/v1/rpc/record_roster_snapshot", {"taken_on": taken_on, "rows": rows}, _sign_in())


def roster_days_missing(since):
    """The days from since (an ISO date) on, oldest first, that have no Roster Snapshot although days
    before and after them do: the nights the Roster job missed, as ISO dates."""
    return _post("/rest/v1/rpc/roster_days_missing", {"since": since}, _sign_in())


def roster_days_without_t4_t5(since):
    """The saved days from since (an ISO date) on, oldest first, with no T4/T5 values yet, as ISO dates."""
    return _post("/rest/v1/rpc/roster_days_without_t4_t5", {"since": since}, _sign_in())
