#!/usr/bin/env bash
# Starts a Memora image and checks that it works: health, web app, non-root user, data on the volume,
# first-run setup and the memora-admin tool.
# Usage: docker/smoke-test.sh [image]   (default image: memora:local)
set -euo pipefail

IMAGE="${1:-memora:local}"
NAME="memora-smoke-$$"
VOLUME="memora-smoke-$$"
DATA_DIR="$(mktemp -d)"
PORT="${SMOKE_PORT:-3990}"

cleanup() {
  docker rm -f "$NAME" >/dev/null 2>&1 || true
  docker volume rm -f "$VOLUME" >/dev/null 2>&1 || true
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

# expect <pattern> <failure message> <command...>: the command succeeds and its output matches.
# The output is captured first: in `command | grep -q`, grep stops reading at the first match
# and Docker 28's client then dies of SIGPIPE on its next write, failing the check at random.
expect() {
  local out
  out="$("${@:3}")" && grep -q -- "$1" <<<"$out" || fail "$2"
}

# Which user Memora runs as (the entrypoint runs the given command in its place):
# the data folder's owner when nothing is set,
[ "$(docker run --rm -v "$DATA_DIR:/data" "$IMAGE" id -u)" = "$(id -u)" ] ||
  fail "not running as the data folder's owner"
# 1000 for a new Docker volume (root's, and empty),
[ "$(docker run --rm -v "$VOLUME:/data" "$IMAGE" sh -c 'echo "$(id -u) $(stat -c %u /data)"')" = "1000 1000" ] ||
  fail "a new volume is not handed to user 1000"
docker volume rm -f "$VOLUME" >/dev/null
# and PUID/PGID when they are set.
[ "$(docker run --rm -e PUID=4321 -e PGID=4321 -v "$VOLUME:/data" "$IMAGE" sh -c 'echo "$(id -u) $(id -g)"')" = "4321 4321" ] ||
  fail "PUID/PGID not used"

# No PUID/PGID: Memora takes the data folder's owner.
docker run -d --name "$NAME" -p "127.0.0.1:$PORT:3000" -v "$DATA_DIR:/data" "$IMAGE" >/dev/null

for _ in $(seq 1 30); do
  if curl -fsS "http://127.0.0.1:$PORT/api/health" >/dev/null 2>&1; then break; fi
  sleep 1
done

expect '"status":"ok"' "health endpoint not ok" curl -fsS "http://127.0.0.1:$PORT/api/health"
expect '<div id="root">' "web app not served" curl -fsS "http://127.0.0.1:$PORT/"
# The open-source licences: the app's, the server's and, in its own section, Node.js's.
NOTICES="$(curl -fsS "http://127.0.0.1:$PORT/third-party-licenses.txt")" || fail "no licence notices"
for notice in '^react ' '^fastify ' '^The runtime: Node.js'; do
  grep -q -- "$notice" <<<"$NOTICES" || fail "licence notices lack $notice"
done
RUNTIME="$(sed -n '/^The runtime: Node.js/,$p' <<<"$NOTICES")"
grep -q 'Node.js is licensed' <<<"$RUNTIME" || fail "Node.js's own licence is missing"
[ "$(docker exec "$NAME" stat -c %u /proc/1)" = "$(id -u)" ] || fail "server is not running as the data folder's owner"
[ -f "$DATA_DIR/memora.db" ] || fail "database not created in the data volume"

docker exec "$NAME" node /app/healthcheck.mjs || fail "built-in healthcheck failed"

# First-run setup: the code is in the log, and only works with that code.
CODE="$(docker logs "$NAME" 2>&1 | sed -n 's/.*Memora setup code: *\([0-9A-Z-]*\).*/\1/p' | tail -n 1)"
[ -n "$CODE" ] || fail "no setup code in the log"
expect "No accounts yet" "memora-admin list-users" docker exec "$NAME" memora-admin list-users
setup() {
  curl -s -o /dev/null -w '%{http_code}' -H 'content-type: application/json' \
    -H "origin: http://127.0.0.1:$PORT" -X POST "http://127.0.0.1:$PORT/api/v1/auth/setup" \
    -d "{\"setupCode\":\"$1\",\"username\":\"smoke\",\"displayName\":\"Smoke\",\"password\":\"violet-harbour-lantern\"}"
}
[ "$(setup WRONG-CODE-0000)" = "403" ] || fail "setup accepted a wrong code"
[ "$(setup "$CODE")" = "200" ] || fail "setup with the logged code failed"
expect "^smoke " "admin account not listed" docker exec "$NAME" memora-admin list-users
expect "One-time password" "memora-admin reset-password" \
  docker exec "$NAME" memora-admin reset-password smoke
[ "$(stat -c %u "$DATA_DIR/memora.db-wal")" = "$(id -u)" ] || fail "database files not owned by the data folder's owner"

docker stop -t 10 "$NAME" >/dev/null
[ "$(docker inspect -f '{{.State.ExitCode}}' "$NAME")" = "0" ] || fail "container did not shut down cleanly"

echo "✔ smoke test passed ($IMAGE)"
