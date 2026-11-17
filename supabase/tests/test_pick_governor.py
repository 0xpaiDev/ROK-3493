"""pick_governor in Postgres: the Council's Picks on a Fort Week, Live or closed (ADR 0006). Runs against the
Supabase database inside a transaction that is always rolled back, so nothing it writes survives.

Each test applies the migrations in its own transaction first, so the tests run before and after they reach
the database. Needs psycopg and SUPABASE_DB_URL (the repo's .env), as test_record_live_week.py does.
"""
import json
import sys
import unittest
import uuid

import psycopg

from test_record_live_week import MIGRATIONS, ROOT, db_url

PICK_CASES = json.loads((ROOT / "tests" / "pick-cases.json").read_text(encoding="utf-8"))["cases"]
# Closed Fort Weeks long before any real one, so the test's rows never meet the Kingdom's.
WEEK = "2020-01-06"
CASE_WEEK = "2020-01-13"


class Pick(unittest.TestCase):
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
        self.council = self.user("council-test@example.invalid")
        self.conn.execute("insert into council_member (email) values ('council-test@example.invalid')")
        for cid, name in [("990000101", "Case Known"), ("990000102", "Case Real"), ("990000103", "Case Third")]:
            self.conn.execute("insert into governor (character_id, current_name) values (%s, %s)", (cid, name))
        self.conn.execute("insert into fort_week (starts_on, completeness) values (%s, 'complete'), (%s, 'complete')", (WEEK, CASE_WEEK))
        self.known = self.entry(WEEK, "990000101", "Case Known", 9)
        self.odd = self.entry(WEEK, None, "Case Odd", 5)
        self.other = self.entry(WEEK, None, "Case Other", 3)

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

    def entry(self, week, cid, name, count, spellings=None):
        return self.one("insert into fort_entry (week, character_id, name, fort_count, spellings) values (%s, %s, %s, %s, %s) returning id",
                        (week, cid, name, count, spellings))

    def as_caller(self, claims=None):
        """Acts as the Council (or claims; False for an anonymous visitor) until reset role."""
        if claims is False:
            self.conn.execute("set local role anon")
        else:
            self.conn.execute("set local role authenticated")
            self.conn.execute("select set_config('request.jwt.claims', %s, true)", (json.dumps(claims or self.council),))

    def pick(self, week, picks, claims=None):
        """Calls pick_governor with picks [(entry, character_id)] as the Council (or claims)."""
        self.as_caller(claims)
        self.conn.execute("select pick_governor(%s::date, %s::jsonb)",
                          (week, json.dumps([{"entry": e, "character_id": c} for e, c in picks])))
        self.conn.execute("reset role")

    def public(self, sql, args=()):
        """What the public site reads, with the public key."""
        self.conn.execute("set local role anon")
        rows = self.conn.execute(sql, args).fetchall()
        self.conn.execute("reset role")
        return rows

    def live_week(self):
        """The Live Week, emptied: the real reading in it is put back by the rollback."""
        live = self.one("select date_trunc('week', now() at time zone 'utc')::date")
        self.conn.execute("insert into fort_week (starts_on) values (%s) on conflict do nothing", (live,))
        self.conn.execute("delete from fort_entry where week = %s", (live,))
        return live

    def refused(self, error, message, week, picks, claims=None):
        """Asserts the call is refused with error and message, and changes no row nor Name History."""
        snapshot = "select md5(string_agg(t::text, '|' order by t::text)) from {} t"
        before = [self.one(snapshot.format(t)) for t in ("fort_entry", "governor_name")]
        self.conn.execute("savepoint call")
        try:
            with self.assertRaisesRegex(error, message):
                self.pick(week, picks, claims)
        finally:
            self.conn.execute("rollback to savepoint call")
        self.assertEqual([self.one(snapshot.format(t)) for t in ("fort_entry", "governor_name")], before)

    # ---- tests ----

    def test_shared_closed_week_pick_cases(self):
        for c in PICK_CASES:
            with self.subTest(c["case"]):
                self.conn.execute("savepoint case_start")
                try:
                    ids = [g["id"] for g in c["governors"]]
                    for g in c["governors"]:
                        self.conn.execute("insert into governor (character_id, current_name) values (%s, %s)", (g["id"], g["name"]))
                    for n in c["nameHistory"]:
                        self.conn.execute("insert into governor_name (character_id, name) values (%s, %s)", (n["id"], n["name"]))
                    entries = [self.entry(CASE_WEEK, r["id"], r["name"], r["fortCount"], r.get("names")) for r in c["rows"]]
                    self.pick(CASE_WEEK, [(entries[p["row"]], p["id"]) for p in c["picks"]])
                    added = self.public("select character_id, name, first_seen::text from governor_name where character_id = any(%s) "
                                        "and first_seen is not null order by name", (ids,))
                    self.assertEqual(added, sorted(((n["id"], n["name"], CASE_WEEK) for n in c["newNames"]), key=lambda n: n[1]))
                finally:
                    self.conn.execute("rollback to savepoint case_start")

    def test_a_closed_week_pick_sets_the_row_and_adds_its_name_to_name_history(self):
        self.pick(WEEK, [(self.odd, "990000102")])
        self.assertEqual(self.public("select character_id, name from fort_entry where week = %s order by fort_count desc", (WEEK,)),
                         [("990000101", "Case Known"), ("990000102", "Case Odd"), (None, "Case Other")])
        self.assertEqual(self.public("select name, first_seen::text from governor_name where character_id = '990000102'"),
                         [("Case Odd", WEEK)])

    def test_if_one_pick_is_refused_no_pick_of_the_call_is_saved(self):
        # The first Pick alone would save; the second names a row that already has a Character ID.
        self.refused(psycopg.errors.InvalidParameterValue, "already has Character ID", WEEK,
                     [(self.odd, "990000102"), (self.known, "990000103")])

    def test_a_pick_on_a_row_that_already_has_a_character_id_is_refused(self):
        self.refused(psycopg.errors.InvalidParameterValue, "already has Character ID", WEEK, [(self.known, "990000102")])

    def test_a_pick_for_a_governor_already_on_the_week_is_refused(self):
        self.refused(psycopg.errors.InvalidParameterValue, "Case Known is on more than one row", WEEK, [(self.odd, "990000101")])

    def test_two_picks_for_one_governor_are_refused(self):
        self.refused(psycopg.errors.InvalidParameterValue, "Case Real is on more than one row", WEEK,
                     [(self.odd, "990000102"), (self.other, "990000102")])

    def test_a_pick_on_a_row_of_another_week_is_refused(self):
        row = self.entry(CASE_WEEK, None, "Case Elsewhere", 1)
        self.refused(psycopg.errors.InvalidParameterValue, "Reload the page", WEEK, [(row, "990000102")])

    def test_a_pick_on_a_week_not_yet_begun_is_refused(self):
        coming = self.one("select date_trunc('week', now() at time zone 'utc')::date + 7")
        self.conn.execute("insert into fort_week (starts_on) values (%s)", (coming,))
        row = self.entry(coming, None, "Case Coming", 1)
        self.refused(psycopg.errors.InvalidParameterValue, "has not begun", coming, [(row, "990000102")])

    def test_a_live_week_pick_adds_the_name_and_leaves_the_rows_to_the_reader(self):
        live = self.live_week()
        row = self.entry(live, None, "Case Live Odd", 4)
        self.pick(live, [(row, "990000102")])
        self.assertEqual(self.public("select character_id, name from fort_entry where week = %s", (live,)), [(None, "Case Live Odd")])
        self.assertEqual(self.public("select name, first_seen::text from governor_name where character_id = '990000102'"),
                         [("Case Live Odd", str(live))])

    def test_a_live_week_slip_is_refused_and_nothing_of_the_call_is_saved(self):
        # "Case Twin" is on two rows: the next reading could not match either, whoever is Picked. "Case Fine" alone would stick.
        live = self.live_week()
        fine = self.entry(live, None, "Case Fine", 6)
        twin = self.entry(live, None, "Case Twin", 5)
        self.entry(live, None, "Case Twin", 2)
        self.refused(psycopg.errors.InvalidParameterValue, 'Case Twin would still be "needs ID" at the next reading', live,
                     [(fine, "990000102"), (twin, "990000103")])

    def test_the_council_cannot_write_name_history_directly(self):
        # pick_governor is the Council's only way into Name History (ADR 0006).
        self.conn.execute("insert into governor_name (character_id, name) values ('990000101', 'Case Known Before')")
        self.as_caller()
        for label, sql in {"insert": "insert into governor_name (character_id, name) values ('990000102', 'Case Direct')",
                           "update": "update governor_name set name = 'Case Direct' where character_id = '990000101' returning 1",
                           "delete": "delete from governor_name where character_id = '990000101' returning 1"}.items():
            with self.subTest(label):
                self.conn.execute("savepoint direct")
                try:
                    if label == "insert":
                        with self.assertRaises(psycopg.errors.InsufficientPrivilege):
                            self.conn.execute(sql)
                    else:
                        # Without a policy, row-level security hides every row from the write: nothing changes.
                        self.assertEqual(self.conn.execute(sql).fetchall(), [])
                finally:
                    self.conn.execute("rollback to savepoint direct")

    def test_only_the_council_may_pick(self):
        self.conn.execute("insert into fort_reader (email) values ('reader-test@example.invalid')")
        for who, claims in {"anonymous visitor": False, "signed-in stranger": self.user("stranger-test@example.invalid"),
                            "the reader's sign-in": self.user("reader-test@example.invalid")}.items():
            with self.subTest(who):
                self.refused(psycopg.errors.InsufficientPrivilege, "", WEEK, [(self.odd, "990000102")], claims)


if __name__ == "__main__":
    unittest.main()
