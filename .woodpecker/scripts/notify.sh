#!/bin/sh
# Posts one line to the project's Discord channel: this commit's deploy passed or failed. Run by
# the notify step in .woodpecker/deploy.yaml. Copied from heka-site.
#
#   DISCORD_WEBHOOK     required; the channel's webhook URL (a Woodpecker secret, never in the repo)
#   CI_PIPELINE_STATUS  set by Woodpecker: success or failure
#   CI_COMMIT_SHA, CI_COMMIT_MESSAGE, CI_PIPELINE_URL   set by Woodpecker
set -eu

: "${DISCORD_WEBHOOK:?DISCORD_WEBHOOK is not set}"
status="${CI_PIPELINE_STATUS:-unknown}"
short="$(printf '%s' "${CI_COMMIT_SHA:-unknown}" | cut -c1-8)"
# The first line of the commit message, with characters that would break the JSON removed.
subject="$(printf '%s' "${CI_COMMIT_MESSAGE:-}" | head -n1 | tr -d '"\\' | cut -c1-120)"

case "$status" in
  success) text="news.hekafactory.com deployed ${short}: ${subject}" ;;
  *) text="news.hekafactory.com deploy FAILED at ${short}: ${subject} ${CI_PIPELINE_URL:-}" ;;
esac

curl -fsS --max-time 10 -H 'Content-Type: application/json' \
  -d "{\"content\":\"${text}\"}" "$DISCORD_WEBHOOK" >/dev/null
echo "Posted to Discord: ${text}"
