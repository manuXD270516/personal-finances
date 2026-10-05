# Producción N1 (ADR-0027): Lightsail 2 GB en São Paulo + backups en Backblaze B2 + AWS Budgets.
# Credenciales: AWS por IAM Identity Center (`aws sso login`, perfil en AWS_PROFILE) y B2 por B2_APPLICATION_KEY_ID /
# B2_APPLICATION_KEY de una clave "master" de corta vida que el owner crea y borra tras el apply (runbook §2.2).
# Nada de esto corre en CI.

locals {
  tags = {
    project     = "pfos"
    environment = "prod"
    managed-by  = "opentofu"
  }
}

provider "aws" {
  region = var.aws_region

  default_tags {
    tags = local.tags
  }
}

provider "b2" {}

module "host" {
  source = "../../modules/lightsail-host"

  name                  = "pfos-prod-host"
  availability_zone     = "${var.aws_region}a"
  bundle_id             = var.lightsail_bundle_id
  deploy_ssh_public_key = var.deploy_ssh_public_key
  tags                  = local.tags
}

module "backups" {
  source = "../../modules/b2-backups"

  bucket_name = var.b2_bucket_name
}

# Alerta temprana de costo (SPIKE-09 §12): 80 % real y 100 % pronosticado del límite mensual.
resource "aws_budgets_budget" "monthly" {
  name         = "pfos-prod-monthly"
  budget_type  = "COST"
  limit_amount = var.budget_limit_usd
  limit_unit   = "USD"
  time_unit    = "MONTHLY"

  notification {
    comparison_operator        = "GREATER_THAN"
    threshold                  = 80
    threshold_type             = "PERCENTAGE"
    notification_type          = "ACTUAL"
    subscriber_email_addresses = [var.budget_alert_email]
  }

  notification {
    comparison_operator        = "GREATER_THAN"
    threshold                  = 100
    threshold_type             = "PERCENTAGE"
    notification_type          = "FORECASTED"
    subscriber_email_addresses = [var.budget_alert_email]
  }
}

# VM efímera del restore drill mensual (docs/30 §8, runbook §6): mismo módulo y plan, otro nombre, vida < 2 h.
module "drill_host" {
  count  = var.drill_enabled ? 1 : 0
  source = "../../modules/lightsail-host"

  name                  = "pfos-drill-host"
  availability_zone     = "${var.aws_region}a"
  bundle_id             = var.lightsail_bundle_id
  deploy_ssh_public_key = var.deploy_ssh_public_key
  tags                  = merge(local.tags, { environment = "drill" })
}
