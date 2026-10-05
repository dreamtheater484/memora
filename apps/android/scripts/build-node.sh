#!/bin/bash
# Builds Node.js for Android from the official source, as a program the app runs (libnode.so).
#
#   build-node.sh <node source dir> <Android NDK dir> <API level> <arm64|x86_64> <output dir>
#
# Node's own android-configure, with what it needs for Node 24 and NDK r29 (Termux's Node
# package makes the same changes: github.com/termux/termux-packages, packages/nodejs-lts), and a
# smaller build: English-only locale data, no npm, no debugger.
set -euo pipefail
src=$1 ndk=$2 api=$3 arch=$4 out=$5
case $arch in
  arm64) cpu=arm64; prefix=aarch64-linux-android ;;
  x86_64) cpu=x64; prefix=x86_64-linux-android ;;
  *) echo "build-node.sh: unknown architecture $arch" >&2; exit 1 ;;
esac
mkdir -p "$out"
out=$(cd "$out" && pwd)
work=$out/src-$arch
rm -rf "$work"
cp -a "$src" "$work"
cd "$work"

# V8's trap handler isn't for Android (nodejs/node#36287). android-patches/trap-handler.h.patch
# no longer applies to V8 in Node 24, so its effect is made here.
python3 - <<'PY'
import re
p = 'deps/v8/src/trap-handler/trap-handler.h'
s = open(p).read()
s, n = re.subn(r'// X64 on Linux, Windows, MacOS, FreeBSD\.\n#if .*?#define V8_TRAP_HANDLER_SUPPORTED false\n#endif\n',
               '#define V8_TRAP_HANDLER_SUPPORTED false\n', s, count=1, flags=re.S)
assert n == 1, 'deps/v8/src/trap-handler/trap-handler.h changed: check the edit'
open(p, 'w').write(s)
PY
# Clang's atomics need libatomic on Android as on Linux.
sed -i 's/\[\x27(OS=="linux" and clang==1) or/[\x27((OS=="linux" or OS=="android") and clang==1) or/' tools/v8_gypfiles/v8.gyp
grep -q 'OS=="android") and clang==1' tools/v8_gypfiles/v8.gyp
# zlib asks Android's old cpufeatures library for the CPU's features, which the NDK no longer
# builds. Its Linux way (getauxval) works on Android too.
sed -i "s/'ARMV8_OS_ANDROID'/'ARMV8_OS_LINUX'/" deps/zlib/zlib.gyp
! grep -q ARMV8_OS_ANDROID deps/zlib/zlib.gyp

toolchain=$ndk/toolchains/llvm/prebuilt/linux-x86_64
export PATH=$PATH:$toolchain/bin
export CC=$toolchain/bin/$prefix$api-clang CXX=$toolchain/bin/$prefix$api-clang++
export CC_host=gcc CXX_host=g++
# The C++ library goes into the program: nothing to find beside it when Android starts it.
export LDFLAGS=-static-libstdc++
export GYP_DEFINES="target_arch=$cpu v8_target_arch=$cpu android_target_arch=$cpu host_os=linux OS=android android_ndk_path=$ndk"
./configure --dest-cpu=$cpu --dest-os=android --openssl-no-asm --cross-compiling \
  --with-intl=small-icu --without-npm --without-corepack --without-amaro --without-inspector
# Only the node program: Node's C++ tests (cctest) need aligned_alloc, which Android has from
# API 28 only.
make -C out BUILDTYPE=Release -j"$(nproc)" node
"$toolchain/bin/llvm-strip" -o "$out/node-$arch" out/Release/node
ls -la "$out/node-$arch"
