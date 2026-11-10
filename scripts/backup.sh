#!/usr/bin/env bash
# Back up the Postgres database (pg_dump, custom format) and the uploads volume.
# Usage: ./scripts/backup.sh [output_dir]   (default: ./backups)
# Keeps the newest $BACKUP_KEEP (default 14) backup sets.
set -euo pipefail

cd "$(dirname "$0")/.."

out_dir="${1:-backups}"
keep="${BACKUP_KEEP:-14}"
stamp="$(date -u +%Y%m%dT%H%M%SZ)"

if [[ ! -f .env ]]; then
  echo ".env not found; run ./scripts/init-env.sh first." >&2
  exit 1
fi
set -a; . ./.env; set +a

mkdir -p "$out_dir"
umask 077

db_file="$out_dir/db-$stamp.dump"
up_file="$out_dir/uploads-$stamp.tar.gz"

# -Fc: compressed custom format, restorable with pg_restore (selective, parallel).
docker compose exec -T db pg_dump -U "${POSTGRES_USER:-tutor}" -d "${POSTGRES_DB:-tutor_booking}" -Fc > "$db_file.tmp"
mv "$db_file.tmp" "$db_file"

# Sanity check: the archive must be readable.
docker compose exec -T db pg_restore --list < "$db_file" >/dev/null

docker compose exec -T api tar -C /app -czf - uploads > "$up_file.tmp" 2>/dev/null || true
if [[ -s "$up_file.tmp" ]]; then mv "$up_file.tmp" "$up_file"; else rm -f "$up_file.tmp"; up_file="(no uploads)"; fi

echo "Backup written: $db_file ; $up_file"

# Retention: delete older sets beyond $keep.
ls -1t "$out_dir"/db-*.dump 2>/dev/null | tail -n +"$((keep + 1))" | while read -r f; do
  rm -f "$f" "$out_dir/uploads-$(basename "$f" | sed 's/^db-//; s/\.dump$//').tar.gz"
done
