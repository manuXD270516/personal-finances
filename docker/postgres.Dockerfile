# syntax=docker/dockerfile:1
# pfos-postgres — PostgreSQL 18 + pgBackRest para producción N1 (ADR-0027, docs/30 §4.1, SPIKE-09 §10).
#   docker build -f docker/postgres.Dockerfile --target runtime -t pfos/pfos-postgres:local .
# `archive_command` se ejecuta DENTRO del contenedor de PostgreSQL, por eso pgBackRest tiene que vivir en la
# misma imagen (no sirve un sidecar). Misma base que el stack local (deploy/compose/compose.yaml), fijada por
# versión y digest; pgBackRest sale del repositorio PGDG que la imagen oficial ya trae configurado.
ARG POSTGRES_IMAGE=postgres:18.6-trixie@sha256:5a5a84b19854a9ffaa54082c166ff4ec27473a361e496e5ea167f298f2da9722

FROM ${POSTGRES_IMAGE} AS runtime
ARG PGBACKREST_VERSION=2.59.2-1.pgdg13+1
ARG GIT_SHA=unknown
ARG VERSION=0.0.0-local
ARG BUILD_DATE=unknown
RUN set -eux; \
    apt-get update; \
    apt-get install -y --no-install-recommends "pgbackrest=${PGBACKREST_VERSION}"; \
    rm -rf /var/lib/apt/lists/*; \
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
