#!/usr/bin/env bash
# Better form-renderer PoC bootstrap: upload the form's OPT into EHRbase and
# create (or find) one demo EHR. Idempotent; prints the EHR id last.
#
# Defaults target the compose stack's dev-bypass ports. Against a cluster, run
# it through .github/workflows/better-poc-bootstrap.yml, which port-forwards
# the in-cluster Services and reads the BFF's own client secret.
#
# Env:
#   EHRBASE_BASE        http://localhost:8082/ehrbase/rest/openehr/v1
#   OIDC_TOKEN_URL      http://localhost:8081/auth/realms/freshehr/protocol/openid-connect/token
#   OIDC_CLIENT_ID      nictiz-ui-svc
#   OIDC_CLIENT_SECRET  dev-nictiz-ui-svc-secret
#   OPT                 form/Vital_Signs_Lite.opt (next to this script)
#   SUBJECT_ID          better-poc-demo
#   SUBJECT_NAMESPACE   better-poc
set -euo pipefail

HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
EHRBASE_BASE=${EHRBASE_BASE:-http://localhost:8082/ehrbase/rest/openehr/v1}
OIDC_TOKEN_URL=${OIDC_TOKEN_URL:-http://localhost:8081/auth/realms/freshehr/protocol/openid-connect/token}
OIDC_CLIENT_ID=${OIDC_CLIENT_ID:-nictiz-ui-svc}
OIDC_CLIENT_SECRET=${OIDC_CLIENT_SECRET:-dev-nictiz-ui-svc-secret}
OPT=${OPT:-$HERE/form/Vital_Signs_Lite.opt}
SUBJECT_ID=${SUBJECT_ID:-better-poc-demo}
SUBJECT_NAMESPACE=${SUBJECT_NAMESPACE:-better-poc}

[ -f "$OPT" ] || { echo "OPT not found: $OPT" >&2; exit 1; }

TOKEN=$(curl -sSf -X POST "$OIDC_TOKEN_URL" \
  -d grant_type=client_credentials \
  -d client_id="$OIDC_CLIENT_ID" \
  -d client_secret="$OIDC_CLIENT_SECRET" | jq -r '.access_token // empty')
[ -n "$TOKEN" ] || { echo "no access token from $OIDC_TOKEN_URL" >&2; exit 1; }

auth=(-H "Authorization: Bearer $TOKEN")
base=${EHRBASE_BASE%/}

template_id=$(grep -o '<template_id><value>[^<]*' "$OPT" | head -1 | sed 's/.*<value>//')
code=$(curl -sS -o /dev/null -w '%{http_code}' "${auth[@]}" \
  -X POST "$base/definition/template/adl1.4" \
  -H 'Content-Type: application/xml' -H 'Accept: application/xml' \
  --data-binary @"$OPT")
case "$code" in
  201) echo "template '$template_id': uploaded" ;;
  409) echo "template '$template_id': already present" ;;
  *)   echo "template upload failed (HTTP $code)" >&2; exit 1 ;;
esac

# One demo EHR, found again by its subject on every later run.
lookup=$(curl -sS -w '\n%{http_code}' "${auth[@]}" -H 'Accept: application/json' \
  "$base/ehr?subject_id=$SUBJECT_ID&subject_namespace=$SUBJECT_NAMESPACE")
lcode=$(printf '%s' "$lookup" | tail -n1)
if [ "$lcode" = 200 ]; then
  ehr_id=$(printf '%s' "$lookup" | sed '$d' | jq -r '.ehr_id.value')
  echo "demo EHR: exists"
else
  status=$(jq -n --arg id "$SUBJECT_ID" --arg ns "$SUBJECT_NAMESPACE" '{
    _type: "EHR_STATUS",
    archetype_node_id: "openEHR-EHR-EHR_STATUS.generic.v1",
    name: { _type: "DV_TEXT", value: "EHR Status" },
    subject: { _type: "PARTY_SELF", external_ref: { _type: "PARTY_REF",
      namespace: $ns, type: "PERSON",
      id: { _type: "GENERIC_ID", value: $id, scheme: "better-poc" } } },
    is_queryable: true, is_modifiable: true }')
  created=$(curl -sS -w '\n%{http_code}' "${auth[@]}" -X POST "$base/ehr" \
    -H 'Content-Type: application/json' -H 'Accept: application/json' \
    -H 'Prefer: return=representation' -d "$status")
  ccode=$(printf '%s' "$created" | tail -n1)
  [ "$ccode" = 201 ] || { echo "EHR creation failed (HTTP $ccode): $(printf '%s' "$created" | sed '$d' | head -c 500)" >&2; exit 1; }
  ehr_id=$(printf '%s' "$created" | sed '$d' | jq -r '.ehr_id.value')
  echo "demo EHR: created"
fi

echo "subject: $SUBJECT_NAMESPACE/$SUBJECT_ID"
echo "ehrId: $ehr_id"
if [ -n "${GITHUB_OUTPUT:-}" ]; then echo "ehr_id=$ehr_id" >> "$GITHUB_OUTPUT"; fi
