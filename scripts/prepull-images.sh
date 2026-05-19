#!/usr/bin/env bash
# Pre-pull docker images for opencoder language runners.
#
# Invoked optionally from docker-compose or `pnpm predev` so first-time users
# don't pay a 30s image-fetch on their first /run. Idempotent — re-runs are
# cheap once images are cached locally.
#
# SOURCE OF TRUTH: packages/shared/src/languages.ts (LANGUAGES.*.docker.image).
# Keep the list below in sync when adding/removing languages. The API server
# also auto-pulls on boot (EXEC_PREPULL=true) so this script is purely for
# the "warm the docker host before the API even starts" use case.

set -euo pipefail

if ! command -v docker >/dev/null 2>&1; then
  echo "[prepull] docker not found — skipping"
  exit 0
fi
if ! docker version --format '{{.Server.Version}}' >/dev/null 2>&1; then
  echo "[prepull] docker daemon not reachable — skipping"
  exit 0
fi

images=(
  "python:3.10-alpine"
  "python:3.11-alpine"
  "python:3.12-alpine"
  "python:3.13-alpine"
  "node:18-alpine"
  "node:20-alpine"
  "node:22-alpine"
  "golang:1.21-alpine"
  "golang:1.22-alpine"
  "golang:1.23-alpine"
  "rust:1.83-alpine"
  "rustlang/rust:nightly-alpine"
  "eclipse-temurin:17-jdk-alpine"
  "eclipse-temurin:21-jdk-alpine"
  "gcc:14-bookworm"
  "ruby:3.3-alpine"
  "mcr.microsoft.com/dotnet/sdk:8.0"
  "zenika/kotlin:1.9"
  "swift:5.10-jammy"
  "php:8.3-alpine"
  "bash:5.2"
  "nickblah/lua:5.4-alpine"
  "elixir:1.16-alpine"
  "haskell:9.6"
  "virtuslab/scala-cli:1.4.3"
  "perl:5.38-slim"
  "r-base:4.3.2"
)

# de-dupe in case the list ever drifts
unique=()
declare -A seen=()
for i in "${images[@]}"; do
  if [[ -z "${seen[$i]:-}" ]]; then
    seen[$i]=1
    unique+=("$i")
  fi
done

echo "[prepull] pulling ${#unique[@]} images (parallel=5)..."
started=$(date +%s)
printf '%s\n' "${unique[@]}" | xargs -n1 -P5 -I{} sh -c '
  img="{}"
  if docker pull --quiet "$img" >/dev/null 2>&1; then
    echo "[prepull] ✓ $img"
  else
    echo "[prepull] ✗ $img"
  fi
'
ended=$(date +%s)
echo "[prepull] done in $((ended - started))s"
