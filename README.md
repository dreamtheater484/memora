# Memora

A self-hosted notebook that runs in your browser. It combines OneNote-style organisation (notebooks, section tabs, page lists) with first-class Markdown, a Word-like rich editor and built-in Kanban boards. It is designed to look great on a phone, a laptop and an ultra-wide monitor.

> **Status: Phase 11, wide-screen workspace and installable app.** Accounts, notebook organisation and a save engine that keeps every keystroke (offline too) are in place, with an `:edge` image on GHCR. Markdown pages have a Notepad++-style source view beside a live preview; rich text pages work like a word processor, with clean pasting from Word, Google Docs and the web. Every page has a version history, deleted items go to a recycle bin, and backups run on a schedule, optionally encrypted. Full-text search, tags, links between pages with backlinks, favourites and templates help find things again. Pages, sections and notebooks export to Markdown, Word, HTML, PDF or a documented `.memora` archive, and Memora imports archives, Markdown folders, Word, HTML and text files. Kanban projects hold boards with columns, swimlanes, WIP limits and cards that drag with the mouse, a finger or the keyboard; any note links to any card, and card keys like `WEB-42` in a note link to their card. On wide and ultra-wide monitors, panes with tabs sit beside the main one (pages, boards, search, backlinks, history), with named layouts; text keeps a readable width. Memora installs as an app, updates when you choose, and can keep every page on a device for offline use. See the [implementation plan](docs/IMPLEMENTATION_PLAN.md) for the roadmap.

## Planned highlights

- **Organisation like OneNote, done better:** notebooks → section groups → coloured section tabs → pages and subpages.
- **Markdown notes:**
  - Notepad++-style highlighted source with a live preview side by side.
  - Tables that realign as you type.
  - Easy formatting through the toolbar, shortcuts and slash commands.
- **Rich notes:** a Word-like editor. Paste screenshots and images straight in, and export to Word or PDF.
- **Kanban:** projects with multiple boards and the full standard feature set. Link any note to any card.
- **Never lose a keystroke:**
  - Autosave with offline support and an always-accurate save indicator.
  - Version history with diffs, a recycle bin, and scheduled, optionally encrypted backups with one-click restore.
- **Open formats:** import and export single notes or whole notebooks as Markdown, Word, PDF, HTML or a documented `.memora` archive.
- **Self-hosted:** one Docker container with one SQLite file. Runs on a NAS (Synology included) or any Docker host.

## Quick start

### Run with Docker

```bash
docker run -d --name memora -p 3000:3000 -e PUID=1000 -e PGID=1000 -v ./data:/data ghcr.io/dreamtheater484/memora:edge
```

Then open `http://localhost:3000`. `:edge` is built from the main branch; version tags come with the first release. See [docs/SETUP.md](docs/SETUP.md) for the full guide (Docker Compose, Synology, HTTPS).

To build the image yourself instead:

```bash
git clone https://github.com/dreamtheater484/memora.git && cd memora
```

```bash
docker build -f docker/Dockerfile -t memora:local .
```

Then run it as above, with `memora:local` as the image.

### Develop

Requires Node.js 22.13+ (24 recommended) and pnpm 10. In a clone of the repository:

```bash
pnpm install
```

```bash
pnpm dev
```

The web app runs at `http://localhost:5173` and the API at `http://localhost:3000`. Read [CONTRIBUTING.md](CONTRIBUTING.md) before your first commit: it explains the privacy guards.

## Documentation

- [Implementation plan](docs/IMPLEMENTATION_PLAN.md): scope, decisions, architecture, roadmap
- [Setup guide](docs/SETUP.md): installing Memora with Docker
- [Backups and restoring](docs/BACKUP_RESTORE.md): the schedule, encryption, Hyper Backup, restoring
- [Architecture](docs/ARCHITECTURE.md): how the code is organised
- [Contributing](CONTRIBUTING.md): development workflow and privacy rules
- [Security policy](docs/SECURITY.md)
- [Architecture decision records](docs/adr/)

## License

[MIT](LICENSE). Memora is created and maintained by [dreamtheater484](https://github.com/dreamtheater484); the source is at [github.com/dreamtheater484/memora](https://github.com/dreamtheater484/memora).
