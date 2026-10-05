#!/bin/bash
# Builds better-sqlite3's native part for Android (it uses Node-API, so one build works with any
# Node.js new enough).
#
#   build-sqlite.sh <better-sqlite3 package dir> <Node.js source dir> <NDK dir> <API level> <arm64|x86_64> <output dir>
#
# The package dir needs node-addon-api beside it, as in node_modules.
set -euo pipefail
pkg=$1 nodesrc=$2 ndk=$3 api=$4 arch=$5 out=$6
case $arch in
  arm64) gyparch=arm64; prefix=aarch64-linux-android ;;
  x86_64) gyparch=x64; prefix=x86_64-linux-android ;;
  *) echo "build-sqlite.sh: unknown architecture $arch" >&2; exit 1 ;;
esac
mkdir -p "$out"
out=$(cd "$out" && pwd)
toolchain=$ndk/toolchains/llvm/prebuilt/linux-x86_64/bin
cd "$pkg"
rm -rf build
export CC=$toolchain/$prefix$api-clang CXX=$toolchain/$prefix$api-clang++
export LINK=$toolchain/$prefix$api-clang++ AR=$toolchain/llvm-ar
# The C++ library goes into the addon, as into Node.js.
export LDFLAGS=-static-libstdc++
npx -y node-gyp@11 rebuild --release --force_build=1 --arch=$gyparch --nodedir="$nodesrc"
"$toolchain/llvm-strip" -o "$out/libbetter_sqlite3-$arch.so" build/Release/better_sqlite3.node
ls -la "$out/libbetter_sqlite3-$arch.so"
