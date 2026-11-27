#!/usr/bin/env bash
. "${FAKE_DIR}/bin/common.sh"
record "df $*"
case "$*" in
  *--output=avail*) printf 'Avail\n%s\n' "$(cfg free_bytes 107374182400)" ;;
  *--output=pcent,target*)
    # Con el mismo dispositivo, df repite el punto de montaje por cada ruta pedida (el script debe evaluarlo una vez).
    if [ -f "${FAKE_DIR}/cfg/df_table" ]; then cat "${FAKE_DIR}/cfg/df_table"; else printf 'Use%% Mounted on\n 40%% /\n 40%% /\n 40%% /\n'; fi
    ;;
esac
