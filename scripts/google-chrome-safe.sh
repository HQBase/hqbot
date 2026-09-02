#!/usr/bin/env bash
set -euo pipefail

for argument in "$@"; do
  case "$argument" in
    -*) continue ;;
    file://*) continue ;;
  esac
  if [[ -f "$argument" ]]; then
    printf '%s\n' \
      'Chrome local files require an absolute file:// URL. Valid example: google-chrome --headless --print-to-pdf=/workspace/hqbot/report.pdf file:///workspace/hqbot/report.html' \
      >&2
    exit 64
  fi
done

exec /usr/bin/google-chrome-stable --disable-dev-shm-usage --no-sandbox "$@"
