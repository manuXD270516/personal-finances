#!/usr/bin/env bash
# PFOS — backups del host N1 (docs/30 §4.1, ADR-0027). Lo ejecutan los timers systemd de deploy/host/systemd.
#
#   pfos-backup.sh full | diff | monthly | check | docs-replica
#
# full/diff → repo1 (PITR 14 d); monthly → repo2 (12 meses); check → archivado de WAL al día y backup reciente;
# docs-replica → réplica de SeaweedFS a B2 (prefijo documents/). Si PF_BACKUP_HEARTBEAT_URL está definida en
# /etc/pfos/pfos.env (p. ej. healthchecks.io, plan gratuito), avisa éxito/fallo: así un backup que NO corre también alerta.
set -euo pipefail
umask 077

readonly COMPOSE_DIR=/opt/pfos/repo/deploy/compose
readonly ENV_FILE=/etc/pfos/pfos.env
readonly PGBR_ENV_FILE=/etc/pfos/pgbackrest.env
readonly RELEASE_ENV=/var/lib/pfos/release.env
readonly RCLONE_IMAGE=rclone/rclone:1.75.1@sha256:45401ad7410db1d67ffdb58e19059ad20b0d8e0285a60e38bbec55cc1019c7a5
readonly MAX_BACKUP_AGE_HOURS=26

kind="${1:-}"
value_of() { sed -n "s/^$2=//p" "$1" | tail -n 1; }
heartbeat="$(value_of "${ENV_FILE}" PF_BACKUP_HEARTBEAT_URL)"

ping_heartbeat() {
  [ -n "${heartbeat}" ] || return 0
  curl -fsS -m 10 --retry 3 -o /dev/null "${heartbeat%/}/pfos-${kind}$1" || true
}
trap 'ping_heartbeat /fail' ERR

pgbr() {
  docker compose -f "${COMPOSE_DIR}/compose.yaml" -f "${COMPOSE_DIR}/compose.prod.yaml" \
    --env-file "${ENV_FILE}" --env-file "${RELEASE_ENV}" --profile core \
    exec -T postgres pgbackrest --stanza=pfos "$@"
}

check_recent_backup() {
  local stop now
  stop="$(pgbr --repo=1 info --output=json | jq '[.[0].backup[].timestamp.stop] | max // 0')"
  now="$(date +%s)"
  [ $((now - stop)) -le $((MAX_BACKUP_AGE_HOURS * 3600)) ] || {
    echo "último backup de repo1 tiene más de ${MAX_BACKUP_AGE_HOURS} h" >&2
    return 1
  }
}

docs_replica() {
  local bucket endpoint
  bucket="$(value_of "${PGBR_ENV_FILE}" PGBACKREST_REPO1_S3_BUCKET)"
  endpoint="$(value_of "${PGBR_ENV_FILE}" PGBACKREST_REPO1_S3_ENDPOINT)"
  # Credenciales solo por variables de entorno del contenedor efímero (nada en disco ni en la línea de comandos).
  # `-e NOMBRE` sin valor: docker toma el valor del entorno de este proceso (asignado en el prefijo).
  RCLONE_CONFIG_SRC_ACCESS_KEY_ID="$(value_of "${ENV_FILE}" PF_DEV_S3_ACCESS_KEY)" \
    RCLONE_CONFIG_SRC_SECRET_ACCESS_KEY="$(value_of "${ENV_FILE}" PF_DEV_S3_SECRET_KEY)" \
    RCLONE_CONFIG_DST_ACCESS_KEY_ID="$(value_of "${PGBR_ENV_FILE}" PGBACKREST_REPO1_S3_KEY)" \
    RCLONE_CONFIG_DST_SECRET_ACCESS_KEY="$(value_of "${PGBR_ENV_FILE}" PGBACKREST_REPO1_S3_KEY_SECRET)" \
    docker run --rm --network pfos_default --read-only --tmpfs /tmp --memory 128m \
    -e RCLONE_CONFIG_SRC_TYPE=s3 -e RCLONE_CONFIG_SRC_PROVIDER=SeaweedFS \
    -e RCLONE_CONFIG_SRC_ENDPOINT=http://object-storage:8333 \
    -e RCLONE_CONFIG_SRC_ACCESS_KEY_ID -e RCLONE_CONFIG_SRC_SECRET_ACCESS_KEY \
    -e RCLONE_CONFIG_DST_TYPE=s3 -e RCLONE_CONFIG_DST_PROVIDER=Other \
    -e RCLONE_CONFIG_DST_ENDPOINT="https://${endpoint#https://}" \
    -e RCLONE_CONFIG_DST_ACCESS_KEY_ID -e RCLONE_CONFIG_DST_SECRET_ACCESS_KEY \
    "${RCLONE_IMAGE}" sync "src:pfos-prod-documents" "dst:${bucket}/documents/pfos-prod-documents" \
    --checksum --transfers 2 --checkers 4 --stats-one-line --stats 0
}

case "${kind}" in
  full) pgbr --repo=1 --type=full backup ;;
  diff) pgbr --repo=1 --type=diff backup ;;
  monthly) pgbr --repo=2 --type=full --annotation="monthly=$(date -u +%Y%m)" backup ;;
  check)
    pgbr check
    check_recent_backup
    ;;
  docs-replica) docs_replica ;;
  *)
    echo "uso: pfos-backup.sh full|diff|monthly|check|docs-replica" >&2
    exit 64
    ;;
esac
ping_heartbeat ""
