"""The Fort Pause on the reader's side (ADR 0007): before it starts the game, the nightly run asks Supabase,
through the reader's own sign-in, whether the Council paused Forts, and ends quietly if so."""
import io
import json
import os
import tempfile
import types
import unittest
from pathlib import Path
from unittest import mock

import fort_reader
from send import forts_paused_since

SIGN_IN = {"FORT_READER_EMAIL": "reader@example.invalid", "FORT_READER_PASSWORD": "secret"}


class FakeSupabase:
    """Answers the reader's sign-in and its question about the Fort Pause; records what it was asked."""

    def __init__(self, open_pauses):
        self.open_pauses = open_pauses
        self.asked = []

    def __call__(self, req, timeout):
        self.asked.append((req.full_url, req.get_header("Authorization")))
        if "/auth/v1/token" in req.full_url:
            return io.BytesIO(json.dumps({"access_token": "reader-token"}).encode())
        return io.BytesIO(json.dumps(self.open_pauses).encode())


class AskingSupabase(unittest.TestCase):
    def setUp(self):
        self.env = mock.patch.dict(os.environ, SIGN_IN)
        self.env.start()

    def tearDown(self):
        self.env.stop()

    def test_a_pause_still_going_is_answered_with_when_it_started(self):
        supabase = FakeSupabase([{"starts_at": "2026-11-20T18:00:00+00:00"}])
        self.assertEqual(forts_paused_since(supabase), "2026-11-20T18:00:00+00:00")

    def test_forts_running_are_answered_with_none(self):
        self.assertIsNone(forts_paused_since(FakeSupabase([])))

    def test_the_question_goes_through_the_readers_own_sign_in(self):
        supabase = FakeSupabase([])
        forts_paused_since(supabase)
        (sign_in, _), (question, auth) = supabase.asked
        self.assertIn("/auth/v1/token", sign_in)
        self.assertIn("/rest/v1/fort_pause", question)
        self.assertEqual(auth, "Bearer reader-token")


class NightlyRun(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.TemporaryDirectory()
        self.run_dir = Path(self.dir.name) / "run"
        self.started = []
        self.capture = mock.patch.object(fort_reader, "capture", lambda *a: self.started.append("game") or [])
        self.capture.start()

    def tearDown(self):
        self.capture.stop()
        self.dir.cleanup()

    def test_while_forts_are_paused_the_run_ends_quietly_without_starting_the_game(self):
        args = types.SimpleNamespace(source=None, send=True)
        with mock.patch("sys.stdout", new_callable=io.StringIO) as out:
            fort_reader.run(args, self.run_dir, paused=lambda: "2026-11-20T18:00:00+00:00")
        self.assertEqual(self.started, [])
        self.assertFalse(self.run_dir.exists())
        self.assertIn("Forts are paused since 2026-11-20 18:00 UTC", out.getvalue())


if __name__ == "__main__":
    unittest.main()
