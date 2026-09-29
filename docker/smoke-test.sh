#!/usr/bin/env bash
# Starts a Memora image and checks that it works: health, web app, non-root user, data on the volume.
# Usage: docker/smoke-test.sh [image]   (default image: memora:local)
set -euo pipefail

IMAGE="${1:-memora:local}"
NAME="memora-smoke-$$"
DATA_DIR="$(mktemp -d)"
PORT="${SMOKE_PORT:-3990}"

cleanup() {
  docker rm -f "$NAME" >/dev/null 2>&1 || true
  # Files in the volume belong to the container user; remove them through Docker.
  docker run --rm -v "$DATA_DIR:/cleanup" --entrypoint sh "$IMAGE" -c 'rm -rf /cleanup/*' >/dev/null 2>&1 || true
  rmdir "$DATA_DIR" 2>/dev/null || true
}
trap cleanup EXIT

fail() {
  echo "✖ $1" >&2
  docker logs "$NAME" 2>&1 | tail -n 50 >&2 || true
  exit 1
}

docker run -d --name "$NAME" -p "127.0.0.1:$PORT:3000" \
  -e PUID="$(id -u)" -e PGID="$(id -g)" \
  -v "$DATA_DIR:/data" "$IMAGE" >/dev/null

for _ in $(seq 1 30); do
  if curl -fsS "http://127.0.0.1:$PORT/api/health" >/dev/null 2>&1; then break; fi
  sleep 1
done

curl -fsS "http://127.0.0.1:$PORT/api/health" | grep -q '"status":"ok"' || fail "health endpoint not ok"
curl -fsS "http://127.0.0.1:$PORT/" | grep -q '<div id="root">' || fail "web app not served"
[ "$(docker exec "$NAME" stat -c %u /proc/1)" = "$(id -u)" ] || fail "server is not running as PUID"
[ -f "$DATA_DIR/memora.db" ] || fail "database not created in the data volume"

docker exec "$NAME" node /app/healthcheck.mjs || fail "built-in healthcheck failed"

docker stop -t 10 "$NAME" >/dev/null
[ "$(docker inspect -f '{{.State.ExitCode}}' "$NAME")" = "0" ] || fail "container did not shut down cleanly"

echo "✔ smoke test passed ($IMAGE)"
