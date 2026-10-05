terraform {
  required_version = ">= 1.10"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.67"
    }
    b2 = {
      source  = "Backblaze/b2"
      version = "~> 0.14"
    }
  }

  # Cifrado del state y de los planes del lado del cliente (OpenTofu ≥ 1.7): el state contiene el secreto de la
  # clave B2 del host. La passphrase (≥ 16 caracteres) vive solo en el gestor de contraseñas del owner y se pasa
  # con TF_VAR_state_passphrase. `enforced = true`: nunca se escribe state en claro.
  encryption {
    key_provider "pbkdf2" "owner" {
      passphrase = var.state_passphrase
    }

    method "aes_gcm" "owner" {
      keys = key_provider.pbkdf2.owner
    }

    state {
      method   = method.aes_gcm.owner
      enforced = true
    }

    plan {
      method   = method.aes_gcm.owner
      enforced = true
    }
  }
}
