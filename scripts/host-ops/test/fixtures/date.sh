#!/usr/bin/env bash
# Reloj controlado: todo `date` sale del instante de state/clock (los dobles de docker y sleep lo adelantan).
. "${FAKE_DIR}/bin/common.sh"
exec "${REAL_DATE}" -d "@$(clock)" "$@"
