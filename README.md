# Memora

A notebook for your own computer or your own server: notebooks with coloured section tabs and page lists, first-class Markdown, a Word-like rich editor and built-in Kanban boards, in one app. It is designed to look great on a phone, a laptop and an ultra-wide monitor.

> **Version 0.9: a public beta.** Everything planned for 1.0 is in and tested; 1.0 follows after time in real use. What's in it: [CHANGELOG.md](CHANGELOG.md).

## Get Memora

|            | **Memora for your computer**                                                              | **Memora Server**                                            |
| ---------- | ----------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| For        | Everyone                                                                                  | Enthusiasts with Docker or a NAS                             |
| Runs on    | Windows, macOS, Ubuntu                                                                    | Docker on Linux, Windows or macOS, or a Synology NAS         |
| Your notes | On that computer                                                                          | On your server, in sync on every device, your phone included |
| Installing | Download, open, done                                                                      | A compose file, and HTTPS for use away from home             |
| Get it     | **[Download page](https://dreamtheater484.github.io/memora/)** · [Guide](docs/DESKTOP.md) | [Server guide](docs/SETUP.md)                                |

Both are the same Memora, from the same code and the same release. You can start on your computer and move to a server later: export once, import once.

![Memora: a Markdown page beside its live preview, with notebooks, section tabs and the page list](docs/images/notes.png)

## What it does

- **Organised your way:** notebooks → section groups → coloured section tabs → pages and subpages, with drag and drop, an Inbox for quick notes, and a shortcut for everything.
- **Markdown notes:** a Notepad++-style source beside a live preview, tables that line up as you type, maths, diagrams and highlighted code.
- **Rich notes:** a Word-like editor with tables, callouts and images. Paste screenshots straight in, and clean pastes from Word, Google Docs and the web.
- **Never lose a keystroke:** autosave that works offline, an honest save indicator, merged edits from two devices, version history, a recycle bin, and scheduled backups (optionally encrypted).
- **Find it again:** full-text search, tags, links between pages with backlinks, favourites and templates.
- **Kanban:** projects with boards, swimlanes, WIP limits and cards that drag with a mouse, a finger or the keyboard. Any note links to any card.
- **Every screen:** panes with tabs on wide and ultra-wide monitors, a phone layout, and an installable app.
- **Open formats:** Markdown, Word, HTML, PDF, and a documented `.memora` archive, in and out.
- **Yours:** an app on your computer, or one small Docker container on a NAS or any Docker host, with one SQLite file. No telemetry, nothing loaded from other sites, two-step verification on the server, and a [security review](docs/SECURITY_REVIEW.md).

| Kanban boards                                                    | Dark theme                                                 | Phones                                             |
| ---------------------------------------------------------------- | ---------------------------------------------------------- | -------------------------------------------------- |
| ![A Kanban board with priority swimlanes](docs/images/board.png) | ![The board in the dark theme](docs/images/board-dark.png) | ![A recipe page on a phone](docs/images/phone.png) |

## Quick start

### On your computer

Download Memora for Windows, macOS or Ubuntu from the [download page](https://dreamtheater484.github.io/memora/), and open it. [docs/DESKTOP.md](docs/DESKTOP.md) has the details.

### Run the server with Docker

```bash
mkdir -p data && docker run -d --name memora --restart unless-stopped -p 3000:3000 -v ./data:/data ghcr.io/dreamtheater484/memora:latest
```

Then run `docker logs memora` for the setup code, and open `http://localhost:3000`. [docs/SETUP.md](docs/SETUP.md) is the full guide: Docker Compose, Synology, Linux, Windows, and HTTPS.

To try it with sample notes and a board, fill a new Memora with the demo dataset. With the setup code from its log, this creates the account `demo` and prints its password:

```bash
node scripts/demo/seed.mjs --url http://localhost:3000 --setup-code <setup-code>
```

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

The web app runs at `http://localhost:5173` and the API at `http://localhost:3000`. Read [CONTRIBUTING.md](CONTRIBUTING.md) before your first commit: it explains the privacy guards, and how to build the desktop app.

## Documentation

- [Implementation plan](docs/IMPLEMENTATION_PLAN.md): scope, decisions, architecture, roadmap
- [User guide](docs/USER_GUIDE.md): using Memora
- [Memora for your computer](docs/DESKTOP.md): the desktop app, and [signing it](docs/SIGNING.md)
- [Server guide](docs/SETUP.md): installing Memora Server with Docker
- [Updating](docs/UPGRADE.md) and [troubleshooting](docs/TROUBLESHOOTING.md)
- [Backups and restoring](docs/BACKUP_RESTORE.md): the schedule, encryption, Hyper Backup, restoring
- [Architecture](docs/ARCHITECTURE.md): how the code is organised
- [Contributing](CONTRIBUTING.md): development workflow and privacy rules
- [Security policy](docs/SECURITY.md) and [security review](docs/SECURITY_REVIEW.md): threat model, OWASP ASVS Level 1
- [Architecture decision records](docs/adr/)
- [Changelog](CHANGELOG.md) and [making a release](docs/RELEASING.md)

## Credits

Memora is built on the work of many open-source projects. Among them:

- **Interface:** [React](https://react.dev), [TanStack Router and Query](https://tanstack.com), [Radix UI](https://www.radix-ui.com), [Tailwind CSS](https://tailwindcss.com), [Lucide](https://lucide.dev) icons, and the [Figtree](https://github.com/erikdkennedy/figtree), [Bricolage Grotesque](https://github.com/ateliertriay/bricolage) and [JetBrains Mono](https://www.jetbrains.com/lp/mono/) fonts.
- **Editors:** [CodeMirror](https://codemirror.net) for Markdown, and [TipTap](https://tiptap.dev) on [ProseMirror](https://prosemirror.net) for rich text.
- **Markdown and more:** [unified](https://unifiedjs.com) (remark and rehype), [Shiki](https://shiki.style), [KaTeX](https://katex.org), [Mermaid](https://mermaid.js.org) and [DOMPurify](https://github.com/cure53/DOMPurify).
- **Import and export:** [docx](https://docx.js.org), [mammoth](https://github.com/mwilliamson/mammoth.js), [Turndown](https://github.com/mixmark-io/turndown), [Paged.js](https://pagedjs.org) and [JSZip](https://stuk.github.io/jszip/).
- **Server:** [Node.js](https://nodejs.org), [Fastify](https://fastify.dev), [SQLite](https://sqlite.org) through [better-sqlite3](https://github.com/WiseLibs/better-sqlite3), [Drizzle ORM](https://orm.drizzle.team), [Zod](https://zod.dev) and [Argon2](https://github.com/napi-rs/node-rs).

Every package Memora ships, with its licence, is listed in the app (**Settings → Open-source licences**, or `/third-party-licenses.txt`). The list is made at build time from what the build contains, and the build stops on a licence nobody has reviewed yet (`scripts/licenses.mjs`).

## License

[MIT](LICENSE). Memora is created and maintained by [dreamtheater484](https://github.com/dreamtheater484); the source is at [github.com/dreamtheater484/memora](https://github.com/dreamtheater484/memora).
