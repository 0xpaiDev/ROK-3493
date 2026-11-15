"""Drive Rise of Kingdoms on an Android device over ADB: screenshot it and swipe the list.

The PC client ignores input from programs, so the reader uses the Android game. With
FORT_READER_ADB set (for example Redroid's 127.0.0.1:5555) it talks to that device; without it,
to BlueStacks, whose instance ADB port changes on every start, so it is read from bluestacks.conf
each run. BlueStacks settings: 1600x900, DPI 450, Advanced > Android Debug Bridge enabled.
Any device must have a 1600x900 screen.
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


def device_serial(env, conf_path=CONF):
    """The ADB address to talk to: FORT_READER_ADB when set (Redroid, a phone, any device),
    else the running BlueStacks instance, found in bluestacks.conf."""
    address = env.get("FORT_READER_ADB", "").strip()
    if address:
        return address
    return f"127.0.0.1:{instance_port(conf_path)}"


def instance_port(conf_path=CONF):
    if not conf_path.exists():
        raise SystemExit(f"BlueStacks isn't installed ({conf_path} is missing). "
                         "On another device, set FORT_READER_ADB in .env to its ADB address.")
    conf = dict(re.findall(r'^(\S+?)="(.*)"$', conf_path.read_text(encoding="utf-8"), re.M))
    key = next((k for k, v in conf.items() if k.endswith(".display_name") and v == INSTANCE), None)
    if key is None:
        raise SystemExit(f'No BlueStacks instance named "{INSTANCE}" (set BLUESTACKS_INSTANCE).')
    port = conf.get(key.replace(".display_name", ".status.adb_port"))
    if not port:
        raise SystemExit(f'The "{INSTANCE}" instance isn\'t running.')
    return port


SCREEN = (1600, 900)


def screen_size(wm_size):
    """The screen size from `adb shell wm size`, refused unless it is 1600x900. An override
    size, when the device has one, is the one apps see, and it is printed last."""
    found = re.findall(r"(\d+)x(\d+)", wm_size)
    if not found:
        raise SystemExit(f"Couldn't read the screen size from the device: {wm_size.strip()!r}.")
    size = tuple(map(int, found[-1]))
    if size != SCREEN:
        raise SystemExit(f"The device's screen is {size[0]}x{size[1]}; the reader needs "
                         f"{SCREEN[0]}x{SCREEN[1]}. Set the device to that size and run again.")
    return size


class Device:
    def __init__(self, env=os.environ):
        self.adb = adb_path()
        self.serial = device_serial(env)
        if ":" in self.serial:  # a network address; a USB serial needs no connect
            out = self._run("connect", self.serial, serial=False).decode(errors="replace")
            if "connected" not in out:
                raise SystemExit(f"Couldn't connect to {self.serial} over ADB: {out.strip()}. "
                                 "On BlueStacks, check Settings > Advanced > Android Debug Bridge.")
        # Before any swipe: the swipe fractions and the screen reading assume this layout.
        self.size = screen_size(self._run("shell", "wm", "size").decode(errors="replace"))

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
