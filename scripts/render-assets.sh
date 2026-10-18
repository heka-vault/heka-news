#!/bin/sh
# Renders public/og.png (the default Open Graph image, 1200×630) from scripts/assets/og.html with
# headless Chrome. The favicon, favicon.ico and apple-touch-icon.png are hekafactory.com's (the
# same mark); copy them from heka-site's public/ when the mark changes there.
#
#   sh scripts/render-assets.sh
#
# Run by hand after changing the mark, the colors or the wording, and commit the result. Needs
# google-chrome (or CHROME=...) and `bun install` done (the image loads fonts from node_modules).
set -eu

cd "$(dirname "$0")/.."
chrome="${CHROME:-google-chrome}"
"$chrome" --headless=new --disable-gpu --hide-scrollbars --force-device-scale-factor=1 \
  --allow-file-access-from-files --virtual-time-budget=2000 \
  --window-size=1200,630 --screenshot=public/og.png "file://$(pwd)/scripts/assets/og.html" >/dev/null 2>&1
echo "Rendered public/og.png"
