# Architecture

This document describes how the code is organised **today**. The target architecture and the reasons behind it are in the [implementation plan](IMPLEMENTATION_PLAN.md#4-architecture). Individual decisions are recorded in [adr/](adr/).

## Overview

```
Browser (React app)  ──HTTP──▶  Fastify server  ──▶  SQLite (memora.db in /data)
        ▲                          │
        └──── static files ◀───────┘  (the server also serves the built web app)
```

In production there is **one process in one container**. The server serves both the API (`/api/...`) and the built web app. Any unknown non-API path returns `index.html`, so client-side routes such as `/p/<id>` work when you reload the page.

## Workspace packages

| Package           | Role                                                 | Built with                                 |
| ----------------- | ---------------------------------------------------- | ------------------------------------------ |
| `apps/server`     | HTTP API, database, migrations, startup and shutdown | esbuild → one ES module, `dist/server.mjs` |
| `apps/web`        | Single-page app                                      | Vite → `dist/`                             |
| `packages/shared` | Schemas, types and pure helpers used by both sides   | Consumed as TypeScript source              |

### Server bundle

The server is bundled into a single file together with `@memora/shared` and every pure-JavaScript dependency. Only native modules stay external. Today that is just `better-sqlite3`, which is why it is the only entry under `dependencies` in `apps/server/package.json`; everything else is a `devDependency`. The Docker runtime image therefore installs one package.

### Paths

The dev entry (`src/*.ts`, run by `tsx`) and the bundle (`dist/server.mjs`) both sit one level below `apps/server/`. `src/paths.ts` resolves `drizzle/` (migrations) and `../web/dist` relative to that, and the Docker image keeps the same layout under `/app`. As a result there are no absolute paths in code and no differences between environments.

## Startup sequence (`apps/server/src/index.ts`)

1. Read and validate the configuration from environment variables (`config.ts`, zod). Invalid values stop the process with a readable message.
2. Open `memora.db` with the durability pragmas: WAL, `synchronous=FULL`, foreign keys.
3. **Migrations** (`db/migrate.ts`):
   - refuse to open a database written by a newer version (downgrade protection);
   - take a consistent backup before changing an existing database;
   - apply the pending Drizzle migrations.
4. Record the instance ID and the version that created the database in `app_meta`.
5. Listen. On `SIGTERM`/`SIGINT`, close the server, then close the database, which checkpoints the WAL.

## Container

- **Multi-stage build.** A `node:24-bookworm-slim` stage builds everything. The runtime stage is `debian:bookworm-slim` plus the Node.js binary, the bundle, the web assets and `better-sqlite3`. It contains no npm, corepack or compilers.
- **`docker/entrypoint.sh`:**
  - caps the V8 heap (`MEMORA_MAX_HEAP_MB`);
  - prepares `/data`;
  - drops from root to `PUID:PGID` with `setpriv`;
  - refuses to run as root;
  - never runs a recursive `chown` on existing data.
- **Health check.** The image's `HEALTHCHECK` calls `/api/health` every 60 s. The route logs only at warn level, so these checks don't flood the log.

## Database

- **Schema:** `apps/server/src/db/schema.ts` (Drizzle ORM).
- **Migrations:** generated SQL in `apps/server/drizzle/`, created with `pnpm db:generate`, committed to git and applied at startup.
- **Backups:** `db/backup.ts` uses SQLite's online backup API. Backup file names avoid colons so they can be copied to any file system.

## Web app (`apps/web`)

- **Stack.** React 19 with TanStack Router (routes in `src/router.tsx`) and TanStack Query for server state. Small UI state (the shell layout, appearance, toasts) lives in zustand stores. Radix primitives provide accessible behaviour for menus, dialogs, popovers, tooltips and selects; the styling is our own.
- **Design tokens** (`src/styles/tokens.css`). Every colour is a CSS variable written with `light-dark()`, so a theme switch only changes `color-scheme` on `<html>` (`data-theme`). `data-glass="off"`, or the system setting for reduced transparency, replaces the translucent panels with solid ones. Tailwind v4 (`src/styles/index.css`) maps the tokens to utilities and switches off its default palette.
- **Section colours** (`src/theme/sections.ts`). The 12 colours are OKLCH hue and chroma pairs. Any element with the `hue` class and `--h`/`--c` gets a matching set of tints (`--sec`, `--sec-soft`, `--sec-ink`). The app accent follows the open section, with an animated transition.
- **Shell** (`src/shell/`). One grid whose columns follow **container queries** on the app root, not the viewport: phone (bottom navigation and drawers), tablet (icon rail), desktop (three columns), wide (plus the inspector) and ultra-wide (plus a second note pane with a draggable split). The content is placeholder data until the notes API exists.
- **Components** (`src/components/ui/`). Shared building blocks with keyboard support and ARIA roles built in: section tabs (roving focus), the page tree (tree keyboard pattern), the command palette (combobox), the split pane (separator) and the save indicator (announces only offline and conflict).
- **Gallery** (`gallery.html`, `src/gallery/`). Shows every component. It is served by the dev server and included only in the `vite build --mode gallery` build that the Playwright tests use, never in the production build.
- **Tests.** Vitest with jsdom for units and components (`*.test.ts(x)` next to the code). Playwright in `e2e/` for screenshots, axe accessibility checks and behaviour in a real browser, always in the pinned Playwright image so the pixels match CI.
