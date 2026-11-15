"""record_roster_snapshot in Postgres, run against the Supabase database inside a transaction that
is always rolled back, so nothing it writes survives.

Each test applies the reader and Roster Snapshot migrations in its own transaction and removes the
real snapshots first (the rollback puts them back), so the cases see only their own. Needs psycopg
and SUPABASE_DB_URL (the repo's .env):
    py -m pip install --target <dir> "psycopg[binary]"
    set PYTHONPATH=<dir> && py -m unittest discover -s supabase/tests
"""
import datetime
import json
import sys
import unittest
import uuid
from pathlib import Path

import psycopg

from test_record_live_week import db_url

ROOT = Path(__file__).resolve().parents[2]
MIGRATIONS = [ROOT / "supabase" / "migrations" / "20261109120000_live_week_reading.sql",  # is_reader, fort_reader
              ROOT / "supabase" / "migrations" / "20261117090000_reader_records_roster_snapshot.sql"]
CASES = json.loads((ROOT / "tests" / "roster-snapshot-cases.json").read_text(encoding="utf-8"))["cases"]


class RosterSnapshot(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        sys.stdout.reconfigure(encoding="utf-8")
        cls.conn = psycopg.connect(db_url())

    @classmethod
    def tearDownClass(cls):
        cls.conn.close()

    def setUp(self):
        self.conn.rollback()
        for m in MIGRATIONS:
            self.conn.execute(m.read_text(encoding="utf-8"))
        self.conn.execute("delete from roster_snapshot")
        self.reader = self.user("reader-test@example.invalid")
        self.conn.execute("insert into fort_reader (email) values ('reader-test@example.invalid') on conflict do nothing")

    def tearDown(self):
        self.conn.rollback()

    # ---- helpers ----

    def one(self, sql, args=()):
        return self.conn.execute(sql, args).fetchone()[0]

    def user(self, email):
        uid = str(uuid.uuid4())
        self.conn.execute(
            "insert into auth.users (id, email, email_confirmed_at, aud, role) values (%s, %s, now(), 'authenticated', 'authenticated')",
            (uid, email))
        return {"sub": uid, "email": email, "role": "authenticated"}

    def record(self, taken_on, rows, claims=None):
        self.conn.execute("set local role authenticated")
        self.conn.execute("select set_config('request.jwt.claims', %s, true)", (json.dumps(claims or self.reader),))
        result = self.one("select record_roster_snapshot(%s::date, %s::jsonb)", (taken_on, json.dumps(rows)))
        self.conn.execute("reset role")
        return result

    def setup_case(self, c):
        for g in c["governors"]:
            self.conn.execute(
                "insert into governor (character_id, current_name, status, status_set_by, status_set_at) values (%s, %s, %s, %s, %s)",
                (g["id"], g["name"], g.get("status", "current"), g.get("statusSetBy", "snapshot"), g.get("statusSetAt", "2020-01-01T00:00:00Z")))
        for n in c["nameHistory"]:
            self.conn.execute("insert into governor_name (character_id, name) values (%s, %s)", (n["id"], n["name"]))
        if c["previous"] is not None:
            day_before = datetime.date.fromisoformat(c["snapshot"]["takenOn"]) - datetime.timedelta(days=1)
            sid = self.one("insert into roster_snapshot (taken_on) values (%s) returning id", (day_before,))
            for p in c["previous"]:
                self.conn.execute("insert into roster_snapshot_row (snapshot_id, character_id, power) values (%s, %s, %s)", (sid, p["id"], p["power"]))

    def ids(self, c):
        return sorted({g["id"] for g in c["governors"]} | {r["id"] for r in c["snapshot"]["rows"]})

    def state(self, c):
        ids = self.ids(c)
        govs = {r[0]: r[1:] for r in self.conn.execute(
            "select character_id, current_name, status from governor where character_id = any(%s)", (ids,))}
        names = set(self.conn.execute(
            "select character_id, name from governor_name where character_id = any(%s)", (ids,)).fetchall())
        return govs, names

    # ---- tests ----

    def test_shared_roster_cases(self):
        for c in CASES:
            with self.subTest(c["case"]):
                self.conn.execute("savepoint case_start")
                try:
                    self.setup_case(c)
                    before, names_before = self.state(c)
                    result = self.record(c["snapshot"]["takenOn"], c["snapshot"]["rows"])
                    after, names_after = self.state(c)
                    self.assertTrue(result["saved"])
                    self.assertEqual(sorted([i, after[i][1]] for i in after if i in before and before[i][1] != after[i][1]), c["statusChanges"])
                    self.assertEqual(sorted([i, after[i][0]] for i in after if i not in before), c["newGovernors"])
                    self.assertEqual(sorted([i, after[i][0]] for i in after if i in before and before[i][0] != after[i][0]), c["renames"])
                    self.assertEqual(sorted(list(n) for n in names_after - names_before), c["newNames"])
                finally:
                    self.conn.execute("rollback to savepoint case_start")

    def test_the_snapshot_and_its_numbers_are_saved_under_the_reader(self):
        rows = [{"id": "1", "name": "Gov 1", "power": 900, "highest_power": 950, "kill_points": 7,
                 "resources_gathered": 8, "alliance_helps": 9}]
        result = self.record("2020-01-07", rows)
        self.assertEqual(result, {"saved": True, "taken_on": "2020-01-07", "rows": 1, "inactive": 0, "current": 0,
                                  "renamed": 0, "new_governors": 1, "new_names": 1})
        self.assertEqual(self.conn.execute(
            "select s.uploaded_by, r.power, r.highest_power, r.kill_points, r.resources_gathered, r.alliance_helps "
            "from roster_snapshot s join roster_snapshot_row r on r.snapshot_id = s.id where s.taken_on = '2020-01-07'").fetchall(),
            [("reader-test@example.invalid", 900, 950, 7, 8, 9)])

    def test_a_day_already_saved_changes_nothing(self):
        self.record("2020-01-07", [{"id": "1", "name": "Gov 1", "power": 900}])
        again = self.record("2020-01-07", [{"id": "1", "name": "Renamed", "power": 1}])
        older = self.record("2020-01-06", [{"id": "1", "name": "Renamed", "power": 1}])
        self.assertEqual([again["saved"], older["saved"], again["latest"]], [False, False, "2020-01-07"])
        self.assertEqual(self.one("select current_name from governor where character_id = '1'"), "Gov 1")

    def test_an_absent_governor_ranked_201st_is_not_marked_inactive(self):
        prev = [{"id": str(i), "name": f"Gov {i}", "power": 1000 - i} for i in range(1, 202)]  # "201" ranks 201st
        self.record("2020-01-06", prev)
        self.record("2020-01-07", [r for r in prev if r["id"] not in ("200", "201")])
        self.assertEqual(self.conn.execute(
            "select character_id, status from governor where character_id in ('200', '201') order by 1").fetchall(),
            [("200", "inactive"), ("201", "current")])

    def test_only_the_readers_sign_in_may_record(self):
        rows = [{"id": "1", "name": "Gov 1", "power": 900}]
        council = self.user("council-test@example.invalid")
        self.conn.execute("insert into council_member (email) values ('council-test@example.invalid')")
        for who in (council, self.user("someone@example.invalid")):
            self.conn.execute("savepoint call")
            try:
                with self.assertRaises(psycopg.errors.InsufficientPrivilege):
                    self.record("2020-01-07", rows, who)
            finally:
                self.conn.execute("rollback to savepoint call")
        self.conn.execute("savepoint call")
        try:
            self.conn.execute("set local role anon")
            with self.assertRaises(psycopg.errors.InsufficientPrivilege):
                self.conn.execute("select record_roster_snapshot('2020-01-07', %s::jsonb)", (json.dumps(rows),))
        finally:
            self.conn.execute("rollback to savepoint call")

    def test_bad_rows_are_refused_whole(self):
        for rows, message in [
            ([], "no rows"),
            ([{"id": "1", "name": "A"}, {"id": "1", "name": "B"}], "appears twice"),
            ([{"id": "x1", "name": "A"}], "numeric Character ID"),
            ([{"id": "1", "name": " "}], "numeric Character ID and a name"),
        ]:
            with self.subTest(message):
                self.conn.execute("savepoint call")
                try:
                    with self.assertRaisesRegex(psycopg.errors.InvalidParameterValue, message):
                        self.record("2026-01-07", rows)
                finally:
                    self.conn.execute("rollback to savepoint call")
                self.assertEqual(self.one("select count(*) from roster_snapshot"), 0)

    def test_a_day_in_the_future_is_refused(self):
        self.conn.execute("savepoint call")
        try:
            with self.assertRaisesRegex(psycopg.errors.InvalidParameterValue, "future"):
                self.record("2999-01-01", [{"id": "1", "name": "A"}])
        finally:
            self.conn.execute("rollback to savepoint call")


if __name__ == "__main__":
    unittest.main()
