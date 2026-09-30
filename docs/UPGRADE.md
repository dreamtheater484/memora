# Updating Memora Server

> **Memora for your computer** updates itself: see [DESKTOP.md](DESKTOP.md#updates). This page is about Memora Server.

Updating takes a minute: download the new image, and recreate the container with it. Memora backs up your database before it changes anything, and your notes live in the data folder, not in the container.

Before a big update, read what changed: the [releases](https://github.com/dreamtheater484/memora/releases) page, or [CHANGELOG.md](../CHANGELOG.md).

## Which image to follow

| Image tag | Gets you                                                                                                              |
| --------- | --------------------------------------------------------------------------------------------------------------------- |
| `:latest` | The newest release. The example compose file uses it.                                                                 |
| `:0.9`    | Fixes to 0.9 only (0.9.1, 0.9.2…), never a new minor version with bigger changes. Change the tag yourself to move on. |
| `:0.9.0`  | Exactly that version, until you change the tag.                                                                       |
| `:edge`   | Every change on the `main` branch once it passes the tests: the newest, and the least tried. For testing.             |

All of them are built for amd64 and arm64 from [github.com/dreamtheater484/memora](https://github.com/dreamtheater484/memora).

## Updating

**With Docker Compose**, in the folder with `docker-compose.yml`:

```bash
docker compose pull && docker compose up -d
```

**With `docker run`:** download the image, remove the container and start it again with the same options (your data folder stays as it is):

```bash
docker pull ghcr.io/dreamtheater484/memora:latest
```

```bash
docker rm -f memora
```

```bash
docker run -d --name memora --restart unless-stopped -p 3000:3000 -v ./data:/data ghcr.io/dreamtheater484/memora:latest
```

**On Synology:** **Container Manager → Image** marks the memora image when a newer one is published. Choose **Update**: Container Manager downloads it and recreates the container. (Menu names can differ slightly between DSM versions.)

## What happens

1. When the new version needs a newer database layout, it first backs up the database as it is, into `backups/`: `memora-pre-migration-v<new version>-<time>.db`.
2. It updates the database and starts. `docker logs memora` shows _"database schema updated"_ with the backup's name.
3. Open browser tabs and the installed app offer the new version: choose **Update**, or reload the page. Changes you were typing are kept.

A database updated by a newer Memora is never opened by an older one: an older image stops with a message instead of damaging it.

## Going back

To go back to the version you had, put back the backup taken just before the update, then start the older image. Anything written after the update is lost.

**To 0.9.0 or later**, with `memora-admin`. Every release since 0.9.0 puts a prepared backup in place as it starts.

1. With the new version still running, find the backup it took:

   ```bash
   docker exec memora memora-admin list-backups
   ```

2. Prepare that backup to be restored. This backs up the current state first (`memora-pre-restore-…`), so you can change your mind:

   ```bash
   docker exec memora memora-admin restore memora-pre-migration-v0.9.1-2026-10-15T08-00-00-000Z.db
   ```

3. Change the image tag back to the older version (in the compose file, or the `docker run` line), and recreate the container: `docker compose up -d`, or `docker rm -f memora` and the older `docker run` line. The older version puts the backup in place as it starts; its log says _"backup restored"_.

**To any version**, by hand:

1. Stop Memora: `docker compose down`, or `docker rm -f memora`.
2. In the data folder, move `memora.db` (and `memora.db-wal` and `memora.db-shm`, if they are there) into a new folder, for example `before-going-back`. Remove the `restore` folder if there is one.
3. Copy the backup from `backups/`, for example `memora-pre-migration-v0.9.1-2026-10-15T08-00-00-000Z.db`, to the data folder as `memora.db`.
4. Start the older image.

`secret.key` stays as it is, so two-step verification keeps working.
