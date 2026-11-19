"""The Fort Pause in Postgres (ADR 0007): set_fort_pause, the Council's switch, and record_live_week refusing a
reading taken while Forts are paused. Runs against the Supabase database inside a transaction that is always
rolled back, so nothing it writes survives.

Each test applies the migrations in its own transaction first, so the tests run before and after they reach
the database. Needs psycopg and SUPABASE_DB_URL (the repo's .env), as test_record_live_week.py does.
"""
import json
import sys
import unittest
import uuid

import psycopg

from test_record_live_week import MIGRATIONS, db_url


class FortPause(unittest.TestCase):
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
        # Start with Forts running and an empty Live Week: the real ones come back with the rollback.
        self.conn.execute("delete from fort_pause")
        self.live = self.one("select date_trunc('week', now() at time zone 'utc')::date")
        self.conn.execute("delete from fort_entry where week = %s", (self.live,))
        self.conn.execute("delete from fort_week where starts_on = %s", (self.live,))
        self.council = self.user("council-test@example.invalid")
        self.conn.execute("insert into council_member (email) values ('council-test@example.invalid')")
        self.reader = self.user("reader-test@example.invalid")
        self.conn.execute("insert into fort_reader (email) values ('reader-test@example.invalid')")

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

    def as_caller(self, claims):
        if claims is None:
            self.conn.execute("set local role anon")
        else:
            self.conn.execute("set local role authenticated")
            self.conn.execute("select set_config('request.jwt.claims', %s, true)", (json.dumps(claims),))

    def switch(self, paused, claims=False):
        """Calls set_fort_pause as the Council (or claims; None for an anonymous visitor)."""
        self.as_caller(self.council if claims is False else claims)
        result = self.one("select set_fort_pause(%s)", (paused,))
        self.conn.execute("reset role")
        return result

    def pauses(self):
        """The Fort Pauses as the public site reads them, oldest first."""
        self.conn.execute("set local role anon")
        rows = self.conn.execute("select starts_at, ends_at from fort_pause order by starts_at").fetchall()
        self.conn.execute("reset role")
        return rows

    def record(self, read_at):
        self.as_caller(self.reader)
        self.conn.execute("select record_live_week(%s, %s::jsonb)",
                          (read_at, json.dumps([{"rank": 1, "name": "Case Anyone", "fort_count": 3}])))
        self.conn.execute("reset role")

    def live_week(self):
        self.conn.execute("set local role anon")
        rows = self.conn.execute("select name, fort_count from fort_entry where week = %s", (self.live,)).fetchall()
        self.conn.execute("reset role")
        return rows

    # ---- tests ----

    def test_the_council_pauses_forts_and_resumes_them(self):
        since = self.switch(True)
        [(start, end)] = self.pauses()
        self.assertEqual((start, end), (since, None))
        self.switch(False)
        [(start, end)] = self.pauses()
        self.assertEqual(start, since)
        self.assertGreaterEqual(end, start)
        self.switch(True)
        self.assertEqual(len(self.pauses()), 2)

    def test_only_the_council_can_pause_or_resume(self):
        callers = {"anonymous visitor": None, "the reader's sign-in": self.reader,
                   "signed-in stranger": self.user("stranger-test@example.invalid")}
        for who, claims in callers.items():
            for paused in (True, False):
                with self.subTest(who, paused=paused):
                    self.conn.execute("savepoint call")
                    try:
                        with self.assertRaises(psycopg.errors.InsufficientPrivilege):
                            self.switch(paused, claims)
                    finally:
                        self.conn.execute("rollback to savepoint call")
        self.assertEqual(self.pauses(), [])

    def test_pausing_twice_or_resuming_running_forts_is_refused(self):
        for paused, message in ((False, "Forts are not paused"), (True, "already paused since")):
            with self.subTest(paused=paused):
                self.conn.execute("savepoint call")
                try:
                    with self.assertRaisesRegex(psycopg.errors.InvalidParameterValue, message):
                        self.switch(paused)
                finally:
                    self.conn.execute("rollback to savepoint call")
            if paused is False:
                self.switch(True)
        self.assertEqual(len(self.pauses()), 1)

    def test_a_reading_taken_while_forts_are_paused_is_refused(self):
        self.switch(True)
        read_at = self.one("select clock_timestamp()")
        self.conn.execute("savepoint call")
        try:
            with self.assertRaisesRegex(psycopg.errors.InvalidParameterValue, "Forts are paused since .*no Fort Week is read"):
                self.record(read_at)
        finally:
            self.conn.execute("rollback to savepoint call")
        self.assertEqual(self.live_week(), [])
        self.assertEqual(self.one("select count(*) from fort_week where starts_on = %s", (self.live,)), 0)

    def test_once_forts_resume_the_live_week_is_read_as_usual(self):
        self.switch(True)
        self.switch(False)
        self.record(self.one("select clock_timestamp()"))
        self.assertEqual(self.live_week(), [("Case Anyone", 3)])


if __name__ == "__main__":
    unittest.main()
