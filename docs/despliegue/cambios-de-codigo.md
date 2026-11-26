# Cambios de código e IaC que pide el despliegue N1

**Fecha:** 2026-11-14. **Origen:** brechas B1–B16 del [runbook](RUNBOOK-DESPLIEGUE.md#brechas-a-cerrar-antes-del-primer-apply), que salen de las críticas y del disenso del [panel](DECISION-DESPLIEGUE.md). **Estado al 2026-11-24:** la fase 0 está cerrada en el código (C1 a C7, C9 a C13 hechos; C8 y C14 se miden en el PoC; C12c es condicional al plan B), pero nada está aplicado en infraestructura. Cada tarea va en su propia rama y su PR, con su change de OpenSpec cuando cambia comportamiento, como pide el `CLAUDE.md` del repo.

Orden recomendado: primero lo que toca el cloud-init y los buckets (C1, C2, C3 y C9), porque después del primer `tofu apply` cambiarlos reemplaza la instancia o deja respaldos con la retención vieja.

## Antes del primer `tofu apply`

- [x] **C1. Quinto digest en el comando forzado (B1).** Falta solo el cloud-init.
  - **Estado (2026-11-24):** hecho en #264: el comando forzado acepta un argumento extra validado contra una lista cerrada (`finance-ml` y `pfos-keycloak`) y sigue rechazando un sexto.
  - [x] **`deploy.yml` (hecho en #234):** el job `resolve` declara `ml: ${{ steps.refs.outputs.ml }}` en sus `outputs` (`.github/workflows/deploy.yml`, líneas 43–49), así que con `vars.PFOS_ML_ENABLED=true` el digest de `finance-ml` llega al host.
  - **Archivo pendiente:** `infra/modules/lightsail-host/cloud-init.yaml.tftpl` (líneas 48–66).
  - **Por qué:** el comando forzado hace `read -r action sha api web pg extra` y muere con «argumentos de más» si llega un quinto argumento, aunque `pfos-deploy.sh` ya lo acepta. Con ML habilitado, el deploy termina en rojo. Cambiar `user_data` después del apply reemplaza la instancia.
  - **Qué:** en el cloud-init, aceptar un 5.º argumento opcional validado con `^ghcr\.io/manuxd270516/finance-ml@sha256:[0-9a-f]{64}$`, pasarlo a `pfos-deploy.sh deploy` y seguir rechazando un 6.º. Recomendación: que el comando valide cualquier argumento extra contra una lista cerrada de imágenes del namespace (`finance-ml` y, si se decide C7 con imagen propia, `pfos-keycloak`), para que una imagen nueva no obligue a reemplazar el host. La crítica desaconseja `lifecycle { ignore_changes = [user_data] }`, porque esconde la deriva entre la plantilla y el host, y el `drill_host` arrancaría con otra plantilla.
  - **Prueba:** un test de shell (o `bats`) que alimente el script con 4, 5 y 6 argumentos y con refs inválidas, y un deploy con `PFOS_ML_ENABLED=true` cuyo resumen muestre la fila `finance-ml`.

- [x] **C2. Puerto 22 en `ufw` (B9).**
  - **Estado (2026-11-24):** hecho en #264: `ufw limit 22/tcp`. Queda para la fase 6 comprobar el 22 desde afuera (comprobación 5).
  - **Archivo:** `infra/modules/lightsail-host/cloud-init.yaml.tftpl` (línea 114).
  - **Por qué:** `ufw allow 22/tcp` abre el 22 a todo Internet en el host, y la única capa que lo cierra es el firewall de Lightsail (alias `lightsail-connect` en `lightsail-host/main.tf`). `ufw` no conoce los rangos del alias, así que no puede filtrarlos sin romper la consola de emergencia.
  - **Qué:** cambiar a `ufw limit 22/tcp` (límite de tasa) y mantener `AllowUsers` y `MaxAuthTries` en sshd. Dejar documentado que la capa principal es el firewall de Lightsail y que la fase 6 lo comprueba desde afuera.

- [x] **C3. Retención de los respaldos mensuales frente a un host comprometido (B2).**
  - **Estado (2026-11-24):** hecho en #263: bucket mensual con Object Lock de 395 días para repo2. Queda para el PoC la prueba 7.4 (pgBackRest contra Object Lock); `tofu fmt -check` y `tofu validate` los corre CI desde el PR de preparación de las fases 1 a 3 (job `config-docs`, 2026-11-25); pasaron sin errores en `infra/`.
  - **Archivos:** `infra/modules/b2-backups/main.tf`, `variables.tf` y `outputs.tf`; `infra/environments/prod/main.tf` y `outputs.tf`; `deploy/host/etc-pfos/pgbackrest.env.example` (`PGBACKREST_REPO2_S3_BUCKET`); `deploy/pgbackrest/pgbackrest.conf` si cambia la ruta de repo2.
  - **Por qué:** el lock por omisión de B2 es por bucket (21 días). La clave del host tiene `deleteFiles` y el lifecycle de `pgbackrest/` borra lo oculto al día siguiente, así que pasados 21 días un host comprometido puede eliminar los 12 mensuales.
  - **Qué (recomendado):** un segundo bucket para repo2, con Object Lock governance de ≥ 395 días (13 meses) y su lifecycle. La clave del host puede seguir ocultando para que pgBackRest expire, pero las versiones bloqueadas no se pueden destruir hasta que vence el lock. Evaluar lo mismo para `documents/` (versiones previas de 365 días con lock de 21). Alternativa: quitar `deleteFiles` de la clave para el prefijo mensual; exige probar qué hace `expire` sin permiso de borrado.
  - **Costo:** 13 fulls mensuales comprimidos de una base de menos de 2 GB caben cerca del cupo gratuito de B2 (centavos por encima).
  - **Ojo:** Object Lock no se puede desactivar en un bucket que lo tiene.

- [x] **C9. Hora del snapshot de Lightsail (B11).**
  - **Estado (2026-11-24):** hecho en #264: snapshot a las 10:00 UTC. Verificar en el primer `tofu plan` que el cambio del `add_on` sea in-place.
  - **Archivo:** `infra/modules/lightsail-host/variables.tf` (`auto_snapshot_time_utc`, hoy `06:00`).
  - **Por qué:** coincide con el full o el diff de las 06:00 UTC, y el snapshot queda tomado en medio del backup.
  - **Qué:** moverlo fuera de 06:00–07:30 UTC y del reinicio de las 08:30 UTC, por ejemplo a `10:00` (06:00 La Paz). Verificar en el plan que el cambio del `add_on` sea in-place.

## Antes del primer deploy

- [x] **C7. Keycloak con build optimizado o techo mayor (B6).**
  - **Estado (2026-11-24):** hecho en #265 (opción A): imagen `pfos-keycloak` con `kc.sh build`; arranque 25,6 a ~16 s y pico ~700 a ~470 MiB medidos en PC. La variable de repo `PFOS_KEYCLOAK_OPTIMIZED` se activa solo tras el primer apply con el cloud-init nuevo. Queda para el PoC medir en 0,4 vCPU.
  - **Archivos:** `deploy/compose/compose.prod.yaml` (servicio `keycloak`, techo de 704m y `command`); si se elige imagen propia, un `docker/keycloak.Dockerfile` nuevo y `.github/workflows/main.yml`.
  - **Por qué:** `start` sin `--optimized` rehace el build de Quarkus en cada arranque, que es el pico de CPU y memoria (≈ 908 MiB medidos sin límite). Con un techo de 704m y una base de 0,4 vCPU puede terminar en OOM o pasar los 420 s de `--wait-timeout`, y disparar el rollback automático en cadena.
  - **Opción A (recomendada):** imagen propia con `kc.sh build` (`--db=postgres`, `--health-enabled=true`, `--cache=local`) y `start --optimized`, construida y escaneada en `main.yml` como las demás. Para no tocar el cloud-init, su digest puede fijarse en `compose.prod.yaml` por PR, como Caddy o SeaweedFS; si viaja por `release.env`, C1 tiene que aceptarlo.
  - **Opción B:** subir el techo (por ejemplo a 896m) y medir en el PoC, compensando con el margen de otros servicios.
  - **Prueba:** E2E local con `PF_E2E_PROJECT=pfos-e2e-<nombre>` y prefijo 3 o 4, y tiempo de arranque medido en el PoC.

- [x] **C4. Prefijo de respaldo para el PoC.**
  - **Estado (2026-11-24):** hecho en #263: override `poc/` documentado en `pgbackrest.env.example` y en las fases 4 y 7. Queda para el PoC comprobar que la variable de entorno tenga precedencia sobre `pgbackrest.conf`.
  - **Archivo:** `deploy/host/etc-pfos/pgbackrest.env.example` (comentario) y las fases 4 y 7 del runbook.
  - **Por qué:** los respaldos ficticios no deben mezclarse con la stanza real, y quedan bloqueados 21 días. Si el primer deploy crea la stanza en el prefijo de producción, después de borrar los datos del PoC el cluster nuevo tiene otro `system-id` y `stanza-create` falla contra esa stanza.
  - **Qué:** documentar `PGBACKREST_REPO1_PATH=/pgbackrest/poc/pitr` y `PGBACKREST_REPO2_PATH=/pgbackrest/poc/monthly` como override temporal, cargado **antes del primer deploy** y quitado en la limpieza del PoC. **A verificar:** que pgBackRest dé precedencia a la variable de entorno sobre `pgbackrest.conf` con la versión de la imagen `pfos-postgres`.

## Antes de los datos reales

- [x] **C5. Drill de restore programado que avise si falla (B4).**
  - **Estado (2026-11-24):** hecho en #268 (change 69 `add-host-restore-drill`). Queda la tarea 7.2 para el PoC (primer drill en un host real y memoria pico).
  - **Archivos:** `deploy/host/systemd/pfos-restore-drill.timer` (nuevo), `deploy/host/pfos-backup.sh` (subcomando `drill`), `deploy/host/pfos-deploy.sh` (instalación del timer, como los demás), `deploy/host/etc-pfos/` (plantilla de un `pgbackrest-restore.env` con la clave de solo lectura).
  - **Por qué:** ADR-0027 y la propuesta prometen un «drill mensual automatizado que falla si no restaura», y no existe. El drill de §6 es manual.
  - **Qué:** una vez por mes, de madrugada y después del full mensual, restaurar el último punto de repo1 con la **clave de solo lectura** en un volumen temporal y un contenedor `pfos-postgres` con `archive_mode=off`, techo de memoria bajo y sin red publicada; correr las consultas de integridad de §6.4; medir la duración; borrar el contenedor y el volumen; avisar por el heartbeat (`/fail` si algo falla). Sumar `pgbackrest verify` semanal. El drill fuera del host (§6, VM efímera) queda trimestral.
  - **Límite:** el drill en el host no cubre un host comprometido. Por eso se mantiene el trimestral.
  - **Memoria:** el restore compite con el stack en 2 GB. Hay que medirlo en el PoC.

- [x] **C6. Limpieza de imágenes y alerta de disco (B7).**
  - **Estado (2026-11-24):** hecho en #268.
  - **Archivos:** `deploy/host/systemd/pfos-image-prune.timer` y `.service` (nuevos), y `deploy/host/pfos-backup.sh` (`check`).
  - **Por qué:** ni `pfos-deploy.sh` ni ningún timer hace `docker image prune`. Con deploys frecuentes, el disco de 60 GB se llena en silencio y detiene PostgreSQL y el archivado.
  - **Qué:** limpieza semanal que conserve las imágenes del release actual y del anterior de `releases.log` (para un rollback rápido; el resto se vuelve a bajar por digest). En `check`, fallar el heartbeat si el disco pasa el 80 %.

- [ ] **C8. pgBackRest dentro del techo de PostgreSQL (B8). Condicional.**
  - **Archivo:** `deploy/compose/compose.prod.yaml` (`postgres`, 384m).
  - **Por qué:** el `archive-push` asíncrono y los backups por `compose exec` comparten el techo con hasta 70 conexiones y `shared_buffers=96MB`. Un full con un pico de conexiones puede tirar la base entera.
  - **Qué:** medir en el PoC (prueba 7.7). Si el pico pasa el 85 % del techo, subirlo y compensar, o correr los backups programados en un contenedor aparte de la misma imagen con el volumen y el socket compartidos.

- [x] **C10. Volumen de la clave privada de conexiones (B10).**
  - **Estado (2026-11-24):** hecho en #268.
  - **Archivos:** `deploy/compose/compose.prod.yaml` (`finance-worker`) y `deploy/host/pfos-deploy.sh`.
  - **Por qué:** pendiente en docs/38: `CONNECTION_CREDENTIALS_PRIVATE_KEYS_FILE=/run/pfos/connection-credentials.keys` necesita el montaje, y un origen inexistente se convierte en directorio.
  - **Qué:** montar el archivo de `/etc/pfos` de solo lectura (o como `configs`, igual que `ml-service-token`) y crearlo vacío con permisos 0400 en `pfos-deploy.sh` si no existe. El worker corre como `node` (uid 1000, `docker/api.Dockerfile:66`), así que el archivo tiene que ser legible por ese uid sin abrirlo a otros: dueño 1000 y 0400.

- [x] **C11. Documentación desactualizada (B11 y B12).**
  - **Estado (2026-11-24):** hecho. Los §6 y §7 del runbook, docs/30 §8 y §12 y ADR-0027 los cubrió #268; ADR-0033, §2.1.5, §2.1.6, §5.2.1 y la documentación de `PFOS_KEYCLOAK_OPTIMIZED` los cierra el PR de cierre de la fase 0.
  - `docs/runbooks/deploy-and-restore.md` §2.1.5: tres hostnames (`app`, `auth` y `files`, D316).
  - §2.1.6: sumar `finance-ml` a los paquetes de GHCR.
  - §5.2.1: advertir que PostgreSQL no debe arrancar del snapshot con el archivado activo y que hay que restaurar encima desde B2.
  - §6: enlazar el drill automático (C5) y dejar el manual como trimestral.
  - `docs/30-backup-and-disaster-recovery.md` §8 y §12: describen el drill (`restore-drill`) y las alarmas de la era RDS/AWS Backup, que no existen en N1. Reemplazarlos por el drill del host, el heartbeat y Grafana.
  - `docs/adr/0033-servicio-de-pronosticos-en-python-en-n1.md` §Decisión: dice que `deploy.yml` y el comando forzado aceptan el digest de ML; las dos cosas son ciertas recién con C1.
  - `docs/adr/0027-…` §Riesgos: el «drill mensual automatizado» existe recién con C5. Agregar una nota que enlace esta decisión.
  - `docs/38-estado-y-pendientes.md`: estado del despliegue y decisiones de la fase 1.

- [x] **C13. Content-Security-Policy de la web (B14).**
  - **Estado (2026-11-24):** hecho en #270 (change 68 `add-web-content-security-policy`, D457 a D459). Queda la comprobación manual de login y logout con el Keycloak de producción en la fase 6.
  - **Archivos:** `deploy/compose/caddy/Caddyfile` (snippet `security_headers` o bloque de `PF_DOMAIN_APP`) o la configuración de cabeceras de `apps/web`.
  - **Por qué:** la web no declara CSP (nota del 2026-10-29 en ADR-0027). Caddy ya agrega HSTS, `nosniff` y `Referrer-Policy`.
  - **Qué:** definir una CSP con `frame-ancestors 'none'` y el origen de `PF_DOMAIN_FILES` en `connect-src`, probarla con la suite E2E (Next puede necesitar nonces para sus scripts) y sumar la comprobación a la fase 6 del runbook. Es comportamiento nuevo: va con su change de OpenSpec.

- [ ] **C14. Regla de corte de CPU y alerta de créditos (B15). Ratificación del 2026-11-24.**
  - **Archivos:** las secciones «PoC de 48 h: regla de corte» y «Fase 7» del runbook. No hay código en el host: la medición es el timer transitorio de la fase 7 y la alarma es de Lightsail.
  - **Por qué:** la base sostenida de Lightsail 2 GB es 0,4 vCPU y el import y los reportes son CPU de un hilo. Si los créditos se agotan, el host degrada sin avisar. N2 no suma CPU sostenida, así que un corte por CPU lleva al plan B.
  - **Qué:** en el PoC, registrar `lscpu`, la CPU promedio del host en reposo durante 6 h con la línea `cpu` de `/proc/stat` cada 5 min (`sysstat` no está en los paquetes del cloud-init, así que no hay `sar`), el tope y el ritmo de acumulación de los créditos (`BurstCapacityTime`) y la persistencia del import de 5 000 filas (`completed_at − approved_at` en `imports.import_job`). Las tendencias de 24 meses se quedan en el nightly `perf` de CI: el Large Seed es solo local y CI. Para la operación, una alarma de Lightsail (`aws lightsail put-alarm`) cuando `BurstCapacityPercentage` baje del 30 %, con aviso por email; no agrega credenciales al host. Revisar `JOB_QUEUE_POLLING_INTERVAL_SECONDS` de pg-boss si la CPU en reposo queda cerca del 20 %.
  - **Prueba:** el log del PoC muestra las mediciones con su modelo de CPU, y `aws lightsail test-alarm --state ALARM` hace llegar el email de la alarma.

## Solo si se activa el plan B (Oracle A1)

Detalle en la sección «Plan B» del runbook. La decisión 2 de la fase 1 dice si C12a y C12b se hacen **antes** del PoC (para tener la salida por CPU lista) o recién si el PoC corta.

- [x] **C12a. Imágenes multi-arch en CI.**
  - **Estado (2026-11-24):** hecho en #267: índices amd64+arm64 de las 5 imágenes propias; los 5 checks `image (…, arm64)` no son obligatorios.
  - `.github/workflows/main.yml`: matriz imagen × plataforma con runners nativos (`ubuntu-24.04` y `ubuntu-24.04-arm`), push por digest e índice con `docker buildx imagetools create`, sin romper `provenance` ni `sbom`, y verify-by-digest sobre el digest del índice.
  - `.github/workflows/pr.yml`: build arm64 sin push y Trivy en las dos plataformas. Un check obligatorio nuevo requiere confirmación del owner.

- [x] **C12b. Digests de terceros y bases como índices multi-arch.**
  - **Estado (2026-11-24):** hecho en #269: todos los digests de terceros ya eran índices multi-arch y Renovate cubre `deploy/host/*.sh`. Queda el smoke de pgBackRest en un host arm64 (en el PoC o con el plan B): CI solo comprobó que el paquete se instala.
  - `docker/*.Dockerfile` (node, python, uv y postgres) y `deploy/compose/compose*.yaml` (Caddy, SeaweedFS y Keycloak): digests de índice multi-arch.
  - `deploy/host/pfos-backup.sh` (`RCLONE_IMAGE`, hoy `rclone/rclone:1.75.1`): digest de índice multi-arch.
  - pgBackRest en la imagen `pfos-postgres` para arm64: comprobar que el paquete exista y pase el smoke.

- [ ] **C12c. Host de OCI.**
  - `infra/modules/oci-host/` (nuevo) e `infra/environments/` (entorno o variable de proveedor).
  - Cloud-init para OCI: iptables de la imagen, block volume en `/var/lib/pfos` y sin la excepción del 22.
  - ADR: addendum a ADR-0027 que active N1-F.
