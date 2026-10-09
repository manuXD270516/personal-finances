#!/usr/bin/env bash
# PFOS — crea (una vez, idempotente) el bucket de documentos en SeaweedFS de producción con versioning y CORS, y el bucket de
# exports del workspace (SIN versioning: al expirar un export su objeto debe desaparecer de verdad; add-workspace-export)
# (equivalente a lo que `migrate` hace en local con OBJECT_STORAGE_ENSURE_BUCKET, que en producción se rechaza).
# Uso en el host, como root, con el stack levantado: /opt/pfos/repo/deploy/host/pfos-bootstrap-storage.sh
set -euo pipefail
umask 077

readonly ENV_FILE=/etc/pfos/pfos.env
readonly AWS_CLI_IMAGE=amazon/aws-cli:2.37.9@sha256:92de75724b6a746951f0e8b915d86bbccd7cb55aff96cd0cb4f7017272160780
value_of() { sed -n "s/^$1=//p" "${ENV_FILE}" | tail -n 1; }

bucket="$(value_of OBJECT_STORAGE_BUCKET)"
exports_bucket="$(value_of OBJECT_STORAGE_EXPORTS_BUCKET)"
origin="https://$(value_of PF_DOMAIN_APP)"
[ -n "${bucket}" ] && [ -n "${exports_bucket}" ] && [ "${origin}" != "https://" ] || {
  echo "faltan OBJECT_STORAGE_BUCKET, OBJECT_STORAGE_EXPORTS_BUCKET o PF_DOMAIN_APP en ${ENV_FILE}" >&2
  exit 1
}
cors="$(printf '{"CORSRules":[{"AllowedOrigins":["%s"],"AllowedMethods":["GET","PUT","POST","HEAD"],"AllowedHeaders":["*"],"ExposeHeaders":["ETag","x-amz-version-id","x-amz-checksum-sha256"],"MaxAgeSeconds":600}]}' "${origin}")"

AWS_ACCESS_KEY_ID="$(value_of PF_DEV_S3_ACCESS_KEY)" AWS_SECRET_ACCESS_KEY="$(value_of PF_DEV_S3_SECRET_KEY)" \
  docker run --rm -i --network pfos_default --read-only --tmpfs /tmp \
  -e AWS_ACCESS_KEY_ID -e AWS_SECRET_ACCESS_KEY -e AWS_DEFAULT_REGION=us-east-1 \
  -e BUCKET="${bucket}" -e EXPORTS_BUCKET="${exports_bucket}" -e CORS="${cors}" --entrypoint /bin/sh "${AWS_CLI_IMAGE}" <<'EOF'
set -eu
s3() { aws --endpoint-url http://object-storage:8333 s3api "$@"; }
s3 head-bucket --bucket "$BUCKET" 2>/dev/null || s3 create-bucket --bucket "$BUCKET"
s3 put-bucket-versioning --bucket "$BUCKET" --versioning-configuration Status=Enabled
s3 put-bucket-cors --bucket "$BUCKET" --cors-configuration "$CORS"
s3 get-bucket-versioning --bucket "$BUCKET"
# Exports del workspace: sin versioning y con lifecycle de 8 días como red de seguridad de la retención de 7 días.
s3 head-bucket --bucket "$EXPORTS_BUCKET" 2>/dev/null || s3 create-bucket --bucket "$EXPORTS_BUCKET"
s3 put-bucket-lifecycle-configuration --bucket "$EXPORTS_BUCKET" --lifecycle-configuration \n  '{"Rules":[{"ID":"expire-exports","Status":"Enabled","Filter":{"Prefix":""},"Expiration":{"Days":8}}]}' || echo "lifecycle no soportado: la retención la aplica el job identity.export-retention" >&2
EOF
echo "bucket ${bucket} listo (versioning + CORS para ${origin}); bucket de exports ${exports_bucket} listo"
