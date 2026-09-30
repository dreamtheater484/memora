# Troubleshooting

Find the symptom below. Most answers start with Memora's log:

```bash
docker logs memora --tail 100
```

On Synology: **Container Manager → Container → memora → Log**.

## Starting Memora

| Symptom                                                 | What to do                                                                                                                                                                                           |
| ------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The container exits with _"is not writable by user …"_  | The `PUID`/`PGID` user can't write the data folder. Give that user read/write access to it, or set `PUID`/`PGID` to its owner ([SETUP.md](SETUP.md#choosing-puid-and-pgid)).                         |
| The container exits with _"refusing to run as root"_    | Set `PUID` to a regular user's id, not `0`.                                                                                                                                                          |
| The container exits with _"newer version of Memora"_    | An older image was started on a database a newer Memora already updated. Use the newer image again, or restore a backup made by the older version ([UPGRADE.md](UPGRADE.md#going-back)).             |
| The container exits with _"is not a Memora secret key"_ | `secret.key` in the data folder was damaged. Put back your copy of it. Or remove the file: Memora makes a new one, and everyone sets up two-step verification again (recovery codes still work).     |
| The page doesn't load at all                            | Check that the container runs (`docker ps`), that the port in the compose file is the one you open, and that the host's firewall lets it through. On Synology, try from the NAS's own network first. |
| Lost the setup code                                     | Check the log again, or restart the container: it prints a new one until the first account exists.                                                                                                   |

## Logging in

| Symptom                                               | What to do                                                                                                                                                                                                                                     |
| ----------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Forgot a password                                     | An administrator resets it in **Settings → Users**. For the last administrator: `docker exec memora memora-admin reset-password <username>`.                                                                                                   |
| Lost the phone with the authenticator app             | Log in with a recovery code, then set up the app again in **Settings → Account**. Without recovery codes, an administrator turns two-step verification off in **Settings → Users**, or `docker exec memora memora-admin reset-2fa <username>`. |
| Codes from the authenticator app are refused          | The codes depend on the time. Check that the phone's clock is set automatically, and that the server's is right too (Synology: **Control Panel → Regional Options → Time → Synchronize with NTP server**).                                     |
| _"Too many attempts"_                                 | Wait the time shown. Each further failure doubles the wait, up to 15 minutes.                                                                                                                                                                  |
| _"Requests from other sites are not allowed"_         | `MEMORA_BASE_URL` doesn't match the address in the browser. Set it to exactly that address, with `https://` and the port.                                                                                                                      |
| _"This connection isn't encrypted"_ on the login page | You're on plain HTTP. It works on your own network, but set up [HTTPS](SETUP.md#https) before real use.                                                                                                                                        |
| Logged out again and again                            | Tick **Remember this device** when you log in (otherwise a session ends after 12 hours unused). If it keeps happening, check that the reverse proxy passes cookies and that `MEMORA_BASE_URL` is right.                                        |

## Saving, syncing and offline

| Symptom                                                                | What to do                                                                                                                                                                                                                                                                   |
| ---------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The status says _"The live connection is blocked (a proxy, perhaps)…"_ | The reverse proxy doesn't pass WebSockets, so changes from other devices arrive every 30 seconds instead of at once. On Synology: edit the reverse proxy rule → **Custom Header → Create → WebSocket**. Other proxies need the `Upgrade` and `Connection` headers passed on. |
| Offline mode doesn't work, or the app can't be installed               | Browsers allow both only over **HTTPS** (or at `localhost`). Set up [HTTPS](SETUP.md#https).                                                                                                                                                                                 |
| _"This browser doesn't let Memora store changes"_                      | Private browsing, or a setting that blocks site data. Memora still works, but sends every change straight to the server and can't work offline. Allow site data for Memora, or use a normal window.                                                                          |
| _"Changes are saved on this device and …"_ stays for a long time       | The server can't be reached. The changes are safe on the device and are sent when it's back. If the server is running, check the address and the proxy.                                                                                                                      |
| A page shows a conflict                                                | It changed on two devices at the same time. **Compare** shows both, change by change, and nothing is lost either way: both versions stay in the page's history.                                                                                                              |

## Pages and files

| Symptom                                                          | What to do                                                                                                                                                                     |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Images pasted from a web page keep their web address             | The server couldn't download them. It needs to reach the internet, and never downloads from addresses on your own network. The image still shows, from the website.            |
| _"Files can be up to … MB"_ or _"This file is larger than … MB"_ | Raise `MEMORA_MAX_UPLOAD_MB` (pasted and dropped files) or `MEMORA_MAX_IMPORT_MB` (imports), then recreate the container (`docker compose up -d`).                             |
| A PDF export only opens the print preview                        | That is how PDFs are made without extra software: choose **Save as PDF** in the print dialog. For one-click PDFs, see [Gotenberg](SETUP.md#optional-one-click-pdfs-gotenberg). |

## Time, memory and backups

| Symptom                                              | What to do                                                                                                                                |
| ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Backups run at the wrong hour, or times look shifted | Set `TZ` to your time zone (for example `Europe/Paris`) and recreate the container.                                                       |
| Memora uses more memory than expected                | About 50 MB is normal. The Node.js heap is capped by `MEMORA_MAX_HEAP_MB` (256 by default); a big import or export uses more for a while. |
| Backups, restoring, moving to a new machine          | See [BACKUP_RESTORE.md](BACKUP_RESTORE.md).                                                                                               |

## Still stuck?

Set `MEMORA_LOG_LEVEL: 'debug'`, recreate the container, reproduce the problem, and read the log. Logs never contain note content, passwords or session tokens.

To report a bug, open an issue on [GitHub](https://github.com/dreamtheater484/memora/issues) with the Memora version (at the bottom of **Settings**), what you did, and what you saw. Leave out anything personal. Report security problems privately, as [SECURITY.md](SECURITY.md) explains.
