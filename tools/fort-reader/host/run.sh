#!/usr/bin/env bash
# One nightly run on the reader's host: start the Android container, read the ranking and send it
# as the Live Week, stop the container. The timer (install.sh) starts this; nobody watches it.
#
# The reader runs even when Android didn't come up: it then fails to reach the device over ADB, and
# that failure emails Petras like any other (and the Council, on Sunday). systemd stops the
# container afterwards whatever happened (ExecStopPost in fort-reader.service).
set -u

HERE="$(cd "$(dirname "$0")/.." && pwd)"   # tools/fort-reader

ADB_ADDRESS="${FORT_READER_ADB:-127.0.0.1:5555}"

echo "$(date -u '+%F %T') UTC: starting redroid"
docker start redroid >/dev/null || echo "docker start redroid failed; the reader will report it"

# Android boots in about 10 s on the A1; give it two minutes.
for _ in $(seq 60); do
  adb connect "$ADB_ADDRESS" >/dev/null 2>&1
  if [ "$(adb -s "$ADB_ADDRESS" shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')" = "1" ]; then
    echo "$(date -u '+%T') UTC: Android is up"
    break
  fi
  sleep 2
done

cd "$HERE" && exec .venv/bin/python fort_reader.py --send
