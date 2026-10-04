# ADR 0006: The desktop app syncs through an end-to-end encrypted folder in the cloud

- **Status:** Accepted
- **Date:** 2026-10-04

## Context

Memora for your computer keeps the notes on one computer. To have them on several computers, people had to run Memora Server, which needs Docker and HTTPS: not something everyone can set up. Many people already have cloud storage: Google Drive, Infomaniak kDrive, Nextcloud.

Two requirements came with the request:

- **Memora may reach one folder and nothing else** in that storage.
- It must **read and write** there.

Facts that shaped the decision:

- **The database can't live in the cloud folder.** `memora.db` is a live SQLite database in WAL mode ([ADR 0001](0001-single-sqlite-database.md)). Sync clients copy files while they are written, and two computers with the same file open each write their own copy; the client then keeps one and renames the other.
- **Google can enforce "one folder".** With the `drive.file` scope, an app sees only the files it created (or that the user picked for it). It is a non-sensitive scope: basic app verification only.
- **WebDAV can't.** kDrive's WebDAV login (the Infomaniak e-mail and an application password) opens the whole kDrive; an address ending in `/Memora` is the client's choice, not a limit the server applies. kDrive's single-folder shares (external users) are web-only. Nextcloud's app passwords are not limited to a folder either.
- **Neither Drive nor WebDAV offers dependable locking**, and Drive allows two files with the same name.
- The plan parked end-to-end encryption because it conflicts with server-side search (§17). That doesn't apply when each computer decrypts into its own database.

## Decision

1. **Each computer keeps its own `memora.db`.** The folder holds encrypted files only:
   - a vault file, `memora-vault.json`: format, scrypt parameters and salt, and a check value;
   - change batches, `changes/<device>.<seq>.mchg`: written once and never changed, by their device only;
   - files (images and attachments), `files/<name>.mblob`, named by an HMAC of their SHA-256;
   - snapshots, `snapshots/<time>.<device>.msnap`: the whole state, for computers that join or were away long;
   - one small record per computer, `devices/<device>.mdev`.
2. **Changes are captured by triggers** that the sync service installs when sync is on, from the current schema at every start. They note which rows changed and, for an update, the row as it was before (its base), in `sync_dirty`. Changes made by sync itself are not captured.
3. **Merging** follows [ADR 0004](0004-revision-based-conflicts.md) where it can, and is otherwise last-writer-wins by a hybrid logical clock:
   - Columns that must change together form groups (a page's type, content and text; a page's section, parent and place; a card's board, column, lane and place; a deletion's time and root). Each group of each row has its own clock.
   - A row changed on this computer and not sent yet keeps its own changes; the rest of the incoming row is taken.
   - **Markdown pages** that changed on both sides are merged three ways, as in the browser. A rich page, or a merge that fails, keeps this computer's text, and the other side's text becomes a `conflict` version in the page's history, synced too. **Nothing is lost.**
   - A deletion wins over a change made at the same time, unless the row was added again after it.
   - Unique names are settled the same way on every computer: tags with the same name become one (the older id stays), a project key taken twice gets a free one, and card numbers that clash are renumbered. Each computer's inbox takes the vault's inbox id when it joins.
   - After each batch, a repair pass undoes what concurrent moves can produce: loops of subpages or groups, a subpage in another section than its parent, a live page in a deleted section.
   - Rows whose parent hasn't arrived yet wait (`sync_parked`) and are tried again; after 30 days they are dropped.
4. **End-to-end encryption, always on.**
   - The passphrase (at least 12 characters) gives a key through scrypt (N = 2¹⁶, r = 8, p = 1). HKDF derives a key for the contents and one for file names.
   - Every file is compressed, then encrypted with AES-256-GCM. Its header and its path in the folder are authenticated, so a file that was changed, swapped or planted fails before anything reads it.
   - Remote content is still treated as untrusted: tables and columns must exist here, values are bound parameters, and sizes are limited.
5. **The folder is reached in one of four ways**, all behind the same small interface (read, write, list, remove):
   - **Google Drive** with `drive.file` only, signed in in the computer's own browser (OAuth for installed apps, PKCE, a loopback redirect to Memora). Memora creates its folder and works inside it; Google refuses everything else.
   - **kDrive** and **other WebDAV** with an application password: one base address fixed at setup, HTTPS only, no redirects followed, every path built from validated names, answers about anything outside the folder ignored.
   - **A folder on this computer**, for a folder the Google Drive, kDrive or Nextcloud app syncs, or a network drive. Memora then holds no cloud credentials at all.
6. **Secrets stay out of the database.** The cloud credentials and the derived key are sealed by the operating system (Electron `safeStorage`: DPAPI, the Keychain, the Secret Service) in the desktop app's main process; the server asks for them over the utility process's message port. Where `safeStorage` would fall back to plain text (Linux without a keyring), Memora refuses to keep them.
7. **Desktop app only.** The code lives in the server (the desktop app runs it) and is switched on in desktop mode. Memora Server doesn't offer it: browsers and phones already sync with the server.

## Consequences

- Several computers share notes without Docker, HTTPS or a server. **Phones are not covered**: they need Memora Server.
- With Google Drive, the one-folder rule is enforced by Google. With WebDAV it is enforced by Memora's code only: the settings say so, and recommend an application password made just for Memora.
- Whoever has the folder (the cloud provider included) sees how many files there are, their sizes and when they change, but not their contents or names.
- Forgetting the passphrase loses the synced copy, not the notes: each computer still has its own.
- Every write to a synced table also writes a row to `sync_dirty`, and each synced row has a few bytes of clock. Search, backups and exports are unchanged.
- Restoring a backup on a synced computer pauses sync: the restored database's sync state is stale. Turning it on again joins as a new device; where the restored notes and the synced ones differ, the synced ones win and the restored page text is kept in history.
- New tables must be listed as synced or local (`sync/tables.ts`); a test fails until they are.
- Google's consent screen has to be in production (in testing, sign-ins expire after 7 days), with a privacy policy. The desktop OAuth client's id and secret are added to builds by CI and are not in the repository.
