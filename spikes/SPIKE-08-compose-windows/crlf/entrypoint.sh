#!/bin/sh
set -eu
echo "entrypoint OK: running $*"
exec "$@"
