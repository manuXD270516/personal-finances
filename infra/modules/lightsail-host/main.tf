# Host único de producción N1 (ADR-0027): Lightsail + Docker Compose. Sin `apply` desde CI: el owner ejecuta
# `tofu plan/apply` localmente con credenciales de corta duración (IAM Identity Center), docs/runbooks §2.

locals {
  cloud_init = templatefile("${path.module}/cloud-init.yaml.tftpl", {
    deploy_ssh_public_key = var.deploy_ssh_public_key
    repo_url              = var.repo_url
    swap_size_mb          = var.swap_size_mb
  })
}

resource "aws_lightsail_instance" "host" {
  name              = var.name
  availability_zone = var.availability_zone
  blueprint_id      = var.blueprint_id
  bundle_id         = var.bundle_id
  ip_address_type   = "dualstack"
  # Cambiar cloud-init REEMPLAZA la instancia (plan lo muestra): el estado vive en volúmenes que se restauran
  # desde B2 (runbook §5); por eso la lógica que cambia seguido vive en el repo (deploy/host), no aquí.
  user_data = local.cloud_init

  add_on {
    type          = "AutoSnapshot"
    snapshot_time = var.auto_snapshot_time_utc
    status        = "Enabled"
  }

  tags = var.tags
}

resource "aws_lightsail_static_ip" "host" {
  name = "${var.name}-ip"
}

resource "aws_lightsail_static_ip_attachment" "host" {
  static_ip_name = aws_lightsail_static_ip.host.name
  instance_name  = aws_lightsail_instance.host.name
}

# Firewall del proveedor (SPIKE-09 §11): solo 80/443 públicos. SSH (22) solo desde la consola web de Lightsail
# (alias `lightsail-connect`, break-glass); el acceso normal y el deploy van por Tailscale (tailscale0).
resource "aws_lightsail_instance_public_ports" "host" {
  instance_name = aws_lightsail_instance.host.name

  port_info {
    protocol   = "tcp"
    from_port  = 80
    to_port    = 80
    cidrs      = ["0.0.0.0/0"]
    ipv6_cidrs = ["::/0"]
  }

  port_info {
    protocol   = "tcp"
    from_port  = 443
    to_port    = 443
    cidrs      = ["0.0.0.0/0"]
    ipv6_cidrs = ["::/0"]
  }

  port_info {
    protocol   = "udp"
    from_port  = 443
    to_port    = 443
    cidrs      = ["0.0.0.0/0"]
    ipv6_cidrs = ["::/0"]
  }

  port_info {
    protocol          = "tcp"
    from_port         = 22
    to_port           = 22
    cidr_list_aliases = ["lightsail-connect"]
  }
}
