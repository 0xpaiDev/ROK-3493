"""pick_governor in Postgres: the Council's Pick on a closed Fort Week (ADR 0006). Runs against the Supabase
database inside a transaction that is always rolled back, so nothing it writes survives.

Each test applies the migration in its own transaction first, so the tests run before and after it reaches
the database. Needs psycopg and SUPABASE_DB_URL (the repo's .env), as test_record_live_week.py does.
"""
import json
import sys
import unittest
import uuid

import psycopg

from test_record_live_week import ROOT, db_url

MIGRATION = ROOT / "supabase" / "migrations" / "20261117100000_pick_governor.sql"
# A closed Fort Week long before any real one, so the test's rows never meet the Kingdom's.
WEEK = "2020-01-06"


class ClosedWeekPick(unittest.TestCase):
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
        self.council = self.user("council-test@example.invalid")
        self.conn.execute("insert into council_member (email) values ('council-test@example.invalid')")
        for cid, name in [("990000101", "Case Known"), ("990000102", "Case Real")]:
            self.conn.execute("insert into governor (character_id, current_name) values (%s, %s)", (cid, name))
        self.conn.execute("insert into fort_week (starts_on, completeness) values (%s, 'complete')", (WEEK,))
        self.known = self.entry(WEEK, "990000101", "Case Known", 9)
        self.odd = self.entry(WEEK, None, "Case Odd", 5)

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

    def entry(self, week, cid, name, count):
        return self.one("insert into fort_entry (week, character_id, name, fort_count) values (%s, %s, %s, %s) returning id",
                        (week, cid, name, count))

    def pick(self, week, entry, cid, claims=None):
        """Calls pick_governor as the Council (or claims; None for an anonymous visitor)."""
        if claims is False:
            self.conn.execute("set local role anon")
        else:
            self.conn.execute("set local role authenticated")
            self.conn.execute("select set_config('request.jwt.claims', %s, true)", (json.dumps(claims or self.council),))
        self.conn.execute("select pick_governor(%s::date, %s::bigint, %s)", (week, entry, cid))
        self.conn.execute("reset role")

    def public(self, sql, args=()):
        """What the public site reads, with the public key."""
        self.conn.execute("set local role anon")
        rows = self.conn.execute(sql, args).fetchall()
        self.conn.execute("reset role")
        return rows

    # ---- tests ----

    def test_a_closed_week_pick_sets_the_row_and_adds_its_name_to_name_history(self):
        self.pick(WEEK, self.odd, "990000102")
        self.assertEqual(self.public("select character_id, name from fort_entry where week = %s order by fort_count desc", (WEEK,)),
                         [("990000101", "Case Known"), ("990000102", "Case Odd")])
        self.assertEqual(self.public("select name, first_seen::text from governor_name where character_id = '990000102'"),
                         [("Case Odd", WEEK)])

    def test_a_pick_on_a_name_another_row_of_the_week_carries_sets_the_row_but_adds_no_name(self):
        # Two Governors read as "Case Odd": Name History under one would hand the other's later rows to it.
        self.entry(WEEK, None, "Case Odd", 2)
        self.pick(WEEK, self.odd, "990000102")
        self.assertEqual(self.public("select character_id from fort_entry where id = %s", (self.odd,)), [("990000102",)])
        self.assertEqual(self.public("select name from governor_name where character_id = '990000102'"), [])

    def test_a_pick_on_a_name_another_row_was_also_read_as_adds_no_name(self):
        # A row read more than one way, one spelling the Picked row's name: two Governors may be behind it.
        self.conn.execute("insert into fort_entry (week, name, fort_count, spellings) values (%s, 'Case 0dd', 2, %s)",
                          (WEEK, ["Case 0dd", "Case Odd"]))
        self.pick(WEEK, self.odd, "990000102")
        self.assertEqual(self.public("select character_id from fort_entry where id = %s", (self.odd,)), [("990000102",)])
        self.assertEqual(self.public("select name from governor_name where character_id = '990000102'"), [])

    def refused(self, error, message, week, entry, cid, claims=None):
        """Asserts the Pick is refused with error and message, and changes no row nor Name History."""
        snapshot = "select md5(string_agg(t::text, '|' order by t::text)) from {} t"
        before = [self.one(snapshot.format(t)) for t in ("fort_entry", "governor_name")]
        self.conn.execute("savepoint call")
        try:
            with self.assertRaisesRegex(error, message):
                self.pick(week, entry, cid, claims)
        finally:
            self.conn.execute("rollback to savepoint call")
        self.assertEqual([self.one(snapshot.format(t)) for t in ("fort_entry", "governor_name")], before)

    def test_a_pick_on_the_live_week_is_refused(self):
        # Only the reader writes the Live Week (ADR 0002): its Picks go to Name History alone.
        live = self.one("select date_trunc('week', now() at time zone 'utc')::date")
        self.conn.execute("insert into fort_week (starts_on) values (%s) on conflict do nothing", (live,))
        row = self.entry(live, None, "Case Live Odd", 1)
        self.refused(psycopg.errors.InvalidParameterValue, "Live Week", live, row, "990000102")

    def test_a_pick_on_a_row_that_already_has_a_character_id_is_refused(self):
        self.refused(psycopg.errors.InvalidParameterValue, "already", WEEK, self.known, "990000102")

    def test_a_pick_for_a_governor_already_on_the_week_is_refused(self):
        self.refused(psycopg.errors.InvalidParameterValue, "Case Known already has a row", WEEK, self.odd, "990000101")

    def test_only_the_council_may_pick(self):
        self.conn.execute("insert into fort_reader (email) values ('reader-test@example.invalid')")
        for who, claims in {"anonymous visitor": False, "signed-in stranger": self.user("stranger-test@example.invalid"),
                            "the reader's sign-in": self.user("reader-test@example.invalid")}.items():
            with self.subTest(who):
                self.refused(psycopg.errors.InsufficientPrivilege, "", WEEK, self.odd, "990000102", claims)


if __name__ == "__main__":
    unittest.main()
