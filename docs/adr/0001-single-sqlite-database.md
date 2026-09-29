# ADR 0001: Store everything in one SQLite database file

- **Status:** Accepted
- **Date:** 2026-09-29

## Context

Notes must live in one file, or a very small number of files, that is easy to back up, move and restore. Autosave writes often, and a crash or power cut must never corrupt data. Memora runs on NAS hardware with modest resources, and there may be more than one user.

## Decision

- Keep **all** server data in a single SQLite database, `memora.db`: users, notes, images (as BLOBs de-duplicated by SHA-256), Kanban boards and version history.
- Run it in WAL mode with `synchronous=FULL` and foreign keys enforced.
- Access it through `better-sqlite3` and Drizzle ORM.
- Keep schema changes as generated, committed migrations that run at startup, with a backup first.

## Consequences

- Backups are single consistent files made with SQLite's online backup API. Copying `memora.db` while it runs is not safe, and the documentation says so.
- Saves are transactional, so a confirmed save survives a power cut.
- Full-text search (FTS5) comes built in, with no extra service.
- There is one writer at a time. That is ample for a personal or small-team notebook.
- Moving between machines means copying one folder (`/data`).
- The portable export format is separate: a documented `.memora` zip archive (see [implementation plan §8.4](../IMPLEMENTATION_PLAN.md#84-memora-archive-format-v1)).
