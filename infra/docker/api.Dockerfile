# The API image (docs/product/10-l2-newsroom-plan.md §8.2, PR 25), and the nightly backup image beside it.
#   docker build -f infra/docker/api.Dockerfile -t pageinator-api:<tag> .                   (the API; the last stage)
#   docker build -f infra/docker/api.Dockerfile --target backup -t pageinator-backup:<tag> .
# The build context is the repository root; .dockerignore lets in only the files these stages copy (no .env file, no
# node_modules, no private folder, no font). No stage takes a secret: settings arrive as environment variables when a
# container starts (infra/docker/compose.pilot.yml). Base images are pinned by digest, with the tag in the comment.
# The pilot's hosts are x86_64 (EC2, ECR); a build on an arm64 Mac makes an arm64 image of the same files.

# node:24.22.0-slim (Debian bookworm; Node 24.22.0, as .nvmrc). Its user "node" is uid 1000.
ARG NODE_IMAGE=node:24.22.0-slim@sha256:91acba91b842bec0bf7ea6f5e09c644c7ccad72c4996ed9616d861d1c7cd60d4
# postgres:18.6-trixie, as infra/docker/compose.dev.yml: pg_dump 18.6 for the backup image
ARG POSTGRES_IMAGE=postgres:18.6-trixie@sha256:74935e72241653ca55e0414067e6d8763aceb8a810eb51b452253ec3dcfc4336

FROM ${NODE_IMAGE} AS deploy
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0 CI=1
WORKDIR /src
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/ apps/api/
COPY packages/contracts/ packages/contracts/
COPY packages/desk-text/ packages/desk-text/
# pnpm 11.20.0 (package.json's packageManager), through Corepack. `pnpm deploy --prod` copies the API (its "files":
# src, scripts) with its production dependencies only, from the lockfile, with the same 7-day release-age rule as every
# install (pnpm-workspace.yaml). It needs injected workspace packages; that setting is given here only, so development
# keeps its links. No install script runs.
RUN corepack enable pnpm \
  && pnpm --config.inject-workspace-packages=true --filter @pageinator/api deploy --prod --ignore-scripts /app \
  && rm -rf /root/.cache /root/.local/share/pnpm
# Node strips TypeScript types from no file under node_modules, and @pageinator/contracts and desk-text are TypeScript
# sources. So each moves to /app/packages/<name> and is linked back where pnpm put it: Node resolves a module by its
# real path, as in development, and each package gets a node_modules of its own that holds its dependencies.
RUN set -eu; cd /app; mkdir packages; \
  for name in contracts desk-text; do \
    real="$(readlink -f "node_modules/@pageinator/$name")"; \
    mv "$real" "packages/$name"; \
    ln -s "/app/packages/$name" "$real"; \
    ln -s "$(dirname "$(dirname "$real")")" "packages/$name/node_modules"; \
  done; \
  node -e 'import("@pageinator/contracts").then(() => import("@pageinator/desk-text"))'

# The nightly database dump (apps/api/scripts/db-backup.ts, run by infra/backup/backup-loop.sh): pg_dump 18.6 from the
# Postgres image, Node and the API's files beside it.
FROM ${NODE_IMAGE} AS node
FROM ${POSTGRES_IMAGE} AS backup
COPY --from=node /usr/local/bin/node /usr/local/bin/node
COPY --from=deploy /app /app
COPY --chmod=0755 infra/backup/backup-loop.sh /usr/local/bin/pgn-backup-loop
# where the dump waits until it is uploaded (a volume in compose, which takes this owner when new)
RUN mkdir /work && chown postgres:postgres /work && chmod 0700 /work
WORKDIR /app
ENV NODE_ENV=production
# the image's own user "postgres" (uid 999), which owns nothing in /app
USER postgres
ENTRYPOINT []
CMD ["pgn-backup-loop"]

FROM ${NODE_IMAGE} AS api
COPY --from=deploy /app /app
WORKDIR /app
# Better Auth's production behaviour (its error page redirects; no made-up client address)
ENV NODE_ENV=production
EXPOSE 8780
# The files belong to root and the process runs as "node": it can read its code and change none of it.
USER node
# Node itself is the process, not pnpm, so a stop signal reaches the API once (src/main.ts, src/shutdown.ts). Compose
# runs it with init: true, so a second signal still kills it.
CMD ["node", "src/main.ts"]
