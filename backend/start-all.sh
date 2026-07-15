#!/usr/bin/env bash
# Start Deno microservices + Python ML (same role as start-all.ps1 on Windows).
#
#   ./backend/start-all.sh
#
set -euo pipefail

BACKEND_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(dirname "$BACKEND_DIR")"
ML_DIR="$ROOT/ml"

# macOS: new Terminal window running a small temp script (avoids quoting bugs).
mac_window() {
  local body="$1"
  local tmp
  tmp="$(mktemp -t "smart-mp-XXXX")"
  printf '#!/usr/bin/env bash\nset -e\n%s\n' "$body" >"$tmp"
  chmod +x "$tmp"
  local q
  q=$(printf %q "$tmp")
  osascript \
    -e 'tell application "Terminal"' \
    -e '  activate' \
    -e "  do script \"exec bash $q\"" \
    -e 'end tell'
}

linux_bg() {
  local name="$1"
  shift
  local log="${TMPDIR:-/tmp}/smart-marketplace-${name}.log"
  echo "[$name] → $log"
  ( "$@" >>"$log" 2>&1 ) &
}

echo "Project root: $ROOT"

if [[ "$(uname -s)" == "Darwin" ]]; then
  for svc in auth products orders users search; do
    mac_window "$(printf 'cd %q && exec deno run --allow-net --allow-env --allow-read --env-file=.env %q' "$BACKEND_DIR" "${svc}/main.ts")"
    sleep 2
  done
  PY="$ML_DIR/.venv/bin/python"
  if [[ -x "$PY" ]]; then
    mac_window "$(printf 'cd %q && exec %q %q' "$ML_DIR/recommender" "$PY" "api.py")"
    sleep 2
    mac_window "$(printf 'cd %q && exec %q api.py' "$ML_DIR/forecasting" "$PY")"
  else
    echo "Warning: ml/.venv missing — ML services skipped." >&2
  fi
  echo "Opened Terminal windows. Next: cd frontend && npm run dev"
else
  cd "$BACKEND_DIR"
  for svc in auth products orders users search; do
    linux_bg "$svc" deno run --allow-net --allow-env --allow-read --env-file=.env "${svc}/main.ts"
    sleep 1
  done
  PY="$ML_DIR/.venv/bin/python"
  if [[ -x "$PY" ]]; then
    linux_bg "recommender-api" "$PY" "$ML_DIR/recommender/api.py"
    linux_bg "forecasting-api" bash -c "cd $(printf %q "$ML_DIR/forecasting") && exec $(printf %q "$PY") api.py"
  else
    echo "Warning: ml/.venv missing — ML services skipped." >&2
  fi
  echo "Background jobs running. Next: cd frontend && npm run dev"
fi
