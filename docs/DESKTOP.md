# Memora for your computer

Memora as an app for Windows, macOS and Ubuntu: download it, open it, start writing. There's no Docker, no server and no account to set up. Your notes stay on your computer.

Using more than one computer? Memora keeps their notes the same through a folder in your cloud storage: Google Drive, kDrive, Nextcloud, or any folder a sync app keeps up to date ([below](#sync-your-computers)). Want your notes on your phone too? That's [Memora Server](SETUP.md), which runs with Docker or on a NAS. You can start here and move to a server later ([below](#moving-to-memora-server)).

## Download

From the [download page](https://dreamtheater484.github.io/memora/), or the newest [release on GitHub](https://github.com/dreamtheater484/memora/releases/latest):

| Your computer                    | File                                              |
| -------------------------------- | ------------------------------------------------- |
| Windows 10 or 11                 | `Memora-Setup.exe`                                |
| Mac, with Intel or Apple Silicon | `Memora.dmg`                                      |
| Ubuntu, on an Intel or AMD PC    | `Memora-amd64.deb`                                |
| Ubuntu, on ARM                   | `Memora-arm64.deb`                                |
| Another Linux system             | `Memora-x86_64.AppImage`, `Memora-arm64.AppImage` |

**What it needs:** a 64-bit computer, about 350 MB of disk space for the app plus room for your notes, and about **500 MB of memory** while Memora is open. That's usual for apps built on web technology; a computer with 4 GB of RAM or more has plenty.

## Installing

### Windows

Double-click `Memora-Setup.exe`. It installs Memora for you, without asking for an administrator, and opens it. From then on Memora is in the Start menu.

**The first time:** until the app is signed ([SIGNING.md](SIGNING.md)), Windows may say "Windows protected your PC". Choose **More info**, then **Run anyway**. It asks only once.

### macOS

Open `Memora.dmg` and drag Memora onto **Applications**. Then open Memora from Applications or Launchpad.

**The first time:** until the app is signed ([SIGNING.md](SIGNING.md)), macOS says it can't check Memora and doesn't open it:

1. Choose **Done**.
2. Open **System Settings → Privacy & Security**, and scroll down to **Security**.
3. Next to "Memora was blocked", choose **Open Anyway**, and confirm with your password.

It asks only once.

### Ubuntu

Double-click `Memora-amd64.deb`: App Center opens it. Choose **Install**. Or, in a terminal:

```bash
sudo apt install ./Memora-amd64.deb
```

Memora is then in the list of apps.

**Another Linux system:** the AppImage runs without installing. Make it executable (in the file's **Properties**, or `chmod +x Memora-x86_64.AppImage`) and double-click it. Some systems need the `libfuse2` package for AppImages.

## Using it

Memora works as described in the [user guide](USER_GUIDE.md). A few things differ, because the app is for one person on one computer:

- There's no login and no password: your account on the computer already protects your notes.
- **Settings** has no pages for passwords, two-step verification, other devices or users.
- The menu bar (press **Alt** on Windows and Ubuntu) has **File → Open the data folder** and **Open the log folder**. **Help** has the user guide, the open-source licences, a way to report a problem, and **Check for updates**.

## Sync your computers

Use Memora on more than one computer, and keep the notes the same on all of them, through a folder in your cloud storage. No server is needed. Phones aren't included: they need [Memora Server](SETUP.md).

### How it works

- Each computer keeps its own copy of the notes, so Memora works offline as before. Changes go through the folder within seconds while the computers are online.
- **Everything is encrypted on your computer** before it goes to the folder: notes, files, and their names. The key comes from a passphrase only you know. Your cloud provider sees how many files there are, how large they are and when they change, but not what's in them.
- **Memora uses one folder and nothing else** in your cloud storage.
- When the same page was changed on two computers before they synced:
  - Markdown pages are merged when the changes don't overlap.
  - Otherwise one text stays, and the other is kept in the page's **History** as a conflict version. Nothing is lost.

### What Memora can reach

| Where                                  | What Memora can reach                                                                                                                             |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Google Drive**                       | Only the files Memora creates itself, in its own folder. **Google enforces this**: the rest of your Drive is out of Memora's reach.               |
| **Infomaniak kDrive**                  | Memora reads and writes in its folder only. The application password itself opens your whole kDrive: kDrive can't limit a password to one folder. |
| **Nextcloud or another WebDAV server** | The same as kDrive: Memora keeps to its folder, but an app password opens your whole account.                                                     |
| **A folder on this computer**          | That folder. Use one that the Google Drive, kDrive or Nextcloud app keeps in sync, or a network drive. Memora then holds no cloud sign-in at all. |

For kDrive and WebDAV, make an application password just for Memora: you can revoke it at any time without changing your own password.

### Set it up

On the first computer:

1. Go to **Settings → Sync**, and choose where to sync:
   - **Google Drive:**
     1. Choose **Sign in with Google**. Your browser opens.
     2. Google asks whether Memora may "see, edit, create and delete only the specific Google Drive files you use with this app". Choose **Allow**.
     3. Go back to Memora. It makes a folder named **Memora** in My Drive.
   - **Infomaniak kDrive:**
     - **kDrive ID:** the number at the end of kDrive's address in your browser, as in `…/kdrive/app/drive/123456`.
     - **E-mail address:** the one you sign in to Infomaniak with.
     - **Application password:** make one in the Infomaniak Manager, under your profile → **Security** → **Application passwords**.
     - **Folder:** Memora makes it when it isn't there.
   - **Nextcloud or another WebDAV server:**
     - **Folder address:** for Nextcloud, `https://your-cloud/remote.php/dav/files/your-name/Memora`.
     - **User name and app password:** in Nextcloud, under **Settings → Security → Devices & sessions**.
   - **A folder on this computer:** choose an empty folder inside the folder that your Google Drive, kDrive or Nextcloud app syncs.
2. **Choose a passphrase**: at least 12 characters, and a few unrelated words work well.
   - Keep it somewhere safe, such as a password manager.
   - You need it on every computer you add.
   - Without it, nobody can read the synced copy, Memora included. Your notes still stay on each computer.

On each other computer, do the same with **the same folder** and **the same passphrase**. Any notes already on that computer are added to the synced ones.

**Settings → Sync** shows when the computers last synced, any problem, and the list of computers. The cloud icon in the top bar shows the same at a glance.

### Good to know

- **Turning sync off** (Settings → Sync → **Turn off**) keeps your notes on this computer and leaves the folder for your other computers.
- **Don't change the files in the sync folder yourself.** Memora notices a file that was changed and stops, rather than reading it. Deleting the folder deletes the synced copy (each computer keeps its notes).
- **A new computer:** install Memora, then set up sync with the same folder and passphrase.
- **Restoring a backup** on a synced computer pauses sync there. When you choose **Sync again**, the notes on your other computers win where they differ, and this computer's page text is kept in each page's history. To bring back one older page everywhere, use that page's **History** instead.
- **Where the sign-in is kept:** by your computer's own protection, never with your notes or in their backups. That's the Windows credential store, the macOS Keychain, or the Linux keyring. On Linux this needs GNOME Keyring or KWallet; without one, sync through a folder on this computer instead.
- **Tags, project keys and card numbers** made on two computers at the same time are sorted out by themselves:
  - Two tags with the same name become one.
  - When two projects have the same key, the newer project gets another key.
  - When two cards have the same number, the newer card gets a new number.

### Your own Google Cloud client

Builds of Memora not made by the project can't sign in to Google Drive by themselves. You can give Memora a Google Cloud client of your own:

1. In the [Google Cloud console](https://console.cloud.google.com/), make a project.
2. Under **APIs & Services**, enable the **Google Drive API**.
3. Set up the **OAuth consent screen**:
   - Choose **External**, and give it a name.
   - Add one scope only: `…/auth/drive.file`.
   - Then **publish** it ("In production"). With this scope it needs no review. In "Testing", Google asks you to sign in again every 7 days.
4. Under **Credentials**, make an **OAuth client ID** of type **Desktop app**.
5. In Memora, go to **Settings → Sync → Advanced: your own Google Cloud client**, and enter its ID and secret.

Use the same client on every computer: Google lets a client's apps see only the files that client's apps made.

## Where your notes are

| System  | Folder                                      |
| ------- | ------------------------------------------- |
| Windows | `%APPDATA%\Memora\Data`                     |
| macOS   | `~/Library/Application Support/Memora/Data` |
| Ubuntu  | `~/.config/Memora/Data`                     |

**File → Open the data folder** opens it. It holds the same files as a server's data folder: `memora.db` with all your notes, `backups/`, and `secret.key`. Uninstalling Memora keeps this folder.

## Backups

Memora makes backups by itself:

- once it has been open for a minute, when the newest backup is more than a day old;
- every night at 03:00, when it's open then;
- before an update that changes the database.

It keeps the backups of the last day, and then one a day for a week, one a week for a month, and one a month for a year. To restore one, go to **Settings → Backups** and choose **Restore**: Memora restarts with it.

The backups are in the data folder, so on the same disk as your notes. To also be safe from a broken disk or a lost laptop, copy the `backups` folder to a USB drive or a cloud folder now and then. Or export everything as a Memora archive (**Settings → Import & export**).

## Updates

- **Windows** and the **AppImage** update themselves: a new version downloads in the background and installs when you close Memora, or right away if you choose **Restart now**.
- **macOS** and **Ubuntu**: Memora tells you when a new version is out. Choose **Download**, and install it over the old one: your notes stay as they are. Once the Mac app is signed, it updates itself too.

**Help → Check for updates** looks right away.

## Privacy

Memora connects to the internet for these things only:

- to check GitHub for a new version;
- to download the pictures of a web page you paste;
- when you turn sync on, to reach your sync folder: Google Drive or your WebDAV server (a folder on this computer needs no connection of Memora's own).

There's no telemetry.

Memora's built-in server listens on this computer only (127.0.0.1), and only the app's window can sign in: it uses a secret made anew each time Memora starts. Other computers on your network can't reach it.

## Moving to Memora Server

Everything moves with it: pages, files, tags, templates, history and boards.

1. In the app: **Settings → Import & export**, and export everything as a **Memora archive**.
2. Set up [Memora Server](SETUP.md), and create your account there.
3. On the server: **Settings → Import & export → Import**, and choose the archive.

## Uninstalling

- **Windows:** Settings → Apps → Installed apps → Memora → **Uninstall**.
- **macOS:** drag Memora from Applications to the Bin.
- **Ubuntu:** App Center → Manage → Memora → **Uninstall**, or `sudo apt remove memora`.

Your notes stay in the data folder. To remove them too, delete that folder.

## Troubleshooting

| What you see                                  | What to do                                                                                                                                                                                                                                                                                                                                  |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| "Memora could not start"                      | The message says why, and where the log is. The log folder is beside the data folder (`logs`). [Report a problem](https://github.com/dreamtheater484/memora/issues) with it.                                                                                                                                                                |
| "Memora stopped unexpectedly"                 | Choose **Start again**: your notes are safe. **Show the log** shows what happened.                                                                                                                                                                                                                                                          |
| Opening Memora again shows nothing new        | Memora opens once: starting it again brings its window to the front.                                                                                                                                                                                                                                                                        |
| Windows or macOS won't open it                | That's the first-time check of an app that isn't signed yet: see [Installing](#installing).                                                                                                                                                                                                                                                 |
| Sync says it is paused                        | **Settings → Sync** says why and what to do: sign in again, enter the password again, or **Sync again** after a restore.                                                                                                                                                                                                                    |
| Sync says a file was changed                  | Something other than Memora changed a file in the sync folder. The other computers' changes still come in. That one computer's changes wait until one of your computers writes a snapshot that has them (each does at least once a week while in use). [Report it](https://github.com/dreamtheater484/memora/issues) if it keeps happening. |
| Sync won't use a folder: it "has files in it" | The folder has `changes`, `files`, `snapshots` or `devices` folders with files, but no `memora-vault.json`. Memora won't start a new sync over them. Choose an empty folder, or a new one.                                                                                                                                                  |
| A computer's changes don't arrive             | A sync app may still be copying the folder. Memora waits for the missing files and takes them in order.                                                                                                                                                                                                                                     |
