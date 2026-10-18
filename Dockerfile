# syntax=docker/dockerfile:1
# heka-news image: the Bun server, run from source (ADR 0001: there is no build step). The same
# shape as heka-site's image, with a Bun runtime instead of nginx because every page is rendered
# per request from SQLite.
#
#   docker build --build-arg GIT_SHA="$(git rev-parse HEAD)" -t heka-news .
#   docker run --read-only --tmpfs /tmp -v "$PWD/data:/data" -p 8080:8080 heka-news
#
# Runs as the image's non-root `bun` user (uid 1000) on a read-only root filesystem. The only
# writable path is the /data volume, which holds the database (/data/heka-news.db); on the host
# it must be writable by uid 1000. /healthz answers "ok <commit>".

ARG BUN_VERSION=1.4.2

# Install production dependencies only. The manifest and lockfile first, so the install layer
# stays cached until a dependency changes.
FROM oven/bun:${BUN_VERSION} AS build
WORKDIR /app
COPY package.json bun.lock ./
RUN --mount=type=cache,target=/root/.bun/install/cache \
  bun install --frozen-lockfile --production --ignore-scripts
# tsconfig.json too: Bun reads jsxImportSource (hono/jsx) from it when it runs the .tsx files.
COPY tsconfig.json ./
COPY src ./src
COPY public ./public

FROM oven/bun:${BUN_VERSION}-slim
WORKDIR /app
# Bun caches transpiled source on disk by default; the root filesystem is read-only.
ENV NODE_ENV=production \
  HOST=0.0.0.0 \
  PORT=8080 \
  DATABASE_PATH=/data/heka-news.db \
  BUN_RUNTIME_TRANSPILER_CACHE_PATH=0
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json /app/tsconfig.json ./
COPY --from=build /app/public ./public
COPY --from=build /app/src ./src
RUN mkdir -p /data && chown bun:bun /data
USER bun
VOLUME /data
EXPOSE 8080
# There is no wget or curl in the slim image; Bun's fetch does the check.
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD ["bun", "-e", "fetch('http://127.0.0.1:8080/healthz').then(r => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]
# Last, so a new commit reuses every layer above.
ARG GIT_SHA=unknown
ENV GIT_SHA=${GIT_SHA}
CMD ["bun", "src/server.ts"]
