#!/bin/sh
# memora-admin: maintenance commands inside the container, for example
#   docker exec memora memora-admin list-users
#   docker exec memora memora-admin reset-password <username>
# `docker exec` runs as root; drop to the user the server runs as, so any file the command
# creates in /data (such as SQLite's working files) stays owned by the Memora user.
set -eu

CLI=/app/apps/server/dist/admin.mjs

if [ "$(id -u)" = "0" ]; then
  # The server's user (PID 1, once the entrypoint has dropped root), else the entrypoint's choice.
  PUID_NOW="$(sed -n 's/^Uid:[[:space:]]*\([0-9]*\).*/\1/p' /proc/1/status)"
  PGID_NOW="$(sed -n 's/^Gid:[[:space:]]*\([0-9]*\).*/\1/p' /proc/1/status)"
  if [ -n "$PUID_NOW" ] && [ "$PUID_NOW" != "0" ]; then
    PUID="$PUID_NOW"
    PGID="$PGID_NOW"
  else
    . /usr/local/lib/memora-user.sh
    memora_user "${MEMORA_DATA_DIR:-/data}"
  fi
  exec setpriv --reuid="$PUID" --regid="$PGID" --clear-groups -- node "$CLI" "$@"
fi
exec node "$CLI" "$@"
