output "instance_name" {
  description = "Nombre de la instancia."
  value       = aws_lightsail_instance.host.name
}

output "public_ip" {
  description = "IPv4 estática (registro A de los dos hostnames en el DNS)."
  value       = aws_lightsail_static_ip.host.ip_address
}

output "ipv6_addresses" {
  description = "IPv6 de la instancia (registros AAAA opcionales)."
  value       = aws_lightsail_instance.host.ipv6_addresses
}
