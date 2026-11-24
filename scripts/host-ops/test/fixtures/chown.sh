#!/usr/bin/env bash
# No hay root en CI: solo registra (el dueño real no se puede comprobar sin privilegios).
. "${FAKE_DIR}/bin/common.sh"
record "chown $*"
