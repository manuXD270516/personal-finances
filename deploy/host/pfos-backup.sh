#!/usr/bin/env bash
# PFOS — backups y operaciones del host N1 (docs/30 §4.1, ADR-0027). Lo ejecutan los timers systemd de deploy/host/systemd.
#
#   pfos-backup.sh full | diff | monthly | check | docs-replica | drill | verify | image-prune
#
# full/diff → repo1 (PITR 14 d); monthly → repo2 (12 meses); check → archivado de WAL al día, backup reciente y disco < 80 %;
# docs-replica → réplica de SeaweedFS a B2 (prefijo documents/); drill → restore mensual del último punto de repo1 en una
# base temporal con la clave de SOLO LECTURA (add-host-restore-drill, D456); verify → `pgbackrest verify` semanal de repo1 y
# repo2; image-prune → limpieza semanal de imágenes que conserva el release actual y el anterior. drill, verify e
# image-prune toman el lock del deploy (deploy.lock) para no coincidir con un deploy ni entre sí.
# Si PF_BACKUP_HEARTBEAT_URL está definida en /etc/pfos/pfos.env (p. ej. healthchecks.io, plan gratuito), avisa
# éxito/fallo: así un backup que NO corre también alerta.
#
# Rutas: `PFOS_ETC_DIR`, `PFOS_STATE_DIR`, `PFOS_REPO_DIR` y `PFOS_DOCKER_DIR` existen solo para probar el script sin un host
# (scripts/host-ops); systemd no las define, así que en producción valen los valores por omisión.
set -Eeuo pipefail
umask 077

readonly ETC_DIR="${PFOS_ETC_DIR:-/etc/pfos}"
readonly STATE_DIR="${PFOS_STATE_DIR:-/var/lib/pfos}"
readonly REPO_DIR="${PFOS_REPO_DIR:-/opt/pfos/repo}"
readonly DOCKER_DIR="${PFOS_DOCKER_DIR:-/var/lib/docker}"
readonly COMPOSE_DIR="${REPO_DIR}/deploy/compose"
readonly ENV_FILE="${ETC_DIR}/pfos.env"
readonly PGBR_ENV_FILE="${ETC_DIR}/pgbackrest.env"
readonly RESTORE_ENV_FILE="${ETC_DIR}/pgbackrest-restore.env"
readonly PGBR_CONF="${REPO_DIR}/deploy/pgbackrest/pgbackrest.conf"
readonly RELEASE_ENV="${STATE_DIR}/release.env"
readonly RELEASES_LOG="${STATE_DIR}/releases.log"
readonly DRILLS_LOG="${STATE_DIR}/drills.log"
readonly LOCK_FILE="${STATE_DIR}/deploy.lock"
readonly RCLONE_IMAGE=rclone/rclone:1.75.1@sha256:45401ad7410db1d67ffdb58e19059ad20b0d8e0285a60e38bbec55cc1019c7a5
readonly MAX_BACKUP_AGE_HOURS=26
readonly DISK_ALERT_PCT=80
readonly RPO_SECONDS=900          # NFR-REL-001: RPO ≤ 15 min
readonly RTO_SECONDS=3600         # NFR-REL-002: RTO observado en drill < 1 h
readonly RECOVERY_CAP_SECONDS=5400 # tope duro de la espera de la recuperación (90 min)
readonly LOCK_WAIT_SECONDS=3600
readonly GIB=1073741824
readonly DRILL_NAME=pfos-drill-pg
readonly DRILL_RESTORE_NAME=pfos-drill-restore
readonly DRILL_VOLUME=pfos-drill-pg
readonly DRILL_NETWORK=pfos-drill

kind="${1:-}"
value_of() { sed -n "s/^$2=//p" "$1" | tail -n 1; }
heartbeat="$(value_of "${ENV_FILE}" PF_BACKUP_HEARTBEAT_URL)"
fail_body=""

# ping_heartbeat <sufijo> [cuerpo]: con cuerpo es un POST (healthchecks lo guarda en el log del check).
ping_heartbeat() {
  [ -n "${heartbeat}" ] || return 0
  local -a body=()
  [ -z "${2:-}" ] || body=(--data-raw "$2")
  curl -fsS -m 10 --retry 3 -o /dev/null "${body[@]}" "${heartbeat%/}/pfos-${kind}$1" || true
}
trap 'ping_heartbeat /fail "${fail_body}"' ERR

utc_now() { date -u +%FT%TZ; }

pgbr() {
  docker compose -f "${COMPOSE_DIR}/compose.yaml" -f "${COMPOSE_DIR}/compose.prod.yaml" \
    --env-file "${ENV_FILE}" --env-file "${RELEASE_ENV}" --profile core \
    exec -T postgres pgbackrest --stanza=pfos "$@"
}

# psql de solo lectura sobre la base de PRODUCCIÓN (superusuario por el socket del contenedor).
prod_psql() {
  docker compose -f "${COMPOSE_DIR}/compose.yaml" -f "${COMPOSE_DIR}/compose.prod.yaml" \
    --env-file "${ENV_FILE}" --env-file "${RELEASE_ENV}" --profile core \
    exec -T postgres psql -U postgres -d pfos -Atc "$1"
}

# Lock compartido con el deploy (decisión 8): quien lo toma escribe su nombre en el archivo para que un deploy lo informe.
take_host_lock() {
  mkdir -p "${STATE_DIR}"
  exec 9<>"${LOCK_FILE}"
  flock -w "${LOCK_WAIT_SECONDS}" 9 || {
    echo "no se pudo tomar ${LOCK_FILE} en ${LOCK_WAIT_SECONDS} s: operación del host en curso: $(head -n 1 "${LOCK_FILE}" 2>/dev/null || true)" >&2
    return 1
  }
  : >"${LOCK_FILE}"
  printf '%s\n' "$1" >&9
}

# ---------------------------------------------------------------------------------------------------------- check

check_recent_backup() {
  local stop now
  stop="$(pgbr --repo=1 info --output=json | jq '[.[0].backup[].timestamp.stop] | max // 0')" || return 1
  now="$(date +%s)"
  [ $((now - stop)) -le $((MAX_BACKUP_AGE_HOURS * 3600)) ] || {
    echo "último backup de repo1 tiene más de ${MAX_BACKUP_AGE_HOURS} h" >&2
    return 1
  }
}

# Sistemas de archivos de /, de los contenedores y del estado del host, sin repetir el mismo punto de montaje.
check_disk() {
  local pcent target pct bad=0 seen=" "
  while read -r pcent target; do
    [ -n "${target}" ] || continue
    case "${seen}" in *" ${target} "*) continue ;; esac
    seen="${seen}${target} "
    pct="${pcent%\%}"
    case "${pct}" in '' | *[!0-9]*) continue ;; esac
    if [ "${pct}" -gt "${DISK_ALERT_PCT}" ]; then
      echo "disco ${target} al ${pct} % (umbral ${DISK_ALERT_PCT} %)" >&2
      bad=1
    fi
  done < <(df --output=pcent,target / "${DOCKER_DIR}" "${STATE_DIR}" | tail -n +2)
  return "${bad}"
}

# Evalúa TODAS las verificaciones (un `pgbackrest check` caído no debe ocultar un disco lleno) y falla al final con la lista.
run_check() {
  local -a failed=()
  local out
  out="$(pgbr check 2>&1)" || {
    printf '%s\n' "${out}" >&2
    failed+=("archivado de WAL (pgbackrest check)")
  }
  check_recent_backup || failed+=("antigüedad del último backup")
  check_disk || failed+=("disco")
  [ "${#failed[@]}" -eq 0 ] && return 0
  fail_body="verificación horaria fallida: $(printf '%s; ' "${failed[@]}")"
  echo "${fail_body}" >&2
  return 1
}

# ---------------------------------------------------------------------------------------------------- docs-replica

docs_replica() {
  local bucket endpoint
  bucket="$(value_of "${PGBR_ENV_FILE}" PGBACKREST_REPO1_S3_BUCKET)"
  endpoint="$(value_of "${PGBR_ENV_FILE}" PGBACKREST_REPO1_S3_ENDPOINT)"
  # Credenciales solo por variables de entorno del contenedor efímero (nada en disco ni en la línea de comandos).
  # Solo el bucket de documentos (CIFRADO por la aplicación): la cuarentena (texto plano transitorio) y los exports NO se replican.
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

# ------------------------------------------------------------------------------------- precondiciones de drill y verify

# Imagen de PostgreSQL + pgBackRest del release (la misma versión que producción).
restore_image() {
  trap - ERR # siempre dentro de `$(...)`: sin esto el ERR heredado (set -E) avisaría /fail dos veces
  [ -r "${RESTORE_ENV_FILE}" ] || {
    echo "falta ${RESTORE_ENV_FILE} (runbook, fase 4: plantilla deploy/host/etc-pfos/pgbackrest-restore.env.example)" >&2
    return 1
  }
  if grep -q '__set__' "${RESTORE_ENV_FILE}"; then
    echo "quedan placeholders __set__ en ${RESTORE_ENV_FILE}" >&2
    return 1
  fi
  local image
  image="$(value_of "${RELEASE_ENV}" PFOS_POSTGRES_IMAGE)"
  [ -n "${image}" ] || {
    echo "PFOS_POSTGRES_IMAGE no está en ${RELEASE_ENV} (todavía no hay un release desplegado)" >&2
    return 1
  }
  printf '%s' "${image}"
}

# Contenedor efímero de pgBackRest con la clave de SOLO LECTURA (nunca pgbackrest.env) y sin la red del stack.
pgbr_restore_run() {
  local image="$1" memory="$2"
  shift 2
  docker run --rm --memory "${memory}" --cpus 0.5 --env-file "${RESTORE_ENV_FILE}" \
    -v "${PGBR_CONF}:/etc/pgbackrest/pgbackrest.conf:ro" \
    --entrypoint pgbackrest "${image}" "$@"
}

# ---------------------------------------------------------------------------------------------------------- drill

# Estado del drill (lo lee drill_exit, que arma la línea de drills.log y avisa al heartbeat).
drill_label="n/a" drill_restore="n/a" drill_recovery="n/a" drill_total="n/a" drill_size="n/a" drill_gap="n/a"
drill_version="n/a" drill_reason="" drill_stage="inicio" drill_t_start=""

drill_cleanup() {
  local rc=0 name
  for name in "${DRILL_NAME}" "${DRILL_RESTORE_NAME}"; do
    if docker container inspect "${name}" >/dev/null 2>&1; then docker rm -f "${name}" >/dev/null || rc=1; fi
  done
  if docker volume inspect "${DRILL_VOLUME}" >/dev/null 2>&1; then docker volume rm "${DRILL_VOLUME}" >/dev/null || rc=1; fi
  if docker network inspect "${DRILL_NETWORK}" >/dev/null 2>&1; then docker network rm "${DRILL_NETWORK}" >/dev/null || rc=1; fi
  return "${rc}"
}

drill_die() {
  drill_reason="$1"
  echo "drill: ${1}" >&2
  exit 1
}

# trap EXIT: limpia SIEMPRE (también tras un fallo), registra una línea sin datos financieros y avisa al heartbeat.
drill_exit() {
  local rc=$?
  trap - EXIT ERR
  set +e
  if ! drill_cleanup; then
    [ -n "${drill_reason}" ] || drill_reason="limpieza"
    rc=1
  fi
  local result=ok line
  # La duración total se registra también en un fallo (desde el inicio del restore hasta ahora).
  if [ -n "${drill_t_start}" ] && [ "${drill_total}" = "n/a" ]; then drill_total=$(($(date +%s) - drill_t_start)); fi
  if [ "${rc}" -ne 0 ]; then
    result=fail
    [ -n "${drill_reason}" ] || drill_reason="error_inesperado(${drill_stage})"
  fi
  line="$(utc_now) ${result} ${drill_label} restore=${drill_restore} recovery=${drill_recovery} total=${drill_total} size=${drill_size} gap=${drill_gap} pgbackrest=${drill_version}"
  [ "${result}" = ok ] || line="${line} reason=${drill_reason}"
  printf '%s\n' "${line}" >>"${DRILLS_LOG}"
  echo "${line}"
  if [ "${result}" = ok ]; then ping_heartbeat "" "${line}"; else ping_heartbeat /fail "${line}"; fi
  exit "${rc}"
}

drill_integrity_count() { docker exec "${DRILL_NAME}" psql -U postgres -d pfos -Atc "$1"; }

readonly SQL_UNBALANCED='SELECT count(*) FROM (SELECT journal_entry_id, currency FROM ledger.posting GROUP BY 1, 2 HAVING sum(amount) <> 0) x'
readonly SQL_INCOMPLETE='SELECT count(*) FROM (SELECT j.id FROM ledger.journal_entry j LEFT JOIN ledger.posting p ON p.journal_entry_id = j.id GROUP BY j.id HAVING count(p.id) < 2) x'
readonly SQL_LAST_POSTING="SELECT COALESCE(floor(extract(epoch FROM max(created_at)))::bigint::text, '') FROM ledger.posting"

drill() {
  local image info size need free t0 restore_start restore_end recovery_start recovery_end end state
  local unbalanced incomplete copy_last gap

  # El lock va ANTES del trap de salida: si otra operación lo tiene, esta no debe limpiar los recursos de esa (el ERR avisa).
  drill_stage="lock"
  take_host_lock drill
  trap drill_exit EXIT
  trap 'exit 143' TERM INT HUP # systemd (TimeoutStartSec) manda SIGTERM: sin esto no correría la limpieza
  trap - ERR

  drill_stage="restos"
  drill_cleanup || drill_die "restos_de_un_drill_anterior"

  drill_stage="precondiciones"
  image="$(restore_image)" || drill_die "precondiciones"
  drill_version="$(docker run --rm --entrypoint pgbackrest "${image}" version | awk '{print $2}')" || drill_die "version_de_pgbackrest"

  drill_stage="espacio"
  info="$(pgbr --repo=1 info --output=json | jq -r '.[0].backup[-1] | "\(.label) \(.info.size)"')" || drill_die "info_del_ultimo_backup"
  drill_label="${info%% *}"
  size="${info##* }"
  case "${size}" in '' | *[!0-9]*) drill_die "info_del_ultimo_backup(sin_tamano)" ;; esac
  drill_size="${size}"
  need=$((size * 125 / 100 + 2 * GIB))
  free="$(df --output=avail -B1 "${DOCKER_DIR}" | tail -n 1 | tr -d ' ')" || drill_die "espacio_libre_desconocido"
  if [ "${free}" -lt "${need}" ]; then
    drill_die "espacio(necesario=$(((need + GIB - 1) / GIB))GiB,libre=$((free / GIB))GiB)"
  fi

  drill_stage="referencia"
  t0="$(prod_psql "${SQL_LAST_POSTING}")" || drill_die "consulta_a_produccion"

  drill_stage="restore"
  restore_start="$(date +%s)"
  drill_t_start="${restore_start}"
  docker network create "${DRILL_NETWORK}" >/dev/null || drill_die "red"
  docker volume create "${DRILL_VOLUME}" >/dev/null || drill_die "volumen"
  docker run --rm --name "${DRILL_RESTORE_NAME}" --network "${DRILL_NETWORK}" --memory 256m --cpus 0.5 \
    --env-file "${RESTORE_ENV_FILE}" -v "${DRILL_VOLUME}:/var/lib/postgresql" \
    -v "${PGBR_CONF}:/etc/pgbackrest/pgbackrest.conf:ro" \
    --entrypoint pgbackrest "${image}" --stanza=pfos --repo=1 --process-max=1 restore || drill_die "restore"
  restore_end="$(date +%s)"
  drill_restore=$((restore_end - restore_start))

  # Sin archivado, sin puertos, sin la red del stack y con `listen_addresses` vacío (solo el socket local). `hot_standby=off`:
  # con max_connections=10 (menor que el de producción) la recuperación abortaría por el chequeo de parámetros.
  drill_stage="arranque"
  recovery_start="$(date +%s)"
  docker run -d --name "${DRILL_NAME}" --network "${DRILL_NETWORK}" --memory 256m --cpus 0.5 \
    --env-file "${RESTORE_ENV_FILE}" -v "${DRILL_VOLUME}:/var/lib/postgresql" \
    -v "${PGBR_CONF}:/etc/pgbackrest/pgbackrest.conf:ro" \
    "${image}" postgres -c archive_mode=off -c listen_addresses= -c hot_standby=off \
    -c shared_buffers=32MB -c max_connections=10 >/dev/null || drill_die "arranque"

  drill_stage="recuperacion"
  while :; do
    state="$(docker exec "${DRILL_NAME}" psql -U postgres -d pfos -Atc 'SELECT pg_is_in_recovery()' 2>/dev/null || true)"
    [ "${state}" = "f" ] && break
    [ "$(docker inspect -f '{{.State.Running}}' "${DRILL_NAME}" 2>/dev/null || echo false)" = "true" ] || {
      docker logs --tail 40 "${DRILL_NAME}" >&2 || true
      drill_die "recuperacion(contenedor_detenido)"
    }
    if [ $(($(date +%s) - recovery_start)) -ge "${RECOVERY_CAP_SECONDS}" ]; then
      drill_die "recuperacion(tope_de_90_min)"
    fi
    sleep 10
  done
  recovery_end="$(date +%s)"
  drill_recovery=$((recovery_end - recovery_start))

  drill_stage="integridad"
  unbalanced="$(drill_integrity_count "${SQL_UNBALANCED}")" || drill_die "integridad(consulta_inv004)"
  incomplete="$(drill_integrity_count "${SQL_INCOMPLETE}")" || drill_die "integridad(consulta_inv005)"
  if [ "${unbalanced}" -gt 0 ] || [ "${incomplete}" -gt 0 ]; then
    drill_die "integridad(inv004_sin_cuadrar=${unbalanced},inv005_incompletos=${incomplete})"
  fi

  drill_stage="rpo"
  copy_last="$(drill_integrity_count "${SQL_LAST_POSTING}")" || drill_die "consulta_a_la_copia"
  if [ -z "${t0}" ]; then
    drill_gap="n/a"
    echo "drill: producción sin postings: no se evalúa la pérdida de datos" >&2
  elif [ -z "${copy_last}" ]; then
    drill_gap="n/a"
    drill_die "rpo(copia_sin_postings)"
  else
    gap=$((t0 - copy_last))
    [ "${gap}" -ge 0 ] || gap=0 # la recuperación llega al final del WAL: puede traer postings posteriores a t0
    drill_gap="${gap}"
    [ "${gap}" -le "${RPO_SECONDS}" ] || drill_die "rpo(gap=${gap}s,max=${RPO_SECONDS}s)"
  fi

  drill_stage="duracion"
  end="$(date +%s)"
  drill_total=$((end - restore_start))
  [ "${drill_total}" -le "${RTO_SECONDS}" ] || drill_die "duracion(total=${drill_total}s,max=${RTO_SECONDS}s)"
  exit 0
}

# ---------------------------------------------------------------------------------------------------------- verify

verify() {
  take_host_lock verify
  local image repo out rc summary="" bad=""
  image="$(restore_image)"
  for repo in 1 2; do
    rc=0
    out="$(pgbr_restore_run "${image}" 192m --stanza=pfos "--repo=${repo}" verify 2>&1)" || rc=$?
    printf '%s\n' "${out}"
    if [ "${rc}" -ne 0 ] || grep -Eq 'completed with [1-9]|ERROR' <<<"${out}"; then
      bad="${bad} repo${repo}"
      summary="${summary} repo${repo}=fail"
    else
      summary="${summary} repo${repo}=ok"
    fi
  done
  if [ -n "${bad}" ]; then
    fail_body="verify con archivos inválidos o errores en:${bad}"
    echo "${fail_body}" >&2
    return 1
  fi
  ping_heartbeat "" "verify ok${summary}"
  exit 0
}

# ------------------------------------------------------------------------------------------------------ image-prune

free_bytes() { df --output=avail -B1 "${DOCKER_DIR}" | tail -n 1 | tr -d ' '; }

image_id() { docker image inspect --format '{{.Id}}' "$1" 2>/dev/null || true; }

image_prune() {
  take_host_lock image-prune
  local before after id ref n_removed=0 n_failed=0
  local -A keep=()
  local -a candidates=()
  before="$(free_bytes)"

  # Imágenes de cualquier contenedor (en marcha o detenido).
  while read -r id; do [ -z "${id}" ] || keep["${id}"]=1; done < <(
    docker container ls -a -q --no-trunc | xargs -r docker container inspect --format '{{.Image}}'
  )
  # Release actual y anterior (dos últimas líneas de releases.log: api, web, pg y los extras, en cualquiera de sus formatos).
  if [ -s "${RELEASES_LOG}" ]; then
    while read -r ref; do
      id="$(image_id "${ref}")"
      [ -z "${id}" ] || keep["${id}"]=1
    done < <(tail -n 2 "${RELEASES_LOG}" | awk '{for (i = 3; i <= NF; i++) print $i}')
    # La réplica de documentos corre cada noche en un contenedor efímero: se conserva su imagen.
    id="$(image_id "${RCLONE_IMAGE}")"
    [ -z "${id}" ] || keep["${id}"]=1
    mapfile -t candidates < <(docker image ls -a -q --no-trunc | sort -u)
    for id in "${candidates[@]}"; do
      [ -n "${id}" ] || continue
      [ -z "${keep[${id}]:-}" ] || continue
      # Sin `-f`: si alguna está en uso el borrado falla, se cuenta y se sigue.
      if docker image rm "${id}" >/dev/null 2>&1; then n_removed=$((n_removed + 1)); else n_failed=$((n_failed + 1)); fi
    done
  else
    echo "image-prune: falta ${RELEASES_LOG} (o está vacío): solo se borran las imágenes sin referencia" >&2
  fi
  docker image prune -f >/dev/null
  after="$(free_bytes)"
  ping_heartbeat "" "image-prune borradas=${n_removed} fallidas=${n_failed} liberado_bytes=$((after - before))"
  exit 0
}

case "${kind}" in
  full) pgbr --repo=1 --type=full backup ;;
  diff) pgbr --repo=1 --type=diff backup ;;
  monthly) pgbr --repo=2 --type=full --annotation="monthly=$(date -u +%Y%m)" backup ;;
  check) run_check ;;
  docs-replica) docs_replica ;;
  drill) drill ;;
  verify) verify ;;
  image-prune) image_prune ;;
  *)
    echo "uso: pfos-backup.sh full|diff|monthly|check|docs-replica|drill|verify|image-prune" >&2
    exit 64
    ;;
esac
ping_heartbeat ""
