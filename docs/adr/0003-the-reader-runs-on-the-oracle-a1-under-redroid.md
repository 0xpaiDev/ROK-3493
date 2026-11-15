---
status: accepted
---

# The reader runs on the Oracle A1 under Redroid

The Live Week needs a daily run, and a final run just before the Monday reset, with no one at a PC. The reader runs on the Oracle Always Free A1 (2 OCPU / 12 GB ARM, Ubuntu 24.04). Android runs there in a Redroid container (Android 13, arm64 only) with a 1600x900, DPI 450 screen and software graphics. The container's data directory sits on the host's disk, so the game files and the Reader Account's login outlive the container. The machine stays on, a timer on it starts each run, and the container runs only for the run: about 1.5 minutes pass from container start to the game's city screen. ADB listens only on the host's loopback address.

The spike in ticket 03 tested this on 2026-11-15. The arm64 game (1.1.13.72, installed from its APK bundle) starts and renders the Fort Destroyer Rankings. The login survives a container stop and start. The existing reader, pointed at the container with `FORT_READER_ADB`, read the full ranking (ranks 1 to 60, no problems found), but only with its swipes slowed to 4 seconds through a test wrapper. The reader as committed reads one screen there and stops; the slower swipe is ticket 04's. Whether last week's ranking can still be seen after the Monday reset is not checked yet. It decides whether the final run may land after 00:00 UTC, not where the reader runs.

## Considered options

- **The home PC woken from sleep by Task Scheduler, running BlueStacks.** It needs no new host, and the reader already works there. But the PC must be on or asleep (not off) every night, Windows updates and sleep settings can break the wake-up, and a failed final run leaves the week Partial. It stays the fallback if the game stops running under Redroid.
- **A paid Windows VM running BlueStacks.** It costs money every month, and nested virtualisation for BlueStacks is fragile on cloud VMs. Already dropped in the spec.

## Consequences

- The A1 is slow for this game. With scrcpy streaming, both cores sat at 100%: the game took about 1.2 of them and scrcpy's encoder about 0.3. A 1.2-second swipe is ignored and a 4-second swipe scrolls; the cause is not established. The reader needs a slower swipe on this device. The one full reading took 407 seconds for 22 screens, run from the home PC through an SSH tunnel with scrcpy streaming; a run on the host should be faster, but still minutes.
- Redroid has no Play Store. Petras installs each game update by hand from the APK bundle (the base, `split_RawAssets` and `split_config.arm64_v8a` parts), as the README will describe.
- The Reader Account must be open nowhere else. After a restart the game once showed "Login failed, REGISTER_AND_LOGING" while the same account was still running in BlueStacks at home. CONFIRM restarted the game and it carried on.
- The host runs Docker with the `binder_linux` module loaded and binderfs mounted at boot. A kernel without them would stop the reader.
