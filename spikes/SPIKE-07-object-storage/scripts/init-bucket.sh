#!/bin/sh
# Init idempotente: crea buckets, aplica CORS e intenta versioning.
# Se ejecuta en amazon/aws-cli contra el backend (red interna de Compose).
set -u
EP="${S3_ENDPOINT:?}"
aws_() { aws --endpoint-url "$EP" "$@"; }

i=0
until aws_ s3api list-buckets >/dev/null 2>&1; do
  i=$((i+1)); [ "$i" -gt 60 ] && { echo "S3 no responde"; exit 1; }
  sleep 1
done

for b in $BUCKETS; do
  if aws_ s3api head-bucket --bucket "$b" >/dev/null 2>&1; then
    echo "bucket $b ya existe (idempotente)"
  else
    aws_ s3api create-bucket --bucket "$b" && echo "bucket $b creado" || { echo "ERROR creando $b"; exit 1; }
  fi
  aws_ s3api put-bucket-cors --bucket "$b" --cors-configuration file:///init/cors.json \
    && echo "CORS aplicado a $b" || echo "WARN: put-bucket-cors falló en $b"
  if [ "${ENABLE_VERSIONING:-true}" = "true" ]; then
    aws_ s3api put-bucket-versioning --bucket "$b" --versioning-configuration Status=Enabled \
      && echo "versioning habilitado en $b" || echo "WARN: versioning no soportado en $b"
  fi
done
echo "init OK"
