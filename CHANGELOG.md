# Changelog

What changed in each Memora release. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/). [UPGRADE.md](docs/UPGRADE.md) explains how to update.

## [Unreleased]

## [0.9.2] - 2026-09-30

### Added

- A **…** button on notebooks, section groups and sections opens their menu (new section, rename, colour, export, delete), in the navigation and in the phone lists. It is the same menu a right-click or long-press opens.
- **Settings → Open-source licences** lists every package Memora ships, with its licence, and Node.js's own. The list is made at build time from what each build contains and is in the container image too. A build stops on a licence nobody has reviewed yet.
- Credits in the README.

### Changed

- The setup guide has a table of requirements: DSM 7.2 or later, a 64-bit processor, and 512 MB of free memory recommended. It also says how to check a Synology NAS, and the Synology steps include a complete compose file.
- The memory figures in the guides now match what Container Manager shows: usually 100 to 150 MB, and more for a while during large imports and exports.
- Memora is described in its own terms, without comparisons to other note apps.

## [0.9.1] - 2026-09-30

### Changed

- No more `PUID` and `PGID`: Memora runs as the owner of its data folder, so creating the folder is all the setup it needs, on a Synology NAS too. `PUID`/`PGID` still work to choose another user. Existing installs keep working as they are.
- When the data folder isn't writable, the message says who owns it and what to change.
- The Synology guide: create the `data` folder before starting (Container Manager stops with _"Bind mount failed"_ otherwise), how to use another port, and to leave the Web Station portal off.

### Fixed

- Links in the release notes on GitHub lead to the documents again.

## [0.9.0] - 2026-09-30

The first release: a public beta. Everything planned for 1.0 is in; what's left is time in real use (see Phase 13 in [the plan](docs/IMPLEMENTATION_PLAN.md)).

### Notes and organisation

- Notebooks with colours and icons, section groups nested up to four levels, and sections as coloured tabs. Pages have subpages up to three levels deep.
- Drag and drop to reorder and move things; multi-select pages to move, copy or delete them together; every delete can be undone.
- An Inbox for quick notes (`Ctrl/Cmd+Alt+N`, or the pen button on phones).
- Keyboard shortcuts for every action, with a reference sheet (`?`), and a command palette (`Ctrl/Cmd+K`).

### Editors

- **Markdown pages:** a Notepad++-style source view beside a live preview (or either alone).
  - Tables line up by themselves, emoji and Chinese, Japanese and Korean text included, with a grid editor.
  - GitHub-flavoured Markdown, footnotes, alerts, maths (KaTeX), diagrams (Mermaid) and highlighted code.
  - Find and replace, an outline, and word counts.
- **Rich text pages:** a word processor with a Home / Insert / Table toolbar.
  - Tables with merged cells and colours, images with captions, file attachments, callouts, maths and code.
  - An A4 or Letter page view.
- **Pasting:** clean pastes from Word, Google Docs and web pages, and screenshots straight from the clipboard. Images from web pages are downloaded by the server, so pages never depend on other sites.
- Pages convert between Markdown and rich text, with a report of what Markdown can't keep.

### Saving, offline and sync

- Every keystroke is kept: saved on the device at once and on the server within seconds, with an honest "Saved" indicator.
- Works offline, including pages created offline. Other devices update live.
- Edits to the same Markdown page on two devices merge by themselves; real conflicts are yours to settle, side by side.

### History, recycle bin and backups

- A version history per page: compare any two versions, name versions, and restore (or restore as a copy).
- A recycle bin, emptied after 30 days.
- Scheduled backups, optionally encrypted, restored from Settings or the command line.

### Search, tags and links

- Full-text search as you type, with phrases, exclusions and filters, and a tag browser.
- Links between pages (`[[`) that survive renames, with backlinks and hover previews.
- Favourites, recent pages, and templates (five built in, your own, and a default per section).

### Import and export

- Export a page, section, notebook or everything as Markdown, Word, HTML, PDF, or a documented `.memora` archive (optionally encrypted).
- Import `.memora` archives, Markdown folders, Word, HTML and text files, or drop files onto a section.

### Kanban

- Projects with keys (`WEB-42`), boards from templates, and columns with WIP limits, colours and a Done flag.
- Swimlanes, by hand or by priority or label.
- Cards with descriptions, labels, dates, checklists, comments, attachments and an activity log.
- Cards drag with a mouse, a finger or the keyboard; boards update live.
- Any note links to any card, and card keys in notes link by themselves.

### Workspace and app

- On wide and ultra-wide screens, panes with tabs beside the main one (pages, boards, search, backlinks and history), with named layouts.
- Text keeps a readable width you choose.
- Installs as an app on phones and desktops, updates when you say so, and can keep every page on a device.
- Light and dark themes, full keyboard use, and screen-reader labels throughout.

### Security

- Argon2id passwords, server-side sessions that you can revoke per device, CSRF protection, throttled logins and an audit log.
- Two-step verification with an authenticator app, with recovery codes; administrators can require it.
- A strict Content Security Policy and security headers. A [security review](docs/SECURITY_REVIEW.md) covers the threat model and the OWASP ASVS Level 1 checklist.

### Running it

- One Docker image for amd64 and arm64 that runs as a non-root user in about 50 MB of RAM, with a health check.
- Setup guides for Synology, Linux and Windows, with three ways to get HTTPS.
- `memora-admin` inside the container for lost passwords, lost phones, backups and restores.

[Unreleased]: https://github.com/dreamtheater484/memora/compare/v0.9.2...HEAD
[0.9.2]: https://github.com/dreamtheater484/memora/compare/v0.9.1...v0.9.2
[0.9.1]: https://github.com/dreamtheater484/memora/compare/v0.9.0...v0.9.1
[0.9.0]: https://github.com/dreamtheater484/memora/releases/tag/v0.9.0
