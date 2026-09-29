# ADR 0003: TypeScript end to end, with a bundled server

- **Status:** Accepted
- **Date:** 2026-09-29

## Context

The app has a rich browser client and a small API server. It must run in Docker on NAS hardware with little RAM, and be developed on both Windows 11 and Ubuntu.

## Decision

- **Language:** TypeScript (strict) for the client, the server and a shared package.
- **Server:** Fastify, bundled with esbuild into a single ES module. Native modules (`better-sqlite3`) stay external.
- **Client:** React and Vite, with TanStack Router and TanStack Query.
- **Tooling:** pnpm workspaces, Vitest, ESLint and Prettier.
- **Pinned versions:**
  - pnpm 10, because the corepack in some Linux distributions cannot run newer pnpm releases.
  - TypeScript 6, because typescript-eslint does not support TypeScript 7 yet.
  - Node.js 24 in the image; 22.13+ is supported for development.

## Consequences

- Schemas and types are shared between client and server, so API mismatches show up as compile errors.
- The runtime image contains one npm package plus the bundle. It measures about 220 MB unpacked (about 84 MB compressed) and idles at about 40 MB of RAM.
- Stack traces point into the bundle. It is not minified (minifying saved no RAM), so function names stay readable.
- The server bundle must not rely on runtime file lookups inside `node_modules`. New dependencies are checked in the Docker smoke test.
