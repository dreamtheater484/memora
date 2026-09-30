# Memora for your computer

Memora as an app for Windows, macOS and Ubuntu: download it, open it, start writing. There's no Docker, no server and no account to set up. Your notes stay on your computer.

Want your notes on every device, your phone included? That's [Memora Server](SETUP.md), which runs with Docker or on a NAS. You can start here and move to a server later ([below](#moving-to-memora-server)).

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

Memora connects to the internet for two things only: to check GitHub for a new version, and to download the pictures of a web page you paste. There's no telemetry.

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

| What you see                           | What to do                                                                                                                                                                   |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| "Memora could not start"               | The message says why, and where the log is. The log folder is beside the data folder (`logs`). [Report a problem](https://github.com/dreamtheater484/memora/issues) with it. |
| "Memora stopped unexpectedly"          | Choose **Start again**: your notes are safe. **Show the log** shows what happened.                                                                                           |
| Opening Memora again shows nothing new | Memora opens once: starting it again brings its window to the front.                                                                                                         |
| Windows or macOS won't open it         | That's the first-time check of an app that isn't signed yet: see [Installing](#installing).                                                                                  |
