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

- **Docker** (optional), to build and test the container image and to run the visual tests.

Development works the same on Windows 11 and Ubuntu. All scripts are cross-platform Node.js scripts, and `.gitattributes` enforces LF line endings.

## Getting started

```bash
pnpm install
```

`pnpm install` also installs the git hooks (see [Privacy guards](#privacy-guards-read-this)). Then start the API and the web app:

```bash
pnpm dev
```

| Command                                        | What it does                                                                                              |
| ---------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `pnpm dev`                                     | API at `http://localhost:3000` (auto-restart) and web app at `http://localhost:5173` (hot reload)         |
| `pnpm build`                                   | Production build: `apps/web/dist` and the bundled server at `apps/server/dist/server.mjs`                 |
| `pnpm start`                                   | Runs the production build (serves the web app too)                                                        |
| `pnpm test`                                    | Unit and integration tests (Vitest)                                                                       |
| `pnpm test:visual`                             | Visual snapshots and accessibility checks (Playwright in Docker, see [below](#web-app-and-design-system)) |
| `pnpm lint` / `pnpm format` / `pnpm typecheck` | Code quality                                                                                              |
| `pnpm check`                                   | Everything above plus the privacy checks, which is what CI runs                                           |
| `pnpm db:generate`                             | Creates a migration after changing `apps/server/src/db/schema.ts`                                         |
| `pnpm docker:build`                            | Builds the Docker image as `memora:local`                                                                 |

In development the server stores its data in `apps/server/data/`. That folder is gitignored.

## Branches and pull requests

`main` only changes through pull requests.

1. Create a branch from an up-to-date `main`, named after the change, for example `feat/phase-2-auth` or `fix/save-indicator-offline`.
2. Make several small, focused commits. Each one should build and pass the hooks.
3. Push the branch and open a pull request against `main`. Describe what changed, why, and how you verified it (tests, screenshots for visual changes).
4. Merge once CI is green.

Branch names, commit messages and pull request text are public too: the [privacy rules](#privacy-guards-read-this) apply to them.

## Web app and design system

The interface follows the Aurora design (decision D21 in the plan). Its building blocks live in `apps/web/src`:

| Folder           | What it holds                                                                                                            |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `styles/`        | Design tokens (`tokens.css`: colours with `light-dark()`, glass, elevation, motion) and the Tailwind theme (`index.css`) |
| `theme/`         | The 12 section colours and the appearance store (theme, glass effects)                                                   |
| `components/ui/` | Core components (buttons, menus, dialogs, section tabs, page tree, command palette, save indicator, split pane, …)       |
| `shell/`         | The responsive app shell: navigation, section tabs, page list, dialogs, commands and keyboard shortcuts                  |
| `notes/`         | The notes tree from the API: lookups, move planning, and the actions that change it                                      |
| `gallery/`       | The component gallery                                                                                                    |

Some rules of thumb:

- Use the token utilities (`bg-surface`, `text-fg-2`, `border-line`, `bg-sec-soft` inside an element with class `hue`). Tailwind's default palette is switched off on purpose.
- There is no class-merging helper, so don't pass a class that competes with one a component already sets (for example a second `rounded-*`). Add a prop to the component instead.
- Every interactive element needs a keyboard path and an accessible name. Icon-only buttons use `IconButton`, which requires a `label`.

**Component gallery.** With `pnpm dev` running, open `http://localhost:5173/gallery.html`. It shows every component in light and dark, with glass on or off, and in any section colour. URL parameters fix these for screenshots: `?theme=dark&glass=off&accent=teal`. The gallery is not part of the production build.

**Visual and accessibility tests.** `apps/web/e2e` has Playwright tests: screenshots of the gallery and of the shell at phone, desktop, wide and ultra-wide sizes in both themes, axe accessibility checks and some behaviour tests. Screenshots depend on fonts and rendering, so they always run in the pinned Playwright Docker image, locally and in CI:

```bash
pnpm test:visual            # run the tests in Docker (Linux or WSL)
pnpm test:visual:update     # accept new or intended visual changes, then review the PNGs in git
```

`pnpm test:e2e` runs the same tests with the browsers installed on your machine. That is fine for behaviour and accessibility, but screenshots may differ slightly from the baselines.

The resilience suite (`e2e/resilience.spec.ts`) checks that no keystroke is lost when the network or server fails, and also runs in Firefox and WebKit. It uses a fake server in the browser (`e2e/helpers.ts`) that can go down, lose answers, answer slowly or act as a second device. Its tests fail if a save indicator ever shows "Saved" before the server has confirmed.

## Project layout

```
apps/server       Fastify API, SQLite database, migrations (bundled into one file with esbuild)
apps/web          React + Vite web app (Playwright tests and screenshot baselines in apps/web/e2e)
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
