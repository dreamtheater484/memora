# ADR 0004: Revision-based saving with 3-way merge instead of CRDTs

- **Status:** Accepted
- **Date:** 2026-09-29

## Context

The same note can be open on several devices, and edits can happen offline. No keystroke may be lost, and conflicts must never silently discard work. Real-time co-editing between different users is not needed for v1.0.

## Decision

- Every page has an integer `revision`. Each save sends the full content and the `baseRevision` it started from.
- If the base matches, the save is accepted.
- If it doesn't:
  - **Markdown** pages try a 3-way merge (base, server, local). A clean merge is saved and shown without interrupting the user.
  - Otherwise, and for **rich** pages, the local version is stored as a `conflict` version. The user chooses _Keep mine_, _Keep theirs_ or _Compare_.
- Clients keep unsynced edits in an IndexedDB outbox until the server confirms them.

## Consequences

- It is much simpler than CRDTs (Yjs) for storage, search, export and debugging.
- Nothing is ever lost: both sides of a conflict end up in the version history.
- Concurrent editing of the same rich page on two devices needs a manual decision. That is rare for a single user, and presence hints make it rarer still.
- If sharing and co-editing are added later, Yjs can replace this for shared pages (see plan §17).
