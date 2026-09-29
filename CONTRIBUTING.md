# Contributing to Memora

## Prerequisites

- **Node.js 22.13 or newer.** 24 LTS is recommended and is what the Docker image uses.
- **pnpm 10.** The exact version is pinned in `package.json` (`packageManager`). The easiest way to get it is through corepack, which ships with Node.js:

  ```bash
  corepack enable pnpm
  ```

  If that fails with a permission error:
  - **Linux** (system-wide Node.js): install the shim in your own bin folder instead, and make sure `~/.local/bin` is on your `PATH`.

    ```bash
    corepack enable --install-directory ~/.local/bin pnpm
    ```

  - **Windows:** run the terminal as Administrator once.

  Without enabling it, you can also prefix every command with `corepack`, for example `corepack pnpm install`. Root scripts that call `pnpm` internally (such as `pnpm build`) only work once pnpm is on the `PATH`.

- **Docker** (optional), to build and test the container image.

Development works the same on Windows 11 and Ubuntu. All scripts are cross-platform Node.js scripts, and `.gitattributes` enforces LF line endings.

## Getting started

```bash
pnpm install
```

`pnpm install` also installs the git hooks (see [Privacy guards](#privacy-guards-read-this)). Then start the API and the web app:

```bash
pnpm dev
```

| Command                                        | What it does                                                                                      |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `pnpm dev`                                     | API at `http://localhost:3000` (auto-restart) and web app at `http://localhost:5173` (hot reload) |
| `pnpm build`                                   | Production build: `apps/web/dist` and the bundled server at `apps/server/dist/server.mjs`         |
| `pnpm start`                                   | Runs the production build (serves the web app too)                                                |
| `pnpm test`                                    | Unit and integration tests (Vitest)                                                               |
| `pnpm lint` / `pnpm format` / `pnpm typecheck` | Code quality                                                                                      |
| `pnpm check`                                   | Everything above plus the privacy checks, which is what CI runs                                   |
| `pnpm db:generate`                             | Creates a migration after changing `apps/server/src/db/schema.ts`                                 |
| `pnpm docker:build`                            | Builds the Docker image as `memora:local`                                                         |

In development the server stores its data in `apps/server/data/`. That folder is gitignored.

## Project layout

```
apps/server       Fastify API, SQLite database, migrations (bundled into one file with esbuild)
apps/web          React + Vite web app
packages/shared   Code used by both: schemas, types, pure helpers
design/mockups    Phase 1 clickable design mockups (view with `node design/mockups/serve.mjs`)
docker/           Dockerfile, entrypoint, compose example, smoke test
scripts/          Privacy guards and cross-platform helper scripts
docs/             Plan, setup guide, architecture, decision records
```

## Privacy guards (read this)

**The repository must never contain personal information:** secrets, local paths, usernames, personal email addresses, IP addresses of home networks, or real user data. The rules are in [section 6 of the implementation plan](docs/IMPLEMENTATION_PLAN.md#6-repository-layout--privacy-rules-critical). Several layers of automation enforce them:

| When                                   | Check                                                                                                                                  |
| -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Every commit (pre-commit hook)         | Your git email is a GitHub noreply address · staged files contain no personal patterns · no secrets (secretlint) · formatting and lint |
| Every commit message (commit-msg hook) | No personal patterns                                                                                                                   |
| Every push (pre-push hook)             | All files scanned · type check · tests                                                                                                 |
| CI (every push and pull request)       | All of the above, plus **gitleaks over the full git history** and a check of every commit's author email                               |

### One-time setup

1. **Use your GitHub noreply email for commits** in this repository. Find it at GitHub → Settings → Emails, and turn on _"Keep my email addresses private"_ and _"Block command line pushes that expose my email"_. Then run:

   ```bash
   git config user.email "<id>+<github-user>@users.noreply.github.com"
   ```

2. **Create your personal block list.** Create `.forbidden-strings.local` in the repository root. It is gitignored, so it never leaves your machine. Put one entry per line, listing things that must never appear in the repository: your usernames, real name, personal email, home IP addresses, local folder names. Plain entries match whole words, case-insensitively. Prefix an entry with `re:` to use a regular expression. For example:

   ```
   # .forbidden-strings.local — never committed
   yourname
   your.name@mail.example
   <your-nas-ip>
   re:my-secret-project-\d+
   ```

### When the check fails

- Replace the value with a **placeholder**: `<nas-ip>`, `<your-user>`, `notes.example.com`, `/volume1/docker/memora`.
- If a line genuinely needs a generic match (for example documentation that explains a pattern), add `privacy-check: allow` to that line. This never bypasses your personal block list.
- Run the checks yourself at any time with `pnpm check:privacy`.
- For build output or image contents, which contain third-party code, use `node scripts/check-forbidden.mjs --personal-only <files>`.

Never skip hooks with `--no-verify`. CI runs the same checks and will reject the change anyway.

## Coding guidelines

- TypeScript in strict mode everywhere. Validate data at boundaries with zod schemas, preferably shared through `packages/shared`.
- Keep RAM use modest. Memora runs on NAS hardware: prefer streaming over buffering, and justify new dependencies or caches.
- Every feature meets the [definition of done](docs/IMPLEMENTATION_PLAN.md#134-definition-of-done-every-feature): tests, light and dark themes, phone to ultra-wide, keyboard accessible, docs updated.
- Database changes: edit `apps/server/src/db/schema.ts`, run `pnpm db:generate`, and commit the generated migration. Migrations run automatically on start, with a backup first.
