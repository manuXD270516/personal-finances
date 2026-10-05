# Destino de backups fuera del host (ADR-0027, docs/30 §4.1, SPIKE-09 §5.7/§10): Backblaze B2 con versioning (siempre
# activo en B2), cifrado SSE-B2 + cifrado de cliente de pgBackRest, y Object Lock governance como protección ante
# compromiso del host: la clave del host NO tiene `bypassGovernance` ni permisos para cambiar retenciones.
#   pgbackrest/pitr/     repo1 (PITR 14 d)        → versiones ocultas se purgan al día siguiente de vencer el lock
#   pgbackrest/monthly/  repo2 (12 mensuales)
#   documents/           réplica nocturna de SeaweedFS (versiones previas 365 d)

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

# Clave del host: lectura/escritura/listado y "borrar" (pgBackRest expira backups → en un bucket versionado eso oculta
# el archivo; la versión bloqueada no se puede eliminar hasta que vence el lock). Sin bypassGovernance,
# writeFileRetentions, writeFileLegalHolds ni writeBucketRetentions.
resource "b2_application_key" "host" {
  key_name  = "${var.bucket_name}-host"
  bucket_id = b2_bucket.backups.bucket_id
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
  key_name  = "${var.bucket_name}-restore"
  bucket_id = b2_bucket.backups.bucket_id
  capabilities = [
    "listBuckets",
    "listFiles",
    "readFiles",
  ]
}
