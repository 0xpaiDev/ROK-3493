#!/usr/bin/env bash
# Install (or move) the nightly Fort reader run on the host. Run from anywhere as the reader's user:
#     tools/fort-reader/host/install.sh
# It reads FORT_READER_RUN_AT (HH:MM, UTC, 22:00 to 23:50, default 23:45) from the repo's .env, so changing that one
# line and running this again moves the next run. Prints when the next run is.
set -euo pipefail

DIR="$(cd "$(dirname "$0")/.." && pwd)"   # tools/fort-reader
ENV_FILE="$(realpath "$DIR/../..")/.env"
RUN_AT="$(grep -E '^\s*FORT_READER_RUN_AT\s*=' "$ENV_FILE" 2>/dev/null | tail -1 | cut -d= -f2 | tr -d ' "\r' || true)"
RUN_AT="${RUN_AT:-23:45}"
# From 22:00: record_live_week closes the week Complete only on a Sunday reading from 22:00 UTC.
# To 23:50: a run takes about 10 minutes, and a reading sent after the 00:00 reset is refused.
if ! [[ "$RUN_AT" =~ ^(22:[0-5][0-9]|23:[0-4][0-9]|23:50)$ ]]; then
  echo "FORT_READER_RUN_AT must be HH:MM in UTC from 22:00 to 23:50, such as 23:45; .env has '$RUN_AT'." >&2
  exit 1
fi

chmod 600 "$ENV_FILE"   # secrets: readable by this user only
chmod +x "$DIR/host/run.sh"

sed -e "s|__USER__|$(id -un)|" -e "s|__DIR__|$DIR|g" -e "s|__ENV__|$ENV_FILE|" "$DIR/host/fort-reader.service" \
  | sudo tee /etc/systemd/system/fort-reader.service >/dev/null
sudo tee /etc/systemd/system/fort-reader.timer >/dev/null <<EOF
# Written by install.sh from FORT_READER_RUN_AT in .env. Edit that, not this.
[Unit]
Description=Fort reader: one run a day at $RUN_AT UTC; Sunday's closes the Fort Week

[Timer]
OnCalendar=*-*-* $RUN_AT:00 UTC
# No catch-up run after the host was off: one landing after the Monday reset would read the
# new week's ranking at a time nobody chose.
Persistent=false

[Install]
WantedBy=timers.target
EOF

# The daily Roster Snapshot (README: Roster Snapshot). Lilith publishes each day at a time we don't
# know, so it asks twice a day; a day already saved is a quiet no-op. Persistent: a run missed while
# the host was off is made up at boot, which is harmless here.
sed -e "s|__USER__|$(id -un)|" -e "s|__DIR__|$DIR|g" "$DIR/host/roster.service" \
  | sudo tee /etc/systemd/system/roster.service >/dev/null
sudo tee /etc/systemd/system/roster.timer >/dev/null <<EOF
# Written by install.sh. Edit host/install.sh, not this.
[Unit]
Description=Roster job: twice a day, save Lilith's newest day as a Roster Snapshot

[Timer]
OnCalendar=*-*-* 06,18:00:00 UTC
Persistent=true

[Install]
WantedBy=timers.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable --now fort-reader.timer roster.timer >/dev/null
sudo systemctl restart fort-reader.timer roster.timer
systemctl list-timers fort-reader.timer roster.timer --no-pager
