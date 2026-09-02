#!/usr/bin/env bash
set -euo pipefail

export DISPLAY=:99
export HOME=/workspace/home
export XDG_CACHE_HOME="$HOME/.cache"
export XDG_CONFIG_HOME="$HOME/.config"
export XDG_DATA_HOME="$HOME/.local/share"
export XDG_RUNTIME_DIR=/tmp/hqbot-runtime

mkdir -p \
  /workspace/chrome \
  "$XDG_CACHE_HOME" \
  "$XDG_CONFIG_HOME" \
  "$XDG_DATA_HOME" \
  "$XDG_RUNTIME_DIR"
chmod 0700 "$XDG_RUNTIME_DIR"
rm -f /tmp/.X99-lock

Xvfb "$DISPLAY" -screen 0 1440x900x24 -ac -nolisten tcp &
for _attempt in {1..50}; do
  [[ -S /tmp/.X11-unix/X99 ]] && break
  sleep 0.1
done
[[ -S /tmp/.X11-unix/X99 ]]

eval "$(dbus-launch --sh-syntax)"
openbox-session &
xterm -geometry 110x28+24+52 -title "HQBot terminal" -e bash -lc 'cd /workspace && exec bash' &
google-chrome \
  --disable-background-networking \
  --disable-dev-shm-usage \
  --disable-gpu \
  --disable-sync \
  --no-default-browser-check \
  --no-first-run \
  --no-sandbox \
  --password-store=basic \
  --remote-debugging-address=127.0.0.1 \
  --remote-debugging-port=9222 \
  --restore-last-session \
  --start-maximized \
  --user-data-dir=/workspace/chrome \
  &

x11vnc \
  -display "$DISPLAY" \
  -forever \
  -localhost \
  -nopw \
  -noxdamage \
  -quiet \
  -rfbport 5900 \
  -shared \
  -viewonly &

exec websockify --heartbeat=30 0.0.0.0:6080 127.0.0.1:5900
