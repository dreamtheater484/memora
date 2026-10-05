# Memora for Android (trial)

A trial of Memora on Android phones, with the same engine as everywhere else: Memora's own server and web app, run by Node.js inside the app. Nothing is forked or rewritten, as in the desktop app.

## How it fits together

- **Node.js** is built for Android from the official source ([scripts/build-node.sh](scripts/build-node.sh)). The app ships it as `libnode.so`, because Android lets an app run programs only from its own library folder. It's Node 24 LTS, with English-only locale data and without npm or the debugger, to keep it small.
- **better-sqlite3** gets the same treatment ([scripts/build-sqlite.sh](scripts/build-sqlite.sh)). It uses Node-API, so one build works with any recent Node.
- **The engine**: the server, its migrations and packages, and the web app, as the desktop app lays them out (`apps/desktop/build/memora`). The app unpacks them once per version, from `assets/engine.zip` ([scripts/stage.sh](scripts/stage.sh)).
- **[engine/android.cjs](engine/android.cjs)** starts the server. It stands in for what Electron gives the desktop app: the message port to the app (over stdin and stdout) and loading better-sqlite3 from the library folder.
- **The app** ([Engine.kt](app/src/main/kotlin/io/github/dreamtheater484/memora/Engine.kt), [MainActivity.kt](app/src/main/kotlin/io/github/dreamtheater484/memora/MainActivity.kt)):
  - Starts Node.js on `127.0.0.1` and signs the WebView in with a secret made anew at each start, as the desktop app does.
  - Keeps sync's secrets sealed by Android's keystore.
- **Sync** is through WebDAV (kDrive, Nextcloud). Google Drive and "a folder on this computer" don't apply here.

## Building

The [Android workflow](../../.github/workflows/android.yml) does all of it. It builds Node.js, about an hour per processor type and cached afterwards. Then it builds the APKs and runs the trial on an emulator ([scripts/trial.sh](scripts/trial.sh)). By hand:

1. `pnpm build` at the root, then `pnpm build && pnpm resources` in `apps/desktop`.
2. Build Node.js and better-sqlite3 for `arm64` and `x86_64` with the scripts, into one folder.
3. `scripts/stage.sh <NDK> <that folder>`, then `./gradlew assembleRelease` here.
