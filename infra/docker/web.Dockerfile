# The web image (docs/product/10-l2-newsroom-plan.md §8.2, PR 25): Caddy v2.11.7 (Apache-2.0) with the web app's
# static build and infra/caddy/Caddyfile. Caddy serves the app, passes /api/* to the API, and holds the TLS
# certificate.
#   docker build -f infra/docker/web.Dockerfile -t pageinator-web:<tag> .
# The build context is the repository root (.dockerignore). No stage takes a secret. Base images are pinned by digest,
# with the tag in the comment.

# node:24.22.0-slim, as infra/docker/api.Dockerfile
ARG NODE_IMAGE=node:24.22.0-slim@sha256:91acba91b842bec0bf7ea6f5e09c644c7ccad72c4996ed9616d861d1c7cd60d4
# caddy:2.11.7 (Alpine)
ARG CADDY_IMAGE=caddy:2.11.7@sha256:504a44d7d74bd2bc28a66afc4774912fc21223ca8a67734af1c54ab2f999b489

FROM ${NODE_IMAGE} AS build
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0 CI=1
WORKDIR /src
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/web/ apps/web/
COPY packages/contracts/ packages/contracts/
# the web app and what it uses, from the lockfile (the 7-day rule of pnpm-workspace.yaml applies); no install script
RUN corepack enable pnpm \
  && pnpm install --frozen-lockfile --ignore-scripts --filter @pageinator/web... \
  && pnpm --filter @pageinator/web build

FROM ${CADDY_IMAGE} AS web
# Caddy runs as an unprivileged user of its own, with every capability dropped (compose: cap_drop ALL). Docker lets a
# container's process bind ports below 1024 without one (net.ipv4.ip_unprivileged_port_start is 0 in containers), so
# the binary's own file capability (cap_net_bind_service) goes: with it, the kernel refuses to start the binary
# without that capability. A copy carries no file capability. Its certificates and state live in /data and /config
# (volumes in compose).
RUN cp /usr/bin/caddy /usr/bin/caddy.copy && mv /usr/bin/caddy.copy /usr/bin/caddy \
  && addgroup -S -g 10001 caddy && adduser -S -D -H -u 10001 -G caddy caddy \
  && mkdir -p /data /config && chown caddy:caddy /data /config
COPY infra/caddy/Caddyfile /etc/caddy/Caddyfile
COPY --from=build /src/apps/web/dist /srv/web
USER caddy
# the base image's command: caddy run --config /etc/caddy/Caddyfile --adapter caddyfile
