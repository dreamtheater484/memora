# Installing Memora

This guide installs Memora with Docker: on a Synology NAS, on Linux, or on Windows. Using Memora is in the [user guide](USER_GUIDE.md); updating it is in [UPGRADE.md](UPGRADE.md).

## What you need

|                  | Needed                                                                                                                            |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| **Docker host**  | A Synology NAS with DSM 7.2 or later and **Container Manager**, Docker Engine on Linux, or Docker Desktop on Windows 11           |
| **Processor**    | 64-bit: x86-64 (Intel or AMD) or ARM64                                                                                            |
| **Memory (RAM)** | **512 MB free** recommended, 256 MB at the least                                                                                  |
| **Disk**         | About 350 MB for the image, plus your notes, their images and files, and the backups                                              |
| **HTTPS**        | For real use: offline mode and the installed app need it ([HTTPS](#https)). Plain HTTP on your own network is fine for trying it. |

**Memory in practice.** Memora usually uses **100 to 150 MB**: that is what Container Manager and `docker stats` show, the program itself included. Large imports and exports take more for a while, up to about 400 MB, because the Node.js heap is capped at 256 MB (`MEMORA_MAX_HEAP_MB`). Memory hardly grows with the number of notes, which stay in the database on disk.

**Disk in practice.** Disk use grows with your notes, images and files. The automatic backups keep up to about 25 copies of the database (daily, weekly and monthly ones; [BACKUP_RESTORE.md](BACKUP_RESTORE.md)), so leave room for that too, or keep fewer.

## Quick start (any Docker host)

1. Create a folder for Memora, for example `memora`, with a folder `data` inside it. Save [`docker/docker-compose.example.yml`](../docker/docker-compose.example.yml) in `memora` as `docker-compose.yml`.
2. Edit it: set `TZ` to your time zone.
3. Start it:

   ```bash
   docker compose up -d
   ```

4. Read the **setup code** from the log:

   ```bash
   docker logs memora
   ```

5. Open `http://<host-ip>:3000`, enter the setup code, and create your administrator account. On the computer that runs Docker, use `http://localhost:3000`: browsers allow offline mode only there or over HTTPS.

> On Ubuntu, `docker compose` needs the Compose plugin: `sudo apt install docker-compose-v2`.

Or with plain `docker run` (one line, in the `memora` folder):

```bash
mkdir -p data && docker run -d --name memora --restart unless-stopped -p 3000:3000 -v ./data:/data ghcr.io/dreamtheater484/memora:latest
```

### Images

The images are built for amd64 and arm64 and published at `ghcr.io/dreamtheater484/memora`:

- `:latest`, the newest release (what the example uses);
- `:0.9`, the fixes to 0.9 only, or `:0.9.0`, exactly that version;
- `:edge`, every change on the `main` branch, for testing.

[UPGRADE.md](UPGRADE.md#which-image-to-follow) says more about choosing one.

To build the image yourself instead, from a checkout of the repository:

```bash
docker build -f docker/Dockerfile -t memora:local .
```

Then use `image: memora:local` in the compose file.

## First run

### The setup code

Until the first account exists, Memora prints a one-time setup code in its log each time it starts:

```
================================================================
  Memora setup code:  7K3M-Q9WX-D2HT
...
```

The code proves that whoever creates the administrator can read the server's log, so nobody else on your network can claim a fresh Memora first. It is kept only in memory: a restart prints a new one. After a few wrong codes Memora makes you wait before trying again.

### Accounts

- The first account is the **administrator**. Administrators manage accounts and see the audit log; they can't read other people's notes.
- Add people in **Settings → Users → Add user**. Memora shows a **one-time password** once: give it to them in person or over a private channel. They choose their own password when they first log in.
- **Passwords** need at least 12 characters. Common passwords, and ones containing the username, are refused. A few unrelated words work well.
- **Remember this device** keeps you logged in for 30 days of inactivity. Without it, a session ends after 12 hours of inactivity. Either way, you are logged out after 90 days.
- **Settings → Account → Devices** lists where you're logged in. Sign out any device you don't recognise. Changing your password signs out all your other devices.
- **Settings → Audit log** (administrators) shows logins, failed logins and account changes for the last year.

### Two-step verification

Each person can turn on **two-step verification** in **Settings → Account**: logging in then also asks for a six-digit code from an authenticator app on their phone (2FAS, Aegis, Google Authenticator, Microsoft Authenticator, or the one built into a password manager such as Bitwarden or 1Password). Setting it up shows a QR code to scan and ten **recovery codes**. Each recovery code logs in once without the phone. Keep them somewhere safe, such as a password manager.

Administrators can require it for everyone in **Settings → Users → Security**, after turning it on for their own account. Anyone without it is then asked to set it up before they can continue.

Lost the phone and the recovery codes? An administrator turns it off for that person in **Settings → Users** (the person's **⋯** menu). For the last administrator, use `memora-admin reset-2fa <username>` (below).

We strongly recommend two-step verification for everyone when Memora can be reached from the internet.

### Locked out? `memora-admin`

For when the web interface can't help, such as a forgotten administrator password:

```bash
docker exec memora memora-admin list-users
```

```bash
docker exec memora memora-admin reset-password <username>
```

```bash
docker exec memora memora-admin reset-2fa <username>
```

`reset-password` prints a one-time password and signs that user out everywhere. `reset-2fa` turns off two-step verification for someone who lost their phone and their recovery codes, and signs them out everywhere. On Synology, run these over SSH with `sudo`, or use **Container Manager → Container → memora → Action → Open terminal** and type `memora-admin list-users`.

`memora-admin hash-benchmark` shows how long one password check takes on your hardware. Around 100–500 ms is right; logins are slow on purpose, to make guessing expensive.

## Which user Memora runs as

Memora never runs as root. There's nothing to set: it runs as **the owner of the data folder**, so it can always write there. Create the `data` folder yourself (in File Station, Explorer or with `mkdir`), and Memora's files belong to you.

If Docker creates the folder instead (it didn't exist when the container started), the folder belongs to root. Memora then runs as user `1000` and hands the empty folder to it.

To choose the user yourself, set `PUID` and `PGID` to its numeric user and group ID (`id` shows them on Linux). That user must be able to read and write the data folder. If it can't, Memora stops with a message that says who owns the folder, instead of changing permissions itself.

## Where your data lives

Everything is stored in the folder mounted at `/data`:

| Path                             | Contents                                                                              |
| -------------------------------- | ------------------------------------------------------------------------------------- |
| `memora.db`                      | The database: all users, notes, images and boards                                     |
| `memora.db-wal`, `memora.db-shm` | SQLite working files while Memora runs (normal)                                       |
| `backups/`                       | Automatic backups, including one taken before every upgrade that changes the database |
| `secret.key`                     | The instance key: it encrypts two-step verification secrets. Made on first start.     |

**Keep a copy of `secret.key`** somewhere safe, such as your password manager. It is not in the database or its backups, so a stolen backup doesn't give away anyone's two-step verification. Without it, after a restore on a new machine, authenticator codes stop working until people set up their app again (their recovery codes still work).

**Encryption at rest.** Memora doesn't encrypt the database file itself ([ADR 0005](adr/0005-database-encryption-at-rest.md)). To protect everything against a stolen disk, put the data folder on an encrypted volume: a Synology **encrypted shared folder**, LUKS on Linux, or BitLocker on Windows.

**Never copy `memora.db` while Memora is running** as a backup. Use the files in `backups/`, which are consistent snapshots, taken every night and before every update. [BACKUP_RESTORE.md](BACKUP_RESTORE.md) explains the schedule, encryption, copying them elsewhere with Hyper Backup, and restoring.

## Configuration

Set these as environment variables (the `environment:` section of the compose file):

| Variable                      | Default                          | Purpose                                                                                                                    |
| ----------------------------- | -------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `PUID` / `PGID`               | the data folder's owner          | User and group Memora runs as ([see above](#which-user-memora-runs-as)). Leave them out unless you need another user.      |
| `TZ`                          | `Etc/UTC`                        | Timezone, for example `Europe/Paris`                                                                                       |
| `PORT`                        | `3000`                           | Port inside the container                                                                                                  |
| `MEMORA_BASE_URL`             | —                                | The address you open Memora at, for example `https://<nas-ip>:8443`. Used for the origin check on every change.            |
| `MEMORA_TRUST_PROXY`          | `loopback,linklocal,uniquelocal` | Which reverse proxies may pass on the visitor's address (`X-Forwarded-For`): see below                                     |
| `MEMORA_SESSION_DAYS`         | `30`                             | How long "remember this device" keeps you logged in without using Memora                                                   |
| `MEMORA_SESSION_HOURS`        | `12`                             | How long a session lasts without using Memora, without "remember this device"                                              |
| `MEMORA_MAX_HEAP_MB`          | `256`                            | Maximum Node.js heap in MB. Keeps RAM use predictable.                                                                     |
| `MEMORA_MAX_UPLOAD_MB`        | `25`                             | Largest image or file that can be pasted or dropped into a page, in MB                                                     |
| `MEMORA_BACKUP_DIR`           | `/data/backups`                  | Where backups are written                                                                                                  |
| `MEMORA_BACKUP_SCHEDULE`      | `0 3 * * *`                      | When backups are taken (cron syntax, the container's time zone); `off` for never                                           |
| `MEMORA_BACKUP_KEEP`          | `7,4,12`                         | Daily, weekly and monthly backups kept, besides everything from the last day                                               |
| `MEMORA_BACKUP_PASSWORD_FILE` | —                                | A file with a password to encrypt new backups with ([BACKUP_RESTORE.md](BACKUP_RESTORE.md))                                |
| `MEMORA_TRASH_DAYS`           | `30`                             | Days a deleted item stays in the recycle bin before it is deleted for good                                                 |
| `MEMORA_HISTORY_RETENTION`    | `48h,14d,90d`                    | Page versions: all for 48 hours, then hourly for 14 days, daily for 90 days, weekly after. Named versions are always kept. |
| `MEMORA_MAX_IMPORT_MB`        | `1024`                           | Largest file that can be imported (a `.memora` archive or a zip), in MB                                                    |
| `MEMORA_GOTENBERG_URL`        | —                                | A Gotenberg service for one-click PDF export, for example `http://gotenberg:3000` (see below)                              |
| `MEMORA_SECRET_KEY_FILE`      | `/data/secret.key`               | Where the instance key is kept, for example a Docker secret. Made there on first start when it doesn't exist.              |
| `MEMORA_LOG_LEVEL`            | `info`                           | `fatal`, `error`, `warn`, `info`, `debug`, `trace` or `silent`                                                             |

**`MEMORA_TRUST_PROXY`.** Memora slows down repeated failed logins per visitor address, and records addresses in the audit log. Behind a reverse proxy every request comes from the proxy, so Memora reads the real address from the proxy's `X-Forwarded-For` header, but only from proxies it trusts. The default trusts proxies on the same machine and on private networks, which covers the Synology reverse proxy and Docker's networks. Set `false` when nothing sits in front of Memora, or list addresses or ranges (for example `198.51.100.2,2001:db8::/32`) to be stricter.

**Images from web pages.** When you paste part of a web page with pictures, Memora's server downloads them, so the page keeps working when the website changes. That needs the container to reach the internet (it does by default). Memora never downloads from addresses on your own network, whatever a pasted page points at.

**Import and export.** Exports and imports of archives and zips run in the background on the server, one at a time, with their files in `/data/tmp` while they work. An export's file can be downloaded for a day, then it is deleted. Word, HTML and PDF files are made in your browser.

### Optional: one-click PDFs (Gotenberg)

Without anything extra, **Export → PDF** opens a print preview laid out in pages, and your browser's print dialog saves the PDF. To download PDFs in one click instead, run [Gotenberg](https://gotenberg.dev) next to Memora and tell Memora where it is. Add this to the compose file's `services:`, and `MEMORA_GOTENBERG_URL: 'http://gotenberg:3000'` to Memora's `environment:`:

```yaml
gotenberg:
  image: gotenberg/gotenberg:8
  container_name: memora-gotenberg
  restart: unless-stopped
  # No ports: only Memora talks to it, over the compose network.
```

Gotenberg runs a headless Chromium and uses a few hundred MB of RAM, so it is worth it only if you export PDFs often. Memora sends it the page with its images inside and a content security policy that forbids loading anything else, so a page can't make it fetch an address.

## Synology step by step

**Can your NAS run it?** If Package Center offers **Container Manager**, yes: it needs DSM 7.2 or later and exists only for 64-bit models, and Memora is built for both kinds of 64-bit processor. **Control Panel → Info Center → General** shows the DSM version, the processor and the installed memory; **Resource Monitor** shows how much memory is free. A NAS with 2 GB of RAM or more usually has the 512 MB to spare; with 1 GB, check Resource Monitor first.

1. Install **Container Manager** from Package Center. It creates the shared folder `docker`.
2. In **File Station**, create the folder `memora` inside `docker`, and a folder `data` inside `memora`. Container Manager doesn't create a missing folder: it stops with _"Bind mount failed"_. Memora runs as the account that creates the `data` folder, so there is nothing to set up for permissions.
3. **Container Manager → Project → Create**:
   - **Project name:** `memora`.
   - **Path:** `docker/memora`.
   - **Source:** **Create docker-compose.yml**, and paste this, with your time zone:

     ```yaml
     services:
       memora:
         image: ghcr.io/dreamtheater484/memora:latest
         container_name: memora
         restart: unless-stopped
         ports:
           - '3000:3000'
         environment:
           TZ: 'Etc/UTC' # your time zone, for example Europe/Berlin
         volumes:
           - ./data:/data
     ```

     If port 3000 is taken on the NAS, change only the first number, for example `'3001:3000'`, and use that port below.

   - **Web portal via Web Station:** leave it off. The reverse proxy in [HTTPS](#https) does that job, with the WebSocket header Memora needs.
   - Finish the wizard. Container Manager downloads the image and starts Memora.

4. **Container Manager → Container → memora → Log** shows the setup code.
5. Open `http://<nas-address>:3000` and create your administrator account.
6. Set up [HTTPS](#https). Then change the port line to `'127.0.0.1:3000:3000'`, so only the reverse proxy can reach Memora directly, and build the project again (**Project → memora → Action → Build**).

Updating later: [UPGRADE.md](UPGRADE.md#updating). Backing up to another disk or the cloud with Hyper Backup: [BACKUP_RESTORE.md](BACKUP_RESTORE.md).

### Images from your own fork

The images above come from [github.com/dreamtheater484/memora](https://github.com/dreamtheater484/memora). A fork publishes its own image to `ghcr.io/<your-github-user>/memora`. If that image is private, either make it public (GitHub → your profile → **Packages → memora → Package settings → Change visibility**), or log in on the NAS with a token that can only read packages:

```bash
sudo docker login ghcr.io -u <your-github-user>
```

Paste a **fine-grained or classic token with only `read:packages`** as the password. The token stays on the NAS, never in the repository.

## Ubuntu 26.04 (Docker Engine)

1. Install Docker and Compose from Ubuntu's packages, and let your user run Docker (log out and back in afterwards):

   ```bash
   sudo apt install docker.io docker-compose-v2
   ```

   ```bash
   sudo usermod -aG docker "$USER"
   ```

2. Make a folder for Memora, with its `data` folder, and download the example compose file into it:

   ```bash
   mkdir -p ~/memora/data && cd ~/memora && curl -fsSLo docker-compose.yml https://raw.githubusercontent.com/dreamtheater484/memora/main/docker/docker-compose.example.yml
   ```

3. In `docker-compose.yml`, set `TZ` to your time zone.
4. Start it, and read the setup code:

   ```bash
   docker compose up -d && docker logs memora
   ```

5. Open `http://localhost:3000` and create your administrator account.

## Windows 11 (Docker Desktop)

1. Install [Docker Desktop](https://www.docker.com/products/docker-desktop/) with the WSL 2 back end (its default), and start it.
2. Create a folder, for example `C:\memora`, and save [`docker-compose.example.yml`](../docker/docker-compose.example.yml) in it as `docker-compose.yml`. In PowerShell:

   ```powershell
   mkdir C:\memora; cd C:\memora; Invoke-WebRequest https://raw.githubusercontent.com/dreamtheater484/memora/main/docker/docker-compose.example.yml -OutFile docker-compose.yml
   ```

3. Set `TZ` in the file.
4. Start it, and read the setup code:

   ```powershell
   docker compose up -d; docker logs memora
   ```

5. Open `http://localhost:3000` and create your administrator account.

Memora then runs whenever Docker Desktop does. To reach it from your phone or another computer, allow Docker Desktop through the Windows firewall when it asks, and set up [HTTPS](#https) for offline use on those devices.

## HTTPS

Browsers only allow offline mode, secure cookies and clipboard images over **HTTPS** (or at `localhost`), even on your own network. Over plain HTTP Memora still works, but logs a warning and uses a weaker cookie.

Three ways to get HTTPS:

- **A. VPN plus a local certificate** (no domain name; the tested path): below.
- **B. A domain name** with a Let's Encrypt certificate.
- **C. Tailscale**, with its built-in certificates.

### A. VPN plus a local certificate

You create a small **certificate authority** (CA) of your own, use it to issue a certificate for the NAS, and tell each of your devices to trust that CA. From outside your home, you reach the NAS through your VPN (for example WireGuard). Nothing is opened on your router.

**1. Create the CA and the certificate.** On a computer with OpenSSL (Ubuntu has it; on Windows use WSL or Git Bash), in an empty folder. Replace `<nas-ip>` with the NAS's address on your network, the one you'll type in the browser.

Create the CA. It asks for a passphrase: choose a strong one.

```bash
openssl req -x509 -newkey rsa:3072 -sha256 -days 3650 -keyout memora-ca.key -out memora-ca.crt -subj "/CN=Memora local CA" -addext "basicConstraints=critical,CA:TRUE" -addext "keyUsage=critical,keyCertSign,cRLSign"
```

Create a file `memora.ext` describing the NAS certificate. Add `DNS:<name>` entries (comma-separated) if you also use a local name such as `memora.home.arpa`:

```
basicConstraints = CA:FALSE
keyUsage = critical, digitalSignature, keyEncipherment
extendedKeyUsage = serverAuth
subjectAltName = IP:<nas-ip>
```

Create the key and certificate for the NAS, signed by the CA. 825 days is the longest that Apple devices accept:

```bash
openssl req -new -newkey rsa:2048 -noenc -keyout memora.key -out memora.csr -subj "/CN=<nas-ip>"
```

```bash
openssl x509 -req -in memora.csr -CA memora-ca.crt -CAkey memora-ca.key -CAcreateserial -days 825 -sha256 -extfile memora.ext -out memora.crt
```

You now have `memora-ca.crt` (goes on every device), `memora.crt` and `memora.key` (go on the NAS), and `memora-ca.key`.

> **Keep `memora-ca.key` and its passphrase safe and off the NAS**, for example on a USB stick or in your password manager. Anyone with it can create certificates your devices trust. You need it again only to renew the NAS certificate in about two years (repeat the last two commands).

**2. Import the certificate in DSM.** **Control Panel → Security → Certificate → Add → Add a new certificate → Import certificate**:

- Private key: `memora.key`
- Certificate: `memora.crt`
- Intermediate certificate: `memora-ca.crt`

**3. Add a reverse proxy rule.** **Control Panel → Login Portal → Advanced → Reverse Proxy → Create**:

- Source: protocol **HTTPS**, hostname `*`, port `8443` (any free port; DSM itself uses 5000 and 5001).
- Destination: protocol **HTTP**, hostname `localhost`, port `3000`.
- **Custom Header → Create → WebSocket**. Without it, changes from your other devices show up only every 30 seconds, and Memora's status says the live connection is blocked.

Then in **Control Panel → Security → Certificate → Settings**, choose the imported certificate for the `*:8443` entry.

**4. Tell Memora its address.** In the compose file (**Container Manager → Project → memora → YAML Configurations**), set `MEMORA_BASE_URL: 'https://<nas-ip>:8443'` and change the port line to `'127.0.0.1:3000:3000'`. Save, and let Container Manager rebuild the project.

**5. Trust the CA on each device.** Copy `memora-ca.crt` to the device, then:

- **Windows 11:** double-click the file → **Install Certificate** → Current User → **Place all certificates in the following store → Browse → Trusted Root Certification Authorities** → Finish, and confirm. Chrome and Edge use this store; so does Firefox (it trusts the Windows store by default).
- **Ubuntu:** for the system and command-line tools:

  ```bash
  sudo cp memora-ca.crt /usr/local/share/ca-certificates/ && sudo update-ca-certificates
  ```

  Chrome and Firefox keep their own lists: in Chrome, **Settings → Privacy and security → Security → Manage certificates**, and import it as a trusted authority. In Firefox, **Settings → Privacy & Security → Certificates → View Certificates → Authorities → Import**, and tick "Trust this CA to identify websites".

- **Android:** **Settings → Security and privacy → More security settings → Encryption and credentials → Install a certificate → CA certificate**, then pick the file. The menu names differ between phone makers; searching Settings for "CA certificate" finds it.
- **iOS / iPadOS:** open the file (AirDrop, Mail or Files) and allow the profile download. Install it in **Settings → General → VPN & Device Management**. Then turn on full trust in **Settings → General → About → Certificate Trust Settings**. That last step is easy to miss.

Open `https://<nas-ip>:8443`: the browser shows a padlock with no warning. From outside, connect the VPN first and use the same address.

### B. A domain name

Point a (sub)domain at your home address (Synology DDNS works), get a Let's Encrypt certificate in **Control Panel → Security → Certificate**, create the reverse proxy rule above with your domain as the source hostname and port 443, and forward port 443 on your router. Turn on **Auto Block** and the firewall in DSM. Set `MEMORA_BASE_URL` to `https://<your-domain>`.

### C. Tailscale

Install Tailscale on the NAS and your devices, turn on **HTTPS certificates** in the Tailscale admin console, and use `tailscale serve` to publish `http://localhost:3000` at your NAS's Tailscale name. Set `MEMORA_BASE_URL` to that `https://` address.

## Installing the app

Once Memora is served over HTTPS, it installs on phones and computers like an app, with its own window and icon, and works offline. The [user guide](USER_GUIDE.md#offline-and-the-app) shows how, for each browser.

## First deployment checklist

For the first time on the NAS:

1. Start the project, and create the administrator with the setup code.
2. Run `memora-admin hash-benchmark`. It should say roughly 100–500 ms per hash.
3. Set up HTTPS (option A), install the CA on each device, and log in on each one, also over the VPN.
4. Add a second, regular account. Log in with its one-time password in a private window, and choose a new password.
5. Turn on two-step verification for the administrator (**Settings → Account**), and store the recovery codes and a copy of `data/secret.key` in your password manager.
6. Check **Settings → Audit log** shows these logins.
7. Check the memory use in **Container Manager → Container**. It is usually 100 to 150 MB.

## Updating

```bash
docker compose pull && docker compose up -d
```

Memora backs up the database before it changes it. [UPGRADE.md](UPGRADE.md) covers the image tags, Synology, and going back to an earlier version.

## Troubleshooting

The most common problems:

- **The container stops at start:** `docker logs memora` says why, for example that the data folder isn't writable ([above](#which-user-memora-runs-as)).
- **Changes from other devices take 30 seconds:** the reverse proxy doesn't pass WebSockets; add the **WebSocket** custom header to the rule ([HTTPS](#a-vpn-plus-a-local-certificate), step 3).
- **Offline mode or installing the app doesn't work:** that needs [HTTPS](#https).
- **A forgotten password or a lost phone:** [`memora-admin`](#locked-out-memora-admin).

Everything else is in [TROUBLESHOOTING.md](TROUBLESHOOTING.md).
