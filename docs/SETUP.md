# Installing Memora

> **Draft (Phase 3).** Memora has accounts and notebook organisation now; editing pages starts in Phase 5. The guide grows with each phase and is finished in Phase 13.

## What you need

- A Docker host:
  - Synology DSM 7.2+ with **Container Manager**;
  - Docker Engine on Linux (for example Ubuntu 26.04);
  - or Docker Desktop on Windows 11.
- An x86-64 (amd64) or ARM64 CPU.
- About 100 MB of free RAM for Memora itself. The Node.js heap is capped at 256 MB by default.
- About 300 MB of disk space for the image, plus your notes.
- **HTTPS** for real use (see [HTTPS](#https)). Plain HTTP works on your own network for trying Memora out.

## Quick start (any Docker host)

1. Create a folder for Memora, for example `memora`, and save [`docker/docker-compose.example.yml`](../docker/docker-compose.example.yml) in it as `docker-compose.yml`.
2. Edit it:
   - `image:` put the GitHub account that publishes Memora in place of `<your-github-user>`.
   - `PUID`, `PGID` and `TZ` (see [Choosing PUID and PGID](#choosing-puid-and-pgid)).
3. Start it:

   ```bash
   docker compose up -d
   ```

4. Read the **setup code** from the log:

   ```bash
   docker logs memora
   ```

5. Open `http://<host-ip>:3000`, enter the setup code, and create your administrator account.

> On Ubuntu, `docker compose` needs the Compose plugin: `sudo apt install docker-compose-v2`.

Or with plain `docker run` (one line):

```bash
docker run -d --name memora --restart unless-stopped -p 3000:3000 -e PUID=1000 -e PGID=1000 -v ./data:/data ghcr.io/<your-github-user>/memora:edge
```

### Images

The `:edge` image is built from the `main` branch after every change that passes CI, for amd64 and arm64. Versioned images (`:1`, `:latest`) arrive with the first release.

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

### Locked out? `memora-admin`

For when the web interface can't help, such as a forgotten administrator password:

```bash
docker exec memora memora-admin list-users
```

```bash
docker exec memora memora-admin reset-password <username>
```

`reset-password` prints a one-time password and signs that user out everywhere. On Synology, run these over SSH with `sudo`, or use **Container Manager → Container → memora → Action → Open terminal** and type `memora-admin list-users`.

`memora-admin hash-benchmark` shows how long one password check takes on your hardware. Around 100–500 ms is right; logins are slow on purpose, to make guessing expensive.

## Choosing PUID and PGID

Memora never runs as root. It runs as the user and group given by `PUID` and `PGID`. **That user must be able to read and write the data folder** on the host.

- **Linux:** run `id` in a terminal and use the `uid` and `gid` it shows.
- **Synology:** connect over SSH and run `id <your-dsm-user>`, or create a dedicated DSM user for Memora and use its IDs. Give that user read/write access to the Memora folder in **Control Panel → Shared Folder**.
- **Docker Desktop (Windows):** the defaults (`1000`) are fine.

If the folder isn't writable, Memora stops with a clear message instead of changing permissions itself.

## Where your data lives

Everything is stored in the folder mounted at `/data`:

| Path                             | Contents                                                                              |
| -------------------------------- | ------------------------------------------------------------------------------------- |
| `memora.db`                      | The database: all users, notes, images and boards                                     |
| `memora.db-wal`, `memora.db-shm` | SQLite working files while Memora runs (normal)                                       |
| `backups/`                       | Automatic backups, including one taken before every upgrade that changes the database |

**Never copy `memora.db` while Memora is running** as a backup. Use the files in `backups/`, which are consistent snapshots. Backup scheduling and restore arrive in Phase 7.

## Configuration

Set these as environment variables (the `environment:` section of the compose file):

| Variable               | Default                          | Purpose                                                                                                         |
| ---------------------- | -------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `PUID` / `PGID`        | `1000` / `1000`                  | User and group Memora runs as (see above)                                                                       |
| `TZ`                   | `Etc/UTC`                        | Timezone, for example `Europe/Paris`                                                                            |
| `PORT`                 | `3000`                           | Port inside the container                                                                                       |
| `MEMORA_BASE_URL`      | —                                | The address you open Memora at, for example `https://<nas-ip>:8443`. Used for the origin check on every change. |
| `MEMORA_TRUST_PROXY`   | `loopback,linklocal,uniquelocal` | Which reverse proxies may pass on the visitor's address (`X-Forwarded-For`): see below                          |
| `MEMORA_SESSION_DAYS`  | `30`                             | How long "remember this device" keeps you logged in without using Memora                                        |
| `MEMORA_SESSION_HOURS` | `12`                             | How long a session lasts without using Memora, without "remember this device"                                   |
| `MEMORA_MAX_HEAP_MB`   | `256`                            | Maximum Node.js heap in MB. Keeps RAM use predictable.                                                          |
| `MEMORA_BACKUP_DIR`    | `/data/backups`                  | Where backups are written                                                                                       |
| `MEMORA_LOG_LEVEL`     | `info`                           | `fatal`, `error`, `warn`, `info`, `debug`, `trace` or `silent`                                                  |

**`MEMORA_TRUST_PROXY`.** Memora slows down repeated failed logins per visitor address, and records addresses in the audit log. Behind a reverse proxy every request comes from the proxy, so Memora reads the real address from the proxy's `X-Forwarded-For` header, but only from proxies it trusts. The default trusts proxies on the same machine and on private networks, which covers the Synology reverse proxy and Docker's networks. Set `false` when nothing sits in front of Memora, or list addresses or ranges (for example `198.51.100.2,2001:db8::/32`) to be stricter.

## Synology step by step

1. Install **Container Manager** from Package Center.
2. In **File Station**, create the folder `docker/memora`, with a `data` folder inside it.
3. Find the IDs for `PUID`/`PGID`: connect over SSH and run `id <your-dsm-user>`, or create a dedicated user for Memora. That user needs read/write access to `docker/memora` (**Control Panel → Shared Folder → docker → Edit → Permissions**).
4. **Container Manager → Project → Create**:
   - Project name: `memora`.
   - Path: `docker/memora`.
   - Source: **Create docker-compose.yml**, and paste the example compose file with your values.
   - Start it. The first start downloads the image.
5. **Container Manager → Container → memora → Log** shows the setup code.
6. Open `http://<nas-ip>:3000` and create your administrator account.
7. Set up [HTTPS](#https), then change the port line to `'127.0.0.1:3000:3000'`, so only the reverse proxy can reach Memora directly.

### If the image is private

A container image published from a GitHub repository starts out private. Either make it public (GitHub → your profile → **Packages → memora → Package settings → Change visibility**), or log in on the NAS with a token that can only read packages:

```bash
sudo docker login ghcr.io -u <your-github-user>
```

Paste a **fine-grained or classic token with only `read:packages`** as the password. The token stays on the NAS, never in the repository.

## HTTPS

Browsers only allow offline mode, secure cookies and clipboard images over **HTTPS**, even on your own network. Over plain HTTP Memora still works, but logs a warning and uses a weaker cookie.

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
- **Custom Header → Create → WebSocket** (needed for live updates in later phases).

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

## First deployment checklist

For the first time on the NAS:

1. Start the project, and create the administrator with the setup code.
2. Run `memora-admin hash-benchmark`. It should say roughly 100–500 ms per hash.
3. Set up HTTPS (option A), install the CA on each device, and log in on each one, also over the VPN.
4. Add a second, regular account. Log in with its one-time password in a private window, and choose a new password.
5. Check **Settings → Audit log** shows these logins.
6. Check the memory use in **Container Manager → Container**. It should stay around 50 MB.

## Updating

```bash
docker compose pull && docker compose up -d
```

On Synology: **Container Manager → Image** marks the memora image when a newer one is published; choose **Update**, which downloads it and recreates the container. (Labels can differ a little between DSM versions.)

Memora updates the database automatically on start, and takes a backup first. A database created by a newer Memora version is never opened by an older one.

## Troubleshooting

| Symptom                                            | Fix                                                                                                                           |
| -------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Container exits with _"is not writable by user …"_ | Give the `PUID`/`PGID` user read/write access to the data folder, or change `PUID`/`PGID`                                     |
| Container exits with _"refusing to run as root"_   | Set `PUID` to a regular user's id (not `0`)                                                                                   |
| Container exits with _"newer version of Memora"_   | You started an older image on a newer database. Use the newer image, or restore a backup.                                     |
| Lost the setup code                                | Check the log again, or restart the container to print a new one                                                              |
| Forgot a password                                  | An administrator resets it in **Settings → Users**. For the last administrator: `memora-admin reset-password <username>`      |
| _"Too many attempts"_                              | Wait the time shown. Repeated failures double the wait, up to 15 minutes                                                      |
| _"Requests from other sites are not allowed"_      | `MEMORA_BASE_URL` doesn't match the address in the browser. Set it to exactly that address, including `https://` and the port |
| Log warns about _"signing in over plain HTTP"_     | You're using plain HTTP. Set up HTTPS and `MEMORA_BASE_URL`                                                                   |
| `denied` when pulling the image                    | The image is private: see [If the image is private](#if-the-image-is-private)                                                 |
| Check the logs                                     | `docker logs memora`, or Container Manager → Container → memora → Log                                                         |
