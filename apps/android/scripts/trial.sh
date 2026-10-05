#!/bin/bash
# The trial on a running emulator or phone (adb): installs the APK, starts Memora twice (the
# first start unpacks the engine), and reports the times, the memory used and screenshots.
#
#   trial.sh <APK> <output dir>
set -uo pipefail
apk=$1
out=$2
pkg=io.github.dreamtheater484.memora
mkdir -p "$out"
report=$out/report.txt
: > "$report"
say() { echo "$*" | tee -a "$report"; }

adb root > /dev/null 2>&1
adb wait-for-device
say "device: $(adb shell getprop ro.product.model | tr -d '\r'), Android $(adb shell getprop ro.build.version.release | tr -d '\r')"
say "APK: $(du -h "$apk" | cut -f1) ($(basename "$apk"))"
adb uninstall $pkg > /dev/null 2>&1
adb install -r "$apk" > /dev/null
say "installed: $(adb shell du -sh "$(adb shell pm path $pkg | head -1 | tr -d '\r' | sed 's/^package://; s#/base.apk##')" | cut -f1) app, before its first start"

start() {
  local label=$1
  adb logcat -c
  say "== $label start"
  say "$(adb shell am start -W -n $pkg/.MainActivity | grep TotalTime)"
  for _ in $(seq 1 180); do
    adb logcat -d -s Memora:I | grep -q "page shown" && break
    adb logcat -d | grep -q "FATAL EXCEPTION" && break
    sleep 1
  done
  adb logcat -d -s Memora | grep -E "trial:|engine:" | sed 's/^.*Memora *: //' | tee -a "$report"
  adb logcat -d | grep -A20 "FATAL EXCEPTION" | tee -a "$report"
  sleep 10
  adb exec-out screencap -p > "$out/$label.png"
  say "-- memory after the start, settled for 10 s"
  say "app (WebView and Kotlin): $(adb shell dumpsys meminfo $pkg | grep -E 'TOTAL PSS' | awk '{print $3 " kB PSS"}')"
  local pid
  pid=$(adb shell ps -A -o PID,ARGS | grep libnode.so | grep -v grep | awk '{print $1}' | head -1)
  if [ -n "$pid" ]; then
    say "engine (Node.js): $(adb shell cat /proc/$pid/smaps_rollup | grep -E '^Pss:' | awk '{print $2 " kB PSS"}')"
  else
    say "engine (Node.js): not running"
  fi
}

start first
adb shell am force-stop $pkg
sleep 2
start second
say "-- on the phone after use: $(adb shell du -sh /data/data/$pkg | cut -f1) of data (the unpacked engine included)"
adb shell cat /data/data/$pkg/files/logs/memora.log > "$out/memora.log" 2>/dev/null
adb logcat -d > "$out/logcat.txt"
