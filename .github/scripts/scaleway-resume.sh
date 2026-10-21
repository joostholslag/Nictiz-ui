#!/usr/bin/env bash
# Power on the Scaleway cluster's instances if they are stopped (the stack may
# be paused to save cost) and wait until they run. Volumes, IPs and the load
# balancer survive a pause, so nothing else changes.
#
# Finds the instances by their Terraform tags (cluster:<name>, role:...)
# across the whole organization (a key lists only its default project when no
# scope is given) in SCW_ZONE first and the other nl-ams zones next. Exports
# the zone and project where they were found to $GITHUB_ENV for later steps.
# Env: SCW_SECRET_KEY, SCW_ORGANIZATION_ID, SCW_PROJECT_ID, CLUSTER_NAME, SCW_ZONE
set -euo pipefail
: "${SCW_SECRET_KEY:?}" "${CLUSTER_NAME:?}" "${SCW_ZONE:?}"
# Secrets pasted into GitHub may carry a trailing newline, which breaks the URLs.
SCW_SECRET_KEY=$(printf '%s' "$SCW_SECRET_KEY" | tr -d '[:space:]')
SCW_ORGANIZATION_ID=$(printf '%s' "${SCW_ORGANIZATION_ID:-}" | tr -d '[:space:]')
SCW_PROJECT_ID=$(printf '%s' "${SCW_PROJECT_ID:-}" | tr -d '[:space:]')
api() { curl -sSf -H "X-Auth-Token: $SCW_SECRET_KEY" "$@"; }

# The project is not known up front (the UI repo only holds the organization's
# default project). SCW_SERVER_ID_HINT, the id of any instance of the cluster
# (console URL), resolves it: the key must be allowed to read that instance.
if [ -n "${SCW_SERVER_ID_HINT:-}" ]; then
  hint=$(api "https://api.scaleway.com/instance/v1/zones/$SCW_ZONE/servers/$SCW_SERVER_ID_HINT" \
    | jq -r '.server | "\(.project) \(.name) \(.state) \(.tags | join(","))"') \
    || { echo "::error::cannot read instance $SCW_SERVER_ID_HINT in $SCW_ZONE with this key (no permission on its project?)"; exit 1; }
  SCW_PROJECT_ID=${hint%% *}
  echo "hint instance: ${hint#* } -> project resolved"
  scope="project=$SCW_PROJECT_ID"
elif [ -n "$SCW_ORGANIZATION_ID" ]; then
  scope="organization=$SCW_ORGANIZATION_ID"
else
  scope="project=$SCW_PROJECT_ID"
fi

servers() { # $1 = zone, $2 = role tag -> "id state name project"
  api "https://api.scaleway.com/instance/v1/zones/$1/servers?$scope&tags=cluster:$CLUSTER_NAME,role:$2&per_page=100" \
    | jq -r '.servers[] | "\(.id) \(.state | gsub(" "; "_")) \(.name) \(.project)"'
}

zone=""
for z in "$SCW_ZONE" nl-ams-1 nl-ams-2 nl-ams-3; do
  if [ -n "$(servers "$z" control-plane)" ]; then zone=$z; break; fi
done
if [ -z "$zone" ]; then
  echo "::error::no instances tagged cluster:$CLUSTER_NAME in $SCW_ZONE or any nl-ams zone ($scope)"
  fp() { printf '%s' "$1" | sha256sum | cut -c1-12; }
  echo "configured project id fingerprint: $(fp "$SCW_PROJECT_ID"), organization: $(fp "$SCW_ORGANIZATION_ID")"
  for z in "$SCW_ZONE" nl-ams-1 nl-ams-2 nl-ams-3; do
    for sc in "$scope" "project=$SCW_PROJECT_ID" ""; do
      echo "servers in $z (${sc:-key default project}):"
      api "https://api.scaleway.com/instance/v1/zones/$z/servers?per_page=50&$sc" \
        | jq -r '.servers[] | "  \(.name)\t\(.state)\tproject=\(.project)\ttags=\(.tags | join(","))"' || true
    done
  done | awk '!seen[$0]++'
  echo "projects visible to this key:"
  api "https://api.scaleway.com/account/v3/projects?organization_id=$SCW_ORGANIZATION_ID&page_size=50" \
    | jq -r '.projects[] | "  \(.name)\t\(.id)"' || echo "  (account API not permitted for this key)"
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
