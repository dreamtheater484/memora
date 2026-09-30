# ADR 0005: Database encryption at rest is parked; the instance key seals the secrets instead

- **Status:** Accepted
- **Date:** 2026-09-30

## Context

Plan D12 and §9.15 made encrypting the database file an optional Phase 12 item. The candidate was `better-sqlite3-multiple-ciphers` (SQLite3 Multiple Ciphers), with the key read from a Docker secret (`MEMORA_DB_KEY_FILE`) and a tool to encrypt or decrypt an existing database. The plan set a decision point: park it if it harms arm64 builds or reliability.

What was checked in Phase 12:

- **Builds.** Version 13.0.3 follows `better-sqlite3` 13.0.3 (Memora's driver) within two days. Its npm package ships prebuilt binaries for linux-x64, linux-arm64, musl, macOS and Windows. **arm64 is not a blocker.**
- **Who maintains it.** One maintainer, repackaging upstream `better-sqlite3` with a different SQLite build. Every Memora install, encrypted or not, would run its storage on that fork, and SQLite fixes would reach Memora only after both projects release.
- **What it would protect.** Memora must restart unattended (after a NAS reboot or an update), so the key has to be on the same machine, readable by the container. Anyone who can copy the data folder and the Docker secrets can read the database anyway. What remains is protection against a stolen disk or a copy of the data folder alone. A Synology encrypted shared folder, or LUKS on Linux, gives the same protection without code: the whole folder is encrypted, including temporary files such as exports waiting to be downloaded (which an encrypted database file would not cover).
- **Cost.**
  - A second path through backups, restore, migrations, the restore drill and the admin tool.
  - Key loss means every note is lost, without exception.
  - A few percent more CPU on every page read (search is the hottest path).

## Decision

- **Parked** for v1.0. `MEMORA_DB_KEY_FILE` is not added.
- Instead, what must not be readable from a copy of the database is protected on its own:
  - **Two-step verification secrets** are sealed with AES-256-GCM under an **instance key**: 32 random bytes in `data/secret.key` (mode 600), made on first start, never in the database or its backups (`MEMORA_SECRET_KEY_FILE` moves it).
  - Recovery codes, session tokens and passwords were already stored only as hashes.
  - Backups and exports can already be encrypted with a password (AES-256-GCM, scrypt).
- For encryption of everything at rest, the setup guide points to **encrypted volumes**:
  - a Synology encrypted shared folder;
  - LUKS or an encrypted home on Linux;
  - BitLocker on Windows.

## Consequences

- One storage driver, the upstream one: nothing changes for existing installs.
- A copy of the database, or of a backup, doesn't give away two-step verification secrets. Without `secret.key` (for example after a restore on a new machine without it), the authenticator codes stop working, but recovery codes still do. Users can then set up their app again, or an administrator (or `memora-admin reset-2fa`) turns two-step verification off for them. BACKUP_RESTORE.md says to keep a copy of `secret.key`.
- Revisit this when upstream SQLite or `better-sqlite3` offers encryption, when a maintained second driver appears, or together with end-to-end encryption and sharing (§17).
