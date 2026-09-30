# Backups and restoring

Memora keeps everything in one SQLite database in its data folder: notes, pages' files, versions, users and settings. Backups are copies of that database, taken while Memora runs, so each one is complete and consistent.

One file is deliberately left out: `secret.key`, the key that encrypts two-step verification secrets. Keep a copy of it apart from the backups, such as in your password manager ([restoring on a new machine](#on-a-new-machine) says why).

This guide covers what Memora backs up on its own, how to keep a copy somewhere else (on a Synology NAS, with Hyper Backup), and how to restore, on the same machine or a new one.

## What Memora does on its own

- **Scheduled backups.** Every night at 03:00 (the container's `TZ`), Memora writes `memora-scheduled-<time>.db` into its backup folder (`/data/backups` in the container, so `backups/` in your data folder).
- **Before every update** that changes the database: `memora-pre-migration-v<version>-<time>.db`.
- **Before every restore**: `memora-pre-restore-<time>.db`, so a restore can be undone.
- **By hand**: **Settings › Backups › Back up now**, or `docker exec memora memora-admin backup`.

Old backups are thinned out: everything from the last day is kept, then the newest backup of each of the last 7 days, 4 weeks and 12 months. The rest is deleted.

Within Memora there is more to fall back on: every page has a **version history** (page menu › History) and deleted things wait in the **recycle bin** for 30 days.

### Settings

| Variable                      | Default         | Purpose                                                                                                                                             |
| ----------------------------- | --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `MEMORA_BACKUP_SCHEDULE`      | `0 3 * * *`     | When backups are taken, in cron syntax (minute hour day month weekday). `off` turns them off.                                                       |
| `MEMORA_BACKUP_KEEP`          | `7,4,12`        | How many daily, weekly and monthly backups are kept (besides everything from the last day)                                                          |
| `MEMORA_BACKUP_PASSWORD_FILE` | —               | A file holding a password: new backups are encrypted with it (see below)                                                                            |
| `MEMORA_BACKUP_DIR`           | `/data/backups` | Where backups are written                                                                                                                           |
| `MEMORA_TRASH_DAYS`           | `30`            | Days a deleted item stays in the recycle bin                                                                                                        |
| `MEMORA_HISTORY_RETENTION`    | `48h,14d,90d`   | Page versions: all of them for 48 hours, then one per hour for 14 days, one per day for 90 days, then one per week. Named versions are always kept. |

Examples: `0 */6 * * *` backs up every six hours; `30 2 * * 1-5` at 02:30 on weekdays.

### Encrypted backups

Backups hold everything in Memora, so anyone with a backup file can read your notes. If backups leave the NAS (to the cloud, say), encrypt them:

1. Create a file with a long password in it, next to the compose file, for example `secrets/backup_password`. Keep the password somewhere safe too, such as your password manager: **without it, encrypted backups can't be restored.**
2. Mount it into the container and point Memora at it:

   ```yaml
   services:
     memora:
       environment:
         MEMORA_BACKUP_PASSWORD_FILE: /run/secrets/backup_password
       volumes:
         - ./data:/data
         - ./secrets/backup_password:/run/secrets/backup_password:ro
   ```

New backups end in `.db.enc` and are encrypted with AES-256-GCM (the key comes from the password through scrypt). Backups made before stay as they were. To restore an encrypted backup, the same password file must be set.

## Keeping a copy elsewhere with Hyper Backup

Backups on the same disks as Memora don't help when those disks fail. On a Synology NAS, Hyper Backup copies the backup folder to another place (a USB drive, another NAS, or cloud storage) on a schedule.

1. Install **Hyper Backup** from the Package Center and open it.
2. Click **+ › Data backup task** and pick a destination: a USB drive, another Synology NAS, or a cloud service (Synology C2, S3, Backblaze B2…). Follow the steps to connect to it.
3. Under **Data backup**, select the Memora backup folder: `docker/memora/data/backups` (or wherever your data folder is). Select **only `backups/`**, not `memora.db` itself: copying the live database while Memora writes to it can give a broken copy.
4. Under **Backup settings**, turn on **Enable backup schedule** and pick a time **after** Memora's own backup, for example 04:00 when Memora backs up at 03:00. Turn on **Enable client-side encryption** if the destination isn't yours (or use Memora's own encryption, above).
5. Under **Rotation settings**, turn on **Enable backup rotation**. Memora thins out its own folder, so a modest rotation (for example 30 versions) is plenty.
6. Click **Done**, then **Back up now** once to check it works.

Hyper Backup keeps several versions of the folder, so a backup that Memora later deletes can still be found there.

To get a file back from Hyper Backup, open **Hyper Backup Explorer** (or the task's **Restore › Data**), browse to a version of `backups/`, and copy the backup you want into Memora's `backups/` folder. Then restore it as below.

## Restoring

Restoring puts **everything** back as it was when the backup was made: notes, files, versions, users, sessions and settings. Memora first backs up everything as it is now (`memora-pre-restore-…`), so you can go back.

Browsers that had Memora open drop what they kept and load the notes afresh. Changes they hadn't sent yet are not lost: they show as a conflict with the restored page, to keep or not. Whoever signed in after the backup was made has to sign in again.

### From Settings (administrators)

**Settings › Backups**, then **Restore…** next to the backup. Memora checks the backup, backs up the current state, and restarts; the page reloads when Memora is back.

The restart relies on the container's restart policy, which the compose file and the `docker run` command in [SETUP.md](SETUP.md) set (`restart: unless-stopped`). Without one, start the container again yourself: the backup is put in place as Memora starts.

### From the command line

```sh
docker exec memora memora-admin list-backups
docker exec memora memora-admin restore memora-scheduled-2026-09-30T03-00-00-000Z.db
docker restart memora
```

### On a new machine

1. Install and start Memora on the new machine as in [SETUP.md](SETUP.md), with the same `MEMORA_BACKUP_PASSWORD_FILE` if the backup is encrypted. Don't set it up in the browser.
2. Copy the backup into the new data folder's `backups/`.
3. Restore it and restart:

   ```sh
   docker exec memora memora-admin restore memora-scheduled-2026-09-30T03-00-00-000Z.db
   docker restart memora
   ```

Memora updates the database if the backup came from an older version (taking a backup first), and everything is there: sign in with your usual account.

**Two-step verification** needs the instance key, `secret.key`, which is not in the backup. Copy yours into the new data folder (readable by the `PUID` user) before step 3 to keep everyone's authenticator app working; the restart in step 3 reads it. Without it, Memora makes a new key; people log in with a recovery code and set up their app again in **Settings → Account** (or an administrator turns it off for them).

### Restoring one page

To get back one page rather than everything, use its version history (page menu › History) or the recycle bin. For something older than the history keeps, restore the backup on a second, temporary Memora (as on a new machine, on another port), copy the text out, and remove it again.

## How it is checked

The test suite restores backups and compares the result with what was backed up, and every change to Memora runs a **restore drill** on the real container image (`docker/restore-drill.sh`): write a page, back up (encrypted), change the page, restore from the API, let Docker restart Memora, and check the page is exactly as it was; then the same with `memora-admin`.
