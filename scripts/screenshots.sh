#!/bin/sh
# Screenshots of the key pages in light and dark, on a desktop and a 390px phone, with headless
# Chrome. For reviewing a visual change against seed data (frontend-design asks for screenshots;
# break-ui wants the worst cases looked at, not imagined).
#
#   sh scripts/screenshots.sh [base URL] [output dir]     default http://localhost:8080 ./shots
#
# Needs a running server with seed data (bun run seed && bun run dev) and google-chrome (or
# CHROME=...). Pages: the front page, the long post with the deep comment thread, a second post,
# the status feed, a profile and the invite tree.
set -eu

base="${1:-http://localhost:8080}"
out="${2:-shots}"
chrome="${CHROME:-google-chrome}"
mkdir -p "$out"

# Item ids from the seed, found by title so the script survives reseeding.
item_id() {
  curl -fsS "${base}/posts" | tr '<' '\n' | grep -F "$1" | grep '^a href="/item/' | head -n1 |
    sed -n 's|^a href="/item/\([0-9]*\)".*|\1|p'
}
thread="$(item_id 'Holdout scenarios')"
post="$(item_id 'What broke when we ran forty agents')"

shot() {
  # $1 name, $2 path, $3 width, $4 height, $5 light|dark
  flags=""
  [ "$5" = dark ] && flags="--force-dark-mode --blink-settings=preferredColorScheme=0"
  profile="$(mktemp -d)"
  # shellcheck disable=SC2086
  "$chrome" --headless=new --disable-gpu --hide-scrollbars --no-first-run --no-default-browser-check \
    --user-data-dir="$profile" --virtual-time-budget=4000 --force-device-scale-factor=1 \
    --window-size="$3,$4" $flags --screenshot="${out}/$1-$3-$5.png" "${base}$2" >/dev/null 2>&1
  rm -rf "$profile"
}

for page in "front|/|1800|2600" "thread|/item/${thread}|6200|9000" "post|/item/${post}|2000|2800" \
  "status|/status|1600|2600" "profile|/u/ledgerline|1400|1900" "tree|/tree|1300|1900"; do
  name="$(echo "$page" | cut -d'|' -f1)"
  path="$(echo "$page" | cut -d'|' -f2)"
  desktop_h="$(echo "$page" | cut -d'|' -f3)"
  phone_h="$(echo "$page" | cut -d'|' -f4)"
  for scheme in light dark; do
    shot "$name" "$path" 1280 "$desktop_h" "$scheme"
    shot "$name" "$path" 390 "$phone_h" "$scheme"
  done
done
ls "$out"
