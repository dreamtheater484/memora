# The sync folder's format

Memora for your computer can keep several computers' notes the same through one folder in cloud storage ([DESKTOP.md](DESKTOP.md#sync-your-computers), [ADR 0006](adr/0006-sync-through-a-cloud-folder.md)). This document describes what Memora keeps in that folder, **format version 1**: enough to check its encryption, or to read a vault without Memora when you have its passphrase.

## Principles

- **Encrypted end to end.** Every file except the vault file is encrypted on the computer that wrote it, with a key that comes from the passphrase. File names give nothing away either.
- **Written once.** Batches of changes and snapshots are never changed after they are written, and each is written by one computer only. A batch is only ever written as a new file: when its number is taken, the next one is used. No two computers write the same file, so a cloud service's lack of locking (or Google Drive's files with the same name) can't mix two writers up.
- **Checked.** Each file's header and its path in the folder are authenticated with its content. A file that was changed, renamed, swapped or put there by someone else fails to decrypt, and Memora doesn't use it: a batch that can't be used holds back that computer's later batches (not the other computers'), until a snapshot has what it had.
- **Limited.** Memora reads the vault file and records up to 64 KB, batches and snapshot parts up to 64 MB, and stored files up to the upload limit; nothing decompresses to more than 256 MB.
- **Versioned.** Every file carries a version. A computer that meets a newer version pauses sync and asks for an update.

## Layout

```
memora-vault.json                                  the vault: key settings, a check value
changes/<device>.<seq>.mchg                        a batch of one computer's changes
snapshots/<time>.<device>.<part>.msnap             everything one computer had, in parts
files/<name>.mblob                                 an image or attachment
devices/<device>.mdev                              a computer that syncs here
```

- `<device>` is a computer's id (a UUIDv7).
- `<seq>` numbers a computer's batches from 1, with 10 digits.
- `<time>` is when the snapshot was taken (epoch milliseconds, 16 digits), and `<part>` its part, from 0, with 5 digits.
- A stored file's `<name>` is the HMAC-SHA-256 of its SHA-256 (as hexadecimal text) under the names key.

Memora reads only names of these shapes, and passes over anything else in the folder, such as a sync app's conflicted copies. It makes a new vault only in a folder whose `changes`, `files`, `snapshots` and `devices` folders are empty or not there.

## The vault file

`memora-vault.json` is plain JSON:

```json
{
  "format": "memora-sync",
  "version": 1,
  "vaultId": "01a10759-860d-7598-a78a-c169a7549a7e",
  "createdAt": 1791124675008,
  "kdf": { "name": "scrypt", "logN": 16, "r": 8, "p": 1, "salt": "<16 bytes, base64>" },
  "check": "<base64>"
}
```

## Keys

1. **Vault key:** scrypt of the passphrase (as Unicode NFC, UTF-8) with the salt and parameters above, 32 bytes. Memora opens a vault whose `logN` is 14 to 17, `r` at most 8 and `p` at most 4.
2. **Content key:** HKDF-SHA-256 of the vault key, with the vault id (as text) as the salt and `memora-sync content v1` as the info, 32 bytes.
3. **Names key:** the same, with `memora-sync names v1`.

`check` is the encryption (below) of the text `memora-vault:<vaultId>` at the path `memora-vault.json`, with kind 0. A passphrase is right when it decrypts.

## Encrypted files

```
MEMORASYNC1 (11 bytes) · kind (1 byte) · nonce (12 bytes) · ciphertext · tag (16 bytes)
```

- AES-256-GCM with the content key and the nonce.
- The additional authenticated data is the 24-byte header followed by the file's path in the folder, as UTF-8 (for example `changes/<device>.0000000001.mchg`).
- Kinds:
  - 0: the check value;
  - 1: a batch of changes;
  - 2: a stored file;
  - 3: a snapshot part;
  - 4: a computer's record.
- Batches, snapshot parts and records are JSON, compressed with gzip before encryption. Stored files are their bytes, not compressed.

## Batches and snapshots

A batch:

```json
{
  "v": 1,
  "device": "<id>",
  "name": "<computer's name>",
  "seq": 1,
  "at": 1791124675008,
  "changes": []
}
```

A snapshot part:

```json
{
  "v": 1,
  "device": "<id>",
  "at": 1791124675008,
  "part": 0,
  "last": false,
  "cursors": { "<device>": 42 },
  "changes": []
}
```

`cursors` says which batches of each computer the snapshot includes. Parts are written one after the other; a snapshot is complete when its parts from 0 are all in the folder and the highest one has `last: true`.

A snapshot has every synced row as it was when its computer last sent it (a row changed since is in it as it was then; one not sent yet isn't in it), the deletions that computer knows of, and, in its last parts, the changes from other computers that still wait there for a row they need.

A change is one row of a synced table:

| Field  | Meaning                                                                                                                            |
| ------ | ---------------------------------------------------------------------------------------------------------------------------------- |
| `t`    | The table, as in Memora's database (`pages`, `cards`, …)                                                                           |
| `k`    | The row's key: the values of its key columns, without the owner                                                                    |
| `h`    | Its hybrid logical clock: `<16-digit milliseconds>:<4-digit counter>:<device>`. Clocks compare as text.                            |
| `op`   | `put` or `del`                                                                                                                     |
| `full` | For `put`: the row is new, and `f` has all its columns                                                                             |
| `f`    | For `put`: column values (text, numbers or null). A JSON column merged key by key travels as `column.key`, the value as JSON text. |
| `c`    | In snapshots: the clock of each group of columns that changed after the row was added                                              |
| `b`    | In snapshots: the clock of when the row was added                                                                                  |

Columns that name the owner are left out: each computer uses its own account. `card_comments.user_id` and `card_activity.user_id` travel as `1` (someone) or `null`. Images and attachments are rows of `asset_blobs` whose bytes are the stored file of the same SHA-256.

Which tables and columns sync, and which columns change together, is listed in `apps/server/src/sync/tables.ts`.

## Records

```json
{
  "v": 1,
  "id": "<device>",
  "name": "<computer's name>",
  "version": "0.9.8",
  "lastSeenAt": 1791124675008,
  "seq": 42
}
```

Written by each computer about once an hour, for the list of computers in the settings.

## Removing what nobody needs

Each computer removes only files it wrote, and only names of the shapes above:

- its snapshots, except the two newest;
- its batches more than a month old that its newest snapshot has, but never its newest batch: that one tells the other computers how far it got;
- stored files no row refers to any more, a month after they were written (only names of 64 hexadecimal digits).
