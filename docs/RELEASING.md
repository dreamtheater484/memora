# Making a release

For maintainers. A release is a version tag on `main`; the [release workflow](../.github/workflows/release.yml) does the rest.

## Versions

Memora follows [Semantic Versioning](https://semver.org/): `MAJOR.MINOR.PATCH`.

- **Patch** (0.9.1): fixes only.
- **Minor** (0.10.0): new features, or anything that changes the database. A release before 1.0 may also change behaviour in a minor version; the changelog says so.
- **Major** (1.0.0, 2.0.0): the first stable release, then breaking changes.
- **Pre-release** (1.0.0-rc.1): a candidate to try. It gets only its own image tag, never `latest`. Name candidates `-rc.1` to `-rc.9`: the Android app can't number others, and the release checks that first.

**The Android app's version** is the same: its `versionName` is the root `package.json`'s version. Android also wants a `versionCode`, a number, and installs an APK over another only when it's higher. Memora's rises with every version:

> versionCode = MAJOR × 10,000,000 + MINOR × 10,000 + PATCH × 10, plus **9** for a release, or **N − 1** for its candidate `-rc.N`.

So `0.11.0` is 110009, `1.0.0-rc.1` is 10000000, `1.0.0-rc.2` 10000001, and `1.0.0` 10000009: a candidate comes after the version before it, and the release after its candidates. It holds up to 209.999.999. The rule is in [build.gradle.kts](../apps/android/app/build.gradle.kts) and [release-notes.mjs](../scripts/release-notes.mjs) (`androidVersionCode`, with its tests); the Android workflow checks each APK against the second.

## Steps

1. **On a branch:** set the version in the five `package.json` files (root, `apps/server`, `apps/web`, `apps/desktop`, `packages/shared`).
2. In [CHANGELOG.md](../CHANGELOG.md), rename `## [Unreleased]` to `## [x.y.z] - YYYY-MM-DD`, add a new empty `## [Unreleased]` above it, and update the links at the bottom. Check it the way the workflow will:

   ```bash
   node scripts/release-notes.mjs x.y.z --check
   ```

3. Check the image for personal information and build-machine paths, with your local list:

   ```bash
   docker build -f docker/Dockerfile -t memora:local . && node scripts/check-image.mjs memora:local
   ```

4. Open a pull request. Its **Release** run (a dry run: nothing is published) builds the desktop app on Windows, macOS and Ubuntu, installs it and tests it there, builds the Android app and runs it on an emulator, and builds and checks the images. Merge it once all of that and CI are green, and wait for CI on `main` to pass too.

   The Android app needs **Memora's signing key** in the repository's secrets ([SIGNING.md](SIGNING.md#android)): without it, the release stops at its first job. The dry run doesn't use it: its APKs are signed with the debug key, and named `…-debug-key.apk`.

5. **Tag the merge commit** and push the tag:

   ```bash
   git fetch origin && git tag -a vx.y.z origin/main -m "Memora x.y.z" && git push origin vx.y.z
   ```

6. Watch the **Release** workflow. It checks that the tag, the packages and the changelog agree, and that CI passed for that commit on `main`. It then:
   - builds the desktop app on Windows, macOS and Ubuntu (amd64 and arm64), signed once the signing secrets are set ([SIGNING.md](SIGNING.md)), then tests the app, installs the installer as people will, and tests that too;
   - builds the Android app ([android.yml](../.github/workflows/android.yml)) signed with Memora's key, checks each APK's version and key, and runs the x86_64 one on an emulator. Node.js for Android takes hours to build, so the release uses the one `main` built and cached; the Android workflow keeps that cache from expiring;
   - builds and smoke-tests both architectures of the image, checks the images and lists their contents (SPDX);
   - tags the images: `x.y.z`, `x.y` and `latest`, or only its own tag for a pre-release;
   - creates the GitHub release with the changelog's notes, the installers, the update files (`latest*.yml`) the desktop app checks, and the APKs with their checksums: `Memora-x.y.z-arm64.apk` for phones and `Memora-x.y.z-x86_64.apk`, each with a `.sha256`.

   Each desktop job also keeps screenshots of the app it tested, as built and as installed, in the run's `desktop-screenshot-…` artifacts: a way to see the Mac app without a Mac. The Windows job also installs and tests the Microsoft Store package (`store.png`); with the Store's values set, it keeps that package for uploading in Partner Center. The Android job's `android-trial` artifact has the emulator's report and screenshots.

7. Check the release page (the installers and the APKs are there), open the [download page](https://dreamtheater484.github.io/memora/), and pull the new image once:

   ```bash
   docker pull ghcr.io/dreamtheater484/memora:x.y.z
   ```

Then update your phone: download `Memora-x.y.z-arm64.apk` from the release page and open it ([ANDROID.md](ANDROID.md#updating)). It installs over the version before, notes included.

If the workflow fails before publishing, fix the cause on `main`, delete the tag (`git push origin :vx.y.z` and `git tag -d vx.y.z`), and tag again. After publishing, don't move a tag: release a new patch version instead.
