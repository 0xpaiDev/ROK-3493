"""The daily roster job against a fake Lilith API: no network, no Supabase."""
import base64
import datetime
import io
import json
import os
import types
import unittest
import urllib.error
from unittest import mock

import roster

NOW = datetime.datetime(2026, 11, 15, 12, 0, tzinfo=datetime.timezone.utc)


def token(expires):
    claims = base64.urlsafe_b64encode(json.dumps({"exp": int(expires.timestamp())}).encode()).decode().rstrip("=")
    return f"header.{claims}.signature"


def member(id, name, power, **extra):
    return {"id": id, "name": name, "power": power, "max_power": power + 1, "kill": 7, "collect": 8, "help": 9,
            "dead": 1, "t5": 2, "dt": "2026/11/14", **extra}


class FakeLilith:
    """Answers the two API calls the job makes; records what it was asked."""

    def __init__(self, day="2026-11-14", members=None, total=None, status=200, code=200):
        self.day, self.status, self.code = day, status, code
        self.members = members if members is not None else [member("149673994", "FKK CATHAY", 125),
                                                            member("49913581", " Zhuī Mìng ", 104)]
        self.total = len(self.members) if total is None else total
        self.asked = []

    def __call__(self, req, timeout):
        self.asked.append((req.full_url, dict(req.header_items())))
        if self.status != 200:
            raise urllib.error.HTTPError(req.full_url, self.status, "no", {}, io.BytesIO(b"{}"))
        if "/api/kindomInformation" in req.full_url:
            body = {"code": self.code, "msg": "OK", "data": {"day": self.day}}
        else:
            body = {"code": self.code, "msg": "OK", "data": self.members, "total": self.total}
        return io.BytesIO(json.dumps(body).encode())


def args(**kw):
    return types.SimpleNamespace(dry_run=kw.get("dry_run", False), day=kw.get("day"))


class Roster(unittest.TestCase):
    def setUp(self):
        self.env = mock.patch.dict(os.environ, {"LILITH_PAUTH": token(NOW + datetime.timedelta(days=20))})
        self.env.start()
        self.sent, self.mails = [], []

    def tearDown(self):
        self.env.stop()

    def send(self, day, rows):
        self.sent.append((day, rows))
        return {"saved": True, "taken_on": day, "rows": len(rows), "new_governors": 0, "renamed": 0, "inactive": 0, "current": 0}

    def run_job(self, lilith=None, **kw):
        lilith = lilith or FakeLilith()
        lines = roster.run(args(**kw), kw.get("now", NOW), lilith, self.send, lambda s, b: self.mails.append(s))
        return lines, lilith

    def test_saves_the_newest_day_with_character_ids_and_the_kept_columns(self):
        lines, lilith = self.run_job()
        self.assertEqual(self.sent, [("2026-11-14", [
            {"id": "149673994", "name": "FKK CATHAY", "power": 125, "highest_power": 126, "kill_points": 7, "resources_gathered": 8, "alliance_helps": 9},
            {"id": "49913581", "name": "Zhuī Mìng", "power": 104, "highest_power": 105, "kill_points": 7, "resources_gathered": 8, "alliance_helps": 9}])])
        self.assertIn("start=2026-11-14&end=2026-11-14", lilith.asked[1][0])
        self.assertIn("server_id=2493", lilith.asked[1][0])
        self.assertTrue(lilith.asked[0][1]["Authorization"].startswith("Bearer header."))
        self.assertEqual(self.mails, [])
        self.assertIn("Saved the 2026-11-14 Roster Snapshot", lines[-1])

    def test_a_dry_run_saves_nothing(self):
        lines, _ = self.run_job(dry_run=True)
        self.assertEqual(self.sent, [])
        self.assertEqual(lines[-1], "Dry run: nothing saved.")

    def test_a_given_day_skips_asking_for_the_newest(self):
        _, lilith = self.run_job(day="2026-11-10")
        self.assertEqual(len(lilith.asked), 1)
        self.assertEqual(self.sent[0][0], "2026-11-10")

    def test_a_day_already_saved_is_not_a_failure(self):
        self.send = lambda day, rows: {"saved": False, "taken_on": day, "latest": day}
        lines, _ = self.run_job()
        self.assertEqual(lines[-1], "Nothing new: the latest Roster Snapshot is already 2026-11-14.")

    def test_a_partial_answer_is_refused_before_saving(self):
        # Governors missing from the answer would be marked Inactive.
        with self.assertRaisesRegex(roster.RosterError, "2 of 600"):
            self.run_job(FakeLilith(total=600))
        self.assertEqual(self.sent, [])

    def test_an_empty_day_is_refused(self):
        with self.assertRaisesRegex(roster.RosterError, "no member data"):
            self.run_job(FakeLilith(members=[]))

    def test_a_value_that_is_not_a_whole_number_is_refused(self):
        with self.assertRaisesRegex(roster.RosterError, "power is '12M'"):
            self.run_job(FakeLilith(members=[{**member("1", "A", 0), "power": "12M"}]))

    def test_a_refused_token_says_to_replace_it(self):
        with self.assertRaisesRegex(roster.RosterError, "put a new one in LILITH_PAUTH"):
            self.run_job(FakeLilith(status=401))

    def test_an_expired_token_stops_before_asking_lilith(self):
        os.environ["LILITH_PAUTH"] = token(NOW - datetime.timedelta(hours=1))
        lilith = FakeLilith()
        with self.assertRaisesRegex(roster.RosterError, "expired on 2026-11-15"):
            self.run_job(lilith)
        self.assertEqual(lilith.asked, [])

    def test_a_token_close_to_expiry_still_saves_and_emails_a_reminder(self):
        os.environ["LILITH_PAUTH"] = token(NOW + datetime.timedelta(days=3))
        self.run_job()
        self.assertEqual(len(self.sent), 1)
        self.assertEqual(self.mails, ["Roster job: the Lilith token expires 2026-11-18"])

    def test_lilith_data_days_old_emails_a_note(self):
        self.run_job(FakeLilith(day="2026-11-11"))
        self.assertEqual(self.mails, ["Roster job: Lilith's newest stats are from 2026-11-11"])

    def test_a_null_name_or_id_is_sent_empty_never_as_none(self):
        # The database refuses an empty name or ID; "None" would rename a Governor.
        self.run_job(FakeLilith(members=[{**member("1", "A", 5), "name": None}, {**member("2", "B", 4), "id": None}]))
        self.assertEqual([(r["id"], r["name"]) for r in self.sent[0][1]], [("1", ""), ("", "B")])

    def test_a_reminder_that_cannot_be_mailed_still_saves(self):
        os.environ["LILITH_PAUTH"] = token(NOW + datetime.timedelta(days=3))
        def broken(subject, body):
            raise TimeoutError("smtp timed out")
        lines = roster.run(args(), NOW, FakeLilith(day="2026-11-11"), self.send, broken)
        self.assertEqual(len(self.sent), 1)
        self.assertIn("couldn't email it: smtp timed out", lines[0])
        self.assertIn("Saved the 2026-11-11 Roster Snapshot", lines[2])
        self.assertIn("couldn't email it", lines[3])

    def test_no_token_or_a_garbled_one_says_what_to_do(self):
        for value, message in [("", "Add LILITH_PAUTH"), ("not-a-jwt", "not a Lilith token")]:
            with self.subTest(value):
                os.environ["LILITH_PAUTH"] = value
                with self.assertRaisesRegex(roster.RosterError, message):
                    self.run_job()


if __name__ == "__main__":
    unittest.main()
