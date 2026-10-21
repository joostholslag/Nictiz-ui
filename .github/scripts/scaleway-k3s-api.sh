#!/usr/bin/env bash
# The stack keeps the k3s API (6443) closed to the internet; its own CI opens
# it to the runner's IP for one run and closes it afterwards. Same here.
# Usage: scaleway-k3s-api.sh open|close
# Env: SCW_SECRET_KEY, SCW_PROJECT_ID, CLUSTER_NAME, SCW_ZONE, KUBECONFIG (open)
set -euo pipefail
: "${SCW_SECRET_KEY:?}" "${SCW_PROJECT_ID:?}" "${CLUSTER_NAME:?}" "${SCW_ZONE:?}"
SCW_SECRET_KEY=$(printf '%s' "$SCW_SECRET_KEY" | tr -d '[:space:]')
SCW_PROJECT_ID=$(printf '%s' "$SCW_PROJECT_ID" | tr -d '[:space:]')
API="https://api.scaleway.com/instance/v1/zones/$SCW_ZONE"
api() { curl -sSf -H "X-Auth-Token: $SCW_SECRET_KEY" "$@"; }

sg_id() {
  api "$API/security_groups?project=$SCW_PROJECT_ID&name=$CLUSTER_NAME-sg" \
    | jq -r --arg n "$CLUSTER_NAME-sg" '[.security_groups[] | select(.name == $n)] | if length == 1 then .[0].id else error("expected exactly one security group named \($n), found \(length)") end'
}

case "${1:-}" in
  open)
    RUNNER_IP=$(curl -4 -sSf --retry 3 https://api.ipify.org)
    SG=$(sg_id)
    api -o /dev/null -H "Content-Type: application/json" -X POST "$API/security_groups/$SG/rules" \
      -d "{\"protocol\":\"TCP\",\"direction\":\"inbound\",\"action\":\"accept\",\"ip_range\":\"$RUNNER_IP/32\",\"dest_port_from\":6443,\"dest_port_to\":6443}"
    echo "opened 6443 on $CLUSTER_NAME-sg for $RUNNER_IP"
    if [ -n "${GITHUB_ENV:-}" ]; then echo "K3S_RUNNER_IP=$RUNNER_IP" >> "$GITHUB_ENV"; fi
    SERVER=$(awk '/server:/ {print $2; exit}' "${KUBECONFIG:?}")
    # 5 min: k3s needs time to come up after a resume. Any HTTP status means
    # the TCP connection got through.
    for _ in $(seq 1 150); do
      curl -sk -o /dev/null --max-time 5 "$SERVER/livez" && exit 0
      sleep 2
    done
    echo "::error::k3s API at $SERVER still unreachable from $RUNNER_IP after 5 min"
    exit 1 ;;
  close)
    : "${K3S_RUNNER_IP:?}"
    SG=$(sg_id)
    # Delete by match, not by id: the rule list may have been rewritten meanwhile.
    for id in $(api "$API/security_groups/$SG/rules?per_page=100" \
      | jq -r --arg ip "$K3S_RUNNER_IP" '.rules[] | select(.direction == "inbound" and .dest_port_from == 6443 and (.ip_range == $ip or .ip_range == ($ip + "/32"))) | .id'); do
      api -o /dev/null -X DELETE "$API/security_groups/$SG/rules/$id"
      echo "removed rule $id"
    done ;;
  *) echo "usage: $0 open|close" >&2; exit 1 ;;
esac
