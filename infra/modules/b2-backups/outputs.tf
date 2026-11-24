output "bucket_name" {
  description = "Bucket B2 principal: repo1 y réplica de documentos (PGBACKREST_REPO1_S3_BUCKET)."
  value       = b2_bucket.backups.bucket_name
}

output "monthly_bucket_name" {
  description = "Bucket B2 de mensuales con Object Lock de 395 d (PGBACKREST_REPO2_S3_BUCKET)."
  value       = b2_bucket.monthly.bucket_name
}

output "host_key_id" {
  description = "Key id de la clave del host (PGBACKREST_REPO{1,2}_S3_KEY)."
  value       = b2_application_key.host.application_key_id
}

output "host_key_secret" {
  description = "Secreto de la clave del host (PGBACKREST_REPO{1,2}_S3_KEY_SECRET). Se copia al host y no se guarda en otro lugar."
  value       = b2_application_key.host.application_key
  sensitive   = true
}

output "restore_key_id" {
  description = "Key id de la clave de solo lectura (restore drill)."
  value       = b2_application_key.restore.application_key_id
}

output "restore_key_secret" {
  description = "Secreto de la clave de solo lectura (restore drill)."
  value       = b2_application_key.restore.application_key
  sensitive   = true
}
