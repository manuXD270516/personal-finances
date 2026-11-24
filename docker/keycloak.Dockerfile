# syntax=docker/dockerfile:1
# pfos-keycloak — Keycloak con build optimizado para producción N1 (docs/despliegue/cambios-de-codigo.md C7, ADR-0027).
#   docker build -f docker/keycloak.Dockerfile --target runtime -t pfos/pfos-keycloak:local .
# `start` sobre la imagen oficial rehace el build de Quarkus en cada arranque (pico de CPU y memoria ≈ 900 MiB, con
# riesgo de OOM bajo el techo de 704m). Aquí el build se hace UNA vez, al construir la imagen, con las opciones de
# build-time fijas; en runtime solo se aplican las opciones de runtime (hostname, proxy, DB, secretos) que pone
# compose.prod.yaml. Misma base que el stack local (deploy/compose/compose.yaml): versión y digest fijados.
ARG KEYCLOAK_IMAGE=quay.io/keycloak/keycloak:26.8.0@sha256:b0f60d489d51c5d113390bdf5461d4c06e6051be026c05549f2e1e10ec352bcc

FROM ${KEYCLOAK_IMAGE} AS builder
# Opciones de BUILD-TIME (no se pueden cambiar en runtime sin volver a construir): proveedor de base de datos,
# endpoints de salud/management (puerto 9000, el healthcheck de compose usa /health/ready) y caché local (un solo
# nodo, sin JGroups). Sin features extra, sin proveedores ni temas propios.
ENV KC_DB=postgres \
    KC_HEALTH_ENABLED=true \
    KC_CACHE=local
RUN /opt/keycloak/bin/kc.sh build

FROM ${KEYCLOAK_IMAGE} AS runtime
ARG GIT_SHA=unknown
ARG VERSION=0.0.0-local
ARG BUILD_DATE=unknown
COPY --from=builder /opt/keycloak/ /opt/keycloak/
LABEL org.opencontainers.image.title="pfos-keycloak" \
      org.opencontainers.image.description="Keycloak 26.8 con build optimizado (postgres, health, cache local) para PFOS" \
      org.opencontainers.image.revision="${GIT_SHA}" \
      org.opencontainers.image.version="${VERSION}" \
      org.opencontainers.image.created="${BUILD_DATE}" \
      org.opencontainers.image.source="https://github.com/manuXD270516/personal-finances"
# La imagen oficial ya corre como uid 1000 (`keycloak`); se declara explícito para el chequeo no-root del PR.
USER 1000
ENTRYPOINT ["/opt/keycloak/bin/kc.sh"]
