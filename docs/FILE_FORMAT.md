# The `.memora` archive format

A `.memora` file holds notes exported from Memora: one page, a section, a section group, a notebook, or everything a user has. Memora reads it back with **Settings → Import & export → Import**, or when it is dropped onto a page list or a section tab.

This document describes **format version 1**. It is meant to be enough to read an archive without Memora, and to write one that Memora imports.

## Principles

- **Open and readable.** An archive is a zip file of JSON, Markdown and the pages' files. Rich pages also come as HTML, so every page can be read with any browser or text editor.
- **Checked.** `manifest.json` lists the SHA-256 of every other file. Memora refuses an archive whose files are missing, extra or changed, and imports nothing from it.
- **Versioned.** `manifest.json` records `formatVersion`. Memora imports every version up to its own, and refuses newer ones with a message that says to update Memora.
- **Never overwriting.** Everything imported gets new ids, so an import can't replace or clash with notes that are already there.
- **Optionally encrypted**, with the same envelope as encrypted backups (see [Encryption](#encryption)).

## Layout

```
manifest.json
notebooks/<notebook-id>/notebook.json
notebooks/<notebook-id>/groups/<group-id>.json
notebooks/<notebook-id>/sections/<section-id>/section.json
notebooks/<notebook-id>/sections/<section-id>/pages/<page-id>.json        # the page's details
notebooks/<notebook-id>/sections/<section-id>/pages/<page-id>.md          # a Markdown page's text
notebooks/<notebook-id>/sections/<section-id>/pages/<page-id>.rich.json   # a rich page's document
notebooks/<notebook-id>/sections/<section-id>/pages/<page-id>.html        # a rich page, readable
inbox/section.json                                                        # the Inbox, when exported
inbox/pages/<page-id>.json, .md, .rich.json, .html
history/<page-id>.jsonl                                                   # optional: version history
assets/<sha256>.<ext>                                                     # the pages' files
assets/index.json
tags.json
templates/<template-id>.json                                              # "everything" only
```

Paths use `/`, and ids are UUIDs (version 7). Folders exist only through the files in them.

## `manifest.json`

Written last, so it can list every other file.

```json
{
  "format": "memora-archive",
  "formatVersion": 1,
  "appVersion": "1.0.0",
  "exportedAt": "2026-09-30T14:30:00.000Z",
  "scope": { "type": "notebook", "ids": ["0190c0de-…"] },
  "counts": {
    "notebooks": 1,
    "groups": 2,
    "sections": 4,
    "pages": 37,
    "assets": 5,
    "templates": 0,
    "versions": 120
  },
  "sha256": {
    "notebooks/0190c0de-…/notebook.json": "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08"
  }
}
```

| Field           | Meaning                                                                                |
| --------------- | -------------------------------------------------------------------------------------- |
| `format`        | Always `memora-archive`.                                                               |
| `formatVersion` | The version of this specification the archive follows (an integer).                    |
| `appVersion`    | The Memora version that wrote it; for information only.                                |
| `scope`         | What was exported: `page`, `section`, `group`, `notebook` or `everything`, and its id. |
| `counts`        | How many of each thing the archive holds; for information only.                        |
| `sha256`        | The SHA-256 (hexadecimal) of every file in the archive except the manifest, by path.   |

## The notes

Times are milliseconds since 1970 (UTC). Colours are one of `coral`, `orange`, `amber`, `lime`, `green`, `teal`, `cyan`, `blue`, `indigo`, `violet`, `magenta` and `slate`; an unknown colour is replaced on import.

**`notebook.json`**: `id`, `name`, `color`, `icon` (one of Memora's notebook icons), `sortKey`, `createdAt`, `updatedAt`.

**`groups/<id>.json`**: a section group: `id`, `notebookId`, `parentGroupId` (null at the top of the notebook; groups nest at most four deep), `name`, `sortKey`, `createdAt`, `updatedAt`.

**`section.json`**: `id`, `notebookId`, `groupId` (null when the section isn't in a group), `name`, `color`, `sortKey`, `isInbox`, `createdAt`, `updatedAt`. The Inbox's pages are imported into the importing user's Inbox.

**`pages/<id>.json`**: `id`, `sectionId`, `parentPageId` (null for a top-level page; subpages nest at most three deep), `title`, `type` (`markdown` or `rich`), `sortKey`, `viewMode` (`source`, `split`, `preview` or null), `createdAt`, `updatedAt`, `tags` (names) and `links` (the titles of the pages it links to, for information).

**The page's content** is next to it:

- `<id>.md`: a Markdown page's text, as Memora stores it ([the dialect](IMPLEMENTATION_PLAN.md#82-markdown-dialect)). Files are referred to as `asset:<asset-id>`, links to pages as `[[Page title]]`.
- `<id>.rich.json`: a rich page's document: TipTap/ProseMirror JSON, `{ "type": "doc", "content": [...] }`. Images and attached files have `"src": "asset:<asset-id>"`; links to pages have `"href": "wiki:<title>"`.
- `<id>.html`: the rich page as a standalone HTML file with its images linked from `assets/`. Memora writes it for reading and ignores it on import.

`sortKey` orders siblings: items sort by it as plain strings. On import, items keep their order and go after what is already there.

## Files

Each file a page refers to is stored once, as `assets/<sha256>.<ext>`, however many pages or ids refer to it. `assets/index.json` maps the ids the pages use to them:

```json
[
  {
    "id": "0190c0de-…",
    "sha256": "b94d27b9…",
    "mime": "image/png",
    "name": "chart.png",
    "size": 20480,
    "file": "assets/b94d27b9….png"
  }
]
```

On import each file gets a new id, and the pages' `asset:` references are changed to match. Images are recognised by their content, not by their name or `mime`.

## Tags and templates

**`tags.json`**: the tags the exported pages use, with their colours: `[{ "name": "Urgent", "color": "coral" }]` (`color` may be null). Tags are matched by name, whatever the case: an imported tag that exists already is reused.

**`templates/<id>.json`**: page templates (only in an export of everything): `id`, `name`, `type`, `content` (like a page's), `createdAt`, `updatedAt`.

## History

With **Include version history**, `history/<page-id>.jsonl` holds the page's saved versions, one JSON object per line, oldest first: `id`, `revision`, `type`, `title`, `content`, `reason` (`auto`, `conversion`, `import`, `restore`, `conflict` or `manual`), `name` (a named version's name, or null), `deviceLabel`, `createdAt`. Lines that can't be read are skipped.

## Encryption

An encrypted archive keeps the `.memora` extension; Memora recognises it by its first bytes and asks for the password. The file is:

| Bytes | Content                                                                                        |
| ----- | ---------------------------------------------------------------------------------------------- |
| 10    | The magic bytes `MEMORAENC1` (ASCII).                                                          |
| 3     | scrypt's parameters: log₂ N, r and p (one byte each; Memora writes 16, 8 and 1).               |
| 16    | The scrypt salt.                                                                               |
| 12    | The AES-GCM nonce.                                                                             |
| …     | The zip, encrypted with AES-256-GCM under the key scrypt derives (32 bytes) from the password. |
| 16    | The GCM authentication tag.                                                                    |

The first 41 bytes (the header) are the GCM additional authenticated data, so they can't be changed unnoticed. A wrong password and a damaged file both fail the authentication check; nothing is imported then.

## Importing

Memora imports an archive in two steps, so a failure leaves nothing half done:

1. It checks the manifest (`format`, `formatVersion`) and every file's SHA-256, then stores the files.
2. It adds the notebooks, groups, sections, pages, tags, versions and templates in one database transaction.

An archive can go in **as new notebooks**, or **into a chosen notebook**: then its sections join that notebook (at the top level; the archive's groups aren't recreated), and Memora takes a backup of its database first. Pages whose rich document is damaged, or whose section is missing, are skipped and listed in the import's report.

## The Markdown folder

**Export → Markdown** writes a zip meant for other apps rather than for Memora ([§8.5](IMPLEMENTATION_PLAN.md#85-markdown-folder-export)): notebooks, section groups and sections are folders named after them, pages are `.md` files named after their titles, a page's subpages go in a folder named like the page, and files go in `assets/` at the top, linked with relative paths. Rich pages are converted to Markdown, and the export's report lists what Markdown couldn't keep. A single page without files is exported as a plain `.md` file.

Each page starts with a front-matter block:

```yaml
---
title: 'Plans: 2026' # only when the file name had to change the title
id: 0190c0de-…
tags: [work, q1]
created: 2026-09-29T10:36:00.000Z
updated: 2026-09-30T08:12:00.000Z
---
```

Memora imports such a zip too, and zips from other apps: one folder around everything becomes the notebook (otherwise the zip's name does), a folder that holds only folders becomes a section group, other folders become sections, `.md`, `.markdown` and `.txt` files become pages, and images and files they link to with relative paths are stored as the pages' files. The front matter's `title` and `tags` are used; the rest of it is dropped.
