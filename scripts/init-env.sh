#!/usr/bin/env bash
# Generate a local .env with fresh random secrets. Refuses to overwrite an
# existing .env unless --force is passed.
set -euo pipefail

cd "$(dirname "$0")/.."

force=0
if [[ "${1:-}" == "--force" ]]; then
  force=1
fi

if [[ -f .env && "$force" -ne 1 ]]; then
  echo ".env already exists; refusing to overwrite (pass --force to replace)." >&2
  exit 1
fi

if ! command -v openssl >/dev/null 2>&1; then
  echo "openssl is required to generate secrets." >&2
  exit 1
fi

umask 077

gen_hex() { openssl rand -hex 32; }
gen_password() { openssl rand -base64 24 | tr -d '\n='; }

cat > .env <<EOF
POSTGRES_USER=tutor
POSTGRES_PASSWORD=$(gen_hex)
POSTGRES_DB=tutor_booking
JWT_SECRET=$(gen_hex)
PAYMENT_WEBHOOK_SECRET=$(gen_hex)
SEED_ADMIN_PASSWORD=$(gen_password)
SEED_DEMO_DATA=true
APP_BASE_URL=http://localhost:8080
EOF

chmod 600 .env
echo "Wrote .env with generated secrets (mode 600)."
