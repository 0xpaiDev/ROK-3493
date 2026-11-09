"""record_live_week in Postgres, run against the Supabase database inside a transaction that is
always rolled back, so nothing it writes survives.

Each test applies the Live Week migration in its own transaction first, so the tests run before and
after the migration reaches the database. Needs psycopg and SUPABASE_DB_URL (the repo's .env):
    py -m pip install --target <dir> "psycopg[binary]"
    set PYTHONPATH=<dir> && py -m unittest discover -s supabase/tests
"""
import json
import os
import re
import sys
import unittest
import uuid
from pathlib import Path

import psycopg

ROOT = Path(__file__).resolve().parents[2]
MIGRATION = ROOT / "supabase" / "migrations" / "20261109120000_live_week_reading.sql"
CASES = json.loads((ROOT / "tests" / "name-matching-cases.json").read_text(encoding="utf-8"))["cases"]


def db_url():
    if os.environ.get("SUPABASE_DB_URL"):
        return os.environ["SUPABASE_DB_URL"]
    env = (ROOT / ".env").read_text(encoding="utf-8")
    m = re.search(r'^\s*SUPABASE_DB_URL\s*=\s*"?([^"\n]+)"?', env, re.M)
    if not m:
        raise SystemExit("SUPABASE_DB_URL is not in the environment or .env.")
    return m.group(1).strip()


class LiveWeekReading(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        sys.stdout.reconfigure(encoding="utf-8")
        cls.conn = psycopg.connect(db_url())

    @classmethod
    def tearDownClass(cls):
        cls.conn.close()

    def setUp(self):
        self.conn.rollback()
        self.conn.execute(MIGRATION.read_text(encoding="utf-8"))
        self.live = self.one("select date_trunc('week', now() at time zone 'utc')::date")
        self.reader = self.user("reader-test@example.invalid")
        self.conn.execute("insert into fort_reader (email) values ('reader-test@example.invalid')")

    def tearDown(self):
        self.conn.rollback()

    # ---- helpers ----

    def one(self, sql, args=()):
        return self.conn.execute(sql, args).fetchone()[0]

    def user(self, email, confirmed=True):
        uid = str(uuid.uuid4())
        self.conn.execute(
            "insert into auth.users (id, email, email_confirmed_at, aud, role) values (%s, %s, %s, 'authenticated', 'authenticated')",
            (uid, email, "now()" if confirmed else None))
        return {"sub": uid, "email": email, "role": "authenticated"}

    def as_user(self, claims):
        self.conn.execute("set local role authenticated")
        self.conn.execute("select set_config('request.jwt.claims', %s, true)", (json.dumps(claims),))

    def as_owner(self):
        self.conn.execute("reset role")

    def governors(self, governors, name_history=()):
        for g in governors:
            self.conn.execute("insert into governor (character_id, current_name) values (%s, %s)", (g["id"], g["name"]))
        for n in name_history:
            self.conn.execute("insert into governor_name (character_id, name) values (%s, %s)", (n["id"], n["name"]))

    def record(self, rows, week=None, claims=None):
        """Calls record_live_week as the reader (or claims), with rows in in-game order."""
        self.as_user(claims or self.reader)
        entries = [{"rank": i + 1, "name": r["name"], "fort_count": r["fortCount"]} for i, r in enumerate(rows)]
        # On an error the caller rolls back to a savepoint, which also undoes the role.
        result = self.one("select record_live_week(%s::date, %s::jsonb)", (week or self.live, json.dumps(entries)))
        self.as_owner()
        return result

    def public_week(self, week=None):
        """The Live Week's entries as the public site reads them, in ranking order."""
        self.conn.execute("set local role anon")
        rows = self.conn.execute(
            "select character_id, name, fort_count from fort_entry where week = %s order by fort_count desc, tie_order, id",
            (week or self.live,)).fetchall()
        self.as_owner()
        return rows

    # ---- tests ----

    def test_shared_matching_cases(self):
        for c in CASES:
            with self.subTest(c["case"]):
                self.conn.execute("savepoint case_start")
                try:
                    self.governors(c["governors"], c["nameHistory"])
                    self.record(c["rows"])
                    self.assertEqual([r[0] for r in self.public_week()], c["ids"])
                finally:
                    self.conn.execute("rollback to savepoint case_start")

    def test_only_the_readers_sign_in_may_record_the_live_week(self):
        council = self.user("council-test@example.invalid")
        self.conn.execute("insert into council_member (email) values ('council-test@example.invalid')")
        self.conn.execute("insert into fort_reader (email) values ('unconfirmed-test@example.invalid')")
        callers = {
            "anonymous visitor": None,
            "Council member": council,
            "signed-in stranger": self.user("stranger-test@example.invalid"),
            "reader email not confirmed": self.user("unconfirmed-test@example.invalid", confirmed=False),
        }
        rows = [{"name": "Case Anyone", "fortCount": 3}]
        for who, claims in callers.items():
            with self.subTest(who):
                self.conn.execute("savepoint call")
                try:
                    with self.assertRaises(psycopg.errors.InsufficientPrivilege):
                        if claims is None:
                            self.conn.execute("set local role anon")
                            self.conn.execute("select record_live_week(%s::date, '[]'::jsonb)", (self.live,))
                        else:
                            self.record(rows, claims=claims)
                finally:
                    self.conn.execute("rollback to savepoint call")
        self.assertEqual(self.public_week(), [])

    def test_a_week_other_than_the_live_week_is_refused(self):
        for label, days in {"last week": -7, "next week": 7}.items():
            week = self.one("select %s::date + %s", (self.live, days))
            with self.subTest(label):
                before = self.public_week(week)
                self.conn.execute("savepoint call")
                try:
                    with self.assertRaisesRegex(psycopg.errors.InvalidParameterValue, "not the Live Week"):
                        self.record([{"name": "Case Anyone", "fortCount": 3}], week=week)
                finally:
                    self.conn.execute("rollback to savepoint call")
                self.assertEqual(self.public_week(week), before)


    def test_a_reading_leaves_name_history_and_governors_untouched(self):
        self.governors([{"id": "990000011", "name": "Case Known"}], [{"id": "990000011", "name": "Case Before"}])
        tables = "select md5(string_agg(t::text, '|' order by t::text)) from {} t"
        before = [self.one(tables.format(t)) for t in ("governor", "governor_name")]
        self.record([{"name": "Case Before", "fortCount": 9}, {"name": "Case Unknown", "fortCount": 4}])
        self.assertEqual([self.one(tables.format(t)) for t in ("governor", "governor_name")], before)

    def test_two_rows_whose_names_belong_to_one_governor_both_stay_needs_id(self):
        # A Governor renamed and another who took the old name: both names lead to one Character ID.
        self.governors([{"id": "990000012", "name": "Case Now"}], [{"id": "990000012", "name": "Case Then"}])
        self.record([{"name": "Case Now", "fortCount": 9}, {"name": "Case Then", "fortCount": 4}])
        self.assertEqual(self.public_week(), [(None, "Case Now", 9), (None, "Case Then", 4)])

    def test_the_next_reading_replaces_the_last_and_matches_a_name_the_council_resolved(self):
        self.governors([{"id": "990000013", "name": "Case Real"}])
        self.record([{"name": "Case Odd", "fortCount": 5}, {"name": "Case Gone", "fortCount": 2}])
        # The Council picks Case Real for the "needs ID" row; the pick goes into Name History.
        self.conn.execute("insert into governor_name (character_id, name) values ('990000013', 'Case Odd')")
        self.record([{"name": "Case Odd", "fortCount": 8}])
        self.assertEqual(self.public_week(), [("990000013", "Case Odd", 8)])

    def test_a_reading_stamps_the_live_weeks_as_of_time(self):
        self.record([{"name": "Case Anyone", "fortCount": 3}])
        self.conn.execute("set local role anon")
        read_at, now = self.conn.execute("select read_at, now() from fort_week where starts_on = %s", (self.live,)).fetchone()
        self.assertEqual(read_at, now)

if __name__ == "__main__":
    unittest.main()
