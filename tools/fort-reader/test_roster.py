"""The daily roster job against a fake Lilith API: no network, no Supabase."""
import base64
import datetime
import io
import json
import os
import tempfile
import types
import unittest
import urllib.error
from pathlib import Path
from unittest import mock

import roster

NOW = datetime.datetime(2026, 11, 15, 6, 0, tzinfo=datetime.timezone.utc)  # the morning run
EVENING = datetime.datetime(2026, 11, 15, 18, 0, tzinfo=datetime.timezone.utc)


def token(expires):
    claims = base64.urlsafe_b64encode(json.dumps({"exp": int(expires.timestamp())}).encode()).decode().rstrip("=")
    return f"header.{claims}.signature"


def member(id, name, power, **extra):
    return {"id": id, "name": name, "power": power, "max_power": power + 1, "kill": 7, "collect": 8, "help": 9,
            "dead": 1, "t1": 5, "dead_t1": 6, "t4": 3, "t5": 2, "dead_t4": 4, "dead_t5": 0, "dt": "2026/11/14", **extra}


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

    def run_job(self, lilith=None, without=(), missing=(), log=None, **kw):
        lilith = lilith or FakeLilith()
        self.asked_since, self.asked_missing_since = [], []

        def days_without_t4_t5(since):
            self.asked_since.append(since)
            return list(without)

        def days_missing(since):
            self.asked_missing_since.append(since)
            return list(missing)
        lines = roster.run(args(**kw), kw.get("now", NOW), lilith, self.send, lambda s, b: self.mails.append(s),
                           days_without_t4_t5, days_missing, log)
        return lines, lilith

    def test_a_second_run_on_a_saved_day_saves_nothing_and_emails_nobody(self):
        self.send = lambda day, rows: self.sent.append(day) or {"saved": False, "taken_on": day, "latest": day, "filled": 0}
        lines, _ = self.run_job(now=EVENING)
        self.assertEqual(self.sent, ["2026-11-14"])
        self.assertEqual(self.mails, [])
        self.assertEqual(lines[-1], "Nothing new: the latest Roster Snapshot is already 2026-11-14.")

    def test_a_run_after_a_missed_day_saves_the_missed_day_and_the_newest(self):
        lines, lilith = self.run_job(missing=["2026-11-13"])
        self.assertEqual(self.asked_missing_since, ["2026-08-17"])  # no further back than Lilith's history
        self.assertEqual([d for d, _ in self.sent], ["2026-11-14", "2026-11-13"])
        self.assertIn("start=2026-11-13&end=2026-11-13", lilith.asked[2][0])
        self.assertEqual(lines[-1], "Saved the missed day 2026-11-13: 2 Governors.")

    def test_a_missed_day_lilith_cannot_give_does_not_fail_the_run(self):
        lilith = FakeLilith()
        real = lilith.__call__

        def answer(req, timeout):
            if "start=2026-11-13" in req.full_url:
                return io.BytesIO(json.dumps({"code": 200, "msg": "OK", "data": [], "total": 0}).encode())
            return real(req, timeout)
        lines, _ = self.run_job(answer, missing=["2026-11-13"])
        self.assertEqual([d for d, _ in self.sent], ["2026-11-14"])
        self.assertEqual(lines[-1], "Couldn't save the missed day 2026-11-13: Lilith has no member data for 2026-11-13.")

    def test_the_evening_run_sends_the_reminders_a_failed_morning_run_could_not(self):
        os.environ["LILITH_PAUTH"] = token(NOW + datetime.timedelta(days=3))
        log = roster.day_log(None, "2026-11-15")  # the morning run left nothing: it failed before them
        self.run_job(FakeLilith(day="2026-11-11"), log=log, now=EVENING)
        self.assertEqual(self.mails, ["Roster job: the Lilith token expires 2026-11-18",
                                      "Roster job: Lilith's newest stats are from 2026-11-11"])

    def test_the_day_counts_as_saved_once_its_snapshot_is_in_even_if_the_run_fails_after(self):
        log = roster.day_log(None, "2026-11-15")
        def days_missing(since):
            raise SystemExit("Supabase refused /rest/v1/rpc/roster_days_missing: 500")
        with self.assertRaises(SystemExit):
            roster.run(args(), NOW, FakeLilith(), self.send, self.mails.append, lambda since: [], days_missing, log)
        self.assertTrue(log["saved"])

    def test_a_run_that_fails_before_saving_leaves_the_day_unsaved(self):
        log = roster.day_log(None, "2026-11-15")
        with self.assertRaises(roster.RosterError):
            self.run_job(FakeLilith(status=401), log=log)
        self.assertFalse(log["saved"])

    def test_a_second_run_on_the_same_day_sends_no_reminder_again(self):
        os.environ["LILITH_PAUTH"] = token(NOW + datetime.timedelta(days=3))
        log = roster.day_log(None, "2026-11-15")
        self.run_job(FakeLilith(day="2026-11-11"), log=log)
        self.mails = []
        lines, _ = self.run_job(FakeLilith(day="2026-11-11"), log=log, now=EVENING)
        self.assertEqual(self.mails, [])
        self.assertIn("already emailed today", lines[0])

    def test_a_reminder_that_could_not_be_mailed_is_tried_again_by_the_next_run(self):
        os.environ["LILITH_PAUTH"] = token(NOW + datetime.timedelta(days=3))
        log = roster.day_log(None, "2026-11-15")
        def broken(subject, body):
            raise TimeoutError("smtp timed out")
        roster.run(args(), NOW, FakeLilith(), self.send, broken, lambda since: [], lambda since: [], log)
        self.run_job(log=log, now=EVENING)
        self.assertEqual(self.mails, ["Roster job: the Lilith token expires 2026-11-18"])

    def test_saved_days_without_t4_t5_are_filled_from_lilith_history(self):
        def send(day, rows):
            self.sent.append((day, rows))
            if day == "2026-11-14":
                return {"saved": True, "taken_on": day, "rows": len(rows), "new_governors": 0, "renamed": 0, "inactive": 0, "current": 0}
            return {"saved": False, "taken_on": day, "latest": "2026-11-14", "filled": len(rows)}
        self.send = send
        lines, lilith = self.run_job(without=["2026-11-10", "2026-11-12"])
        self.assertEqual(self.asked_since, ["2026-08-17"])  # Lilith keeps at least 90 days
        self.assertEqual([d for d, _ in self.sent], ["2026-11-14", "2026-11-10", "2026-11-12"])
        self.assertIn("start=2026-11-10&end=2026-11-10", lilith.asked[2][0])
        self.assertEqual({k: self.sent[1][1][0][k] for k in ("t4_kills", "t5_kills", "t4_deaths", "t5_deaths")},
                         {"t4_kills": 3, "t5_kills": 2, "t4_deaths": 4, "t5_deaths": 0})
        self.assertEqual(lines[-2:], ["Filled T4/T5 kills and deaths for 2026-11-10: 2 Governors.",
                                      "Filled T4/T5 kills and deaths for 2026-11-12: 2 Governors."])
        self.assertEqual(self.mails, [])

    def test_a_saved_day_lilith_cannot_give_does_not_fail_the_run(self):
        lilith = FakeLilith()
        real = lilith.__call__

        def answer(req, timeout):
            if "start=2026-11-10" in req.full_url:
                lilith.asked.append((req.full_url, {}))
                return io.BytesIO(json.dumps({"code": 200, "msg": "OK", "data": [], "total": 0}).encode())
            return real(req, timeout)
        lines, _ = self.run_job(answer, without=["2026-11-10"])
        self.assertEqual([d for d, _ in self.sent], ["2026-11-14"])
        self.assertEqual(lines[-1], "Couldn't fill T4/T5 kills and deaths for 2026-11-10: Lilith has no member data for 2026-11-10.")

    def test_a_dry_run_fills_nothing(self):
        lines, _ = self.run_job(dry_run=True, without=["2026-11-10"], missing=["2026-11-13"])
        self.assertEqual([self.sent, self.asked_since, self.asked_missing_since], [[], [], []])

    def test_saves_the_newest_day_with_character_ids_and_the_kept_columns(self):
        lines, lilith = self.run_job()
        self.assertEqual(self.sent, [("2026-11-14", [
            {"id": "149673994", "name": "FKK CATHAY", "power": 125, "highest_power": 126, "kill_points": 7, "resources_gathered": 8, "alliance_helps": 9,
             "t4_kills": 3, "t5_kills": 2, "t4_deaths": 4, "t5_deaths": 0},
            {"id": "49913581", "name": "Zhuī Mìng", "power": 104, "highest_power": 105, "kill_points": 7, "resources_gathered": 8, "alliance_helps": 9,
             "t4_kills": 3, "t5_kills": 2, "t4_deaths": 4, "t5_deaths": 0}])])
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
        for field, value, message in [("power", "12M", "power is '12M'"), ("t4", 1.5, "t4 is 1.5"),
                                      ("dead_t5", -1, "dead_t5 is -1"), ("t5", "7", "t5 is '7'")]:
            with self.subTest(field):
                with self.assertRaisesRegex(roster.RosterError, message):
                    self.run_job(FakeLilith(members=[{**member("1", "A", 0), field: value}]))
        self.assertEqual(self.sent, [])

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
        lines = roster.run(args(), NOW, FakeLilith(day="2026-11-11"), self.send, broken, lambda since: [], lambda since: [])
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


class DayLog(unittest.TestCase):
    """What the day's runs did, kept on the host between runs: whether one saved, and the reminders sent."""

    def setUp(self):
        self.dir = tempfile.TemporaryDirectory()
        self.path = Path(self.dir.name) / "runs" / "roster-day.json"

    def tearDown(self):
        self.dir.cleanup()

    def test_a_day_with_no_run_yet_has_saved_nothing_and_sent_nothing(self):
        self.assertEqual(roster.day_log(self.path, "2026-11-15"), {"day": "2026-11-15", "saved": False, "reminded": []})

    def test_the_second_run_reads_what_the_first_wrote(self):
        roster.save_day_log(self.path, {"day": "2026-11-15", "saved": True, "reminded": ["token"]})
        self.assertEqual(roster.day_log(self.path, "2026-11-15"), {"day": "2026-11-15", "saved": True, "reminded": ["token"]})

    def test_a_new_day_starts_afresh(self):
        roster.save_day_log(self.path, {"day": "2026-11-15", "saved": True, "reminded": ["token"]})
        self.assertEqual(roster.day_log(self.path, "2026-11-16"), {"day": "2026-11-16", "saved": False, "reminded": []})

    def test_a_garbled_log_starts_afresh(self):
        self.path.parent.mkdir(parents=True)
        self.path.write_text("{not json", encoding="utf-8")
        self.assertEqual(roster.day_log(self.path, "2026-11-15"), {"day": "2026-11-15", "saved": False, "reminded": []})


if __name__ == "__main__":
    unittest.main()
