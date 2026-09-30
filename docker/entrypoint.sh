#!/bin/sh
# Memora container entrypoint.
#  - Caps the Node.js heap (MEMORA_MAX_HEAP_MB, default 256) to keep RAM use predictable.
#  - When started as root: prepares the data folders, then runs Memora as the owner of the
#    data folder (or PUID:PGID when set; see memora-user.sh).
#  - When started as a non-root user (compose `user:`): runs directly as that user.
set -eu

DATA_DIR="${MEMORA_DATA_DIR:-/data}"
BACKUP_DIR="${MEMORA_BACKUP_DIR:-$DATA_DIR/backups}"
HEAP_MB="${MEMORA_MAX_HEAP_MB:-256}"

case "$HEAP_MB" in
  '' | *[!0-9]*) echo "memora: MEMORA_MAX_HEAP_MB must be a number of megabytes" >&2; exit 1 ;;
esac
export NODE_OPTIONS="--max-old-space-size=${HEAP_MB}${NODE_OPTIONS:+ $NODE_OPTIONS}"

if [ "$(id -u)" != "0" ]; then
  exec "$@"
fi

CHOSEN_PUID="${PUID:-}"
. /usr/local/lib/memora-user.sh
memora_user "$DATA_DIR"
case "$PUID$PGID" in
  '' | *[!0-9]*) echo "memora: PUID and PGID must be numeric" >&2; exit 1 ;;
esac
if [ "$PUID" = "0" ]; then
  echo "memora: refusing to run as root (PUID=0); leave PUID out, or set it to a regular user" >&2
  exit 1
fi

run_as_user() {
  setpriv --reuid="$PUID" --regid="$PGID" --clear-groups -- "$@"
}

for dir in "$DATA_DIR" "$BACKUP_DIR"; do
  if [ ! -d "$dir" ]; then
    mkdir -p "$dir"
    chown "$PUID:$PGID" "$dir"
  elif [ -z "$(ls -A "$dir")" ] && [ "$(stat -c '%u' "$dir")" = "0" ]; then
    # A fresh, empty folder created by Docker for the volume: hand it to the Memora user.
    chown "$PUID:$PGID" "$dir"
  fi
  # Never chown existing data recursively (a wrong mount could change a whole share);
  # explain the fix instead.
  if ! run_as_user test -w "$dir"; then
    echo "memora: $dir is not writable by user $PUID:$PGID (the folder belongs to $(stat -c '%u:%g' "$dir"))." >&2
    if [ -n "$CHOSEN_PUID" ]; then
      echo "memora: leave PUID/PGID out to run as the folder's owner, or give user $PUID read/write access to it on the host." >&2
    else
      echo "memora: give user $PUID read/write access to the folder on the host, or set PUID/PGID to a user that has it." >&2
    fi
    exit 1
  fi
done

exec setpriv --reuid="$PUID" --regid="$PGID" --clear-groups -- "$@"
