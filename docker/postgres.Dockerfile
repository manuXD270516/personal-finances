# syntax=docker/dockerfile:1
# pfos-postgres — PostgreSQL 18 + pgBackRest para producción N1 (ADR-0027, docs/30 §4.1, SPIKE-09 §10).
#   docker build -f docker/postgres.Dockerfile --target runtime -t pfos/pfos-postgres:local .
# `archive_command` se ejecuta DENTRO del contenedor de PostgreSQL, por eso pgBackRest tiene que vivir en la
# misma imagen (no sirve un sidecar). Misma base que el stack local (deploy/compose/compose.yaml), fijada por
# versión y digest; pgBackRest sale del repositorio PGDG que la imagen oficial ya trae configurado.
ARG POSTGRES_IMAGE=postgres:18.7-trixie@sha256:eb63372c1e05c755f55fa30cbd07aecc443676fc6c0fa90b9002d01537841e1a

FROM ${POSTGRES_IMAGE} AS runtime
# gosu (binario Go de la imagen oficial) solo se usa al arrancar como root; aquí se arranca como `postgres`, así
# que se elimina en el RUN de abajo para no arrastrar su stdlib de Go (CVE-2025-68121, CRITICAL).
ARG PGBACKREST_VERSION=2.59.3-1.pgdg13+1
ARG GIT_SHA=unknown
ARG VERSION=0.0.0-local
ARG BUILD_DATE=unknown
RUN set -eux; \
    apt-get update; \
    apt-get install -y --no-install-recommends "pgbackrest=${PGBACKREST_VERSION}"; \
    rm -rf /var/lib/apt/lists/*; \
    rm -f /usr/local/bin/gosu; \
    # Rutas de trabajo de pgBackRest propiedad de `postgres` (el contenedor corre sin root).
    install -d -o postgres -g postgres -m 0750 /var/log/pgbackrest /var/lib/pgbackrest /tmp/pgbackrest /var/lib/postgresql/pgbackrest-spool; \
    pgbackrest version
LABEL org.opencontainers.image.title="pfos-postgres" \
      org.opencontainers.image.description="PostgreSQL 18 + pgBackRest (PITR a Backblaze B2) para PFOS" \
      org.opencontainers.image.revision="${GIT_SHA}" \
      org.opencontainers.image.version="${VERSION}" \
      org.opencontainers.image.created="${BUILD_DATE}" \
      org.opencontainers.image.source="https://github.com/manuXD270516/personal-finances"
# La imagen oficial admite correr como el usuario `postgres` (uid 999) desde el arranque: sin gosu ni root.
USER postgres
