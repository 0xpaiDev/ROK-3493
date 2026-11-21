"""KvK ticket 07 in Postgres: nobody is a Main by default, and a Farm's link points only at a marked Main.
Runs against the Supabase database inside a transaction that is always rolled back.

The migration is not idempotent (it resets every Governor), so it is applied in the transaction only while
the live database doesn't have it yet. Needs psycopg and SUPABASE_DB_URL, as test_record_live_week.py does.
"""
import sys
import unittest

import psycopg

from test_record_live_week import ROOT, db_url

MIGRATION = ROOT / "supabase" / "migrations" / "20261121120000_council_marks_the_mains.sql"


class MarkedMains(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        sys.stdout.reconfigure(encoding="utf-8")
        cls.conn = psycopg.connect(db_url())

    @classmethod
    def tearDownClass(cls):
        cls.conn.close()

    def setUp(self):
        self.conn.rollback()
        applied = self.one("select count(*) from information_schema.columns where table_name = 'governor' and column_name = 'main_kind'")
        if not applied:
            self.conn.execute(MIGRATION.read_text(encoding="utf-8"))

    def tearDown(self):
        self.conn.rollback()

    def one(self, sql, args=()):
        return self.conn.execute(sql, args).fetchone()[0]

    def add(self, cid, kind=None):
        if kind is None:
            self.conn.execute("insert into governor (character_id, current_name) values (%s, %s)", (cid, "Gov " + cid))
        else:
            self.conn.execute("insert into governor (character_id, current_name, kind) values (%s, %s, %s)", (cid, "Gov " + cid, kind))

    def link(self, farm, main):
        self.conn.execute("update governor set kind = 'farm', main_character_id = %s where character_id = %s", (main, farm))

    def refused(self, fn, code):
        self.conn.execute("savepoint s")
        with self.assertRaises(psycopg.Error) as e:
            fn()
        self.conn.execute("rollback to savepoint s")
        self.assertEqual(e.exception.sqlstate, code)

    def test_a_new_governor_is_unmarked(self):
        self.add("900000001")
        self.assertEqual(self.one("select kind from governor where character_id = '900000001'"), "unmarked")

    def test_a_farm_links_to_a_marked_main(self):
        self.add("900000001", "main")
        self.add("900000002")
        self.link("900000002", "900000001")
        self.assertEqual(self.one("select main_character_id from governor where character_id = '900000002'"), "900000001")

    def test_a_farm_cannot_link_to_an_unmarked_governor_or_to_a_farm(self):
        self.add("900000001", "main")
        self.add("900000002")
        self.add("900000003")
        self.refused(lambda: self.link("900000003", "900000002"), "23503")
        self.link("900000002", "900000001")
        self.refused(lambda: self.link("900000003", "900000002"), "23503")

    def test_a_main_with_farms_cannot_be_unmarked_until_they_are_unlinked(self):
        self.add("900000001", "main")
        self.add("900000002")
        self.link("900000002", "900000001")
        unmark = lambda: self.conn.execute("update governor set kind = 'unmarked' where character_id = '900000001'")
        self.refused(unmark, "23503")
        self.conn.execute("update governor set kind = 'unmarked', main_character_id = null where character_id = '900000002'")
        unmark()
        self.assertEqual(self.one("select kind from governor where character_id = '900000001'"), "unmarked")

    def test_a_farm_with_its_main_unknown_is_allowed(self):
        self.add("900000002")
        self.conn.execute("update governor set kind = 'farm' where character_id = '900000002'")
        self.assertEqual(self.one("select kind from governor where character_id = '900000002'"), "farm")


if __name__ == "__main__":
    unittest.main()
