# Destino de backups fuera del host (ADR-0027, docs/30 §4.1, SPIKE-09 §5.7/§10): Backblaze B2 con versioning (siempre
# activo en B2), cifrado SSE-B2 + cifrado de cliente de pgBackRest, y Object Lock governance como protección ante
# compromiso del host: la clave del host NO tiene `bypassGovernance` ni permisos para cambiar retenciones.
#   bucket `backups` (lock 21 d):
#     pgbackrest/pitr/   repo1 (PITR 14 d)        → versiones ocultas se purgan al día siguiente de vencer el lock
#     documents/         réplica nocturna de SeaweedFS (versiones previas 365 d)
#   bucket `monthly` (lock 395 d, D455): pgbackrest/monthly/ = repo2 (12 mensuales). Segundo bucket porque el lock por
#     omisión es POR BUCKET: con un solo bucket de 21 d, un host comprometido podía borrar los mensuales pasados 21 días.
#
# IRREVERSIBLE: Object Lock no se puede desactivar en un bucket que lo tiene (`is_file_lock_enabled` fuerza recrear el
# recurso, y un bucket con versiones bloqueadas no se puede vaciar ni borrar hasta que venzan los locks). Cambiar los
# días de retención por omisión solo afecta a los objetos nuevos.

resource "b2_bucket" "backups" {
  bucket_name = var.bucket_name
  bucket_type = "allPrivate"

  default_server_side_encryption {
    mode      = "SSE-B2"
    algorithm = "AES256"
  }

  file_lock_configuration {
    is_file_lock_enabled = true

    default_retention {
      mode = "governance"

      period {
        duration = var.object_lock_days
        unit     = "days"
      }
    }
  }

  lifecycle_rules {
    file_name_prefix             = "pgbackrest/"
    days_from_hiding_to_deleting = 1
  }

  lifecycle_rules {
    file_name_prefix             = "documents/"
    days_from_hiding_to_deleting = var.documents_noncurrent_days
  }
}

# Mensuales (repo2). Mismo cifrado SSE-B2; lock governance de ≥ 395 días (13 meses > los 12 mensuales de pgBackRest
# `repo2-retention-full=12`). `expire` de pgBackRest "borra" → en un bucket versionado eso oculta el archivo; el
# lifecycle destruye la versión oculta 1 día después, pero B2 no destruye una versión mientras dure su lock, así que
# queda en pie hasta ~13 meses desde que se escribió aunque la clave del host pida borrarla.
resource "b2_bucket" "monthly" {
  bucket_name = "${var.bucket_name}-monthly"
  bucket_type = "allPrivate"

  default_server_side_encryption {
    mode      = "SSE-B2"
    algorithm = "AES256"
  }

  file_lock_configuration {
    is_file_lock_enabled = true

    default_retention {
      mode = "governance"

      period {
        duration = var.monthly_object_lock_days
        unit     = "days"
      }
    }
  }

  lifecycle_rules {
    file_name_prefix             = "pgbackrest/"
    days_from_hiding_to_deleting = 1
  }
}

# Clave del host: lectura/escritura/listado y "borrar" (pgBackRest expira backups → en un bucket versionado eso oculta
# el archivo; la versión bloqueada no se puede eliminar hasta que vence el lock). Sin bypassGovernance,
# writeFileRetentions, writeFileLegalHolds ni writeBucketRetentions. Una sola clave para los dos buckets (`bucket_ids`).
resource "b2_application_key" "host" {
  key_name   = "${var.bucket_name}-host"
  bucket_ids = [b2_bucket.backups.bucket_id, b2_bucket.monthly.bucket_id]
  capabilities = [
    "listBuckets",
    "listFiles",
    "readFiles",
    "writeFiles",
    "deleteFiles",
  ]
}

# Clave de SOLO LECTURA para el restore drill mensual (VM efímera) y para restaurar en un host nuevo antes de
# entregarle la clave de escritura: un host de drill comprometido no puede alterar los backups.
resource "b2_application_key" "restore" {
  key_name   = "${var.bucket_name}-restore"
  bucket_ids = [b2_bucket.backups.bucket_id, b2_bucket.monthly.bucket_id]
  capabilities = [
    "listBuckets",
    "listFiles",
    "readFiles",
  ]
}
