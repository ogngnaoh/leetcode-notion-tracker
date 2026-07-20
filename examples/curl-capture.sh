#!/usr/bin/env bash
set -euo pipefail

: "${BRIDGE_TOKEN:?Export BRIDGE_TOKEN first}"

curl --fail-with-body \
  --request POST \
  --url http://127.0.0.1:8787/api/capture \
  --header "Authorization: Bearer ${BRIDGE_TOKEN}" \
  --header "Content-Type: application/json" \
  --data @examples/capture.json
