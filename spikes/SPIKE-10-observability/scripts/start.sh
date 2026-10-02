#!/usr/bin/env bash
# Arranca worker + api con el SDK OTel (o sin él: MODE=nosdk). Logs JSON en logs/*.log
cd "$(dirname "$0")/.." || exit 1
. scripts/env.sh
mkdir -p logs
IMPORT="--import ./dist/otel.js"
[ "${MODE:-sdk}" = "nosdk" ] && IMPORT=""
OTEL_SERVICE_NAME=finance-worker node $IMPORT dist/worker/main.js > logs/worker.log 2>&1 &
OTEL_SERVICE_NAME=finance-api node $IMPORT dist/api/main.js > logs/api.log 2>&1 &
wait
