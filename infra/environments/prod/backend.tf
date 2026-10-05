# State remoto en S3 (docs/22 §4) con lockfile nativo de S3 (sin DynamoDB). Configuración parcial: bucket y región
# se pasan en `tofu init -backend-config=backend.hcl` (archivo local, fuera del repo; ver backend.hcl.example).
# Validación sin credenciales: `tofu init -backend=false && tofu validate`.
terraform {
  backend "s3" {
    key          = "pfos/prod/terraform.tfstate"
    encrypt      = true
    use_lockfile = true
  }
}
