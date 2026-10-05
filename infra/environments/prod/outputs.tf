output "host_public_ip" {
  description = "IPv4 estática: registros A de PF_DOMAIN_APP y PF_DOMAIN_AUTH."
  value       = module.host.public_ip
}

output "host_ipv6_addresses" {
  description = "IPv6 de la instancia (registros AAAA opcionales)."
  value       = module.host.ipv6_addresses
}

output "b2_bucket_name" {
  description = "PGBACKREST_REPO{1,2}_S3_BUCKET."
  value       = module.backups.bucket_name
}

output "b2_host_key_id" {
  description = "PGBACKREST_REPO{1,2}_S3_KEY."
  value       = module.backups.host_key_id
}

output "b2_host_key_secret" {
  description = "PGBACKREST_REPO{1,2}_S3_KEY_SECRET (tofu output -raw b2_host_key_secret)."
  value       = module.backups.host_key_secret
  sensitive   = true
}

output "b2_restore_key_id" {
  description = "Clave B2 de solo lectura (restore drill / host nuevo)."
  value       = module.backups.restore_key_id
}

output "b2_restore_key_secret" {
  description = "Secreto de la clave B2 de solo lectura (tofu output -raw b2_restore_key_secret)."
  value       = module.backups.restore_key_secret
  sensitive   = true
}

output "drill_host_public_ip" {
  description = "IPv4 de la VM de drill (null si drill_enabled = false)."
  value       = try(module.drill_host[0].public_ip, null)
}
