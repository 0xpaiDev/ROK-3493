"""Scrolling the Fort Destroyer Rankings: every rank must be read whole on some screen."""
import unittest
from types import SimpleNamespace

from fort_reader import scroll_and_read
from merge import merge_frames

ROW_PX, SCREEN_PX, VISIBLE = 101, 900, 6  # the panel on a 1600x900 screen shows ~6 rows
LAST_RANK = 64  # ranks 60 and below have 0 forts, so the run stops on them


class Shot:
    """A screenshot of the fake list: just the position of its top edge, in rows."""

    def __init__(self, top):
        self.top = top

    def save(self, path):
        pass


class SlowDevice:
    """The list as Redroid on the A1 shows it. A swipe is drawn only `lag` looks after it is sent,
    and a swipe sent while another is still waiting lands together with it. `fling` stretches every
    upward swipe, for a list that runs on past the finger."""

    def __init__(self, lag=0, fling=1.0):
        self.top, self.lag, self.fling, self.queued, self.wait = 0.0, lag, fling, [], 0

    def swipe(self, from_y, to_y, ms=1200):
        rows = (from_y - to_y) * SCREEN_PX / ROW_PX
        if rows > 0:
            rows *= self.fling
        if not self.queued:
            self.wait = self.lag
        self.queued.append(rows)

    def screenshot(self):
        if self.queued:
            if self.wait == 0:
                self.top = min(max(self.top + sum(self.queued), 0.0), LAST_RANK - VISIBLE)
                self.queued = []
            else:
                self.wait -= 1
        return Shot(self.top)


def read(shot):
    """Haiku's reading of a fake screen: the rows shown whole, as read.PROMPT asks."""
    rows = [SimpleNamespace(rank=k, name=f"Governor {k}", forts=max(0, 60 - k))
            for k in range(1, LAST_RANK + 1) if k - 1 >= shot.top - 1e-9 and k <= shot.top + VISIBLE + 1e-9]
    return SimpleNamespace(is_fort_ranking=True, pinned=None, rows=rows)


def ranking(device):
    screens = scroll_and_read(device, read, run_dir=None, changed=lambda a, b: a.top != b.top,
                              sleep=lambda s: None)
    frames = [[vars(r) for r in s.rows if r.forts > 0] for s in screens if not isinstance(s, str)]
    return merge_frames(frames)


class Scrolling(unittest.TestCase):
    def test_a_device_that_keeps_up_reads_every_rank(self):
        rows, problems = ranking(SlowDevice())
        self.assertEqual(problems, [])
        self.assertEqual([r["rank"] for r in rows], list(range(1, 60)))

    def test_a_swipe_drawn_a_look_late_is_waited_for_not_sent_twice(self):
        # 2026-11-15 23:45: the first look after a swipe came before Redroid drew it, the reader swiped
        # again, both landed, and ranks 24 and 52 went past the top unread.
        rows, problems = ranking(SlowDevice(lag=1))
        self.assertEqual(problems, [])
        self.assertEqual([r["rank"] for r in rows], list(range(1, 60)))

    def test_a_swipe_drawn_two_looks_late_is_still_one_swipe(self):
        rows, problems = ranking(SlowDevice(lag=2))
        self.assertEqual(problems, [])
        self.assertEqual([r["rank"] for r in rows], list(range(1, 60)))

    def test_a_step_that_carries_a_row_past_the_top_backs_up_and_reads_it(self):
        # Whatever makes a step too long, a rank between two screens is read before moving on.
        rows, problems = ranking(SlowDevice(fling=2.0))
        self.assertEqual(problems, [])
        self.assertEqual([r["rank"] for r in rows], list(range(1, 60)))


if __name__ == "__main__":
    unittest.main()
