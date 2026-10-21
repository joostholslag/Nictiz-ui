#!/usr/bin/env bash
# Writes the npm user config for Better's registry exactly as the Hub access
# guide prescribes (docs.better.care → access-guides/artifactory, "NPM
# Repository Access"): the Base64 credential from api/npm/auth as
# //hub.better.care/:_auth, plus always-auth. The @better scope → registry
# mapping is the project-level app/.npmrc. Env: BETTER_USER, BETTER_TOKEN.
# Usage: better-npmrc.sh <output-file>
set -euo pipefail
out=${1:?output file}
: "${BETTER_USER:?}" "${BETTER_TOKEN:?}"
umask 077
reply=$(curl -sSf -u "$BETTER_USER:$BETTER_TOKEN" https://hub.better.care/artifactory/api/npm/auth | tr -d '\r')
auth=$(printf '%s\n' "$reply" | sed -n 's/^_auth *= *//p')
[ -n "$auth" ] || { echo "no _auth from hub.better.care: wrong user/token, or no npm access" >&2; exit 1; }
[ -z "${GITHUB_ACTIONS:-}" ] || echo "::add-mask::$auth"
printf '//hub.better.care/:_auth=%s\nalways-auth=true\n' "$auth" > "$out"
# npm ≥7 looks auth up by the registry's full path, so the guide's host-level
# key alone may not be consulted for https://hub.better.care/npm/; add it too.
printf '//hub.better.care/npm/:_auth=%s\n' "$auth" >> "$out"
