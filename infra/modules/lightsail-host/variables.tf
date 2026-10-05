variable "name" {
  description = "Nombre de la instancia Lightsail (p. ej. pfos-prod-host)."
  type        = string
}

variable "availability_zone" {
  description = "Zona de disponibilidad (São Paulo: sa-east-1a)."
  type        = string
  default     = "sa-east-1a"
}

variable "bundle_id" {
  description = "Plan Lightsail. small_3_0 = 2 GB / 2 vCPU burst / 60 GB (USD 12/mes con IPv4, 2026-10). Subir a medium_3_0 (4 GB, USD 24) sin rediseño. Verificar ids con `aws lightsail get-bundles --region sa-east-1`."
  type        = string
  default     = "small_3_0"
}

variable "blueprint_id" {
  description = "Imagen del SO (Ubuntu LTS)."
  type        = string
  default     = "ubuntu_24_04"
}

variable "deploy_ssh_public_key" {
  description = "Clave PÚBLICA ed25519 del job de deploy (GitHub Actions). Solo puede ejecutar el comando forzado pfos-deploy. No es un secreto."
  type        = string

  validation {
    condition     = can(regex("^ssh-ed25519 [A-Za-z0-9+/=]+( .*)?$", var.deploy_ssh_public_key))
    error_message = "Debe ser una clave pública ssh-ed25519."
  }
}

variable "repo_url" {
  description = "Repositorio público del que el host obtiene compose/scripts en el commit desplegado."
  type        = string
  default     = "https://github.com/manuXD270516/personal-finances.git"
}

variable "swap_size_mb" {
  description = "Swap del host (MiB). 2 GiB en el plan de 2 GB (SPIKE-09 §3, ADR-0027)."
  type        = number
  default     = 2048
}

variable "auto_snapshot_time_utc" {
  description = "Hora (UTC, HH:00) del snapshot automático diario de Lightsail (retiene 7). 06:00 UTC = 02:00 La Paz."
  type        = string
  default     = "06:00"
}

variable "tags" {
  description = "Tags comunes (docs/22 §5)."
  type        = map(string)
  default     = {}
}
