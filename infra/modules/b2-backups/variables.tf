variable "bucket_name" {
  description = "Nombre GLOBAL del bucket B2 principal (repo1 + documentos; único en Backblaze), p. ej. pfos-prod-backups-<sufijo>. El de mensuales se llama \"<bucket_name>-monthly\"."
  type        = string
}

variable "object_lock_days" {
  description = "Retención por defecto de Object Lock (modo governance). ≥ PITR (14 d, docs/30 §4) + margen."
  type        = number
  default     = 21
}

variable "monthly_object_lock_days" {
  description = "Retención por defecto de Object Lock (governance) del bucket de mensuales (repo2). ≥ 395 d (13 meses) para cubrir los 12 mensuales de pgBackRest; IRREVERSIBLE: el lock no se puede desactivar en el bucket (D455)."
  type        = number
  default     = 395

  validation {
    condition     = var.monthly_object_lock_days >= 395
    error_message = "monthly_object_lock_days debe ser >= 395 (13 meses) para cubrir la retención de 12 mensuales."
  }
}

variable "documents_noncurrent_days" {
  description = "Días que se conservan las versiones ocultas/antiguas de la réplica de documentos (docs/30 §5: 365)."
  type        = number
  default     = 365
}
