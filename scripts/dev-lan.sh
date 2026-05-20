#!/usr/bin/env bash
# Launch API + web bound to LAN. Friends connect at http://<your-ip>:5173 - no password, just pick a name.
set -euo pipefail

cd "$(dirname "$0")/.."
ROOT="$(pwd)"

LAN_IP=$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || hostname -I 2>/dev/null | awk '{print $1}')
if [ -z "${LAN_IP:-}" ]; then
  echo "could not detect LAN IP - set LAN_IP=... manually" >&2
  exit 1
fi

PUBLIC_URL="http://$LAN_IP:5173"
DB_FILE="$ROOT/apps/api/prisma/dev.db"

# Apply pending migrations.
(cd "$ROOT/apps/api" && DATABASE_URL="file:$DB_FILE" pnpm prisma migrate deploy >/dev/null)

# Cleanup on exit.
PIDS=()
trap 'for p in "${PIDS[@]:-}"; do kill "$p" 2>/dev/null || true; done' EXIT INT TERM

(cd "$ROOT/apps/api" && \
  HOST=0.0.0.0 PORT=4000 NODE_ENV=development \
  DATABASE_URL="file:$DB_FILE" \
  JWT_SECRET="${JWT_SECRET:-local-dev-secret-please-replace-32-chars-min-x}" \
  PUBLIC_BASE_URL="$PUBLIC_URL" \
  DATA_DIR="./data" \
  EXEC_FORCE_LOCAL="${EXEC_FORCE_LOCAL:-true}" \
  pnpm dev) &
PIDS+=("$!")

(cd "$ROOT" && pnpm --filter @opencoder/web dev) &
PIDS+=("$!")

echo
echo "========================================================"
echo "  opencoder running"
echo "  you:       http://localhost:5173"
echo "  friends:   $PUBLIC_URL"
echo " share that URL with anyone on your wifi - they pick a name and join"
echo "  Ctrl-C to stop"
echo "========================================================"
echo

wait
