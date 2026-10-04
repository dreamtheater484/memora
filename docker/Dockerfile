# syntax=docker/dockerfile:1
#
# Memora container image. Build from the repository root:
#   docker build -f docker/Dockerfile -t memora:local .

ARG NODE_VERSION=24
# Both stages use the same Debian release, so the native SQLite driver built in the build stage
# matches the C library of the runtime image.
ARG DEBIAN_RELEASE=bookworm

# ---------------------------------------------------------------------------------------------
# Build stage: install all dependencies, build the web app and bundle the server.
# ---------------------------------------------------------------------------------------------
FROM node:${NODE_VERSION}-${DEBIAN_RELEASE}-slim AS build
WORKDIR /app
ENV CI=true \
    COREPACK_ENABLE_DOWNLOAD_PROMPT=0

RUN corepack enable

# Manifests first, so the dependency layer is cached until they change.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
# Fixes to dependencies, applied as they are installed (pnpm-workspace.yaml).
COPY patches/ patches/
COPY scripts/install-hooks.mjs scripts/run-bin.mjs scripts/
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
RUN pnpm install --frozen-lockfile

COPY . .
# The licence list (scripts/licenses.mjs) names the image's base system too.
ARG DEBIAN_RELEASE
RUN MEMORA_IMAGE_BASE="Debian ${DEBIAN_RELEASE} (slim)" pnpm build

# The server bundle's only runtime dependencies are native modules: the SQLite driver and
# Argon2 (the platform's own package is installed). better-sqlite3 ships prebuilt binaries for
# every platform; keep only the one for this image.
RUN pnpm --filter @memora/server deploy --prod --legacy /out/server \
 && cd /out/server/node_modules/better-sqlite3 \
 && keep="$(node -p "require('path').basename(require('./lib/binding').getPrebuildPath())")" \
 && find prebuilds -type f ! -name "$keep" -delete \
 && rm -rf deps src build binding.gyp \
 && rm -rf /out/server/node_modules/.pnpm/node-addon-api*

# ---------------------------------------------------------------------------------------------
# Runtime stage: plain Debian slim plus the Node.js binary — no npm, corepack or build tools.
# ---------------------------------------------------------------------------------------------
FROM debian:${DEBIAN_RELEASE}-slim AS runtime
LABEL org.opencontainers.image.title="Memora" \
      org.opencontainers.image.description="Self-hosted notebook with notebooks and section tabs, Markdown and rich notes, and Kanban boards." \
      org.opencontainers.image.licenses="MIT"

ENV NODE_ENV=production \
    PORT=3000 \
    MEMORA_DATA_DIR=/data

# Debian's security fixes published since the base image was built (the image scan fails on any
# that are fixed but missing).
RUN apt-get update \
 && apt-get upgrade -y --no-install-recommends \
 && apt-get clean \
 && rm -rf /var/lib/apt/lists/*

COPY --from=build /usr/local/bin/node /usr/local/bin/node

WORKDIR /app
# Same layout as the repository, so paths resolve identically in development and production.
COPY --from=build /out/server/node_modules apps/server/node_modules
COPY --from=build /app/apps/server/package.json apps/server/
COPY --from=build /app/apps/server/dist apps/server/dist
COPY --from=build /app/apps/server/drizzle apps/server/drizzle
COPY --from=build /app/apps/web/dist apps/web/dist
COPY LICENSE ./
COPY docker/healthcheck.mjs ./
COPY docker/entrypoint.sh /usr/local/bin/memora-entrypoint
COPY docker/memora-admin.sh /usr/local/bin/memora-admin
COPY docker/memora-user.sh /usr/local/lib/memora-user.sh
RUN chmod 0755 /usr/local/bin/memora-entrypoint /usr/local/bin/memora-admin && mkdir -p /data

EXPOSE 3000
HEALTHCHECK --interval=60s --timeout=5s --start-period=30s --retries=3 \
  CMD ["node", "/app/healthcheck.mjs"]

# The entrypoint starts as root only to prepare /data, then drops to the data folder's owner
# (or PUID:PGID when set).
ENTRYPOINT ["memora-entrypoint"]
CMD ["node", "apps/server/dist/server.mjs"]
