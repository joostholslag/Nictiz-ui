#!/usr/bin/env bash
# Writes the npm user config for Better's registry exactly as the Hub access
# guide prescribes (docs.better.care → access-guides/artifactory, "NPM
# Repository Access"):
#   npm config set '//hub.better.care/:_auth' <ENCODED_TOKEN>
#   npm config set '@better:registry' https://hub.better.care/npm/
# BETTER_NPM_AUTH is that <ENCODED_TOKEN> (the `_auth = ...` value the guide's
# curl against api/npm/auth returns). Without it, BETTER_USER + BETTER_TOKEN
# run that curl here.
# Usage: better-npmrc.sh <output-file>
set -euo pipefail
out=${1:?output file}
umask 077
auth=${BETTER_NPM_AUTH:-}
if [ -z "$auth" ]; then
  : "${BETTER_USER:?}" "${BETTER_TOKEN:?}"
  auth=$(curl -sSf -u "$BETTER_USER:$BETTER_TOKEN" https://hub.better.care/artifactory/api/npm/auth \
    | tr -d '\r' | sed -n 's/^_auth *= *//p')
  [ -n "$auth" ] || { echo "no _auth from hub.better.care: wrong user/token, or no npm access" >&2; exit 1; }
fi
auth=$(printf '%s' "$auth" | tr -d '[:space:]')
[ -z "${GITHUB_ACTIONS:-}" ] || echo "::add-mask::$auth"
: > "$out"
NPM_CONFIG_USERCONFIG=$out npm config set '//hub.better.care/:_auth' "$auth"
NPM_CONFIG_USERCONFIG=$out npm config set '@better:registry' https://hub.better.care/npm/
