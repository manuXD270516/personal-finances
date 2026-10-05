variable "state_passphrase" {
  description = "Passphrase del cifrado de state/plan de OpenTofu (TF_VAR_state_passphrase; nunca en archivos)."
  type        = string
  sensitive   = true

  validation {
    condition     = length(var.state_passphrase) >= 16
    error_message = "La passphrase debe tener al menos 16 caracteres."
  }
}

variable "aws_region" {
  description = "Región AWS del host (São Paulo, ADR-0027)."
  type        = string
  default     = "sa-east-1"
}

variable "lightsail_bundle_id" {
  description = "Plan Lightsail (small_3_0 = 2 GB, USD 12/mes; medium_3_0 = 4 GB, USD 24/mes)."
  type        = string
  default     = "small_3_0"
}

variable "deploy_ssh_public_key" {
  description = "Clave pública ssh-ed25519 del job de deploy (su privada va solo al secreto DEPLOY_SSH_KEY del environment production)."
  type        = string
}

variable "b2_bucket_name" {
  description = "Nombre global del bucket B2 de backups."
  type        = string
}

variable "budget_limit_usd" {
  description = "Límite mensual de AWS Budgets (presupuesto del owner 2026-10-05: USD 10–20)."
  type        = string
  default     = "20"
}

variable "budget_alert_email" {
  description = "Email que recibe las alertas de AWS Budgets."
  type        = string
}

variable "drill_enabled" {
  description = "true crea la VM efímera del restore drill mensual (runbook §6); false la destruye. ≈ USD 0.02/h."
  type        = bool
  default     = false
}
