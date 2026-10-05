# syntax=docker/dockerfile:1
# finance-api — una imagen, varios comandos (ADR-0011): api | worker | migrate | seed
#   docker build -f docker/api.Dockerfile -t pfos/finance-api:local .
# Base fijada por versión y digest (docs/20 §3, §15); Renovate la actualiza vía PR. Misma línea que .nvmrc (24).
ARG NODE_IMAGE=node:24.21.0-bookworm-slim@sha256:0e0ff40c39bc087845bfb27465a0df4ea419520094bc35842ff83dd8cbe6f9b6

############################ base ############################
FROM ${NODE_IMAGE} AS base
ENV PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH \
    CI=true \
    COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable
WORKDIR /repo

############################ deps ############################
# Solo el lockfile: la capa del store se reutiliza mientras no cambien las dependencias.
FROM base AS deps
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json .npmrc ./
RUN --mount=type=cache,id=pfos-pnpm-store,target=/pnpm/store \
    pnpm fetch --store-dir /pnpm/store

############################ build ###########################
FROM deps AS build
COPY . .
RUN --mount=type=cache,id=pfos-pnpm-store,target=/pnpm/store \
    pnpm install --store-dir /pnpm/store --frozen-lockfile --offline --filter "@pf/api..."
# `deploy --legacy`: node_modules de producción aislado de @pf/api (+ dist de los paquetes del workspace).
RUN --mount=type=cache,id=pfos-pnpm-store,target=/pnpm/store \
    pnpm --filter "@pf/api..." run build \
 && pnpm --filter @pf/api deploy --store-dir /pnpm/store --prod --legacy /out \
 && rm -rf /out/src /out/test /out/tsconfig*.json /out/vitest*.ts

############################ runtime #########################
FROM ${NODE_IMAGE} AS runtime
ARG GIT_SHA=unknown
ARG VERSION=0.0.0-dev
ARG BUILD_DATE=unknown
LABEL org.opencontainers.image.title="finance-api" \
      org.opencontainers.image.description="PFOS backend: api | worker | migrate | seed (NestJS + dbmate + pg-boss)" \
      org.opencontainers.image.source="https://github.com/manuXD270516/personal-finances" \
      org.opencontainers.image.revision="${GIT_SHA}" \
      org.opencontainers.image.version="${VERSION}" \
      org.opencontainers.image.created="${BUILD_DATE}" \
      org.opencontainers.image.licenses="UNLICENSED" \
      org.opencontainers.image.vendor="PFOS" \
      org.opencontainers.image.base.name="docker.io/library/node:24.21.0-bookworm-slim"
ENV NODE_ENV=production \
    PFOS_VERSION=${VERSION} \
    PFOS_GIT_SHA=${GIT_SHA} \
    NODE_OPTIONS="--enable-source-maps"
# Sin gestores de paquetes en runtime (superficie mínima, docs/20 §1).
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
# Ficheros propiedad de root y no escribibles: el proceso corre como `node` (uid 1000) y con FS de solo lectura.
COPY --from=build --chown=root:root /out/ ./
COPY --chown=root:root --chmod=0555 docker/healthcheck.mjs /usr/local/lib/pfos/healthcheck.mjs
USER node:node
EXPOSE 8080 8082
# Healthcheck por defecto del comando `api`. Compose lo sobrescribe para `worker` (8082) y lo desactiva en los
# one-shot `migrate`/`seed`. Docker 29: start-interval exige start-period (SPIKE-08).
HEALTHCHECK --interval=10s --timeout=3s --start-period=30s --start-interval=2s --retries=3 \
  CMD ["node", "/usr/local/lib/pfos/healthcheck.mjs", "http://127.0.0.1:8080/health/ready"]
# Forma exec (sin sh -c): node recibe SIGTERM; en Compose `init: true` aporta tini como PID 1.
ENTRYPOINT ["node", "dist/entrypoint.js"]
CMD ["api"]
