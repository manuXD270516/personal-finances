# Utilidades comunes de los dobles (se hace `source`). FAKE_DIR y FAKE_CALLS los define el harness.
# cfg <clave> [defecto]: valor preparado por el test en $FAKE_DIR/cfg/<clave>.
cfg() { if [ -f "${FAKE_DIR}/cfg/$1" ]; then cat "${FAKE_DIR}/cfg/$1"; else printf '%s' "${2:-}"; fi; }
record() { printf '%s\n' "$*" >>"${FAKE_CALLS}"; }
clock() { cat "${FAKE_DIR}/state/clock"; }
advance() { echo $(($(clock) + $1)) >"${FAKE_DIR}/state/clock"; }
