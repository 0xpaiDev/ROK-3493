"""save_kvk, delete_kvk and kvk_standings in Postgres: the Council sets up a KvK and its Counting Periods, and
the site reads each Governor's totals over them. Runs against the Supabase database inside a transaction that
is always rolled back, so nothing it writes survives.

Each test applies the T4/T5 and KvK migrations in its own transaction and clears the saved KvKs and Roster
Snapshots first (the rollback puts them back). Needs psycopg and SUPABASE_DB_URL (the repo's .env), as
test_record_live_week.py does.
"""
import json
import sys
import unittest
import uuid

import psycopg

from test_record_live_week import ROOT, db_url

MIGRATIONS = [ROOT / "supabase" / "migrations" / "20261119090000_roster_snapshot_t4_t5.sql",
              ROOT / "supabase" / "migrations" / "20261119160000_kvk.sql",
              ROOT / "supabase" / "migrations" / "20261120090000_kvk_standings_show_all.sql"]
CASES = json.loads((ROOT / "tests" / "kvk-cases.json").read_text(encoding="utf-8"))["cases"]
WEIGHTS = {"t4Kill": 1, "t5Kill": 2, "t4Death": 4, "t5Death": 8}


def as_input(k, ids=None):
    """A KvK from the shared cases (the site's shape) as save_kvk takes it."""
    ids = ids or {}
    w = k.get("weights", WEIGHTS)
    return {"id": ids.get(k.get("id")), "name": k["name"], "starts_on": k["startsOn"], "ends_on": k["endsOn"],
            "power_cutoff": k.get("powerCutoff", 20000000),
            "weights": {"t4_kill": w["t4Kill"], "t5_kill": w["t5Kill"], "t4_death": w["t4Death"], "t5_death": w["t5Death"]},
            "periods": [{"starts_on": p["startsOn"], "ends_on": p["endsOn"]} for p in k.get("periods", [])]}


class KvK(unittest.TestCase):
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
        self.conn.execute("delete from kvk")
        self.conn.execute("delete from roster_snapshot")
        self.council = self.user("council-test@example.invalid")
        self.conn.execute("insert into council_member (email) values ('council-test@example.invalid')")

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

    def as_caller(self, claims=None):
        """Acts as the Council (or claims; False for an anonymous visitor) until reset role."""
        if claims is False:
            self.conn.execute("set local role anon")
        else:
            self.conn.execute("set local role authenticated")
            self.conn.execute("select set_config('request.jwt.claims', %s, true)", (json.dumps(claims or self.council),))

    def save(self, kvk, claims=None):
        self.as_caller(claims)
        kid = self.one("select save_kvk(%s::jsonb)", (json.dumps(kvk),))
        self.conn.execute("reset role")
        return kid

    def delete(self, kvk_id, claims=None):
        self.as_caller(claims)
        self.conn.execute("select delete_kvk(%s)", (kvk_id,))
        self.conn.execute("reset role")

    def kvks(self):
        """The saved KvKs and their Counting Periods, as the public reads them."""
        self.conn.execute("set local role anon")
        rows = self.conn.execute(
            "select k.name, k.starts_on::text, k.ends_on::text, k.power_cutoff, k.weight_t4_kill, k.weight_t5_kill, "
            "k.weight_t4_death, k.weight_t5_death, "
            "coalesce((select json_agg(json_build_array(p.starts_on, p.ends_on) order by p.starts_on) "
            "          from kvk_counting_period p where p.kvk_id = k.id), '[]') "
            "from kvk k order by k.starts_on").fetchall()
        self.conn.execute("reset role")
        return rows

    def refused(self, error, message, call):
        """Asserts the call is refused with error and a sentence matching message, and changes no KvK."""
        before = self.kvks()
        self.conn.execute("savepoint call")
        try:
            with self.assertRaises(error) as refusal:
                call()
        finally:
            self.conn.execute("rollback to savepoint call")
        self.assertRegex(refusal.exception.diag.message_primary, message)
        self.assertEqual(self.kvks(), before)

    def governor(self, cid, name, status="current"):
        self.conn.execute("insert into governor (character_id, current_name, status) values (%s, %s, %s)", (cid, name, status))

    def snapshot(self, day, rows):
        """A Roster Snapshot for day: rows (character_id, power, t4_kills, t5_kills, t4_deaths, t5_deaths)."""
        sid = self.one("insert into roster_snapshot (taken_on) values (%s) returning id", (day,))
        for cid, power, *t in rows:
            self.conn.execute("insert into roster_snapshot_row (snapshot_id, character_id, power, t4_kills, t5_kills, t4_deaths, t5_deaths) "
                              "values (%s, %s, %s, %s, %s, %s, %s)", (sid, cid, power, *t))

    def standings(self, kvk_id):
        """What the public site reads for a KvK's table, with the public key."""
        self.conn.execute("set local role anon")
        rows = self.conn.execute(
            "select character_id, name, status, start_power, t4_kills, t5_kills, t4_deaths, t5_deaths "
            "from kvk_standings(%s) order by character_id", (kvk_id,)).fetchall()
        self.conn.execute("reset role")
        return rows

    # ---- saving a KvK ----

    def test_shared_kvk_cases(self):
        for c in CASES:
            with self.subTest(c["case"]):
                self.conn.execute("savepoint case_start")
                try:
                    ids = {}
                    for o in c["others"]:
                        ids[o["id"]] = self.save(as_input({**o, "periods": []}))
                    if c["refused"] is None:
                        self.save(as_input(c["kvk"], ids))
                        saved = [r for r in self.kvks() if r[0] == c["kvk"]["name"]]
                        self.assertEqual(len(saved), 1)
                        self.assertEqual(saved[0][1:3], (c["kvk"]["startsOn"], c["kvk"]["endsOn"]))
                        self.assertEqual(len(saved[0][8]), len(c["kvk"]["periods"]))
                    else:
                        self.refused(psycopg.errors.lookup("22023"), "^" + c["refused"].replace(".", r"\.") + "$",
                                     lambda: self.save(as_input(c["kvk"], ids)))
                finally:
                    self.conn.execute("rollback to savepoint case_start")

    def test_a_new_kvk_takes_the_default_cutoff_and_weights(self):
        self.save({"name": "KvK 2020", "starts_on": "2020-01-10", "ends_on": "2020-02-20", "periods": []})
        self.assertEqual(self.kvks()[0][3:8], (20000000, 1, 2, 4, 8, ))

    def test_saving_a_kvk_again_replaces_its_days_cutoff_weights_and_periods(self):
        k = as_input({"name": "KvK 2020", "startsOn": "2020-01-10", "endsOn": "2020-02-20",
                      "periods": [{"startsOn": "2020-01-10", "endsOn": "2020-01-14"}, {"startsOn": "2020-01-20", "endsOn": None}]})
        kid = self.save(k)
        again = self.save({**k, "id": kid, "name": "KvK Winter", "ends_on": "2020-03-01", "power_cutoff": 25000000,
                           "weights": {"t4_kill": 0, "t5_kill": 1, "t4_death": 2, "t5_death": 3},
                           "periods": [{"starts_on": "2020-01-12", "ends_on": "2020-02-01"}]})
        self.assertEqual(again, kid)
        self.assertEqual(self.kvks(), [("KvK Winter", "2020-01-10", "2020-03-01", 25000000, 0, 1, 2, 3, [["2020-01-12", "2020-02-01"]])])

    def test_editing_a_kvk_that_is_gone_is_refused(self):
        self.refused(psycopg.errors.lookup("22023"), r"^There is no KvK 999999999\. Reload the page\.$",
                     lambda: self.save({**as_input({"name": "KvK", "startsOn": "2020-01-10", "endsOn": "2020-02-20"}), "id": 999999999}))

    def test_only_the_council_can_save_a_kvk(self):
        k = as_input({"name": "KvK 2020", "startsOn": "2020-01-10", "endsOn": "2020-02-20"})
        self.refused(psycopg.errors.InsufficientPrivilege, "^Only the Council can set up a KvK", lambda: self.save(k, self.user("someone@example.invalid")))
        self.refused(psycopg.errors.InsufficientPrivilege, "save_kvk", lambda: self.save(k, False))

    def test_nobody_writes_a_kvk_but_through_save_kvk(self):
        self.as_caller()
        with self.assertRaises(psycopg.errors.InsufficientPrivilege):
            self.conn.execute("insert into kvk (name, starts_on, ends_on) values ('KvK', '2020-01-10', '2020-02-20')")

    # ---- deleting a KvK ----

    def test_the_council_deletes_a_kvk_with_its_counting_periods(self):
        keep = self.save(as_input({"name": "Keep", "startsOn": "2020-03-01", "endsOn": "2020-03-20"}))
        gone = self.save(as_input({"name": "Gone", "startsOn": "2020-01-10", "endsOn": "2020-02-20",
                                   "periods": [{"startsOn": "2020-01-10", "endsOn": None}]}))
        self.delete(gone)
        self.assertEqual([r[0] for r in self.kvks()], ["Keep"])
        self.assertEqual(self.one("select count(*) from kvk_counting_period where kvk_id = %s", (gone,)), 0)
        self.assertIsNotNone(keep)

    def test_only_the_council_can_delete_a_kvk(self):
        kid = self.save(as_input({"name": "KvK 2020", "startsOn": "2020-01-10", "endsOn": "2020-02-20"}))
        self.refused(psycopg.errors.InsufficientPrivilege, "^Only the Council can delete a KvK", lambda: self.delete(kid, self.user("someone@example.invalid")))
        self.refused(psycopg.errors.InsufficientPrivilege, "delete_kvk", lambda: self.delete(kid, False))

    def test_deleting_a_kvk_that_is_gone_is_refused(self):
        self.refused(psycopg.errors.lookup("22023"), r"^There is no KvK 999999999\. Reload the page\.$", lambda: self.delete(999999999))

    # ---- the KvK totals read ----

    def setup_kingdom(self):
        """Three Governors over 10 to 15 Jan 2020; 990000003 is missing on 12 and 13 Jan."""
        self.governor("990000001", "Gov <One>")
        self.governor("990000002", "Gov Two", "inactive")
        self.governor("990000003", "Gov Three")
        self.governor("990000004", "Gov Late")
        days = {"2020-01-10": [("990000001", 30_000_000, 1, 1, 1, 1), ("990000002", 25_000_000, 2, 2, 2, 2), ("990000003", 21_000_000, 3, 3, 3, 3)],
                "2020-01-11": [("990000001", 30_100_000, 10, 1, 0, 0), ("990000002", 25_000_000, 20, 2, 0, 0), ("990000003", 21_000_000, 30, 3, 0, 0)],
                "2020-01-12": [("990000001", 30_200_000, 100, 0, 1, 0), ("990000002", 25_000_000, 200, 0, 2, 0)],
                "2020-01-13": [("990000001", 30_300_000, 1000, 0, 0, 1), ("990000002", 25_000_000, 2000, 0, 0, 2), ("990000004", 40_000_000, 5, 5, 5, 5)],
                "2020-01-14": [("990000001", 30_400_000, 10000, 0, 0, 0), ("990000003", 21_000_000, 30000, 0, 0, 0)],
                "2020-01-15": [("990000001", 30_500_000, 100000, 0, 0, 0), ("990000003", 21_000_000, 300000, 0, 0, 0)]}
        for day, rows in days.items():
            self.snapshot(day, rows)

    def kvk_with(self, *periods):
        return self.save(as_input({"name": "KvK 2020", "startsOn": "2020-01-10", "endsOn": "2020-02-20",
                                   "periods": [{"startsOn": a, "endsOn": b} for a, b in periods]}))

    def test_a_closed_period_sums_its_days_both_ends_included(self):
        self.setup_kingdom()
        rows = self.standings(self.kvk_with(("2020-01-11", "2020-01-13")))
        self.assertEqual(rows, [("990000001", "Gov <One>", "current", 30_000_000, 1110, 1, 1, 1),
                                ("990000002", "Gov Two", "inactive", 25_000_000, 2220, 2, 2, 2),
                                ("990000003", "Gov Three", "current", 21_000_000, 30, 3, 0, 0),
                                ("990000004", "Gov Late", "current", None, 5, 5, 5, 5)])

    def test_an_open_period_runs_to_the_newest_snapshot(self):
        self.setup_kingdom()
        rows = self.standings(self.kvk_with(("2020-01-14", None)))
        self.assertEqual([(r[0], r[4]) for r in rows], [("990000001", 110000), ("990000002", 0), ("990000003", 330000)])

    def test_several_periods_add_up_and_days_between_them_do_not_count(self):
        self.setup_kingdom()
        rows = self.standings(self.kvk_with(("2020-01-11", "2020-01-11"), ("2020-01-13", "2020-01-13"), ("2020-01-15", None)))
        self.assertEqual([(r[0], r[4:]) for r in rows], [("990000001", (101010, 1, 0, 1)), ("990000002", (2020, 2, 0, 2)),
                                                          ("990000003", (300030, 3, 0, 0)), ("990000004", (5, 5, 5, 5))])

    def test_a_governor_counted_but_not_in_the_kvk_start_snapshot_is_read_without_starting_power(self):
        self.setup_kingdom()
        rows = self.standings(self.kvk_with(("2020-01-12", None)))
        self.assertEqual(rows[-1], ("990000004", "Gov Late", "current", None, 5, 5, 5, 5))

    def test_a_governor_seen_only_outside_the_counting_periods_is_not_read(self):
        self.setup_kingdom()
        rows = self.standings(self.kvk_with(("2020-01-14", None)))
        self.assertNotIn("990000004", [r[0] for r in rows])

    def test_no_counting_period_yet_reads_zeros(self):
        self.setup_kingdom()
        rows = self.standings(self.kvk_with())
        self.assertEqual([r[3:] for r in rows], [(30_000_000, 0, 0, 0, 0), (25_000_000, 0, 0, 0, 0), (21_000_000, 0, 0, 0, 0)])

    def test_a_kvk_waiting_for_its_start_snapshot_reads_nothing(self):
        self.setup_kingdom()
        kid = self.save(as_input({"name": "KvK later", "startsOn": "2020-01-20", "endsOn": "2020-02-20",
                                  "periods": [{"startsOn": "2020-01-20", "endsOn": None}]}))
        self.assertEqual(self.standings(kid), [])


if __name__ == "__main__":
    unittest.main()
