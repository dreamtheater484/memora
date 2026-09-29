# Architecture

This document describes how the code is organised **today**. The target architecture and the reasons behind it are in the [implementation plan](IMPLEMENTATION_PLAN.md#4-architecture). Individual decisions are recorded in [adr/](adr/).

## Overview

```
Browser (React app)  ──HTTP──────▶  Fastify server  ──▶  SQLite (memora.db in /data)
  IndexedDB           ◀─WebSocket─     │
  service worker                       │
        ▲                              │
        └──── static files ◀───────────┘  (the server also serves the built web app)
```

In production there is **one process in one container**. The server serves both the API (`/api/...`) and the built web app. Any unknown non-API path returns `index.html`, so client-side routes such as `/p/<id>` work when you reload the page. In the browser, pages being edited live in IndexedDB first, and a service worker keeps the app itself, so both work without a connection.

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
- **API.** `GET /api/v1/tree` returns all page metadata (with a short snippet, never the content) in one answer. Every change answers with the rows it created or updated (`TreeChanges`), and deletes answer with what went to the recycle bin, for Undo. `POST /pages` takes an id made by the browser, so a page created offline keeps it.
- **Saving content** (`PUT /pages/:id/content`). Each page has an integer `revision`; a save names the `baseRevision` it started from. If that is still the page's revision, the save is taken in one transaction and the revision goes up by one. If not, the answer is `409 revision_conflict` with the server's revision and content, and the browser merges (D25). Content equal to what is stored always succeeds, so a save repeated after a lost answer is harmless.
- **Versions** (`page_versions`). The versioning hook keeps the text a save replaces, at most every 10 minutes (`auto`), and always when a save settles a conflict. `POST /pages/:id/versions` keeps the browser's side of a conflict it couldn't merge (`conflict`). History, restore and retention come in Phase 7.
- **Rich pages** (D30). Their content is TipTap JSON; a save or conversion that isn't a document is refused (`invalid_content`). `richToText` in `@memora/shared` gives the plain text for snippets and search.
- **Conversion** (`POST /pages/:id/convert`). The browser converts the content; the server checks the base revision, keeps the old content as a `conversion` version, and changes the type and content in one transaction. Other browsers hear about it as `page.updated`.

## Files (`apps/server/src/assets`, `routes/assets.ts`)

- **Upload.** `PUT /api/v1/assets/:id?name=…` takes the file as the request body, whatever its type (the route has its own content-type parser), up to `MEMORA_MAX_UPLOAD_MB`. The id comes from the browser (D28); the same id with the same bytes again is a no-op, so a retried upload is harmless, and another user's id is refused.
- **Storage.** `assets` holds one row per id (name, type, size, image width and height); `asset_blobs` holds the bytes once per user and SHA-256, so the same screenshot pasted twice is stored once.
- **Types.** `assets/image.ts` reads the type and size of PNG, JPEG, GIF, WebP and AVIF from the first bytes; a file only claiming to be an image is stored as plain bytes.
- **Web images** (`assets/fetch.ts`, D31). `POST /api/v1/assets/fetch` downloads an image from the web into a new file: http(s) only; every address the host resolves to is checked against private, loopback, link-local, multicast and other special ranges (IPv4-mapped IPv6 is refused outright); the connection is pinned to the checked address; at most three redirects, each checked; 10 s and 20 MB (or the upload limit) in all; only real images are kept. At most two downloads run at once, as each is held in memory until stored.
- **Download.** `GET /api/v1/assets/:id` answers inline only for those images; anything else is `Content-Disposition: attachment`, with `nosniff` and a sandboxing `Content-Security-Policy`. An id always names the same bytes, so the answer is cacheable for a year (`private`, with an `ETag`).

## Live events (`apps/server/src/events`, `routes/events.ts`)

- **Channel.** `/api/v1/events` is a WebSocket (`@fastify/websocket`), opened with the session cookie and checked for origin like any change. `events/hub.ts` keeps the open sockets per user, in memory, and only ever sends a user their own events.
- **Messages.** Routes that change the tree declare `config.emits: 'tree'`, and an `onResponse` hook publishes `tree.changed` once they have succeeded; a content save publishes `page.updated` with the page's row and new revision. Browsers name themselves with a random id in the `x-memora-device` header (the `device` query parameter for the WebSocket), and an event is not sent back to the browser that caused it.
- **Presence.** Each browser reports the pages it has open (at most 50); the hub sends the user's other browsers a `presence` list with a label per device, such as "Firefox on Windows".
- **Limits.** A heartbeat every 30 s closes dead sockets and those of sessions that ended; more than 60 messages between two heartbeats closes the socket (1008). When the session ends, the socket closes with 4401, so the browser stops reconnecting.
- **Reverse proxies** must pass WebSocket upgrades (see SETUP.md). Without them Memora still works: the browser checks for changes every 30 s instead.

## Web app (`apps/web`)

- **Stack.** React 19 with TanStack Router (routes in `src/router.tsx`) and TanStack Query for server state.
- **Session** (`src/auth/`, `src/lib/api.ts`). `GET /api/v1/auth/me` tells the app whether setup is needed, who is signed in, and the CSRF token. Route guards (`beforeLoad`) send people to setup, login or the forced password change, and after login back to the page they wanted, but only to a path in this app. The API client adds the CSRF token to changes, and when the server says the session is gone, the app forgets its cached data and shows the login page. The admin pages are split into their own chunks. Small UI state (the shell layout, appearance, toasts) lives in zustand stores. Radix primitives provide accessible behaviour for menus, dialogs, popovers, tooltips and selects; the styling is our own.
- **Design tokens** (`src/styles/tokens.css`). Every colour is a CSS variable written with `light-dark()`, so a theme switch only changes `color-scheme` on `<html>` (`data-theme`). `data-glass="off"`, or the system setting for reduced transparency, replaces the translucent panels with solid ones. Tailwind v4 (`src/styles/index.css`) maps the tokens to utilities and switches off its default palette.
- **Section colours** (`src/theme/sections.ts`). The 12 colours are OKLCH hue and chroma pairs. Any element with the `hue` class and `--h`/`--c` gets a matching set of tints (`--sec`, `--sec-soft`, `--sec-ink`). The app accent follows the open section, with an animated transition.
- **Shell** (`src/shell/`). One grid whose columns follow **container queries** on the app root, not the viewport: phone (bottom navigation and drill-down), tablet (icon rail and overlays), desktop (three columns), wide (plus the inspector) and ultra-wide (plus a second note pane with a draggable split). The address says where you are (`/n/`, `/g/`, `/s/`, `/p/` plus an id); `location.ts` turns it into the open notebook, section and page, and on larger screens falls back to the last section and page you had open. Commands (`commands.ts`) are shared by buttons, context menus, the command palette and the keyboard shortcuts (`shortcuts.ts`, one table that also drives the `?` sheet).
- **Notes data** (`src/notes/`). The tree is one TanStack Query entry; `model.ts` builds lookups and ordered lists from it once per change, and plans moves with the same rules and sort keys as the server. Every change shows at once and is then replaced by the server's answer; requests go out one at a time, in order, and each answer is laid under the changes still waiting, so an earlier answer never undoes a later change. A failure shows a toast and reloads the tree. UI state (last section and pages, expanded items) is saved a moment after it changes.
- **Drag and drop** (`src/lib/dnd.ts`). A small pointer-events module instead of a library: drop targets are `data-drop-*` attributes found under the pointer, so rows register nothing. Touch drags start after a long press; Escape cancels. `shell/dropRules.ts` decides what may be dropped where.
- **Saving and sync** (`src/sync/`, D24–D25). The engine starts after login, with one IndexedDB database per user (`store.ts`, through `idb`). Each page has a record: its text, the revision and text it is based on, and whether it waits to be sent; the outbox is simply the records with unsent changes, plus pages created offline.
  - **`doc.ts`**, a page open in a tab. The editor reports every change; within 300 ms the text is in the store, and a second after the last keystroke (or every 5 s while typing goes on) the leader is asked to send it. Changes that reach the record from elsewhere come back into the editor, merged with anything not stored yet.
  - **`engine.ts`**, one per tab. Tabs share the store and a `BroadcastChannel`; a Web Lock picks the leader, which sends and keeps the WebSocket. It also keeps the last tree and settings for starting offline, and the 100 most recently opened pages. On `pagehide`, text not yet in the store goes to local storage, and the next start puts it back.
  - **`sender.ts`** sends the outbox: offline changes to the tree first, then content. A `revision_conflict` is merged with the text both sides started from (`merge.ts`: `node-diff3`, lines first, then word by word). What can't be merged is kept on the server as a `conflict` version and shown as a conflict; a page deleted elsewhere keeps its text as a new page in the Inbox. Retries wait 1 s, doubling to 30 s, with jitter.
  - **`live.ts`**, the WebSocket client: after two failed connections it polls every 30 s while it keeps trying.
  - **`hooks.ts`** turns the state into what the save indicators show. "Saved" appears only once the server has confirmed the latest text, and nothing is shown until the engine has checked what waits to be sent.
  - If IndexedDB can't be used, a store in memory takes over, the tab saves directly, and the app warns that closing the tab could lose changes.
- **Markdown** (`src/markdown/`, D27). `pipeline.ts` is the unified pipeline (GFM, footnotes, alerts, maths, wiki links, front matter, raw HTML, then `rehype-sanitize`); block elements get `data-line`. It runs in `render.worker.ts`, which sends back the tree with positions only on top-level blocks. `Preview.tsx` renders each top-level block on its own (memoised by its source), with components for code (Shiki, `highlight.ts`), maths (`math.ts`, KaTeX), diagrams (`mermaid.ts`), images and files (`asset:` links, from this device's copy while they wait to be sent), wiki links and task boxes. `outline.ts` reads headings and counts words from the source.
- **Editor** (`src/editor/`). `MarkdownPage.tsx` is the page: toolbar, Source / Split / Preview, scroll sync (`scrollSync.ts`, with block positions cached until the preview changes), the outline and the grid editor. `MarkdownEditor.tsx` sets up CodeMirror 6, with settings in compartments so a change needs no new editor. Beside it: the highlight theme (`theme.ts`), table alignment and commands (`tables.ts`, on the shared `table.ts`), formatting commands, slash commands and `[[` suggestions (`completion.ts`), paste and drop (`paste.ts`), image thumbnails and two-column boxes for wide characters (`thumbnails.ts`, `wide.ts`). All of it is one lazily loaded chunk.
- **Rich text** (`src/rich/`, D30–D32). `schema.ts` is the list of nodes and marks (TipTap's, plus callouts, file cards, images with width, alignment and caption, line spacing and cell colours), used by the editor and by conversion alike. `RichEditor.tsx` keeps the document in step with the sync engine like the Markdown editor (the text is the JSON), and handles paste and drop: files become images or file cards, pasted HTML is cleaned (`clean.ts`) and its web images are downloaded by the server afterwards (`files.ts`). Around it: the Word-like toolbar (`RichToolbar.tsx`, which measures its width to drop the tabs and move tools into "More"), `/` and `[[` menus (`suggestions.ts`), drag handles (`dragHandle.ts`), Shiki colours for code (`codeHighlight.ts`, as decorations), image and file views (`views.tsx`), and the page (`RichPage.tsx`: selection menu, link and formula dialogs, the right-click table menu, the A4/Letter sheet, the outline, and the toolbar above a phone's keyboard). `convert.ts` turns Markdown into a rich document through the preview's pipeline; the other way is `richToMarkdown` in `@memora/shared`. The editor is a lazily loaded chunk; PageBody picks it from the page record's type.
- **Files** (`sync/engine.ts`). `addFile` keeps a pasted file as an `uploadFile` op in IndexedDB and answers a new id; the sender uploads ops before page content. Where IndexedDB can't keep Blobs (Safari's private windows), the op keeps the file's bytes instead. Images can be made smaller first (`lib/images.ts`, an Editing setting). The service worker keeps loaded files in `memora-files`, emptied when the user signs out.
- **Service worker** (`sw/`, D26). `sw/plugin.ts` writes the list of built files into `sw.js` at build time: everything the app loads, and whatever those scripts import directly, but not the optional parts loaded on demand (diagrams, maths in the preview, Shiki, conversion). Navigations try the network first and fall back to the kept app after 3 s or offline; hashed assets come from the cache; the API is never touched. It is registered in production builds only.
- **Components** (`src/components/ui/`). Shared building blocks with keyboard support and ARIA roles built in: section tabs (roving focus), the page tree (tree keyboard pattern; for long lists it builds rows as they scroll into view, behind a gap of estimated height, so a section with a thousand pages opens quickly), the command palette (combobox), the split pane (separator) and the save indicator (announces only offline and conflict).
- **Gallery** (`gallery.html`, `src/gallery/`). Shows every component. It is served by the dev server and included only in the `vite build --mode gallery` build that the Playwright tests use, never in the production build.
- **Tests.** Vitest with jsdom for units and components (`*.test.ts(x)` next to the code; `fake-indexeddb` for the store). Playwright in `e2e/` for screenshots, axe accessibility checks and behaviour in a real browser, always in the pinned Playwright image so the pixels match CI. The tests talk to a fake server in the browser (`e2e/helpers.ts`, `e2e/notes.ts`), which can go down, lose answers, answer slowly and act as a second device. The resilience suite (`e2e/resilience.spec.ts`) and pasting screenshots (`e2e/paste.spec.ts`) run in Chromium, Firefox and WebKit.
