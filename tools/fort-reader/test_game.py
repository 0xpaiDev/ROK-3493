import tempfile
import unittest
from pathlib import Path

from game import device_serial, screen_size


class DeviceChoice(unittest.TestCase):
    def test_an_adb_address_in_the_environment_wins_over_bluestacks(self):
        missing_conf = Path(tempfile.gettempdir()) / "no-such-dir" / "bluestacks.conf"
        serial = device_serial({"FORT_READER_ADB": "127.0.0.1:5555"}, missing_conf)
        self.assertEqual(serial, "127.0.0.1:5555")

    def test_without_an_address_the_running_bluestacks_instance_is_found_by_name(self):
        with tempfile.TemporaryDirectory() as d:
            conf = Path(d) / "bluestacks.conf"
            conf.write_text(
                'bst.instance.Pie64.display_name="Other"\n'
                'bst.instance.Pie64.status.adb_port="5555"\n'
                'bst.instance.Pie64_1.display_name="ROK"\n'
                'bst.instance.Pie64_1.status.adb_port="5565"\n',
                encoding="utf-8",
            )
            self.assertEqual(device_serial({}, conf), "127.0.0.1:5565")


class ScreenSize(unittest.TestCase):
    def test_a_1600x900_screen_is_accepted(self):
        self.assertEqual(screen_size("Physical size: 1600x900\n"), (1600, 900))

    def test_a_screen_that_isnt_1600x900_is_refused_naming_its_size(self):
        with self.assertRaises(SystemExit) as stop:
            screen_size("Physical size: 1080x1920\n")
        self.assertIn("1080x1920", str(stop.exception))


if __name__ == "__main__":
    unittest.main()
