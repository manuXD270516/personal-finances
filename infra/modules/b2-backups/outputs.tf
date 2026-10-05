output "bucket_name" {
  description = "Bucket B2 (PGBACKREST_REPO{1,2}_S3_BUCKET)."
  value       = b2_bucket.backups.bucket_name
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
