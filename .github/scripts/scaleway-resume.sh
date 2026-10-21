#!/usr/bin/env bash
# Power on the Scaleway cluster's instances if they are stopped (the stack may
# be paused to save cost) and wait until they run. Volumes, IPs and the load
# balancer survive a pause, so nothing else changes.
# Env: SCW_SECRET_KEY, SCW_PROJECT_ID, CLUSTER_NAME, SCW_ZONE
set -euo pipefail
: "${SCW_SECRET_KEY:?}" "${SCW_PROJECT_ID:?}" "${CLUSTER_NAME:?}" "${SCW_ZONE:?}"
API="https://api.scaleway.com/instance/v1/zones/$SCW_ZONE"

servers() { # $1 = role tag
  curl -sSf -H "X-Auth-Token: $SCW_SECRET_KEY" \
    "$API/servers?project=$SCW_PROJECT_ID&tags=cluster:$CLUSTER_NAME,role:$1&per_page=100" \
    | jq -r '.servers[] | "\(.id) \(.state | gsub(" "; "_")) \(.name)"'
}

resume() { # $1 = role tag
  local list
  list=$(servers "$1")
  [ -n "$list" ] || { echo "::warning::no $1 servers tagged cluster:$CLUSTER_NAME"; return 0; }
  while read -r id state name; do
    case "$state" in
      running) echo "$name already running" ;;
      starting) echo "$name is starting" ;;
      stopped|stopped_in_place)
        echo "$name: $state -> poweron"
        curl -sSf -o /dev/null -H "X-Auth-Token: $SCW_SECRET_KEY" -H "Content-Type: application/json" \
          -X POST "$API/servers/$id/action" -d '{"action":"poweron"}' ;;
      *) echo "$name is $state, waiting" ;;
    esac
  done <<< "$list"
  for _ in $(seq 1 60); do
    if servers "$1" | awk '$2 != "running" {bad=1} END {exit bad}'; then
      echo "all $1 servers running"; return 0
    fi
    sleep 10
  done
  echo "timed out waiting for $1 servers:" >&2; servers "$1" >&2; exit 1
}

resume control-plane
resume agent
