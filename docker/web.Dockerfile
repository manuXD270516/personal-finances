# syntax=docker/dockerfile:1
# finance-web — Next.js (App Router, UI + BFF) en salida `standalone` (docs/20 §4.2).
#   docker build -f docker/web.Dockerfile -t pfos/finance-web:local .
# Build once: ninguna configuración de entorno se hornea en el build (sin NEXT_PUBLIC_* de entorno); todo se lee
# en runtime y se valida al arrancar (instrumentation.ts).
ARG NODE_IMAGE=node:24.21.0-bookworm-slim@sha256:0e0ff40c39bc087845bfb27465a0df4ea419520094bc35842ff83dd8cbe6f9b6

############################ base ############################
FROM ${NODE_IMAGE} AS base
ENV PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH \
    CI=true \
    COREPACK_ENABLE_DOWNLOAD_PROMPT=0 \
    NEXT_TELEMETRY_DISABLED=1
RUN corepack enable
WORKDIR /repo

############################ deps ############################
FROM base AS deps
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json .npmrc ./
RUN --mount=type=cache,id=pfos-pnpm-store,target=/pnpm/store \
    pnpm fetch --store-dir /pnpm/store

############################ build ###########################
FROM deps AS build
COPY . .
RUN --mount=type=cache,id=pfos-pnpm-store,target=/pnpm/store \
    pnpm install --store-dir /pnpm/store --frozen-lockfile --offline --filter "@pf/web..."
RUN pnpm --filter "@pf/web..." run build

############################ runtime #########################
FROM ${NODE_IMAGE} AS runtime
ARG GIT_SHA=unknown
ARG VERSION=0.0.0-dev
ARG BUILD_DATE=unknown
LABEL org.opencontainers.image.title="finance-web" \
      org.opencontainers.image.description="PFOS web: Next.js UI + BFF (standalone)" \
      org.opencontainers.image.source="https://github.com/manuXD270516/personal-finances" \
      org.opencontainers.image.revision="${GIT_SHA}" \
      org.opencontainers.image.version="${VERSION}" \
      org.opencontainers.image.created="${BUILD_DATE}" \
      org.opencontainers.image.licenses="UNLICENSED" \
      org.opencontainers.image.vendor="PFOS" \
      org.opencontainers.image.base.name="docker.io/library/node:24.21.0-bookworm-slim"
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    HOSTNAME=0.0.0.0 \
    PORT=3000 \
    PFOS_VERSION=${VERSION} \
    PFOS_GIT_SHA=${GIT_SHA}
# Parches de seguridad de Debian sobre la base fijada por digest (p. ej. perl-base CVE-2026-13221/42496/8376):
# Trivy bloquea CRITICAL con corrección disponible; se aplican al construir sin cambiar la base.
RUN apt-get update \
 && apt-get -y upgrade --no-install-recommends \
 && apt-get clean \
 && rm -rf /var/lib/apt/lists/*
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack \
           /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack /opt/yarn-* \
           /usr/local/bin/yarn /usr/local/bin/yarnpkg
WORKDIR /app
COPY --from=build --chown=root:root /repo/apps/web/.next/standalone/ ./
COPY --from=build --chown=root:root /repo/apps/web/.next/static ./apps/web/.next/static
COPY --from=build --chown=root:root /repo/apps/web/public ./apps/web/public
COPY --chown=root:root --chmod=0555 docker/healthcheck.mjs /usr/local/lib/pfos/healthcheck.mjs
# `.next/cache` es el único directorio escribible (tmpfs en Compose con read_only: true).
RUN mkdir -p apps/web/.next/cache && chown node:node apps/web/.next/cache
USER node:node
EXPOSE 3000
HEALTHCHECK --interval=10s --timeout=3s --start-period=20s --start-interval=2s --retries=3 \
  CMD ["node", "/usr/local/lib/pfos/healthcheck.mjs", "http://127.0.0.1:3000/api/health/ready"]
ENTRYPOINT ["node", "apps/web/server.js"]
