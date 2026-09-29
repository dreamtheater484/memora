#!/usr/bin/env bash
# The restore drill (§9.14): in a running Memora image, write a page, back up (encrypted),
# change the page, restore the backup from the API, let Docker's restart policy start Memora
# again, and check the page is exactly as it was when the backup was made. Then the same
# through memora-admin and a container restart.
# Usage: docker/restore-drill.sh [image]   (default image: memora:local)
set -euo pipefail

IMAGE="${1:-memora:local}"
NAME="memora-drill-$$"
WORK="$(mktemp -d)"
DATA_DIR="$WORK/data"
PORT="${DRILL_PORT:-3991}"
BASE="http://127.0.0.1:$PORT"
JAR="$WORK/cookies"
mkdir -p "$DATA_DIR"
printf 'a long drill password\n' >"$WORK/backup_password"

cleanup() {
  docker rm -f "$NAME" >/dev/null 2>&1 || true
  # Files in the volume belong to the container user; remove them through Docker.
  docker run --rm -v "$WORK:/cleanup" --entrypoint sh "$IMAGE" -c 'rm -rf /cleanup/*' >/dev/null 2>&1 || true
  rm -rf "$WORK" 2>/dev/null || true
}
trap cleanup EXIT

fail() {
  echo "✖ $1" >&2
  docker logs "$NAME" 2>&1 | tail -n 50 >&2 || true
  exit 1
}

wait_healthy() {
  for _ in $(seq 1 60); do
    if curl -fsS "$BASE/api/health" >/dev/null 2>&1; then return 0; fi
    sleep 1
  done
  fail "Memora did not come back"
}

# api <method> <path> [json]: a signed-in request; prints the body.
api() {
  local args=(-fsS -b "$JAR" -c "$JAR" -H "origin: $BASE" -H "x-csrf-token: $CSRF" -X "$1")
  if [ $# -ge 3 ]; then args+=(-H 'content-type: application/json' -d "$3"); fi
  curl "${args[@]}" "$BASE/api/v1$2"
}

content_of() {
  api GET "/pages/$PAGE" | jq -r .content
}

docker run -d --name "$NAME" --restart unless-stopped -p "127.0.0.1:$PORT:3000" \
  -e PUID="$(id -u)" -e PGID="$(id -g)" \
  -e MEMORA_BACKUP_SCHEDULE=off \
  -e MEMORA_BACKUP_PASSWORD_FILE=/run/secrets/backup_password \
  -v "$WORK/backup_password:/run/secrets/backup_password:ro" \
  -v "$DATA_DIR:/data" "$IMAGE" >/dev/null
wait_healthy

# An administrator, signed in.
CODE="$(docker logs "$NAME" 2>&1 | sed -n 's/.*Memora setup code: *\([0-9A-Z-]*\).*/\1/p' | tail -n 1)"
[ -n "$CODE" ] || fail "no setup code in the log"
CSRF="$(curl -fsS -c "$JAR" -H 'content-type: application/json' -H "origin: $BASE" \
  -X POST "$BASE/api/v1/auth/setup" \
  -d "{\"setupCode\":\"$CODE\",\"username\":\"drill\",\"displayName\":\"Drill\",\"password\":\"violet-harbour-lantern\"}" |
  jq -r .csrfToken)"
[ -n "$CSRF" ] && [ "$CSRF" != "null" ] || fail "setup failed"

# A page, then a backup of it.
INBOX="$(api GET /tree | jq -r .inboxId)"
PAGE="$(api POST /pages "{\"sectionId\":\"$INBOX\",\"title\":\"Drill\",\"content\":\"As it was\"}" |
  jq -r '.pages[0].id')"
[ "$(content_of)" = "As it was" ] || fail "page not saved"
DATA_ID="$(api GET /auth/me | jq -r .dataId)"

BACKUP="$(api POST /admin/backups | jq -r .name)"
case "$BACKUP" in
  memora-manual-*.db.enc) ;;
  *) fail "backup not made, or not encrypted: $BACKUP" ;;
esac
head -c 10 "$DATA_DIR/backups/$BACKUP" | grep -q MEMORAENC1 || fail "backup file is not encrypted"
if grep -q "As it was" "$DATA_DIR/backups/$BACKUP"; then fail "backup shows its content"; fi

# Things change after the backup…
REVISION="$(api GET "/pages/$PAGE" | jq -r .revision)"
api PUT "/pages/$PAGE/content" "{\"baseRevision\":$REVISION,\"content\":\"Changed since\"}" >/dev/null
[ "$(content_of)" = "Changed since" ] || fail "change not saved"

# …then the backup is restored: Memora backs up first and restarts.
SAFETY="$(api POST "/admin/backups/$BACKUP/restore" | jq -r .safetyBackup)"
case "$SAFETY" in
  memora-pre-restore-*) ;;
  *) fail "restore not started: $SAFETY" ;;
esac
for _ in $(seq 1 30); do
  [ "$(docker inspect -f '{{.RestartCount}}' "$NAME")" -ge 1 ] && break
  sleep 1
done
[ "$(docker inspect -f '{{.RestartCount}}' "$NAME")" -ge 1 ] || fail "Memora did not restart"
wait_healthy

[ "$(content_of)" = "As it was" ] || fail "page not as it was after the restore: $(content_of)"
[ "$(api GET /auth/me | jq -r .dataId)" != "$DATA_ID" ] || fail "data id not renewed"
[ -f "$DATA_DIR/backups/$SAFETY" ] || fail "safety backup missing"
[ ! -e "$DATA_DIR/restore" ] || fail "restore folder left behind"
echo "✔ restored from the API"

# The same with memora-admin: back to the state before the restore.
docker exec "$NAME" memora-admin restore "$SAFETY" >/dev/null || fail "memora-admin restore failed"
docker restart -t 10 "$NAME" >/dev/null
wait_healthy
[ "$(content_of)" = "Changed since" ] || fail "page not as in the safety backup: $(content_of)"
echo "✔ restored with memora-admin"

echo "✔ restore drill passed ($IMAGE)"
