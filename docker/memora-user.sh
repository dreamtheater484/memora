# Sourced by the entrypoint and memora-admin: which user Memora runs as.
#
# PUID/PGID when they are set. Otherwise whoever owns the data, so Memora can write there with
# nothing to configure: the owner of an existing database (the user Memora ran as before), else
# the owner of the data folder (on a NAS, the account that created it). Root's files don't
# count: a folder Docker made for a missing bind mount or a new volume falls back to 1000:1000
# (the entrypoint then hands it over while it is still empty).
memora_user() {
  if [ -z "${PUID:-}" ]; then
    for path in "$1/memora.db" "$1"; do
      [ -e "$path" ] || continue
      owner="$(stat -c '%u' "$path")"
      [ "$owner" = "0" ] && continue
      PUID="$owner"
      group="$(stat -c '%g' "$path")"
      [ "$group" = "0" ] || PGID="${PGID:-$group}"
      break
    done
  fi
  PUID="${PUID:-1000}"
  PGID="${PGID:-1000}"
}
