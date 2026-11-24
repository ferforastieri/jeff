#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

STAMP=/tmp/jeff-backend-watch.stamp
touch "$STAMP"
echo "[dev] watching backend/src, Cargo.toml and Cargo.lock"
echo "[dev] Ctrl+C to stop"

while sleep 1; do
  if find backend/src backend/Cargo.toml backend/Cargo.lock -type f -newer "$STAMP" -print -quit 2>/dev/null | grep -q .; then
    # Let the editor finish writing the batch.
    sleep 1
    touch "$STAMP"
    echo "[dev] backend changed; building..."
    if cargo build --manifest-path backend/Cargo.toml --bin jeff; then
      cp backend/target/debug/jeff /work/jeff-dev/bin/jeff
      docker restart jeff-dev >/dev/null
      for _ in $(seq 1 60); do
        if curl -fsS http://127.0.0.1:8790/api/health >/dev/null 2>&1; then
          echo "[dev] backend ready on :8790"
          break
        fi
        sleep 1
      done
    else
      echo "[dev] build failed; waiting for the next change"
    fi
  fi
done
