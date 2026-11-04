#!/usr/bin/env bash
# Demo webhook signature handling from inside the compose network.
# The public entrypoint (nginx) returns 404 for this path; the API only accepts
# requests signed with PAYMENT_WEBHOOK_SECRET, so an unsigned request must 401.
set -euo pipefail

cd "$(dirname "$0")/.."

echo "1) Unsigned webhook through nginx (expected: 404, blocked externally)"
curl -sS -o /dev/null -w '   HTTP %{http_code}\n' \
  -X POST http://localhost:8080/api/v1/payments/webhooks/mock \
  -H 'Content-Type: application/json' \
  -d '{"eventId":"evt_demo"}'

echo "2) Unsigned webhook directly to the API (expected: 401 INVALID_SIGNATURE)"
docker compose exec -T api sh -c \
  "wget -qO- --header='Content-Type: application/json' --post-data='{\"eventId\":\"evt_demo\"}' http://127.0.0.1:3000/api/v1/payments/webhooks/mock" \
  || true
