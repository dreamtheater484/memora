#!/bin/bash
# Puts what the Android app runs into the Gradle project:
#   app/src/main/assets/engine.zip   the server, its migrations and packages, and the web app
#                                    (apps/desktop/build/memora, from `pnpm resources` there),
#                                    with engine/android.cjs, which starts the server;
#   app/src/main/jniLibs/<abi>/      Node.js (libnode.so) and better-sqlite3 (libbetter_sqlite3.so).
#
#   stage.sh <dir with node-<arch> and libbetter_sqlite3-<arch>.so>
set -euo pipefail
natives=$(cd "$1" && pwd)
android=$(cd "$(dirname "$0")/.." && pwd)
resources=$android/../desktop/build/memora
[ -f "$resources/server/dist/server.mjs" ] || {
  echo "stage.sh: run \`pnpm build\`, then \`pnpm build && pnpm resources\` in apps/desktop" >&2
  exit 1
}

stage=$(mktemp -d)
trap 'rm -rf "$stage"' EXIT
cp -a "$resources/." "$stage/"
cp "$android/engine/android.cjs" "$stage/"
# better-sqlite3 looks for its native part in build/Release; android.cjs loads the app's own.
rm -rf "$stage/server/node_modules/better-sqlite3/prebuilds"
mkdir -p "$stage/server/node_modules/better-sqlite3/build/Release"
echo "Loaded from the app's library folder: see android.cjs." \
  > "$stage/server/node_modules/better-sqlite3/build/Release/better_sqlite3.node"
assets=$android/app/src/main/assets
mkdir -p "$assets"
rm -f "$assets/engine.zip"
(cd "$stage" && zip -q -9 -r "$assets/engine.zip" .)
ls -la "$assets/engine.zip"

for entry in arm64-v8a:arm64 x86_64:x86_64; do
  IFS=: read -r abi arch <<<"$entry"
  [ -f "$natives/node-$arch" ] || { echo "stage.sh: no node-$arch, skipping $abi"; continue; }
  libs=$android/app/src/main/jniLibs/$abi
  rm -rf "$libs"
  mkdir -p "$libs"
  cp "$natives/node-$arch" "$libs/libnode.so"
  cp "$natives/libbetter_sqlite3-$arch.so" "$libs/libbetter_sqlite3.so"
  ls -la "$libs"
done
