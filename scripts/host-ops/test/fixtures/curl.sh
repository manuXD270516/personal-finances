#!/usr/bin/env bash
. "${FAKE_DIR}/bin/common.sh"
record "curl $*"
exit "$(cfg curl_exit 0)"
