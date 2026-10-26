#!/bin/sh
# Builds the heka-news image for this commit and pushes it to the LAN registry. Copied from
# heka-site's build-image.sh. Skips the build when the registry already has this commit's tag, so
# a re-run deploy does not rebuild.
#
#   sh .forgejo/scripts/build-image.sh heka-news Dockerfile
#
# Needs CI_COMMIT_SHA, a Docker CLI with buildx, curl, and the host's Docker socket. The daemon is
# the host's, so it pushes to the registry as the host does. Run from the repo root (the build
# context).
set -eu

name="${1:?usage: build-image.sh <image name> <dockerfile>}"
dockerfile="${2:?usage: build-image.sh <image name> <dockerfile>}"
: "${CI_COMMIT_SHA:?CI_COMMIT_SHA is not set}"
registry="${HEKA_NEWS_REGISTRY:-192.168.5.251:5000}"
ref="${registry}/${name}:${CI_COMMIT_SHA}"

# The registry's HTTP API, not `docker manifest inspect`, which wants TLS for a registry that is
# not on localhost. 200: the tag exists. 404: it does not. Anything else: build anyway.
accept='application/vnd.oci.image.index.v1+json,application/vnd.oci.image.manifest.v1+json'
accept="${accept},application/vnd.docker.distribution.manifest.list.v2+json"
accept="${accept},application/vnd.docker.distribution.manifest.v2+json"
code="$(curl -s -o /dev/null -I -w '%{http_code}' --max-time 10 -H "Accept: ${accept}" \
  "http://${registry}/v2/${name}/manifests/${CI_COMMIT_SHA}" || true)"
case "$code" in
  200)
    echo "${ref} is already in the registry; skipping the build"
    exit 0
    ;;
  404) ;;
  *) echo "Could not ask the registry about ${ref} (HTTP ${code:-none}); building it" ;;
esac

docker build -f "$dockerfile" --build-arg "GIT_SHA=${CI_COMMIT_SHA}" -t "$ref" .
docker push "$ref"
echo "Pushed ${ref}"
