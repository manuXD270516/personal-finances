#!/usr/bin/env bash
# PFOS — deploy / rollback / status en el host N1 (ADR-0027, docs/runbooks/deploy-and-restore.md).
# Lo ejecuta como root /usr/local/sbin/pfos-deploy (comando forzado SSH instalado por cloud-init), que ya validó los
# argumentos y dejó /opt/pfos/repo en el commit de main que se despliega. Nunca recibe secretos: solo digests.
#
#   pfos-deploy.sh deploy <sha> <finance-api@sha256> <finance-web@sha256> <pfos-postgres@sha256>
#   pfos-deploy.sh rollback      # vuelve al release exitoso anterior (mismos digests de entonces)
#   pfos-deploy.sh status
set -euo pipefail
umask 077

readonly REPO=/opt/pfos/repo
readonly COMPOSE_DIR="${REPO}/deploy/compose"
readonly ENV_FILE=/etc/pfos/pfos.env
readonly PGBR_ENV_FILE=/etc/pfos/pgbackrest.env
readonly STATE_DIR=/var/lib/pfos
readonly RELEASE_ENV="${STATE_DIR}/release.env"
# Una línea por release exitoso: <utc> <sha> <api-ref> <web-ref> <pg-ref>
readonly RELEASES_LOG="${STATE_DIR}/releases.log"

log() { printf '%s pfos-deploy: %s\n' "$(date -u +%FT%TZ)" "$*"; }
die() {
  log "ERROR: $*" >&2
  exit 1
}

# Valor literal de una variable de pfos.env (sin interpretar el archivo como shell).
env_value() { sed -n "s/^$1=//p" "${ENV_FILE}" | tail -n 1; }

compose() {
  local release_env="$1"
  shift
  docker compose -f "${COMPOSE_DIR}/compose.yaml" -f "${COMPOSE_DIR}/compose.prod.yaml" \
    --env-file "${ENV_FILE}" --env-file "${release_env}" --profile core "$@"
}

write_release_env() {
  local file="$1" sha="$2" api="$3" web="$4" pg="$5"
  printf 'PFOS_RELEASE_SHA=%s\nFINANCE_API_IMAGE=%s\nFINANCE_WEB_IMAGE=%s\nPFOS_POSTGRES_IMAGE=%s\n' \
    "${sha}" "${api}" "${web}" "${pg}" >"${file}"
}

pull_and_verify() {
  local sha="$1"
  shift
  local ref revision
  for ref in "$@"; do
    docker pull --quiet "${ref}" >/dev/null
    docker image inspect --format '{{join .RepoDigests "\n"}}' "${ref}" | grep -qx "${ref}" \
      || die "${ref}: el digest descargado no coincide"
    revision="$(docker image inspect --format '{{index .Config.Labels "org.opencontainers.image.revision"}}' "${ref}")"
    [ "${revision}" = "${sha}" ] || die "${ref}: revision=${revision}, esperado ${sha} (build-once de main.yml)"
  done
}

install_host_units() {
  install -m 0644 "${REPO}"/deploy/host/systemd/*.service "${REPO}"/deploy/host/systemd/*.timer /etc/systemd/system/
  systemctl daemon-reload
  systemctl enable --now pfos-backup-full.timer pfos-backup-diff.timer pfos-backup-monthly.timer \
    pfos-backup-check.timer pfos-docs-replica.timer >/dev/null
}

stack_running() { [ -n "$(docker ps -q --filter label=com.docker.compose.project=pfos --filter label=com.docker.compose.service=postgres)" ]; }

pre_migrate_backup() {
  local sha="$1"
  if ! stack_running; then
    log "primer despliegue: sin backup previo a migraciones"
    return 0
  fi
  log "backup incremental pre-migración (repo1, anotado con el sha)"
  compose "${RELEASE_ENV}" exec -T postgres pgbackrest --stanza=pfos --repo=1 --type=incr \
    --annotation=reason=pre-migrate --annotation="sha=${sha}" backup \
    || die "falló el backup pre-migración: se aborta el deploy (el release actual sigue corriendo)"
}

smoke() {
  local app auth
  app="$(env_value PF_DOMAIN_APP)"
  auth="$(env_value PF_DOMAIN_AUTH)"
  # Por Caddy y TLS reales, resolviendo los hostnames al propio host (no depende del DNS público).
  curl -fsS -m 20 --retry 6 --retry-delay 5 --retry-all-errors --resolve "${app}:443:127.0.0.1" \
    "https://${app}/api/health/ready" >/dev/null || return 1
  curl -fsS -m 20 --retry 6 --retry-delay 5 --retry-all-errors --resolve "${auth}:443:127.0.0.1" \
    "https://${auth}/realms/pfos/.well-known/openid-configuration" >/dev/null || return 1
}

ensure_stanza() {
  compose "${RELEASE_ENV}" exec -T postgres pgbackrest --stanza=pfos stanza-create >/dev/null
  compose "${RELEASE_ENV}" exec -T postgres pgbackrest --stanza=pfos check \
    || log "AVISO: pgbackrest check falló (WAL no archivado); revisar pgbackrest.env / B2 (runbook §5)"
}

up_release() {
  local candidate="$1"
  compose "${candidate}" up -d --wait --wait-timeout 420 --remove-orphans
}

previous_release() { tail -n 2 "${RELEASES_LOG}" 2>/dev/null | head -n 1; }

cmd_deploy() {
  local sha="$1" api="$2" web="$3" pg="$4" candidate
  [ -r "${ENV_FILE}" ] && [ -r "${PGBR_ENV_FILE}" ] || die "faltan ${ENV_FILE} o ${PGBR_ENV_FILE} (runbook §2.3)"
  grep -q '__generate__\|__set__' "${ENV_FILE}" "${PGBR_ENV_FILE}" && die "quedan placeholders sin completar en /etc/pfos"

  log "release ${sha}: pull por digest"
  pull_and_verify "${sha}" "${api}" "${web}" "${pg}"
  install_host_units

  candidate="$(mktemp "${STATE_DIR}/release.env.XXXXXX")"
  write_release_env "${candidate}" "${sha}" "${api}" "${web}" "${pg}"
  pre_migrate_backup "${sha}"

  log "compose up (migrate → api/worker → web → caddy)"
  if up_release "${candidate}" && mv -f "${candidate}" "${RELEASE_ENV}" && smoke; then
    ensure_stanza
    printf '%s %s %s %s %s\n' "$(date -u +%FT%TZ)" "${sha}" "${api}" "${web}" "${pg}" >>"${RELEASES_LOG}"
    log "OK release ${sha}"
    return 0
  fi

  rm -f "${candidate}"
  compose "${RELEASE_ENV}" logs --no-color --tail 60 migrate finance-api finance-web 2>/dev/null || true
  local last
  last="$(tail -n 1 "${RELEASES_LOG}" 2>/dev/null || true)"
  if [ -n "${last}" ]; then
    log "falló el release ${sha}: vuelvo al último release exitoso"
    redeploy_line "${last}" || log "ERROR: el rollback automático también falló (runbook §4)"
  fi
  die "release ${sha} no quedó sano"
}

redeploy_line() {
  local _ts sha api web pg
  read -r _ts sha api web pg <<<"$1"
  git -C "${REPO}" -c advice.detachedHead=false checkout --quiet --detach "${sha}"
  write_release_env "${RELEASE_ENV}" "${sha}" "${api}" "${web}" "${pg}"
  up_release "${RELEASE_ENV}"
  smoke
}

cmd_rollback() {
  local prev
  prev="$(previous_release)"
  [ -n "${prev}" ] && [ "$(wc -l <"${RELEASES_LOG}")" -ge 2 ] || die "no hay un release anterior registrado"
  log "rollback a: ${prev}"
  log "AVISO: las migraciones no se revierten; si el release fallido migró de forma incompatible → runbook §5 (PITR)"
  redeploy_line "${prev}"
  # Se registra como un release nuevo: un segundo `rollback` vuelve al que se acaba de abandonar.
  printf '%s %s\n' "$(date -u +%FT%TZ)" "$(cut -d' ' -f2- <<<"${prev}")" >>"${RELEASES_LOG}"
  log "OK rollback"
}

cmd_status() {
  [ -r "${RELEASE_ENV}" ] || die "sin release desplegado"
  cat "${RELEASE_ENV}"
  compose "${RELEASE_ENV}" ps --format 'table {{.Service}}\t{{.Status}}'
  compose "${RELEASE_ENV}" exec -T postgres pgbackrest --stanza=pfos info --output=text | head -n 20 || true
}

mkdir -p "${STATE_DIR}"
exec 9>"${STATE_DIR}/deploy.lock"
flock -n 9 || die "hay otro deploy en curso"

case "${1:-}" in
  deploy) cmd_deploy "$2" "$3" "$4" "$5" ;;
  rollback) cmd_rollback ;;
  status) cmd_status ;;
  *) die "uso: pfos-deploy.sh deploy|rollback|status" ;;
esac
