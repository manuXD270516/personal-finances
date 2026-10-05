# Runbook — Despliegue, rollback y restauración (producción N1)

> **Estado:** Vigente desde 2026-10-05 · **Decisión:** [ADR-0027](../adr/0027-destino-de-despliegue-inicial-vps-compose.md) (AWS Lightsail 2 GB, São Paulo, Docker Compose) · **Relacionado:** [SPIKE-09](../../spikes/SPIKE-09-deploy-costs/README.md) §16–§17 · [docs/30](../30-backup-and-disaster-recovery.md) (RPO/RTO, retenciones, drills) · [docs/22](../22-infrastructure.md) §14 · [docs/23](../23-ci-cd.md) · [config-reference](../config-reference.md)
>
> Nada de este runbook lo ejecuta CI por su cuenta: la infraestructura la aplica el owner desde su máquina y cada deploy necesita su aprobación en GitHub.

## 0. Piezas

| Pieza | Dónde | Qué hace |
|---|---|---|
| IaC | [`infra/`](../../infra) (OpenTofu ≥ 1.10) | `modules/lightsail-host` (instancia, IP estática, firewall 80/443 + 22 solo consola, snapshots diarios, cloud-init), `modules/b2-backups` (bucket con Object Lock + claves), `environments/prod` (composición, AWS Budgets, VM de drill opcional). State en S3 **cifrado del lado cliente** |
| Host | cloud-init del módulo | Ubuntu 24.04, Docker + Compose, Tailscale, ufw, `unattended-upgrades` con reinicio 04:30 La Paz, swap 2 GiB, usuario `pfos-deploy` con **comando forzado** (`/usr/local/sbin/pfos-deploy`) |
| Runtime | [`deploy/compose/compose.prod.yaml`](../../deploy/compose/compose.prod.yaml) sobre `compose.yaml` | Mismas imágenes por digest y mismo contrato de configuración que el modo B local; Caddy (TLS) único con puertos públicos |
| Secretos | `/etc/pfos/pfos.env`, `/etc/pfos/pgbackrest.env` (root, 0600) | Plantillas sin secretos en [`deploy/host/etc-pfos/`](../../deploy/host/etc-pfos) |
| Deploy | [`.github/workflows/deploy.yml`](../../.github/workflows/deploy.yml) → [`deploy/host/pfos-deploy.sh`](../../deploy/host/pfos-deploy.sh) | `workflow_dispatch` + environment `production` (aprobación) → SSH por Tailscale → pull por digest, backup pre-migración, `up --wait`, smoke, rollback automático si falla |
| Backups | [`deploy/host/pfos-backup.sh`](../../deploy/host/pfos-backup.sh) + timers [`deploy/host/systemd/`](../../deploy/host/systemd) | pgBackRest ([`deploy/pgbackrest/pgbackrest.conf`](../../deploy/pgbackrest/pgbackrest.conf)) → B2: full semanal + diff diario + WAL continuo (PITR 14 d), full mensual (12), réplica nocturna de documentos, check horario |

Presupuesto de memoria (2 GB + 2 GiB swap; techos en `compose.prod.yaml`): Keycloak ≈ 550 MiB (techo 704m), PostgreSQL 150–250 (384m), api 160–340 (320m), worker ≈ 200 (288m), web 150–250 (288m), SeaweedFS 60–110 (192m), Caddy ≈ 30 (64m) → **≈ 1.4–1.7 GiB estables** (SPIKE-09 §3 y §17). Sin Grafana Alloy: la app exporta OTLP directo a Grafana Cloud.

## 1. Señales para salir del plan de 2 GB

- `docker stats` / Grafana: memoria del host > 85 % sostenida, swap-in continuo o cualquier `OOMKilled` (`docker inspect -f '{{.State.OOMKilled}}'`).
- Primer login > 10 s de forma habitual (Keycloak paginando).

Acción: `lightsail_bundle_id = "medium_3_0"` (4 GB, USD 24 → total ≈ USD 27, fuera del presupuesto actual: requiere OK del owner) **o** fallback Oracle A1 (ADR-0027). Cambiar el plan reemplaza la VM: restaurar según §5.2.

## 2. Primer despliegue (una sola vez)

### 2.1 Cuentas y prerequisitos (owner)

1. **AWS**: cuenta nueva; root con MFA y sin access keys; IAM Identity Center con un usuario del owner (MFA); región `sa-east-1`. Bucket de state a mano: `aws s3api create-bucket --bucket pfos-tfstate-<sufijo> --region sa-east-1 --create-bucket-configuration LocationConstraint=sa-east-1`, luego `put-bucket-versioning Status=Enabled` y `put-public-access-block` (todo en `true`).
2. **Backblaze B2**: cuenta (elegir región de datos; el endpoint queda como `s3.<región>.backblazeb2.com`). Crear una application key **temporal** con `writeBuckets`, `writeKeys`, `listBuckets`, `listKeys`, `deleteKeys` y vencimiento de 1 día solo para el `tofu apply`.
3. **Tailscale** (plan Personal, gratis): política de acceso mínima:
   ```json
   {
     "tagOwners": { "tag:pfos-prod": ["autogroup:admin"], "tag:pfos-ci": ["autogroup:admin"] },
     "grants": [
       { "src": ["autogroup:admin"], "dst": ["tag:pfos-prod"], "ip": ["tcp:22"] },
       { "src": ["tag:pfos-ci"], "dst": ["tag:pfos-prod"], "ip": ["tcp:22"] }
     ]
   }
   ```
   Y una credencial de **federación OIDC** para GitHub Actions (consola de Tailscale, credenciales de identidad federada; verificar el nombre exacto del menú; issuer `https://token.actions.githubusercontent.com`, subject `repo:manuXD270516/personal-finances:environment:production`, tag `tag:pfos-ci`). Anotar client id y audience.
4. **Grafana Cloud Free**: stack (región `sa-east-1` si está disponible), token de **solo escritura** OTLP → `PF_OTLP_ENDPOINT` y `OTEL_EXPORTER_OTLP_HEADERS`.
5. **Dominio + DNS** (p. ej. Cloudflare, DNS gratis): dos nombres, `app.<dominio>` y `auth.<dominio>`. Registros **solo DNS** (sin proxy) para que Caddy obtenga los certificados.
6. **GHCR**: marcar públicos los paquetes `finance-api`, `finance-web` y `pfos-postgres` (el repo ya es público; las imágenes no contienen secretos) **o** dejar en el host un `docker login ghcr.io` con un token `read:packages` de vida limitada.
7. Opcional: cuenta en healthchecks.io (gratis) → URL de ping para `PF_BACKUP_HEARTBEAT_URL`.

### 2.2 Infraestructura (OpenTofu, desde la máquina del owner)

```bash
ssh-keygen -t ed25519 -N '' -C pfos-deploy@github-actions -f ~/.ssh/pfos-deploy   # clave SOLO para el deploy
cd infra/environments/prod
cp backend.hcl.example backend.hcl && cp prod.tfvars.example prod.tfvars          # completar (no se versionan)
export AWS_PROFILE=pfos-admin && aws sso login
export B2_APPLICATION_KEY_ID=… B2_APPLICATION_KEY=…                               # clave temporal de 2.1.2
read -rs TF_VAR_state_passphrase && export TF_VAR_state_passphrase                 # ≥ 16 car., guardada en el gestor
tofu init -backend-config=backend.hcl
tofu plan -var-file=prod.tfvars -out=prod.tfplan && tofu apply prod.tfplan
tofu output                                                                        # IP, bucket, key ids
```

Después: borrar la clave temporal de B2; crear los registros A (y AAAA opcionales) de `app` y `auth` con `host_public_ip`.

### 2.3 Secretos del host

Desde la **consola web de Lightsail** (SSH del navegador, break-glass) como `ubuntu`:

```bash
sudo -i
cd /etc/pfos
cp /opt/pfos/repo/deploy/host/etc-pfos/pfos.env.example pfos.env
cp /opt/pfos/repo/deploy/host/etc-pfos/pgbackrest.env.example pgbackrest.env
chmod 600 pfos.env pgbackrest.env
while grep -q '__generate__' pfos.env; do sed -i "0,/__generate__/s//$(openssl rand -hex 32)/" pfos.env; done
openssl rand -base64 48   # dos veces: PGBACKREST_REPO1_CIPHER_PASS y PGBACKREST_REPO2_CIPHER_PASS
editor pfos.env pgbackrest.env   # completar cada __set__ (dominios, email ACME, OTLP, B2: tofu output)
```

Guardar una copia **cifrada** de ambos archivos (p. ej. `age -p`) en el gestor de contraseñas del owner: sin las passphrases de pgBackRest los backups son irrecuperables, y sin `pfos.env` hay que rotar todas las credenciales.

### 2.4 Tailscale en el host

En la misma consola: `tailscale up --hostname=pfos-prod --advertise-tags=tag:pfos-prod` y abrir la URL de autorización. Desde la máquina del owner verificar `ssh ubuntu@pfos-prod` (por la tailnet) y registrar la host key para CI:

```bash
ssh-keyscan -t ed25519 pfos-prod > known_hosts.pfos     # comparar la huella con: ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub (en el host)
```

### 2.5 GitHub

Settings → Environments → `production`: **required reviewers** = owner, *prevent self-review* desactivado (proyecto de una persona), deployment branches = `main`. Secrets: `DEPLOY_SSH_KEY` (contenido de `~/.ssh/pfos-deploy`), `DEPLOY_SSH_KNOWN_HOSTS` (contenido de `known_hosts.pfos`). Variables: `DEPLOY_HOST=pfos-prod`, `PFOS_APP_URL=https://app.<dominio>`, `TS_OIDC_CLIENT_ID`, `TS_OIDC_AUDIENCE`. Borrar la clave privada local cuando quede cargada (si se pierde, se genera otra y se re-aplica OpenTofu: cambia el cloud-init → ver §5.2).

### 2.6 Primer deploy

1. Actions → **deploy** → `action=deploy`, `commit_sha=<SHA de main con main.yml en verde>` → aprobar.
2. En el host (`ssh ubuntu@pfos-prod`, `sudo -i`): `bash /opt/pfos/repo/deploy/host/pfos-bootstrap-storage.sh` (bucket de documentos con versioning y CORS) y primer backup completo: `systemctl start pfos-backup@full.service && journalctl -u pfos-backup@full -n 20`.
3. **Keycloak**: túnel `ssh -L 28081:127.0.0.1:28081 ubuntu@pfos-prod` → `http://localhost:28081/admin` con `pfos-admin` / `PF_DEV_KEYCLOAK_ADMIN_PASSWORD`. Crear un admin permanente en `master` con OTP y **borrar** `pfos-admin`; en el realm `pfos`, crear el usuario del owner (contraseña temporal + *Configure OTP* como acción requerida). El realm de prod no trae usuarios demo.
4. Grafana Cloud: check sintético HTTP cada 5 min a `https://app.<dominio>/api/health/ready` y a `https://auth.<dominio>/realms/pfos/.well-known/openid-configuration`, con alerta por email.

## 3. Deploys siguientes

Actions → **deploy** → `deploy` + SHA → aprobar. El job:

1. Verifica que el SHA esté en `main` y tenga una corrida **exitosa** de `main.yml` (incluye `verify-by-digest`), y toma sus digests (`finance-api`, `finance-web`, `pfos-postgres`).
2. Entra a la tailnet con un nodo efímero `tag:pfos-ci` (OIDC, sin auth key guardada) y ejecuta `pfos-deploy deploy <sha> <refs>` por SSH. El host acepta solo ese comando forzado.
3. En el host: checkout del SHA (de `main`), `docker pull` por digest + verificación de `org.opencontainers.image.revision`, instala/actualiza los timers, **backup incremental pre-migración** (anotado con el SHA; si falla, aborta sin tocar nada), `compose up -d --wait` (corre `migrate`; si falla, api/worker siguen en N-1), smoke por Caddy/TLS, `pgbackrest check`, registra el release en `/var/lib/pfos/releases.log`.
4. Si `up` o el smoke fallan: imprime logs y **vuelve solo** al último release exitoso; el job termina en rojo.

Estado: Actions → `deploy` con `action=status` (o `sudo /usr/local/sbin/pfos-deploy status` en el host).

## 4. Rollback por digest

- Actions → **deploy** → `action=rollback` → aprobar. Vuelve al release exitoso anterior (mismo commit y mismos digests de entonces) y lo registra como release nuevo (un segundo rollback deshace el primero).
- Sin GitHub: `ssh ubuntu@pfos-prod 'sudo /usr/local/sbin/pfos-deploy rollback'`.
- **Migraciones:** no se revierten. El rollback de app es seguro solo si las migraciones del release fallido son compatibles hacia atrás (expand/contract, docs/23). Si no lo son: restaurar al backup `pre-migrate` del release (§5.1 con el `--set` del backup anotado o el timestamp previo al deploy).

## 5. Restauración

Reglas de docs/30 §7: capturar evidencia antes de tocar nada, reparación selectiva con reversals (nunca `UPDATE` de postings), registrar horas en el issue del incidente.

```bash
# en el host, como root
cd /opt/pfos/repo/deploy/compose
C="docker compose -f compose.yaml -f compose.prod.yaml --env-file /etc/pfos/pfos.env --env-file /var/lib/pfos/release.env --profile core"
$C exec -T postgres pgbackrest --stanza=pfos info                 # backups y rango de WAL disponibles
```

### 5.1 Borrado o corrupción lógica (PITR en el mismo host)

1. Congelar escrituras: `$C stop caddy finance-web finance-api finance-worker`.
2. Evidencia: `$C exec -T postgres pgbackrest --stanza=pfos --repo=1 --type=incr --annotation=reason=pre-restore backup`.
3. Elegir T (UTC) previo al daño (audit log, logs de Grafana).
4. Restaurar:
   ```bash
   $C stop keycloak postgres
   $C run --rm --no-deps --entrypoint pgbackrest postgres --stanza=pfos --repo=1 --delta \
     --type=time --target='2026-10-05 13:45:00+00' --target-action=promote restore
   $C up -d --wait --wait-timeout 420
   ```
   Para volver al backup pre-migración de un release: `--type=immediate --set=<label de pgbackrest info con reason=pre-migrate>`.
5. Verificar (§6 paso 4) y abrir Caddy. Si hace falta reparación selectiva en vez de volver todo atrás: restaurar en la VM de drill (§6) y extraer desde allí las filas afectadas.

Validado localmente el 2026-10-05 con la imagen `pfos-postgres` y esta misma configuración (repos `posix`): `stanza-create`, `archive-push` asíncrono, full en repo1 y repo2 y restore `--type=time` que recupera exactamente las filas anteriores a T.

### 5.2 Pérdida del host (o cambio de plan/proveedor)

1. Rápido (RPO ≤ 24 h): crear una instancia desde el último **snapshot automático** de Lightsail y luego aplicar PITR hasta el último WAL (§5.1 con `--type=default`).
2. Desde cero (RPO ≤ 5 min): `tofu apply -replace=module.host.aws_lightsail_instance.host …` (o el host nuevo del fallback), §2.3–§2.4 restaurando `pfos.env`/`pgbackrest.env` desde la copia cifrada del gestor, y **antes del primer deploy**:
   ```bash
   docker volume create pfos_pg-data
   $C run --rm --no-deps --entrypoint pgbackrest postgres --stanza=pfos --repo=1 restore   # tras escribir release.env a mano (digests del último release)
   ```
   Luego deploy normal (§3) y réplica de documentos inversa (`rclone sync dst:<bucket>/documents/pfos-prod-documents src:pfos-prod-documents`, mismo contenedor que `pfos-backup.sh docs-replica`).
3. DNS: mismos registros A apuntando a la nueva IP estática.

## 6. Restore drill mensual (primer lunes de cada mes)

Objetivo docs/30 §8: integridad OK y **RTO observado < 1 h**, en una VM efímera aislada con clave B2 de **solo lectura**.

1. `tofu apply -var-file=prod.tfvars -var drill_enabled=true` → VM `pfos-drill-host` (≈ USD 0.02/h). Anotar hora de inicio.
2. Consola web de Lightsail en la VM de drill: `sudo -i`, crear `/etc/pfos/pgbackrest.env` con `PGBACKREST_REPO{1,2}_S3_KEY{,_SECRET}` = `tofu output b2_restore_key_id` / `-raw b2_restore_key_secret` y las mismas passphrases.
3. Restaurar el último punto y arrancar sin archivado:
   ```bash
   IMG=ghcr.io/manuxd270516/pfos-postgres@sha256:…   # PFOS_POSTGRES_IMAGE del último release
   docker volume create drill-pg
   docker run --rm --env-file /etc/pfos/pgbackrest.env -v drill-pg:/var/lib/postgresql \
     -v /opt/pfos/repo/deploy/pgbackrest/pgbackrest.conf:/etc/pgbackrest/pgbackrest.conf:ro \
     --entrypoint pgbackrest "$IMG" --stanza=pfos --repo=1 restore
   docker run -d --name drill-pg --env-file /etc/pfos/pgbackrest.env -v drill-pg:/var/lib/postgresql \
     -v /opt/pfos/repo/deploy/pgbackrest/pgbackrest.conf:/etc/pgbackrest/pgbackrest.conf:ro \
     "$IMG" postgres -c archive_mode=off
   ```
4. Verificar (falla si alguna consulta devuelve > 0):
   ```bash
   docker exec drill-pg psql -U postgres -d pfos -Atc "SELECT count(*) FROM (SELECT journal_entry_id, currency FROM ledger.posting GROUP BY 1, 2 HAVING sum(amount) <> 0) x"
   docker exec drill-pg psql -U postgres -d pfos -Atc "SELECT count(*) FROM ledger.journal_entry j WHERE NOT EXISTS (SELECT 1 FROM ledger.posting p WHERE p.journal_entry_id = j.id)"
   docker exec drill-pg psql -U postgres -d pfos -Atc "SELECT max(created_at) FROM ledger.posting"   # ≈ ahora − RPO
   ```
5. Registrar en el issue mensual: hora de inicio/fin (RTO observado), tamaño restaurado, resultado de las consultas, versión de pgBackRest.
6. `tofu apply -var-file=prod.tfvars -var drill_enabled=false` (destruye la VM y su volumen con los datos restaurados).

Dos drills fallidos seguidos → escalar a N3 (PostgreSQL gestionado) según ADR-0027.

## 7. Operación diaria

| Qué | Cómo |
|---|---|
| Estado de backups | `systemctl list-timers 'pfos-*'`, `journalctl -u 'pfos-backup@*' --since today`; heartbeat (si se configuró) |
| WAL atrasado | `pfos-backup@check` falla → heartbeat `/fail`. Causa típica: credenciales B2 o red. Con la cola de 2 GiB llena pgBackRest descarta WAL para no llenar el disco: hacer un full inmediatamente después de corregir |
| Parches del SO | automáticos (`unattended-upgrades`, reinicio 04:30 La Paz); Docker reinicia los contenedores (`restart: unless-stopped`) |
| Imágenes de terceros | fijadas por digest en `compose.yaml`/`compose.prod.yaml`; se actualizan por PR (Renovate) y llegan con el siguiente deploy |
| Costos | AWS Budgets (80 % real, 100 % pronosticado de USD 20); B2 y Grafana en sus consolas |
| Rotación de secretos | editar `/etc/pfos/*.env` y redeploy del release actual (`action=deploy` con el mismo SHA). Contraseñas de roles de BD: `migrate` las realinea al arrancar |
