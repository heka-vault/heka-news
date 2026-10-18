#!/bin/sh
# Deploys this commit to news.hekafactory.com. Woodpecker runs it from .woodpecker/deploy.yaml
# after the image is in the registry, with the stack directory /home/eric/sites/heka-news mounted
# at the same path and the host's Docker socket. Adapted from heka-site's deploy.sh.
#
#   1. Copy deploy/prod/compose.yaml into the stack, write TAG (this commit) into its .env, and
#      make sure data/ exists and belongs to uid 1000 (the image's `bun` user).
#   2. Pull the image and recreate the container; compose waits for its healthcheck.
#   3. Fail unless the container's /healthz reports this commit and / answers.
#   4. Check https://news.hekafactory.com/healthz through the tunnel; a mismatch there is a warning.
#
# Step 3 runs Bun's fetch inside the container (`compose exec ... bun -e`), because this step runs
# in its own container: 127.0.0.1:3311 here is the step's loopback, not the host's published port,
# and the slim image has no wget or curl. That proves the container is serving this build. Step 4
# only warns: Cloudflare may cache briefly, and the tunnel is the tunnel's concern.
#
# POSIX sh, for the docker:cli image (Alpine, with curl added). The overrides with defaults exist
# so the script can run against a scratch stack on a workstation.
#
#   CI_COMMIT_SHA        required; the image tag
#   HEKA_NEWS_DIR        default /home/eric/sites/heka-news
#   HEKA_NEWS_PUBLIC_URL default https://news.hekafactory.com
set -eu

: "${CI_COMMIT_SHA:?CI_COMMIT_SHA is not set}"
repo_dir="$(cd "$(dirname "$0")/../.." && pwd)"
site_dir="${HEKA_NEWS_DIR:-/home/eric/sites/heka-news}"
public_url="${HEKA_NEWS_PUBLIC_URL:-https://news.hekafactory.com}"

fail() {
  echo "DEPLOY FAILED: $*" >&2
  exit 1
}

# `docker compose` in the stack directory, with stdin detached so it cannot read Woodpecker's step
# script.
compose() {
  (cd "$site_dir" && docker compose "$@" </dev/null)
}

show_stack() {
  compose ps -a || true
  compose logs --no-color --tail 40 heka-news || true
}

[ -d "$site_dir" ] || fail "${site_dir} does not exist. The Woodpecker step must mount it (repo Trusted)."

# Files the deploy writes take the stack directory's owner, so eric can read and edit them even
# though the step runs as root.
owner="$(stat -c '%u:%g' "$site_dir")"
place() {
  chmod 644 "$1"
  chown "$owner" "$1" 2>/dev/null || true
  mv "$1" "$2"
}

# --- 1. compose.yaml, .env and data/ -------------------------------------------------------------

compose_tmp="$(mktemp "${site_dir}/.compose.yaml.XXXXXX")"
env_tmp="$(mktemp "${site_dir}/.env.XXXXXX")"
trap 'rm -f "$compose_tmp" "$env_tmp"' EXIT
cp "${repo_dir}/deploy/prod/compose.yaml" "$compose_tmp"
{
  echo "# Written by .woodpecker/scripts/deploy.sh on every deploy. Not secret."
  echo "TAG=${CI_COMMIT_SHA}"
} >"$env_tmp"
place "$compose_tmp" "${site_dir}/compose.yaml"
place "$env_tmp" "${site_dir}/.env"
trap - EXIT

# The database lives here. Create it on the first deploy; never touch what is inside.
mkdir -p "${site_dir}/data"
chown 1000:1000 "${site_dir}/data"

# --- 2. Pull and recreate ------------------------------------------------------------------------

echo "Deploying ${CI_COMMIT_SHA} to ${site_dir}"
compose pull --quiet || fail "cannot pull heka-news:${CI_COMMIT_SHA} from the registry."
compose up -d --wait --wait-timeout 60 --remove-orphans || {
  show_stack
  fail "the container did not become healthy."
}
compose ps

# --- 3. This commit is serving -------------------------------------------------------------------

# GET a path from the server inside the container; prints the body, or nothing on failure.
in_container() {
  compose exec -T heka-news bun -e \
    "const r = await fetch('http://127.0.0.1:8080$1'); if (!r.ok) process.exit(1); console.log(await r.text())" \
    2>/dev/null || true
}

i=0
body=''
while [ "$i" -lt 30 ]; do
  body="$(in_container /healthz)"
  case "$body" in
    *"$CI_COMMIT_SHA"*) break ;;
  esac
  i=$((i + 1))
  sleep 2
done
case "$body" in
  *"$CI_COMMIT_SHA"*) echo "OK container /healthz reports ${CI_COMMIT_SHA}" ;;
  *)
    show_stack
    fail "container /healthz does not report ${CI_COMMIT_SHA}. Last answer: $(printf '%s' "$body" | head -c 200)"
    ;;
esac

[ -n "$(in_container /)" ] || fail "container / returned nothing."
echo "OK container /"

# --- 4. Through the tunnel (warning only) --------------------------------------------------------

public="$(curl -fsS --max-time 10 "${public_url}/healthz" 2>/dev/null || true)"
case "$public" in
  *"$CI_COMMIT_SHA"*) echo "OK ${public_url}/healthz reports ${CI_COMMIT_SHA}" ;;
  *) echo "WARNING: ${public_url}/healthz answered '$(printf '%s' "$public" | head -c 80)', not this commit." >&2 ;;
esac

echo "Deployed ${CI_COMMIT_SHA}: ${public_url}"
