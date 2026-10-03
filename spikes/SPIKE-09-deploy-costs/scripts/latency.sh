#!/usr/bin/env bash
# SPIKE-09 — RTT aproximado desde la conexión del owner a endpoints públicos de cada región candidata.
# Mide el handshake TCP (time_connect - time_namelookup) por IPv4, 7 intentos, reporta el mínimo y la mediana.
# Uso: bash scripts/latency.sh > results/latency-$(date -u +%F).txt
# Nota: los endpoints *.googleapis.com terminan en el edge de Google (anycast) y NO representan la región.
set -u
HOSTS="
aws-sa-east-1|ec2.sa-east-1.amazonaws.com
aws-us-east-1|ec2.us-east-1.amazonaws.com
oci-sa-saopaulo-1|objectstorage.sa-saopaulo-1.oraclecloud.com
oci-sa-santiago-1|objectstorage.sa-santiago-1.oraclecloud.com
oci-us-ashburn-1|objectstorage.us-ashburn-1.oraclecloud.com
vultr-sao-paulo|sao-br-ping.vultr.com
vultr-santiago|scl-cl-ping.vultr.com
vultr-new-jersey|nj-us-ping.vultr.com
hetzner-ashburn|ash-speed.hetzner.com
hetzner-falkenstein|fsn1-speed.hetzner.com
hetzner-helsinki|hel1-speed.hetzner.com
gcp-edge(southamerica-east1)|southamerica-east1-run.googleapis.com
"
echo "# SPIKE-09 latency — $(date -u +%FT%TZ) — TCP handshake RTT (ms), IPv4, 7 intentos"
printf '%-30s %-48s %6s %6s\n' region host min med
for line in $HOSTS; do
  name="${line%%|*}"; host="${line##*|}"
  samples=()
  for _ in 1 2 3 4 5 6 7; do
    t=$(curl -4 -s -o /dev/null -m 5 -w '%{time_namelookup} %{time_connect}' "https://$host/" 2>/dev/null)
    ms=$(echo "$t" | awk '{ d=($2-$1)*1000; if (d>0) printf "%d", d }')
    [ -n "$ms" ] && samples+=("$ms")
  done
  if [ ${#samples[@]} -eq 0 ]; then printf '%-30s %-48s %6s %6s\n' "$name" "$host" "-" "-"; continue; fi
  sorted=$(printf '%s\n' "${samples[@]}" | sort -n)
  min=$(echo "$sorted" | head -1); med=$(echo "$sorted" | sed -n "$(( (${#samples[@]} + 1) / 2 ))p")
  printf '%-30s %-48s %6s %6s\n' "$name" "$host" "$min" "$med"
done
