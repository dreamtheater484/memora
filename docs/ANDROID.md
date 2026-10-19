# Memora for Android

Memora as an app for Android phones: the same Memora as on your computer, with your notes on the phone, so it works offline. It keeps them the same as on your computers through your kDrive or Nextcloud folder ([below](#sync-with-your-computers)).

It isn't on Google Play. You install it from a file (an APK) from Memora's releases on GitHub, and update it the same way, with the next file: your notes stay.

## Download

From the newest [release on GitHub](https://github.com/dreamtheater484/memora/releases/latest), on the phone:

| Your device                                                 | File                      |
| ----------------------------------------------------------- | ------------------------- |
| An Android phone or tablet                                  | `Memora-x.y.z-arm64.apk`  |
| A Chromebook with an Intel or AMD processor, or an emulator | `Memora-x.y.z-x86_64.apk` |

`x.y.z` is the version, such as `0.11.0`: the first release with an APK. Beside each APK, a `.sha256` file holds its checksum.

**What it needs:** Android 8.0 or later, in its 64-bit version, as nearly every phone has. A few low-cost phones with Android Go run a 32-bit Android only, and can't run Memora.

## Installing

1. Open the release page in the phone's browser, and download `Memora-x.y.z-arm64.apk`.
2. Open the download, from the browser's notification or from **Files → Downloads**.
3. **The first time**, Android says your browser isn't allowed to install unknown apps. Choose **Settings**, turn on **Allow from this source**, and go back.
4. Choose **Install**. If Play Protect warns about an app it doesn't know, choose **More details**, then **Install anyway**. It may offer to scan the app first; that's fine.
5. Open Memora. The first start takes a few seconds longer: it unpacks what it runs.

You can turn **Allow from this source** off again afterwards, in Android's settings under **Install unknown apps** (often in **Apps → Special app access**). Android then asks again at the next update.

**Checking the download** (optional): on a computer, `sha256sum -c Memora-x.y.z-arm64.apk.sha256` with both files in one folder says `OK`. On Windows, `certutil -hashfile Memora-x.y.z-arm64.apk SHA256` shows the checksum to compare with the file's.

## Using it

Memora works as described in the [user guide](USER_GUIDE.md), with the phone layout. As on the computer, there's no login and no password: the phone's screen lock protects your notes. Android's back button goes back a page, and links to websites open in your browser.

## Sync with your computers

Through **Infomaniak kDrive**, or **Nextcloud or another WebDAV server**, only. **Settings → Sync** also lists Google Drive and "a folder on this computer", but they don't work on a phone.

Set it up as on a computer ([DESKTOP.md](DESKTOP.md#set-it-up)): in **Settings → Sync**, choose kDrive or WebDAV, and enter **the same folder** and **the same passphrase** as on your computers. Make an application password just for the phone: you can revoke it alone if you lose the phone.

- Memora syncs when you open it, and when you come back to it from another app. While it's open, changes go through within seconds.
- The sign-in is sealed with a key that Android's keystore keeps on the phone.
- Everything is encrypted on the phone before it goes to the folder, as on your computers. How sync works, and what to know: [DESKTOP.md](DESKTOP.md#sync-your-computers).

## Updating

Memora for Android doesn't update itself. When a new version is out:

1. Download the new `Memora-x.y.z-arm64.apk` from the [release page](https://github.com/dreamtheater484/memora/releases/latest).
2. Open it, and choose **Update**.

Your notes, settings and sync stay as they are: Android replaces the app and keeps its data, because every release is signed with the same key. It won't install an older version over a newer one.

### Being told about new versions: Obtainium

[Obtainium](https://github.com/ImranR98/Obtainium) is a free, open-source app that watches apps' releases on GitHub. It tells you when there's a new version of Memora, and installs it when you tap the notice.

1. Install Obtainium from its [releases](https://github.com/ImranR98/Obtainium/releases).
2. In Obtainium, choose **Add app**, and enter `https://github.com/dreamtheater484/memora`.
3. Under **Filter APKs by regular expression**, enter `arm64\.apk$`: each release has an APK for x86_64 too.
4. Choose **Add**. With Memora already installed, Obtainium recognises it.

## Moving from the trial

The trial app, from the Android workflow's downloads (version `0.10.0-trial`), was signed with a key of the build machine's. A release can't install over it, so moving to 0.11.0, the first release with an APK, takes one reinstall:

1. **Check that sync is done.** In the trial app, go to **Settings → Sync**, choose **Sync now**, and wait until the status says **Synced**, with no **To send** line under it. On a computer, check that the notes you made on the phone are there.
2. **Uninstall the trial**: touch and hold Memora's icon, then **App info → Uninstall**. This deletes the notes on the phone: they're in the sync folder and on your computers.
3. **Install the release** ([above](#installing)).
4. **Join the sync folder again**, as when you first set it up ([above](#sync-with-your-computers)): the same folder, with the same passphrase. Memora brings your notes back.

Under **Computers**, the phone may then show twice: the trial's entry no longer changes.

## Google's developer verification, from 2027

From 2027, Android phones with Google Play install an app from outside Google Play only when its developer is verified by Google and has registered the app, also for an APK you install yourself. (It began in Brazil, Indonesia, Singapore and Thailand on 30 September 2026.) Google's [FAQ](https://developer.android.com/developer-verification/guides/faq) has the details. Memora keeps installing and updating in one of three ways:

- **A free limited-distribution account**, meant for students and hobbyists: no fee and no ID. The maintainer registers Memora's package and its signing key there, and adds up to 20 devices that may then install it as before. That's why Memora's key must never change ([SIGNING.md](SIGNING.md#android)).
- **The advanced flow**, on the phone: a one-time setting to install apps from developers who aren't verified. Turn on developer options, confirm nobody is pressuring you, restart, wait one day, confirm with your fingerprint, face or PIN, and allow it for 7 days or for good. Each install still warns you: choose **Install anyway**. Updates of an unregistered app need it to stay allowed.
- **adb**, from a computer with the [platform tools](https://developer.android.com/tools/releases/platform-tools) and USB debugging on: `adb install -r Memora-x.y.z-arm64.apk`. Google isn't changing adb, and `-r` keeps your notes.

## Where your notes are

In Memora's own storage on the phone, which other apps and the **Files** app can't see. Memora makes backups there by itself, as on a computer ([DESKTOP.md](DESKTOP.md#backups)).

**Uninstalling Memora deletes them**, its backups included, and Android's own backup leaves them out. Keep sync on: your sync folder and your computers then have them too.

## Privacy

As on the computer ([DESKTOP.md](DESKTOP.md#privacy)): no telemetry. Memora connects to the internet only for your sync folder and for the pictures of a web page you paste. It doesn't check for updates. Its built-in server listens on the phone only (127.0.0.1), and only Memora's own window can sign in to it.

## Uninstalling

Touch and hold Memora's icon, then **App info → Uninstall**. That deletes the notes on the phone; the ones in your sync folder and on your computers stay.
