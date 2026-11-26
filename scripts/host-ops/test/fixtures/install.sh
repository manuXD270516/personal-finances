#!/usr/bin/env bash
# `install -o U -g G -m MODE /dev/null ARCHIVO` crea un archivo vacío con ese modo (sin cambiar dueño: no hay root en CI).
. "${FAKE_DIR}/bin/common.sh"
record "install $*"
mode="" ; args=("$@")
for ((i = 0; i < ${#args[@]}; i++)); do [ "${args[i]}" = "-m" ] && mode="${args[i + 1]}"; done
last="${args[${#args[@]} - 1]}"
if [ "${args[$((${#args[@]} - 2))]}" = "/dev/null" ]; then
  : >"${last}"
  [ -z "${mode}" ] || chmod "${mode}" "${last}"
fi
exit 0
