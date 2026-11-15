import unittest

from merge import check_pinned, merge_frames, paste_text


def row(rank, name, forts):
    return {"rank": rank, "name": name, "forts": forts}


class MergeFrames(unittest.TestCase):
    def test_overlapping_screenshots_join_by_rank(self):
        rows, problems = merge_frames([
            [row(1, "TasteMyFat", 198), row(2, "ᵛøkrecislaw", 189), row(3, "ᵛøDarkBFarm2", 150)],
            [row(3, "ᵛøDarkBFarm2", 150), row(4, "ᵛøDarkBFarm1", 149)],
        ])
        self.assertEqual([r["rank"] for r in rows], [1, 2, 3, 4])
        self.assertEqual(problems, [])

    def test_a_fort_count_read_two_ways_is_reported_not_picked(self):
        _, problems = merge_frames([[row(1, "A", 10), row(2, "ᵛøYURIEL", 9)], [row(2, "ᵛøYURIEL", 8)]])
        self.assertEqual(len(problems), 1)
        self.assertIn("Rank 2", problems[0])

    def test_a_name_read_two_ways_with_one_fort_count_keeps_every_spelling(self):
        rows, problems = merge_frames([[row(1, "A", 10), row(2, "CRɣ㋳", 2)], [row(1, "A", 10), row(2, "CRУ", 2)]])
        self.assertEqual(problems, [])
        self.assertEqual([(r["rank"], r["name"], r["forts"], r.get("names")) for r in rows],
                         [(1, "A", 10, None), (2, "CRɣ㋳", 2, ["CRɣ㋳", "CRУ"])])

    def test_the_spelling_read_most_often_leads(self):
        rows, _ = merge_frames([[row(1, "ᵞøHBK777", 9)], [row(1, "ᵛøHBK777", 9)], [row(1, "ᵛøHBK777", 9)]])
        self.assertEqual((rows[0]["name"], rows[0]["names"]), ("ᵛøHBK777", ["ᵛøHBK777", "ᵞøHBK777"]))

    def test_a_skipped_screen_shows_as_missing_ranks(self):
        _, problems = merge_frames([[row(1, "A", 10), row(2, "B", 9)], [row(5, "E", 6)]])
        self.assertIn("Missing ranks: 3, 4.", problems)

    def test_a_rising_fort_count_is_reported(self):
        _, problems = merge_frames([[row(1, "A", 10), row(2, "B", 12)]])
        self.assertTrue(any("more forts" in p for p in problems))

    def test_a_list_not_starting_at_rank_1_is_reported(self):
        _, problems = merge_frames([[row(4, "D", 10)]])
        self.assertIn("The ranking starts at rank 4, not 1.", problems)


class Pinned(unittest.TestCase):
    def test_pinned_row_must_match_the_list(self):
        rows = [row(1, "A", 10), row(2, "CƦУ㋾", 9)]
        self.assertEqual(check_pinned(row(2, "CƦУ㋾", 9), rows), [])
        self.assertEqual(len(check_pinned(row(2, "CƦУ㋾", 8), rows)), 1)
        self.assertEqual(len(check_pinned(row(7, "CƦУ㋾", 1), rows)), 1)

    def test_a_pin_read_in_any_spelling_of_its_row_agrees(self):
        rows, _ = merge_frames([[row(1, "ᵞøFarm", 9)], [row(1, "ᵛøFarm", 9)], [row(1, "ᵛøFarm", 9)]])
        self.assertEqual(check_pinned(row(1, "ᵞøFarm", 9), rows), [])
        self.assertEqual(len(check_pinned(row(1, "Someone", 9), rows)), 1)


class PasteText(unittest.TestCase):
    def test_one_governor_per_line_name_then_count(self):
        self.assertEqual(paste_text([row(1, "ᵛøDarkBFarm1", 149)]), "ᵛøDarkBFarm1\t149\n")


if __name__ == "__main__":
    unittest.main()
