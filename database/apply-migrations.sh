#!/usr/bin/env bash
# Apply SQL migrations to the database referenced by DB_URL (from backend/.env or environment).
# Run from anywhere:  bash database/apply-migrations.sh
set -euo pipefail
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"
if [[ -f backend/.env ]]; then
  set -a
  # shellcheck disable=SC1091
  source backend/.env
  set +a
fi
URL="${DB_URL:-postgresql://marketplace_user:marketplace_pass@127.0.0.1:5432/marketplace}"
echo "Applying migrations (set DB_URL or backend/.env)..."
psql "$URL" -v ON_ERROR_STOP=1 -f "$REPO_ROOT/database/migrations/001_init.sql"
psql "$URL" -f "$REPO_ROOT/database/migrations/002_seed.sql"
echo "Migrations finished."
