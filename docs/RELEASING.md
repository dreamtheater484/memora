# Making a release

For maintainers. A release is a version tag on `main`; the [release workflow](../.github/workflows/release.yml) does the rest.

## Versions

Memora follows [Semantic Versioning](https://semver.org/): `MAJOR.MINOR.PATCH`.

- **Patch** (0.9.1): fixes only.
- **Minor** (0.10.0): new features, or anything that changes the database. A release before 1.0 may also change behaviour in a minor version; the changelog says so.
- **Major** (1.0.0, 2.0.0): the first stable release, then breaking changes.
- **Pre-release** (1.0.0-rc.1): a candidate to try. It gets only its own image tag, never `latest`.

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

4. Open a pull request. Its **Release** run (a dry run: nothing is published) builds the desktop app on Windows, macOS and Ubuntu, installs it and tests it there, and builds and checks the images. Merge it once all of that and CI are green, and wait for CI on `main` to pass too.
5. **Tag the merge commit** and push the tag:

   ```bash
   git fetch origin && git tag -a vx.y.z origin/main -m "Memora x.y.z" && git push origin vx.y.z
   ```

6. Watch the **Release** workflow. It checks that the tag, the packages and the changelog agree, and that CI passed for that commit on `main`. It then:
   - builds the desktop app on Windows, macOS and Ubuntu (amd64 and arm64), signed once the signing secrets are set ([SIGNING.md](SIGNING.md)), then tests the app, installs the installer as people will, and tests that too;
   - builds and smoke-tests both architectures of the image, checks the images and lists their contents (SPDX);
   - tags the images: `x.y.z`, `x.y` and `latest`, or only its own tag for a pre-release;
   - creates the GitHub release with the changelog's notes, the installers and the update files (`latest*.yml`) the desktop app checks.

   Each desktop job also keeps a screenshot of the app it tested, as an artifact of the run: a way to see the Mac app without a Mac. With the Microsoft Store's values set, the Windows job keeps a Store package too, for uploading in Partner Center.

7. Check the release page (the installers are there), open the [download page](https://dreamtheater484.github.io/memora/), and pull the new image once:

   ```bash
   docker pull ghcr.io/dreamtheater484/memora:x.y.z
   ```

If the workflow fails before publishing, fix the cause on `main`, delete the tag (`git push origin :vx.y.z` and `git tag -d vx.y.z`), and tag again. After publishing, don't move a tag: release a new patch version instead.
