#!/usr/bin/env bash
# Phase 2 — apply the SQL migrations to RDS, in the same order docker-compose
# mounts them into docker-entrypoint-initdb.d. All migrations are idempotent
# (CREATE ... IF NOT EXISTS / guarded DO blocks), so this is safe to re-run.
# Uses local psql if present, otherwise a throwaway postgres:16 Docker container.
source "$(dirname "$0")/lib.sh"

[[ -z "${DB_HOST:-}" ]] && { echo "DB_HOST is empty — run ./10-rds.sh first." >&2; exit 1; }
REPO="$HERE/.."
CONN="host=$DB_HOST port=5432 dbname=$DB_NAME user=$DB_USER sslmode=require"

# psql_run reads SQL from stdin.
if command -v psql >/dev/null; then
  psql_run() { PGPASSWORD="$DB_PASSWORD" psql "$CONN" -v ON_ERROR_STOP=1 -q; }
elif command -v docker >/dev/null; then
  echo "  (psql not installed — using a postgres:16 Docker container)"
  psql_run() { docker run --rm -i -e PGPASSWORD="$DB_PASSWORD" postgres:16 psql "$CONN" -v ON_ERROR_STOP=1 -q; }
else
  echo "Need psql or docker to run migrations." >&2; exit 1
fi

log "Discovering migration order from docker-compose.yml"
FILES=()
while IFS= read -r _f; do [[ -n "$_f" ]] && FILES+=("$_f"); done < <(grep 'docker-entrypoint-initdb.d' "$REPO/docker-compose.yml" \
  | sed -E 's#.*(\./apps/api/db/[^:]+):/docker-entrypoint-initdb.d/([0-9]+)-.*#\2 \1#' \
  | sort -n | awk '{print $2}')
echo "  · ${#FILES[@]} migrations"

for rel in "${FILES[@]}"; do
  f="$REPO/${rel#./}"
  echo "  → $(basename "$f")"
  psql_run < "$f"
done

log "Tables now in the database"
printf '\\dt\n' | psql_run
echo
echo "Done. Next: ./30-api-image.sh"
