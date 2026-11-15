import datetime
import tempfile
import unittest
from pathlib import Path

from PIL import Image

from alert import after_run

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


if __name__ == "__main__":
    unittest.main()
