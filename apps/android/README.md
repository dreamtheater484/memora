# Memora for Android

Memora on Android phones, with the same engine as everywhere else: Memora's own server and web app, run by Node.js inside the app. Nothing is forked or rewritten, as in the desktop app. Installing and updating it: [docs/ANDROID.md](../../docs/ANDROID.md).

## How it fits together

- **Node.js** is built for Android from the official source ([scripts/build-node.sh](scripts/build-node.sh)). The app ships it as `libnode.so`, because Android lets an app run programs only from its own library folder. It's Node 24 LTS, with English-only locale data and without npm or the debugger, to keep it small.
- **better-sqlite3** gets the same treatment ([scripts/build-sqlite.sh](scripts/build-sqlite.sh)). It uses Node-API, so one build works with any recent Node.
- **The engine**: the server, its migrations and packages, and the web app, as the desktop app lays them out (`apps/desktop/build/memora`). The app unpacks them once per version, from `assets/engine.zip` ([scripts/stage.sh](scripts/stage.sh)).
- **[engine/android.cjs](engine/android.cjs)** starts the server. It stands in for what Electron gives the desktop app: the message port to the app (over stdin and stdout) and loading better-sqlite3 from the library folder.
- **The app** ([Engine.kt](app/src/main/kotlin/io/github/dreamtheater484/memora/Engine.kt), [MainActivity.kt](app/src/main/kotlin/io/github/dreamtheater484/memora/MainActivity.kt)):
  - Starts Node.js on `127.0.0.1` and signs the WebView in with a secret made anew at each start, as the desktop app does.
  - Keeps sync's secrets sealed by Android's keystore.
- **Sync** is through WebDAV (kDrive, Nextcloud). Google Drive and "a folder on this computer" don't apply here.

## Versions and signing

- **The version** is the root `package.json`'s, and the `versionCode` rises with it ([docs/RELEASING.md](../../docs/RELEASING.md#versions)), so each release installs over the one before.
- **Releases are signed with Memora's own key**, from four environment variables ([docs/SIGNING.md](../../docs/SIGNING.md#android)): `ANDROID_KEYSTORE_BASE64` (or `ANDROID_KEYSTORE_PATH`), `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS` and `ANDROID_KEY_PASSWORD`.
- **Without them**, the build is signed with the machine's debug key, and the APKs' names end in `-debug-key`: for testing, they install over no other build. With `-Pmemora.release=true`, as the release workflow builds, a missing key fails the build instead.

## Building

The [Android workflow](../../.github/workflows/android.yml) does all of it: on pull requests that change the app or what it bundles, on `main`, and for each release. It builds Node.js, about an hour per processor type and cached afterwards. Then it builds the APKs, checks their version and key, and runs the app on an emulator ([scripts/trial.sh](scripts/trial.sh)): the start-up times, the memory used, screenshots, and whether the page sees the app go to the background and come back. By hand, with the Android SDK and NDK:

1. `pnpm build` at the root, then `pnpm build && pnpm resources` in `apps/desktop`.
2. Build Node.js and better-sqlite3 for `arm64` and `x86_64` with the scripts, into one folder.
3. `scripts/stage.sh <that folder>`, then `./gradlew apks` here. The APKs are in `app/build/apks`: `Memora-<version>-arm64.apk` and `Memora-<version>-x86_64.apk`.
