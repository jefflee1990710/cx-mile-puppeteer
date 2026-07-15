#!/usr/bin/env bash
# Launch Google Chrome with remote debugging so cx-mile-puppeteer can attach
# to the SAME kind of browser the extension uses (real profile + cookies).
#
# Usage:
#   ./scripts/launch-chrome-debug.sh
#   # then in .env.local:
#   CX_CDP_URL=http://127.0.0.1:9222
#   pnpm dev
#
set -euo pipefail
PORT="${CX_DEBUG_PORT:-9222}"
PROFILE="${CX_DEBUG_PROFILE:-$HOME/.cx-mile-puppeteer/chrome-debug-profile}"
EXT_DIST="${CX_EXTENSION_DIST:-$HOME/Projects/HKSG/cx-mile-flight-scanner/dist}"
mkdir -p "$PROFILE"

CHROME=""
for c in \
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  "/Applications/Chromium.app/Contents/MacOS/Chromium" \
  "google-chrome" \
  "chromium"; do
  if command -v "$c" >/dev/null 2>&1 || [[ -x "$c" ]]; then
    CHROME="$c"
    break
  fi
done
if [[ -z "$CHROME" ]]; then
  echo "Google Chrome not found" >&2
  exit 1
fi

ARGS=(
  --remote-debugging-port="$PORT"
  --user-data-dir="$PROFILE"
  --no-first-run
  --no-default-browser-check
  "https://www.cathaypacific.com/cx/en_HK/book-a-trip/redeem-flights/redeem-flight-awards.html"
)
if [[ -d "$EXT_DIST" && -f "$EXT_DIST/manifest.json" ]]; then
  ARGS+=(--disable-extensions-except="$EXT_DIST" --load-extension="$EXT_DIST")
  echo "Loading extension from $EXT_DIST"
fi

echo "Chrome CDP → http://127.0.0.1:$PORT"
echo "Profile    → $PROFILE"
echo "Set CX_CDP_URL=http://127.0.0.1:$PORT then pnpm dev / Start"
echo "If Access Denied: rm -rf \"$PROFILE\" and relaunch (burned Akamai cookies)."
exec "$CHROME" "${ARGS[@]}"
