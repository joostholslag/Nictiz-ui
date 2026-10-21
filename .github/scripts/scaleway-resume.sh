#!/usr/bin/env bash
# Power on the Scaleway cluster's instances if they are stopped (the stack may
# be paused to save cost) and wait until they run. Volumes, IPs and the load
# balancer survive a pause, so nothing else changes.
#
# Finds the instances by their Terraform tags (cluster:<name>, role:...) in
# SCW_ZONE first and the other nl-ams zones next, without a project filter, so
# a project id that differs from the stack's does not hide them. Exports the
# zone and project where they were found to $GITHUB_ENV for later steps.
# Env: SCW_SECRET_KEY, CLUSTER_NAME, SCW_ZONE
set -euo pipefail
: "${SCW_SECRET_KEY:?}" "${CLUSTER_NAME:?}" "${SCW_ZONE:?}"
# Secrets pasted into GitHub may carry a trailing newline, which breaks the URLs.
SCW_SECRET_KEY=$(printf '%s' "$SCW_SECRET_KEY" | tr -d '[:space:]')

api() { curl -sSf -H "X-Auth-Token: $SCW_SECRET_KEY" "$@"; }

servers() { # $1 = zone, $2 = role tag → "id state name project"
  api "https://api.scaleway.com/instance/v1/zones/$1/servers?tags=cluster:$CLUSTER_NAME,role:$2&per_page=100" \
    | jq -r '.servers[] | "\(.id) \(.state | gsub(" "; "_")) \(.name) \(.project)"'
}

zone=""
for z in "$SCW_ZONE" nl-ams-1 nl-ams-2 nl-ams-3; do
  if [ -n "$(servers "$z" control-plane)" ]; then zone=$z; break; fi
done
if [ -z "$zone" ]; then
  echo "::error::no instances tagged cluster:$CLUSTER_NAME in $SCW_ZONE or any nl-ams zone"
  for z in "$SCW_ZONE" nl-ams-1 nl-ams-2 nl-ams-3; do
    echo "servers visible to this key in $z:"
    api "https://api.scaleway.com/instance/v1/zones/$z/servers?per_page=50" \
      | jq -r '.servers[] | "  \(.name)\t\(.state)\tproject=\(.project)\ttags=\(.tags | join(","))"' || true
  done | sort -u
  exit 1
fi
project=$(servers "$zone" control-plane | awk '{print $4; exit}')
echo "cluster $CLUSTER_NAME found in zone $zone, project $project"
if [ -n "${GITHUB_ENV:-}" ]; then
  echo "SCW_ZONE=$zone" >> "$GITHUB_ENV"
  echo "SCW_PROJECT_ID=$project" >> "$GITHUB_ENV"
fi
API="https://api.scaleway.com/instance/v1/zones/$zone"

resume() { # $1 = role tag
  local list
  list=$(servers "$zone" "$1")
  [ -n "$list" ] || { echo "::warning::no $1 servers tagged cluster:$CLUSTER_NAME in $zone"; return 0; }
  while read -r id state name _; do
    case "$state" in
      running) echo "$name already running" ;;
      starting) echo "$name is starting" ;;
      stopped|stopped_in_place)
        echo "$name: $state -> poweron"
        api -o /dev/null -H "Content-Type: application/json" \
          -X POST "$API/servers/$id/action" -d '{"action":"poweron"}' ;;
      *) echo "$name is $state, waiting" ;;
    esac
  done <<< "$list"
  for _ in $(seq 1 60); do
    if servers "$zone" "$1" | awk '$2 != "running" {bad=1} END {exit bad}'; then
      echo "all $1 servers running"; return 0
    fi
    sleep 10
  done
  echo "timed out waiting for $1 servers:" >&2; servers "$zone" "$1" >&2; exit 1
}

resume control-plane
resume agent
