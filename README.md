# Memora

A self-hosted notebook that runs in your browser. It combines OneNote-style organisation (notebooks, section tabs, page lists) with first-class Markdown, a Word-like rich editor and built-in Kanban boards. It is designed to look great on a phone, a laptop and an ultra-wide monitor.

> **Status: Phase 0, foundation.** The project skeleton, tooling, privacy guards and Docker image are in place. There are no note-taking features yet. See the [implementation plan](docs/IMPLEMENTATION_PLAN.md) for the roadmap.

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
  - Version history, a recycle bin and automatic backups.
- **Open formats:** import and export single notes or whole notebooks as Markdown, Word, PDF, HTML or a documented `.memora` archive.
- **Self-hosted:** one Docker container with one SQLite file. Runs on a NAS (Synology included) or any Docker host.

## Quick start

### Run with Docker

```bash
docker build -f docker/Dockerfile -t memora:local .
```

```bash
docker run -d --name memora -p 3000:3000 -e PUID=1000 -e PGID=1000 -v ./data:/data memora:local
```

Then open `http://localhost:3000`. See [docs/SETUP.md](docs/SETUP.md) for the full guide (Docker Compose, Synology, HTTPS).

### Develop

Requires Node.js 22.13+ (24 recommended) and pnpm 10.

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
- [Architecture](docs/ARCHITECTURE.md): how the code is organised
- [Contributing](CONTRIBUTING.md): development workflow and privacy rules
- [Security policy](docs/SECURITY.md)
- [Architecture decision records](docs/adr/)

## License

[MIT](LICENSE)
