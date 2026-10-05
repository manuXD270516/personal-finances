variable "bucket_name" {
  description = "Nombre GLOBAL del bucket B2 (único en Backblaze), p. ej. pfos-prod-backups-<sufijo>."
  type        = string
}

variable "object_lock_days" {
  description = "Retención por defecto de Object Lock (modo governance). ≥ PITR (14 d, docs/30 §4) + margen."
  type        = number
  default     = 21
}

variable "documents_noncurrent_days" {
  description = "Días que se conservan las versiones ocultas/antiguas de la réplica de documentos (docs/30 §5: 365)."
  type        = number
  default     = 365
}
