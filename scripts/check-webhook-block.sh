#!/usr/bin/env bash
# Security M1: every case/slash variant of the payment webhook must be 404 via nginx.
BASE="${1:-http://localhost:8080}"; rc=0
for p in mock Mock MOCK mock/ Mock/ ""; do
  c=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/api/v1/payments/webhooks/$p")
  [ "$c" = 404 ] || { echo "FAIL /webhooks/$p -> $c"; rc=1; }
done
[ $rc = 0 ] && echo "OK: webhook variants blocked"; exit $rc
