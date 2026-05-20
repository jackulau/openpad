#!/usr/bin/env bash
# Smoke test: start api, hit /health, register a user, create a pad, run code, tear down.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

API_PORT="${SMOKE_PORT:-4011}"
DATA_DIR="$(mktemp -d)"
DB_FILE="$DATA_DIR/smoke.db"
export DATABASE_URL="file:$DB_FILE"
export JWT_SECRET="smoke-secret-must-be-32-characters-long-enough"
export EXEC_FORCE_LOCAL="true"
export AI_PROVIDER="none"
export PORT="$API_PORT"
export NODE_ENV="development"

cleanup() {
  if [[ -n "${API_PID:-}" ]]; then
    kill "$API_PID" 2>/dev/null || true
    wait "$API_PID" 2>/dev/null || true
  fi
  rm -rf "$DATA_DIR"
}
trap cleanup EXIT

echo "==> running prisma migrate deploy"
pnpm --filter @opencoder/api exec prisma migrate deploy >/dev/null

echo "==> starting api on :$API_PORT"
pnpm --filter @opencoder/api exec tsx src/index.ts >"$DATA_DIR/api.log" 2>&1 &
API_PID=$!

# wait for /health
for i in $(seq 1 30); do
  if curl -sf "http://127.0.0.1:$API_PORT/health" >/dev/null; then
    break
  fi
  sleep 1
done

if ! curl -sf "http://127.0.0.1:$API_PORT/health" >/dev/null; then
  echo "FAIL: api did not start. Log:"
  cat "$DATA_DIR/api.log"
  exit 1
fi
echo "    /health ok"

echo "==> guest signup (name-only)"
TOKEN=$(curl -sf -X POST "http://127.0.0.1:$API_PORT/api/auth/guest" \
  -H "content-type: application/json" \
  -d '{"name":"Smoke"}' \
  | python3 -c 'import json, sys; print(json.load(sys.stdin)["token"])')

if [[ -z "$TOKEN" || "$TOKEN" == "null" ]]; then
  echo "FAIL: did not receive token"
  exit 1
fi
echo "    token received"

echo "==> creating pad"
SLUG=$(curl -sf -X POST "http://127.0.0.1:$API_PORT/api/pads" \
  -H "content-type: application/json" \
  -H "authorization: Bearer $TOKEN" \
  -d '{"language":"python"}' \
  | python3 -c 'import json, sys; print(json.load(sys.stdin)["pad"]["slug"])')
echo "    pad: $SLUG"

echo "==> running code"
OUT=$(curl -sf -X POST "http://127.0.0.1:$API_PORT/api/pads/$SLUG/run" \
  -H "content-type: application/json" \
  -H "authorization: Bearer $TOKEN" \
  -d '{"source":"print(2 + 3)"}' \
  | python3 -c 'import json, sys; d=json.load(sys.stdin); print(d["stdout"].strip())')

if [[ "$OUT" != "5" ]]; then
  echo "FAIL: expected stdout '5', got '$OUT'"
  cat "$DATA_DIR/api.log"
  exit 1
fi
echo "    stdout: 5 ✓"

echo "==> smoke test PASSED"
