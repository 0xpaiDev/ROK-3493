import unittest

from navigate import Stopped, open_ranking


class FakeGame:
    """The device as the navigator sees it: each look names the next screen in the script
    (the last one repeats), taps are recorded, and waiting moves a fake clock."""

    def __init__(self, *screens):
        self.screens = list(screens)
        self.taps = []
        self.clock = 0.0

    def look(self):
        return self.screens.pop(0) if len(self.screens) > 1 else self.screens[0]

    def tap(self, x, y):
        self.taps.append((x, y))

    def wait(self, seconds):
        self.clock += seconds

    def now(self):
        return self.clock


class OpenRanking(unittest.TestCase):
    def test_from_a_city_with_its_bar_closed_it_follows_the_tap_path_to_the_ranking(self):
        game = FakeGame("city_bar_closed", "city", "alliance", "alliance_settings",
                        "alliance_rankings", "fort_ranking")
        open_ranking(game)
        self.assertEqual(game.taps, [(1540, 820), (1160, 840), (90, 490), (1170, 380), (400, 690)])

    def test_a_login_screen_stops_the_run_without_a_tap(self):
        game = FakeGame("loading", "login")
        with self.assertRaises(Stopped) as stop:
            open_ranking(game)
        self.assertEqual((stop.exception.screen, game.taps), ("login", []))
        self.assertIn("log in", stop.exception.reason)

    def test_an_app_update_prompt_stops_the_run_without_a_tap(self):
        game = FakeGame("loading", "update")
        with self.assertRaises(Stopped) as stop:
            open_ranking(game)
        self.assertEqual((stop.exception.screen, game.taps), ("update", []))
        self.assertIn("app update", stop.exception.reason)

    def test_a_screen_it_doesnt_recognise_stops_the_run_without_a_tap(self):
        game = FakeGame("city", "unknown")
        with self.assertRaises(Stopped) as stop:
            open_ranking(game)
        self.assertEqual((stop.exception.screen, game.taps), ("unknown", [(1160, 840)]))
        self.assertIn("doesn't recognise", stop.exception.reason)

    def test_the_login_failed_box_is_confirmed_and_the_game_carries_on_to_the_ranking(self):
        game = FakeGame("login_failed", "loading", "city", "alliance", "alliance_settings",
                        "alliance_rankings", "fort_ranking")
        open_ranking(game)
        self.assertEqual(game.taps[0], (800, 588))

    def test_the_login_failed_box_over_the_loading_screen_is_left_until_the_city_loads_behind_it(self):
        # BlueStacks' bug: CONFIRM pressed while the game still loads restarts it into the same box.
        game = FakeGame("login_failed_loading", "login_failed_loading", "login_failed", "loading",
                        "city", "alliance", "alliance_settings", "alliance_rankings", "fort_ranking")
        open_ranking(game)
        self.assertEqual(game.taps[0], (800, 588))
        self.assertEqual(game.taps.count((800, 588)), 1)

    def test_a_login_failed_box_over_the_loading_screen_counts_towards_the_loading_limit(self):
        game = FakeGame("login_failed_loading")
        with self.assertRaises(Stopped) as stop:
            open_ranking(game, loading_limit=600)
        self.assertEqual((stop.exception.screen, game.taps), ("login_failed_loading", []))

    def test_a_screen_that_its_tap_never_moves_on_stops_the_run_after_three_taps(self):
        game = FakeGame("city")
        with self.assertRaises(Stopped) as stop:
            open_ranking(game)
        self.assertEqual((stop.exception.screen, len(game.taps)), ("city", 3))
        self.assertIn("stuck", stop.exception.reason)

    def test_two_screens_whose_taps_lead_to_each_other_stop_the_run_instead_of_looping(self):
        game = FakeGame(*["alliance", "alliance_settings"] * 50)
        with self.assertRaises(Stopped) as stop:
            open_ranking(game)
        self.assertIn("stuck", stop.exception.reason)
        self.assertLessEqual(len(game.taps), 7)

    def test_a_download_that_outlasts_its_limit_stops_the_run(self):
        game = FakeGame("loading")
        with self.assertRaises(Stopped) as stop:
            open_ranking(game, loading_limit=600)
        self.assertEqual(stop.exception.screen, "loading")
        self.assertIn("10 minutes", stop.exception.reason)

    def test_a_download_inside_its_limit_is_waited_out(self):
        game = FakeGame(*["loading"] * 100, "city", "alliance", "alliance_settings",
                        "alliance_rankings", "fort_ranking")
        open_ranking(game, loading_limit=600)  # 100 looks, 5 s apart: under 10 minutes


if __name__ == "__main__":
    unittest.main()
