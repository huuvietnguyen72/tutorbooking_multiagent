#!/usr/bin/env bash
# Restore a backup made by backup.sh. DESTRUCTIVE: replaces the current database.
# Usage: ./scripts/restore.sh backups/db-<stamp>.dump [--yes]
set -euo pipefail

cd "$(dirname "$0")/.."

file="${1:-}"
if [[ -z "$file" || ! -f "$file" ]]; then
  echo "Usage: $0 <db-*.dump> [--yes]" >&2
  exit 1
fi
if [[ "${2:-}" != "--yes" ]]; then
  read -r -p "This REPLACES the current database with $file. Type 'restore' to continue: " ans
  [[ "$ans" == "restore" ]] || { echo "Aborted."; exit 1; }
fi
set -a; . ./.env; set +a

docker compose stop web api
docker compose exec -T db pg_restore -U "${POSTGRES_USER:-tutor}" -d "${POSTGRES_DB:-tutor_booking}" \
  --clean --if-exists --no-owner < "$file"

stamp="$(basename "$file" | sed 's/^db-//; s/\.dump$//')"
up="$(dirname "$file")/uploads-$stamp.tar.gz"
if [[ -f "$up" ]]; then
  docker compose run --rm --no-deps -T -u root api sh -c 'tar -C /app -xzf - && chown -R node:node /app/uploads' < "$up"
fi

docker compose up -d api web
echo "Restore complete. Check: curl -fsS http://localhost:8080/api/v1/health"
