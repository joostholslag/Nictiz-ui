#!/usr/bin/env bash
# Writes an npm user config that authenticates @better/* against Better's
# registry (hub.better.care, Artifactory) from BETTER_USER + BETTER_TOKEN.
# The registry itself is pinned in app/.npmrc; only the credential lives here.
# Usage: better-npmrc.sh <output-file>
set -euo pipefail
out=${1:?output file}
: "${BETTER_USER:?}" "${BETTER_TOKEN:?}"
umask 077
auth=$(curl -sSf -u "$BETTER_USER:$BETTER_TOKEN" https://hub.better.care/artifactory/api/npm/auth \
  | sed -n 's/^_auth *= *//p' | tr -d '\r')
[ -n "$auth" ] || { echo "no _auth from hub.better.care: wrong user/token, or no npm access" >&2; exit 1; }
[ -z "${GITHUB_ACTIONS:-}" ] || echo "::add-mask::$auth"
printf '//hub.better.care/:_auth=%s\n//hub.better.care/npm/:_auth=%s\n' "$auth" "$auth" > "$out"
