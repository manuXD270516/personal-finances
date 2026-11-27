#!/usr/bin/env bash
. "${FAKE_DIR}/bin/common.sh"
record "sleep $*"
advance "${1:-0}"
