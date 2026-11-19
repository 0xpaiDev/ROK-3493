import datetime
import tempfile
import unittest
from pathlib import Path

from PIL import Image

from alert import after_roster_run, after_run, mail

MAIL = {
    "FORT_READER_GMAIL": "reader@gmail.com",
    "FORT_READER_GMAIL_APP_PASSWORD": "abcd efgh ijkl mnop",
    "FORT_READER_ALERT_TO": "petras@example.com",
    "FORT_READER_ALERT_COUNCIL": "council1@example.com, council2@example.com",
}
WEDNESDAY = datetime.datetime(2026, 11, 11, 23, 45, tzinfo=datetime.timezone.utc)
SUNDAY = datetime.datetime(2026, 11, 15, 23, 45, tzinfo=datetime.timezone.utc)


class FakeGmail:
    """Gmail's SMTP server at the edge: keeps every message it is handed."""
    sent = []
    timeouts = []

    def __init__(self, host, port, timeout=None):
        self.host = host
        FakeGmail.timeouts.append(timeout)

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def login(self, user, password):
        self.user = user

    def send_message(self, msg):
        FakeGmail.sent.append(msg)


class FailureAlert(unittest.TestCase):
    def setUp(self):
        FakeGmail.sent = []
        FakeGmail.timeouts = []
        self.dir = tempfile.TemporaryDirectory()
        self.shot = Path(self.dir.name) / "stopped-login.png"
        Image.new("RGB", (16, 9)).save(self.shot)

    def tearDown(self):
        self.dir.cleanup()

    def test_a_failed_run_emails_petras_the_reason_with_the_screenshot_attached(self):
        after_run("Stopped on the login screen: log the Reader Account in by hand.",
                  self.shot, MAIL, WEDNESDAY, smtp=FakeGmail)
        [msg] = FakeGmail.sent
        body = msg.get_body(("plain",)).get_content()
        [png] = [p for p in msg.iter_attachments()]
        self.assertEqual((msg["To"], "log the Reader Account in by hand" in body,
                          png.get_filename(), png.get_content_type()),
                         ("petras@example.com", True, "stopped-login.png", "image/png"))

    def test_a_failed_sunday_run_also_emails_the_council(self):
        after_run("Stopped on the update screen.", self.shot, MAIL, SUNDAY, smtp=FakeGmail)
        [msg] = FakeGmail.sent
        self.assertEqual(msg["To"], "petras@example.com, council1@example.com, council2@example.com")

    def test_a_failed_run_by_hand_on_sunday_morning_emails_only_petras(self):
        # Not the final run: the week closes only on a reading from Sunday 22:00 UTC.
        morning = datetime.datetime(2026, 11, 15, 10, 0, tzinfo=datetime.timezone.utc)
        after_run("Stopped on the update screen.", self.shot, MAIL, morning, smtp=FakeGmail)
        [msg] = FakeGmail.sent
        self.assertEqual(msg["To"], "petras@example.com")

    def test_a_run_that_sent_its_reading_emails_nobody(self):
        after_run(None, None, MAIL, SUNDAY, smtp=FakeGmail)
        self.assertEqual(FakeGmail.sent, [])

    def test_a_run_that_failed_before_any_screenshot_still_emails_petras(self):
        after_run("Couldn't connect to 127.0.0.1:5555 over ADB.", None, MAIL, WEDNESDAY, smtp=FakeGmail)
        [msg] = FakeGmail.sent
        self.assertIn("No screenshot was taken", msg.get_body(("plain",)).get_content())

    def test_a_stalled_gmail_connection_gives_up_instead_of_hanging_the_run(self):
        after_run("Stopped on the login screen.", self.shot, MAIL, WEDNESDAY, smtp=FakeGmail)
        [timeout] = FakeGmail.timeouts
        self.assertTrue(timeout is not None and timeout <= 60, timeout)

    def test_without_mail_settings_a_failed_run_emails_nobody(self):
        after_run("Stopped on the login screen.", self.shot, {}, SUNDAY, smtp=FakeGmail)
        self.assertEqual(FakeGmail.sent, [])


class RosterFailure(unittest.TestCase):
    """The Roster job runs at 06:00 and 18:00 UTC. The failure email comes only when the day has no
    run that saved, and the failed run is the day's last chance (from 18:00 UTC on)."""

    def setUp(self):
        FakeGmail.sent = []

    def at(self, hour):
        return datetime.datetime(2026, 11, 15, hour, 0, tzinfo=datetime.timezone.utc)

    def test_a_failed_morning_run_emails_nobody(self):
        self.assertEqual(after_roster_run("Couldn't reach Lilith's API: timed out.", MAIL, self.at(6), False, smtp=FakeGmail), [])
        self.assertEqual(FakeGmail.sent, [])

    def test_a_late_catch_up_run_before_the_evening_run_emails_nobody(self):
        # A morning run made up at 14:00 after a reboot still has the 18:00 run after it.
        self.assertEqual(after_roster_run("Couldn't reach Lilith's API: timed out.", MAIL, self.at(14), False, smtp=FakeGmail), [])
        self.assertEqual(FakeGmail.sent, [])

    def test_a_failed_evening_run_after_a_morning_run_that_saved_emails_nobody(self):
        self.assertEqual(after_roster_run("Couldn't reach Lilith's API: timed out.", MAIL, self.at(18), True, smtp=FakeGmail), [])
        self.assertEqual(FakeGmail.sent, [])

    def test_a_failed_evening_run_on_a_day_nothing_saved_emails_petras_the_reason(self):
        to = after_roster_run("Couldn't reach Lilith's API: timed out.\nSecond line.", MAIL, self.at(18), False, smtp=FakeGmail)
        [msg] = FakeGmail.sent
        self.assertEqual([to, msg["To"], msg["Subject"]],
                         [["petras@example.com"], "petras@example.com", "Roster job: Couldn't reach Lilith's API: timed out."])
        self.assertIn("2026-11-15 18:00 UTC saved no Roster Snapshot", msg.get_body(("plain",)).get_content())

    def test_a_run_that_saved_emails_nobody(self):
        self.assertEqual(after_roster_run(None, MAIL, self.at(18), True, smtp=FakeGmail), [])
        self.assertEqual(FakeGmail.sent, [])


class PlainNote(unittest.TestCase):
    def setUp(self):
        FakeGmail.sent = []

    def test_a_note_goes_to_petras_only(self):
        to = mail("Roster job: the Lilith token expires 2026-12-15", "Copy a new one.", MAIL, smtp=FakeGmail)
        self.assertEqual(to, ["petras@example.com"])
        self.assertEqual([FakeGmail.sent[0]["To"], FakeGmail.sent[0]["Subject"]],
                         ["petras@example.com", "Roster job: the Lilith token expires 2026-12-15"])

    def test_no_mail_settings_mails_nobody(self):
        self.assertEqual(mail("x", "y", {}, smtp=FakeGmail), [])
        self.assertEqual(FakeGmail.sent, [])


if __name__ == "__main__":
    unittest.main()
