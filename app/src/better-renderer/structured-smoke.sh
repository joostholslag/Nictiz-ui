#!/usr/bin/env bash
# Does EHRbase take a web-template STRUCTURED composition through the same
# query parameter the Better form renderer uses (format=STRUCTURED)? Posts two
# variants of a minimal "Vital Signs Lite" composition and reports the HTTP
# codes; nothing here is fatal, the answer feeds the PoC README.
# Env: EHRBASE_BASE, TOKEN (Bearer), EHR_ID
set -uo pipefail
: "${EHRBASE_BASE:?}" "${TOKEN:?}" "${EHR_ID:?}"
base=${EHRBASE_BASE%/}
url="$base/ehr/$EHR_ID/composition?templateId=Vital%20Signs%20Lite&format=STRUCTURED"
now=$(date -u +%Y-%m-%dT%H:%M:%SZ)

post() { # $1 label, $2 content-type, $3 body, [$4 url]
  local out code
  out=$(curl -sS -w '\n%{http_code}' -H "Authorization: Bearer $TOKEN" -H "Content-Type: $2" \
    -H 'Accept: application/json' -H 'Prefer: return=representation' -X POST "${4:-$url}" -d "$3")
  code=$(printf '%s' "$out" | tail -n1)
  printf '%-58s HTTP %s\n' "$1" "$code"
  printf '%s' "$out" | sed '$d' | head -c 700; echo; echo
}

# Variant A: RM attributes spelled out (language/territory/category/context/composer).
explicit=$(jq -n --arg now "$now" '{
  vital_signs_lite: {
    language: [{"|code":"en","|terminology":"ISO_639-1"}],
    territory: [{"|code":"NL","|terminology":"ISO_3166-1"}],
    category: [{"|code":"433","|value":"event","|terminology":"openehr"}],
    context: [{ start_time: [$now], setting: [{"|code":"238","|value":"other care","|terminology":"openehr"}] }],
    composer: [{"|name":"better-poc smoke"}],
    vital_signs: [{ blood_pressure: [{ any_event: [{
      systolic: [{"|magnitude":120,"|unit":"mm[Hg]"}],
      diastolic: [{"|magnitude":80,"|unit":"mm[Hg]"}],
      time: [$now]
    }] }] }]
  }}')
post "A: explicit RM attributes, application/json" application/json "$explicit"
post "A: explicit RM attributes, wt.structured media type" application/openehr.wt.structured.schema+json "$explicit"

# Variant B: the FLAT-style ctx block, unflattened next to the template root.
ctx=$(jq -n --arg now "$now" '{
  ctx: { language: "en", territory: "NL", composer_name: "better-poc smoke", time: $now, setting: "other care" },
  vital_signs_lite: { vital_signs: [{ blood_pressure: [{ any_event: [{
      systolic: [{"|magnitude":121,"|unit":"mm[Hg]"}],
      diastolic: [{"|magnitude":81,"|unit":"mm[Hg]"}]
  }] }] }] }}')
post "B: ctx block, application/json" application/json "$ctx"

# Variant C: Better's own query string for the save (its EHR API shape), to see
# how EHRbase answers the exact URL the renderer would have called online.
post "C: Better-style URL (ehrId as query param)" application/json "$explicit" \
  "$base/composition?ehrId=$EHR_ID&lifecycleState=complete&templateId=Vital%20Signs%20Lite&format=STRUCTURED"
