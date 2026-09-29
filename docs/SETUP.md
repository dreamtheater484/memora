# Installing Memora

> **Draft (Phase 0).** Memora does not store notes yet, and has no login yet (that arrives in Phase 2). Only run it on a trusted network for now.
>
> This guide grows with each phase. The step-by-step Synology section and HTTPS setup are completed in Phase 2, and published container images arrive later. Until then you build the image yourself from this repository.

## What you need

- A Docker host:
  - Synology DSM 7.2+ with **Container Manager**;
  - Docker Engine on Linux (for example Ubuntu 26.04);
  - or Docker Desktop on Windows 11.
- An x86-64 (amd64) or ARM64 CPU.
- About 100 MB of free RAM for Memora itself. The Node.js heap is capped at 256 MB by default.
- About 250 MB of disk space for the image, plus your notes.

## Quick start (any Docker host)

1. Get the code (download the repository as a ZIP, or `git clone` it) and open a terminal in its folder.
2. Build the image:

   ```bash
   docker build -f docker/Dockerfile -t memora:local .
   ```

3. Start it with Docker Compose, using the example file in `docker/`:

   ```bash
   cp docker/docker-compose.example.yml docker/docker-compose.yml
   ```

   ```bash
   docker compose -f docker/docker-compose.yml up -d
   ```

   Or with plain `docker run`:

   ```bash
   docker run -d --name memora --restart unless-stopped -p 3000:3000 -e PUID=1000 -e PGID=1000 -v ./data:/data memora:local
   ```

4. Open `http://<host-ip>:3000`. You should see the Memora start page reporting _Server online_.

> On Ubuntu, `docker compose` needs the Compose plugin: `sudo apt install docker-compose-v2`.

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

| Variable             | Default         | Purpose                                                                     |
| -------------------- | --------------- | --------------------------------------------------------------------------- |
| `PUID` / `PGID`      | `1000` / `1000` | User and group Memora runs as (see above)                                   |
| `TZ`                 | `Etc/UTC`       | Timezone, for example `Europe/Paris`                                        |
| `PORT`               | `3000`          | Port inside the container                                                   |
| `MEMORA_BASE_URL`    | —               | The address you use to open Memora, for example `https://notes.example.com` |
| `MEMORA_MAX_HEAP_MB` | `256`           | Maximum Node.js heap in MB. Keeps RAM use predictable.                      |
| `MEMORA_BACKUP_DIR`  | `/data/backups` | Where backups are written                                                   |
| `MEMORA_LOG_LEVEL`   | `info`          | `fatal`, `error`, `warn`, `info`, `debug`, `trace` or `silent`              |

## Synology (outline, completed in Phase 2)

1. Install **Container Manager** from Package Center.
2. In File Station, create `docker/memora` with a `data` subfolder, for example `/volume1/docker/memora/data`.
3. Copy the repository into `docker/memora/source`. Container Manager can build the image from it, although building on a NAS is slow. Phase 2 adds prebuilt images.
4. In **Container Manager → Project → Create**, choose `docker/memora`, paste a compose file based on `docker/docker-compose.example.yml`, set `PUID`/`PGID`, and start it.
5. Open `http://<nas-ip>:3000`.

## HTTPS and remote access (Phase 2)

Browsers only allow offline mode, secure cookies and clipboard image access over **HTTPS**, even inside your own network or VPN. Phase 2 adds step-by-step instructions for:

- **VPN plus a local certificate** (no public domain): reach Memora through your VPN (for example WireGuard) and serve it over HTTPS with a certificate from your own small certificate authority, trusted on your devices.
- **A domain name:** Synology reverse proxy with a Let's Encrypt certificate.
- **Tailscale**, with its built-in HTTPS certificates.

## Updating

Pull or rebuild the image and recreate the container. Memora updates the database automatically on start, and takes a backup first. A database created by a newer Memora version is never opened by an older one.

## Troubleshooting

| Symptom                                            | Fix                                                                                       |
| -------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Container exits with _"is not writable by user …"_ | Give the `PUID`/`PGID` user read/write access to the data folder, or change `PUID`/`PGID` |
| Container exits with _"refusing to run as root"_   | Set `PUID` to a regular user's id (not `0`)                                               |
| Container exits with _"newer version of Memora"_   | You started an older image on a newer database. Use the newer image, or restore a backup. |
| Check the logs                                     | `docker logs memora`, or Container Manager → Container → memora → Log                     |
