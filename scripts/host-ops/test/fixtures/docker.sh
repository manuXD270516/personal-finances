#!/usr/bin/env bash
# Doble de docker: registra la llamada y responde según los archivos cfg/ del sandbox. Mantiene el estado de los recursos del drill.
set -u
. "${FAKE_DIR}/bin/common.sh"
record "docker $*"
args=" $* "
state="${FAKE_DIR}/state"
mkdir -p "${state}"

case "$*" in
  "container inspect --format"*)
    cat "${FAKE_DIR}/cfg/container_images" 2>/dev/null || true
    exit 0
    ;;
  "container inspect "*)
    [ -f "${state}/container-$3" ] && exit 0
    exit 1
    ;;
  "container ls "*)
    [ -f "${FAKE_DIR}/cfg/container_images" ] && echo "c0ffee"
    exit 0
    ;;
  "volume inspect "*) [ -f "${state}/volume-$3" ] && exit 0; exit 1 ;;
  "network inspect "*) [ -f "${state}/network-$3" ] && exit 0; exit 1 ;;
  "volume create "*) touch "${state}/volume-$3"; echo "$3"; exit 0 ;;
  "network create "*) touch "${state}/network-$3"; echo "id"; exit 0 ;;
  "volume rm "*) [ "$(cfg cleanup_fail)" = "1" ] && exit 1; rm -f "${state}/volume-$3"; exit 0 ;;
  "network rm "*) rm -f "${state}/network-$3"; exit 0 ;;
  "rm -f "*) rm -f "${state}/container-$3"; exit 0 ;;
  "inspect -f "*) cfg container_running true; exit 0 ;;
  "logs "*) exit 0 ;;
  "pull "*) exit 0 ;;
  "ps "*) cfg stack_running ""; exit 0 ;;
  "image ls "*) cat "${FAKE_DIR}/cfg/image_ids" 2>/dev/null || true; exit 0 ;;
  "image prune "*) exit 0 ;;
  "image rm "*)
    id="$3"
    if grep -qx "${id}" "${FAKE_DIR}/cfg/rm_fails" 2>/dev/null; then exit 1; fi
    exit 0
    ;;
  "image inspect --format {{.Id}} "*)
    ref="$5"
    awk -v r="${ref}" '$1 == r { print $2; found = 1 } END { exit !found }' "${FAKE_DIR}/cfg/image_map" 2>/dev/null
    exit $?
    ;;
  "image inspect --format {{join .RepoDigests"*) echo "${*: -1}"; exit 0 ;;
  "image inspect --format {{index .Config.Labels"*) cfg revision; exit 0 ;;
esac

# docker exec <contenedor> psql ... -Atc <SQL>
if [ "$1" = "exec" ] && [ "$2" = "pfos-drill-pg" ]; then
  sql="${*: -1}"
  case "${sql}" in
    *pg_is_in_recovery*)
      polls="$(cat "${state}/polls" 2>/dev/null || echo 0)"
      if [ "${polls}" -lt "$(cfg recovery_polls 0)" ]; then
        echo $((polls + 1)) >"${state}/polls"
        advance "$(cfg recovery_poll_secs 10)"
        exit 1
      fi
      advance "$(cfg recovery_secs 120)"
      echo f
      ;;
    *"HAVING sum(amount)"*) cfg unbalanced 0 ;;
    *"HAVING count(p.id)"*) cfg incomplete 0 ;;
    *"max(created_at)"*) cfg copy_last 1796202000 ;;
  esac
  exit 0
fi

# docker compose ... exec -T postgres <comando>
if [ "$1" = "compose" ]; then
  case "${args}" in
    *" psql "*"max(created_at)"*) cfg prod_last 1796202180 ;;
    *" pgbackrest "*" info "*)
      cfg info_json '[{"backup":[{"label":"20261201-060012F_20261202-060010D","info":{"size":1073741824},"timestamp":{"start":1796191000,"stop":1796191800}}]}]'
      ;;
    *" pgbackrest "*" check"*) exit "$(cfg pgbackrest_check_exit 0)" ;;
    *) ;;
  esac
  exit 0
fi

if [ "$1" = "run" ]; then
  case "${args}" in
    *" --entrypoint pgbackrest "*" version"*) echo "pgBackRest 2.58.0" ;;
    *" --name pfos-drill-restore "*)
      advance "$(cfg restore_secs 60)"
      [ "$(cfg restore_exit 0)" = "0" ] || { echo "ERROR: [082]: repositorio no responde" >&2; exit "$(cfg restore_exit)"; }
      ;;
    *" -d --name pfos-drill-pg "*) touch "${state}/container-pfos-drill-pg"; echo "deadbeef" ;;
    *" verify"*)
      case "${args}" in
        *" --repo=1 "*) printf '%s\n' "$(cfg verify_repo1_out 'P00   INFO: verify command end: completed successfully')"; exit "$(cfg verify_repo1_exit 0)" ;;
        *" --repo=2 "*) printf '%s\n' "$(cfg verify_repo2_out 'P00   INFO: verify command end: completed successfully')"; exit "$(cfg verify_repo2_exit 0)" ;;
      esac
      ;;
  esac
  exit 0
fi
exit 0
