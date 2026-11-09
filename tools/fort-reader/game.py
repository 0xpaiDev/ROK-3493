"""Drive Rise of Kingdoms in BlueStacks over ADB: screenshot it and swipe the list.

The PC client ignores input from programs, so the reader uses the Android game in BlueStacks.
BlueStacks settings: 1600x900, DPI 450, Advanced > Android Debug Bridge enabled. The instance's
ADB port changes on every BlueStacks start, so it is read from bluestacks.conf each run.
ADB input stays inside the emulator: the PC's mouse is never touched.
"""
import io
import os
import re
import shutil
import subprocess
from pathlib import Path

from PIL import Image, ImageChops, ImageStat

CONF = Path(r"C:\ProgramData\BlueStacks_nxt\bluestacks.conf")
INSTANCE = os.environ.get("BLUESTACKS_INSTANCE", "ROK")  # the instance's display name
ADB_CANDIDATES = [
    shutil.which("adb"),
    os.path.expandvars(r"%LOCALAPPDATA%\Android\Sdk\platform-tools\adb.exe"),
    r"C:\Program Files\BlueStacks_nxt\HD-Adb.exe",
]


def adb_path():
    for p in ADB_CANDIDATES:
        if p and Path(p).exists():
            return p
    raise SystemExit("No adb found: install Android platform-tools or BlueStacks.")


def instance_port():
    if not CONF.exists():
        raise SystemExit(f"BlueStacks isn't installed ({CONF} is missing).")
    conf = dict(re.findall(r'^(\S+?)="(.*)"$', CONF.read_text(encoding="utf-8"), re.M))
    key = next((k for k, v in conf.items() if k.endswith(".display_name") and v == INSTANCE), None)
    if key is None:
        raise SystemExit(f'No BlueStacks instance named "{INSTANCE}" (set BLUESTACKS_INSTANCE).')
    port = conf.get(key.replace(".display_name", ".status.adb_port"))
    if not port:
        raise SystemExit(f'The "{INSTANCE}" instance isn\'t running.')
    return port


class Device:
    def __init__(self):
        self.adb = adb_path()
        self.serial = f"127.0.0.1:{instance_port()}"
        out = self._run("connect", self.serial, serial=False).decode(errors="replace")
        if "connected" not in out:
            raise SystemExit(f"Couldn't connect to BlueStacks over ADB: {out.strip()}. "
                             "Check Settings > Advanced > Android Debug Bridge.")
        w, h = map(int, re.search(rb"(\d+)x(\d+)", self._run("shell", "wm", "size")).groups())
        self.size = (w, h)

    def _run(self, *args, serial=True):
        cmd = [self.adb] + (["-s", self.serial] if serial else []) + list(args)
        return subprocess.run(cmd, capture_output=True, check=True, timeout=30).stdout

    def screenshot(self):
        return Image.open(io.BytesIO(self._run("exec-out", "screencap", "-p"))).convert("RGB")

    def swipe(self, from_y, to_y, ms=1200):
        """Drag the list from one height to another (fractions of the screen), slowly, so it
        stops where the finger stops instead of flinging on."""
        w, h = self.size
        x = int(w * 0.62)  # the empty middle of the rows, away from names and avatars
        self._run("shell", "input", "swipe", str(x), str(int(h * from_y)), str(x), str(int(h * to_y)), str(ms))


def list_changed(a, b):
    """Did the ranking list move between two screenshots? Looks only at the panel's middle,
    since the map behind the panel keeps animating."""
    w, h = a.size
    box = (int(w * 0.3), int(h * 0.4), int(w * 0.7), int(h * 0.8))
    diff = ImageChops.difference(a.crop(box).convert("L"), b.crop(box).convert("L"))
    return ImageStat.Stat(diff).mean[0] > 2
