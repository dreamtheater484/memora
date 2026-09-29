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

| Package           | Role                                                 | Built with                                    |
| ----------------- | ---------------------------------------------------- | --------------------------------------------- |
| `apps/server`     | HTTP API, database, migrations, startup and shutdown | esbuild → `dist/server.mjs`, `dist/admin.mjs` |
| `apps/web`        | Single-page app                                      | Vite → `dist/`                                |
| `packages/shared` | Schemas, types and pure helpers used by both sides   | Consumed as TypeScript source                 |

### Server bundle

The server is bundled together with `@memora/shared` and every pure-JavaScript dependency, into two entry points: the server and the `memora-admin` command-line tool. Only native modules stay external: `better-sqlite3` and `@node-rs/argon2`. They are the only entries under `dependencies` in `apps/server/package.json`; everything else is a `devDependency`. Both ship prebuilt binaries, so nothing is compiled, in CI or in Docker.

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
5. Listen. If no account exists yet, print a one-time setup code to stdout (kept only in memory).
6. Every 6 hours, delete expired sessions and prune the audit log (a year, at most 50,000 entries).
7. On `SIGTERM`/`SIGINT`, close the server, then close the database, which checkpoints the WAL.

## Container

- **Multi-stage build.** A `node:24-bookworm-slim` stage builds everything. The runtime stage is `debian:bookworm-slim` plus the Node.js binary, the bundle, the web assets and `better-sqlite3`. It contains no npm, corepack or compilers.
- **`docker/entrypoint.sh`:**
  - caps the V8 heap (`MEMORA_MAX_HEAP_MB`);
  - prepares `/data`;
  - drops from root to `PUID:PGID` with `setpriv`;
  - refuses to run as root;
  - never runs a recursive `chown` on existing data.
- **Health check.** The image's `HEALTHCHECK` calls `/api/health` every 60 s. The route logs only at warn level, so these checks don't flood the log.
- **`memora-admin`** (`docker/memora-admin.sh`) runs `dist/admin.mjs` as `PUID:PGID`, even when `docker exec` starts it as root, so files it creates in `/data` keep the right owner.
- **Publishing.** After CI passes on `main`, `.github/workflows/publish.yml` builds the image natively on amd64 and arm64 runners, runs the smoke test on each, and pushes `:edge` and `:sha-<commit>` to GHCR as one multi-architecture image.

## Database

- **Schema:** `apps/server/src/db/schema.ts` (Drizzle ORM).
- **Migrations:** generated SQL in `apps/server/drizzle/`, created with `pnpm db:generate`, committed to git and applied at startup.
- **Backups:** `db/backup.ts` uses SQLite's online backup API. Backup file names avoid colons so they can be copied to any file system.

## Authentication (`apps/server/src/auth`, `routes/`)

- **Layers.** `repo/` wraps the tables (users, sessions, audit log) and is the only code that queries them. `auth/service.ts` holds the rules: setup, login, sessions and password changes. `routes/` turn HTTP requests into service calls and validate every body with the zod schemas from `@memora/shared`, which the web app uses too.
- **Access gate** (`auth/plugin.ts`). Every `/api/` route declares `config.access`: `public`, `user` or `admin`. Registering a route without it stops the server at startup. One `onRequest` hook then applies the API rate limit, checks the origin of changes, resolves the session cookie, and enforces the route's access level, the CSRF token, and a pending password change. Handlers can rely on `request.auth` being set when their route needs a user.
- **Sessions.** The cookie carries a random 32-byte token; the `sessions` table stores its SHA-256 hash, so a copy of the database can't be used to log in. Expiry slides with use; `last_seen_at` is written at most every 5 minutes. The CSRF token is an HMAC of the session token, so it needs no storage.
- **Passwords.** Argon2id through `@node-rs/argon2`, at most two hashes at a time, so a burst of logins can't use much memory. Unknown usernames still cost one hash, so response times don't reveal which accounts exist.
- **Throttling** (`auth/throttle.ts`). In-memory counters per username and per address, with doubling delays, capped at 10,000 entries.
- **Tests.** `auth/access.test.ts` lists every API route with its expected access level and fails when a route is added without an entry, then checks anonymous, regular-user and cross-user requests against each one.

## Notes (`apps/server/src/notes`, `routes/notes.ts`)

- **Tables.** `notebooks`, `section_groups` (nested through `parent_group_id`), `sections` and `pages` (subpages through `parent_page_id`), plus `user_settings` for per-user UI state. Every row carries `owner_id`, and every query filters on it, so another user's ids simply aren't found (404).
- **Order.** Siblings are ordered by a fractional-index `sort_key` (`fractional-indexing`), compared as plain strings, so a move writes only the moved rows. `placeKeys` in `@memora/shared` computes the keys for "before this sibling, or last", and the web app uses the same function to show a move before the server answers.
- **Soft delete.** Deleting sets `deleted_at` on the item and `deleted_root_id` on it and everything inside, so restoring the root brings back exactly what went with it, and nothing deleted earlier. A restore is refused while the parent is itself in the recycle bin; a restored item whose place was taken gets a new key at the end.
- **Limits.** Groups nest at most four levels and pages three; moves that would go deeper, or inside themselves, are refused with `too_deep` or `invalid_move`. Moving a group or page to another notebook or section takes its subtree along, including rows already in the recycle bin.
- **Inbox.** Each user's inbox is a section outside any notebook (`is_inbox`, at most one per owner, created on the first `GET /tree`). It can't be renamed, moved or deleted.
- **API.** `GET /api/v1/tree` returns all page metadata (with a short snippet, never the content) in one answer. Every change answers with the rows it created or updated (`TreeChanges`), and deletes answer with what went to the recycle bin, for Undo.

## Web app (`apps/web`)

- **Stack.** React 19 with TanStack Router (routes in `src/router.tsx`) and TanStack Query for server state.
- **Session** (`src/auth/`, `src/lib/api.ts`). `GET /api/v1/auth/me` tells the app whether setup is needed, who is signed in, and the CSRF token. Route guards (`beforeLoad`) send people to setup, login or the forced password change, and after login back to the page they wanted, but only to a path in this app. The API client adds the CSRF token to changes, and when the server says the session is gone, the app forgets its cached data and shows the login page. The admin pages are split into their own chunks. Small UI state (the shell layout, appearance, toasts) lives in zustand stores. Radix primitives provide accessible behaviour for menus, dialogs, popovers, tooltips and selects; the styling is our own.
- **Design tokens** (`src/styles/tokens.css`). Every colour is a CSS variable written with `light-dark()`, so a theme switch only changes `color-scheme` on `<html>` (`data-theme`). `data-glass="off"`, or the system setting for reduced transparency, replaces the translucent panels with solid ones. Tailwind v4 (`src/styles/index.css`) maps the tokens to utilities and switches off its default palette.
- **Section colours** (`src/theme/sections.ts`). The 12 colours are OKLCH hue and chroma pairs. Any element with the `hue` class and `--h`/`--c` gets a matching set of tints (`--sec`, `--sec-soft`, `--sec-ink`). The app accent follows the open section, with an animated transition.
- **Shell** (`src/shell/`). One grid whose columns follow **container queries** on the app root, not the viewport: phone (bottom navigation and drill-down), tablet (icon rail and overlays), desktop (three columns), wide (plus the inspector) and ultra-wide (plus a second note pane with a draggable split). The address says where you are (`/n/`, `/g/`, `/s/`, `/p/` plus an id); `location.ts` turns it into the open notebook, section and page, and on larger screens falls back to the last section and page you had open. Commands (`commands.ts`) are shared by buttons, context menus, the command palette and the keyboard shortcuts (`shortcuts.ts`, one table that also drives the `?` sheet).
- **Notes data** (`src/notes/`). The tree is one TanStack Query entry; `model.ts` builds lookups and ordered lists from it once per change, and plans moves with the same rules and sort keys as the server. Every change shows at once and is then replaced by the server's answer; requests go out one at a time, in order, and each answer is laid under the changes still waiting, so an earlier answer never undoes a later change. A failure shows a toast and reloads the tree. UI state (last section and pages, expanded items) is saved a moment after it changes.
- **Drag and drop** (`src/lib/dnd.ts`). A small pointer-events module instead of a library: drop targets are `data-drop-*` attributes found under the pointer, so rows register nothing. Touch drags start after a long press; Escape cancels. `shell/dropRules.ts` decides what may be dropped where.
- **Components** (`src/components/ui/`). Shared building blocks with keyboard support and ARIA roles built in: section tabs (roving focus), the page tree (tree keyboard pattern; for long lists it builds rows as they scroll into view, behind a gap of estimated height, so a section with a thousand pages opens quickly), the command palette (combobox), the split pane (separator) and the save indicator (announces only offline and conflict).
- **Gallery** (`gallery.html`, `src/gallery/`). Shows every component. It is served by the dev server and included only in the `vite build --mode gallery` build that the Playwright tests use, never in the production build.
- **Tests.** Vitest with jsdom for units and components (`*.test.ts(x)` next to the code). Playwright in `e2e/` for screenshots, axe accessibility checks and behaviour in a real browser, always in the pinned Playwright image so the pixels match CI.
