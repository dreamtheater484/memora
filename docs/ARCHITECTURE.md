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
