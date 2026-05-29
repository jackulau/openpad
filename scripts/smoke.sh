#!/usr/bin/env bash
# scripts/smoke.sh - end-to-end smoke test for opencoder.
# Boots the api, registers a guest, creates a pad, runs JS that prints 42.
# Exits 0 if every step works, non-zero with a clear log otherwise.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
API_DIR="$REPO_ROOT/apps/api"
PORT="${SMOKE_PORT:-4099}"
BASE="http://127.0.0.1:$PORT"
DB_PATH="$API_DIR/prisma/smoke.db"
LOG_FILE="$(mktemp -t opencoder-smoke-XXXXXX.log)"
PID=""

cleanup() {
  local code=$?
  if [[ -n "$PID" ]] && kill -0 "$PID" 2>/dev/null; then
    kill "$PID" 2>/dev/null || true
    wait "$PID" 2>/dev/null || true
  fi
  rm -f "$DB_PATH" "$DB_PATH-journal"
  if (( code != 0 )); then
    echo
    echo "[FAIL] smoke failed (exit $code). Server log:"
    sed 's/^/    /' "$LOG_FILE" | tail -50
  fi
  rm -f "$LOG_FILE"
  exit "$code"
}
trap cleanup EXIT INT TERM

step() { printf "→ %s\n" "$1"; }
ok() { printf " [OK] %s\n" "$1"; }
fail() { printf " [FAIL] %s\n" "$1" >&2; exit 1; }

# Fail fast if something already listens on PORT. Otherwise the api we start
# loses the bind race (EADDRINUSE), the health check below passes against the
# stale squatter, and every request 500s against its dead DB handle — a very
# confusing failure to debug (looks like a guest-auth bug, isn't).
if command -v lsof > /dev/null 2>&1 && lsof -nP -iTCP:"$PORT" -sTCP:LISTEN > /dev/null 2>&1; then
  fail "port $PORT already in use — kill the stale server first (lsof -ti tcp:$PORT | xargs kill)"
fi

step "applying migrations to $DB_PATH"
(
  cd "$API_DIR"
  DATABASE_URL="file:$DB_PATH" pnpm exec prisma migrate deploy > /dev/null
)
ok "migrations applied"

step "starting api on :$PORT"
(
  cd "$API_DIR"
  DATABASE_URL="file:$DB_PATH" \
  JWT_SECRET="smoke-secret-must-be-32-characters-long-enough" \
  EXEC_FORCE_LOCAL="true" \
  NODE_ENV="development" \
  HOST="127.0.0.1" \
  PORT="$PORT" \
  pnpm exec tsx src/index.ts > "$LOG_FILE" 2>&1 &
  echo $! > "$LOG_FILE.pid"
)
PID="$(cat "$LOG_FILE.pid")"
rm -f "$LOG_FILE.pid"

step "waiting for /health"
for _ in $(seq 1 60); do
  if curl -fsS "$BASE/health" > /dev/null 2>&1; then
    ok "health OK"
    break
  fi
  sleep 0.5
done
curl -fsS "$BASE/health" > /dev/null || fail "/health never came up"

step "POST /api/auth/guest"
GUEST_RES="$(curl -fsS -X POST "$BASE/api/auth/guest" \
  -H "Content-Type: application/json" \
  -d '{"name":"smoker"}')"
TOKEN="$(printf '%s' "$GUEST_RES" | node -e 'let d="";process.stdin.on("data",c=>d+=c);process.stdin.on("end",()=>{console.log(JSON.parse(d).token)})')"
[[ -n "$TOKEN" ]] || fail "no token in guest response: $GUEST_RES"
ok "got bearer token"

step "POST /api/pads"
PAD_RES="$(curl -fsS -X POST "$BASE/api/pads" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"language":"javascript"}')"
SLUG="$(printf '%s' "$PAD_RES" | node -e 'let d="";process.stdin.on("data",c=>d+=c);process.stdin.on("end",()=>{console.log(JSON.parse(d).pad.slug)})')"
[[ -n "$SLUG" ]] || fail "no slug in pad response: $PAD_RES"
ok "pad slug=$SLUG"

step "POST /api/pads/$SLUG/run (javascript: 7*6)"
RUN_RES="$(curl -fsS -X POST "$BASE/api/pads/$SLUG/run" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"language":"javascript","source":"console.log(7*6)"}')"
STDOUT="$(printf '%s' "$RUN_RES" | node -e 'let d="";process.stdin.on("data",c=>d+=c);process.stdin.on("end",()=>{process.stdout.write(JSON.parse(d).stdout||"")})')"
if [[ "$(printf '%s' "$STDOUT" | tr -d '[:space:]')" != "42" ]]; then
  fail "expected stdout=42, got: $STDOUT (full response: $RUN_RES)"
fi
ok "exec stdout=42"

echo
echo "[OK] smoke passed"
