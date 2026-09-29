#!/bin/sh
# memora-admin: maintenance commands inside the container, for example
#   docker exec memora memora-admin list-users
#   docker exec memora memora-admin reset-password <username>
# `docker exec` runs as root; drop to PUID:PGID like the entrypoint does, so any file the
# command creates in /data (such as SQLite's working files) stays owned by the Memora user.
set -eu

CLI=/app/apps/server/dist/admin.mjs

if [ "$(id -u)" = "0" ]; then
  exec setpriv --reuid="${PUID:-1000}" --regid="${PGID:-1000}" --clear-groups -- node "$CLI" "$@"
fi
exec node "$CLI" "$@"
