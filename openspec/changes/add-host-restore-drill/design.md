# Diseño

## Contexto

C5, C6 y C10 de [cambios-de-codigo.md](../../../docs/despliegue/cambios-de-codigo.md) (brechas B4, B7 y B10). Lo que hay hoy en el host N1 (ADR-0027):

- **Backups** (`deploy/host/pfos-backup.sh` y `deploy/host/systemd/`): `full` (dom 06:00 UTC) y `diff` (lun–sáb 06:00) a repo1 (PITR 14 días), `monthly` (día 1, 07:00) a repo2, `docs-replica` (07:30) y `check` horario (archivado de WAL y antigüedad del último backup). Todos corren por `pfos-backup@<tipo>.service` y avisan a `PF_BACKUP_HEARTBEAT_URL/pfos-<tipo>` (healthchecks.io), con `/fail` desde un `trap ERR`. pgBackRest corre dentro del contenedor `postgres` (techo de 384 MiB) por `compose exec`.
- **Deploy** (`deploy/host/pfos-deploy.sh`): toma `flock -n` sobre `/var/lib/pfos/deploy.lock`, instala y habilita los timers en cada deploy (`install_host_units`), registra cada release exitoso en `/var/lib/pfos/releases.log` (`<utc> <sha> <api> <web> <pg> [<ml>]`) y crea `/etc/pfos/ml-service-token` (0444) si falta. Nunca hace `docker image prune`.
- **Drill:** solo el manual de `docs/runbooks/deploy-and-restore.md` §6, en una VM efímera (`drill_enabled=true`) con la clave de B2 de solo lectura (`tofu output b2_restore_key_id`), y sus consultas de integridad del paso 4.
- **Horarios fijos del host:** reinicio de `unattended-upgrades` 08:30 UTC (04:30 La Paz) y snapshot de Lightsail que C9 mueve a 10:00 UTC.
- **Clave privada de las conexiones:** el worker la lee de `CONNECTION_CREDENTIALS_PRIVATE_KEYS_FILE` y exige permisos sin bits de grupo ni otros (`loadPrivateKeyring`); el worker corre como `node` (uid 1000) con `read_only: true`. `compose.prod.yaml` no monta el archivo; si se montara un origen inexistente, Docker crearía un directorio.

Decisiones vigentes: D456 (drill local mensual con aviso por heartbeat y drill fuera del host trimestral), NFR-REL-001 (RPO ≤ 15 min), NFR-REL-002 (RTO observado en drill < 1 h), NFR-REL-005 (todo restore verificado), D342 (clave privada en archivo 0400 fuera del repositorio, solo en el worker).

## Objetivos / No objetivos

**Objetivos**
- Un restore real por mes, sin intervención, que avisa si no restaura, si la copia no cumple las invariantes o si pierde más datos que el RPO.
- Detectar un repositorio corrupto en menos de una semana, sin esperar al drill.
- Que el disco no se llene en silencio por las imágenes de los deploys.
- Que el worker de producción pueda leer la clave privada de las conexiones.

**No objetivos**
- Cubrir un host comprometido: lo cubre el drill trimestral fuera del host (§6), con otra VM y la misma clave de solo lectura.
- Restaurar repo2 o a un instante dado (PITR dirigido): el drill mensual usa el último punto de repo1, que es el camino de una recuperación real.
- Correr el invariant checker completo de la aplicación sobre la copia: exige levantar el worker. Las dos consultas de §6 cubren INV-004 e INV-005; el resto de las invariantes las verifica el job diario de producción.

## Decisiones

1. **C5, C6 y C10 en un solo change.** Los tres tocan `pfos-deploy.sh` (`install_host_units` y archivos de `/etc/pfos`), los dos primeros comparten `pfos-backup.sh`, el heartbeat y el lock, y van en un mismo PR para no cruzar tres ramas sobre el mismo script. Son requirements separados y cada uno tiene sus TC.

2. **El drill es un subcomando de `pfos-backup.sh` disparado por un timer propio.** `pfos-restore-drill.timer` (`OnCalendar=*-*-02 09:00:00 UTC`, `RandomizedDelaySec=5min`, `Persistent=true`) arranca `pfos-backup@drill.service` (el template ya tiene `TimeoutStartSec=2h`, `Nice=10` y prioridad de E/S baja). Día 2 a las 05:00 de La Paz: después del full mensual del día 1, fuera de la ventana de backups (06:00–07:30 UTC), después del reinicio de 08:30 y antes del snapshot de 10:00. El heartbeat es `pfos-drill`.

3. **Pasos del drill** (todos con `set -euo pipefail`; un `trap EXIT` limpia siempre):
   1. **Lock:** `flock -w 3600` sobre `/var/lib/pfos/deploy.lock` (decisión 8).
   2. **Restos de un drill anterior:** si existen el contenedor `pfos-drill-pg`, el volumen `pfos-drill-pg` o la red `pfos-drill`, se borran antes de empezar.
   3. **Precondiciones:** `/etc/pfos/pgbackrest-restore.env` legible, sin `__set__`; imagen = `PFOS_POSTGRES_IMAGE` de `/var/lib/pfos/release.env` (la misma versión de PostgreSQL y pgBackRest que producción). Si falta algo → falla con el motivo.
   4. **Espacio** (requirement «Espacio en disco antes del drill»): tamaño de la base del último backup de repo1 (`pgbackrest info --output=json`, `backup[-1].info.size`); hace falta libre en el sistema de archivos de `/var/lib/docker` ≥ 1,25 × tamaño + 2 GiB. Si no alcanza, falla **sin restaurar** y lo dice.
   5. **Instante de referencia (RPO):** `T0` = `max(created_at)` de `ledger.posting` en producción, por `compose exec -T postgres psql` de solo lectura, y la hora actual.
   6. **Restore** (contenedor nombrado `pfos-drill-restore`, que el paso 2 y la limpieza también borran): red `pfos-drill` (bridge propia, no `internal`: pgBackRest necesita salir a B2) y volumen `pfos-drill-pg`; `docker run --rm --network pfos-drill --memory 256m --cpus 0.5 --env-file /etc/pfos/pgbackrest-restore.env -v pfos-drill-pg:/var/lib/postgresql -v <repo>/deploy/pgbackrest/pgbackrest.conf:/etc/pgbackrest/pgbackrest.conf:ro --entrypoint pgbackrest <imagen> --stanza=pfos --repo=1 --process-max=1 restore` (último punto, recuperación hasta el final del WAL archivado).
   7. **Arranque sin archivado:** `docker run -d --name pfos-drill-pg` con la misma red, volumen, env y techos, sin `-p`, y `postgres -c archive_mode=off -c listen_addresses= -c hot_standby=off -c shared_buffers=32MB -c max_connections=10`. `hot_standby=off` (as-built): con `max_connections=10`, menor que el de producción (70), la recuperación aborta por el chequeo de parámetros que solo rige con *hot standby* activo; sin él la copia no acepta conexiones hasta promover, y el drill sondea hasta que `psql` responde y `pg_is_in_recovery()` da `f`. `listen_addresses=''` deja solo el socket local: ni la red del drill lo alcanza. La recuperación trae el WAL con `archive-get` (lectura) y promueve.
   8. **Espera:** hasta que `pg_is_in_recovery()` sea `false`, con un tope duro de 90 min (si se cumple, falla). El objetivo de 60 min de la duración total es aparte (requirement «Duración del drill dentro del objetivo de RTO»): **decisión del owner del 2026-11-24 (pregunta 3): el drill FALLA y avisa por `/fail` si la duración total, desde el inicio del restore hasta el fin de las verificaciones, supera 60 min** (3600 s exactos no falla). Se evalúa después de la integridad y de la pérdida de datos, así que un fallo de integridad o de RPO siempre manda sobre uno de duración.
   9. **Integridad** (§6.4 del runbook, reforzada): cuenta de pares (asiento, moneda) cuyos postings no suman cero (INV-004); cuenta de asientos con menos de dos postings (INV-005, que incluye los que no tienen ninguno, con `LEFT JOIN ... HAVING count(p.*) < 2`). Cualquiera > 0 → falla.
   10. **Pérdida de datos:** si `T0` no es nulo, `gap = T0 − max(created_at)` de la copia; `gap > 15 min` (NFR-REL-001) → falla. Sin postings en producción, no aplica.
   11. **Medición:** duración del restore, de la recuperación y total; tamaño restaurado; etiqueta del backup; versión de pgBackRest.
   12. **Registro y aviso:** una línea en `/var/lib/pfos/drills.log` (`<utc> ok|fail <etiqueta> restore=<s> recovery=<s> total=<s> size=<bytes> gap=<s> pgbackrest=<versión>`, sin datos financieros) y un `POST` al heartbeat (`pfos-drill` o `pfos-drill/fail`) con esa misma línea como cuerpo.
   13. **Limpieza** (`trap EXIT`, también tras un fallo): `docker rm -f pfos-drill-pg`, `docker volume rm pfos-drill-pg`, `docker network rm pfos-drill`. Si la limpieza falla, el drill falla aunque lo demás haya pasado (un volumen olvidado ocupa disco).

4. **Aislamiento del drill** (requirement «El drill no puede afectar la producción ni los respaldos»):
   - **Clave de solo lectura** (`b2_restore_key`): el contenedor del drill no recibe `/etc/pfos/pgbackrest.env` ni la clave del host. Aunque algo intentara un `archive-push` o un `expire`, B2 lo rechaza.
   - **`archive_mode=off`:** el cluster restaurado promueve a un timeline nuevo; con el archivado activo empujaría WAL a la stanza de producción.
   - **Sin puertos publicados ni la red del stack** (`pfos_default`): nada del stack lo ve y él no ve al stack.
   - **Techos:** 256 MiB y 0,5 CPU por contenedor (el `Nice` del servicio no llega a los contenedores). El valor se mide en el PoC (fase 7); si el restore no entra, se sube y se anota.
   - **Plantilla** `deploy/host/etc-pfos/pgbackrest-restore.env.example` (root 0600): `PGBACKREST_REPO1_S3_{BUCKET,ENDPOINT,REGION,KEY,KEY_SECRET}`, `PGBACKREST_REPO1_CIPHER_PASS` y lo mismo para repo2 (pgBackRest valida la configuración de los dos repos aunque se use uno), con la clave de `tofu output b2_restore_key_id` / `-raw b2_restore_key_secret`. Durante el PoC lleva el mismo override de prefijo que `pgbackrest.env` (C4). **Dependencia con C3 (D455):** la clave de solo lectura tiene que poder leer también el bucket nuevo de los mensuales; si C3 se implementa después, este change lo deja anotado en la plantilla.

5. **Verificación semanal en un contenedor efímero.** `pfos-backup-verify.timer` (`Wed *-*-* 11:00:00 UTC`) → `pfos-backup@verify.service`: `docker run --rm --memory 192m --cpus 0.5 --env-file /etc/pfos/pgbackrest-restore.env ... pgbackrest --stanza=pfos --repo=N verify` para repo1 y repo2; falla si alguno termina con error o informa archivos inválidos. Va fuera del contenedor `postgres` para no sumar al techo de 384 MiB (C8) y usa la clave de solo lectura. Heartbeat `pfos-verify`. *Alternativa descartada:* `compose exec postgres pgbackrest verify`, que lee todo el repositorio dentro del techo de la base.

6. **Limpieza de imágenes** (`pfos-image-prune.timer`, `Sat *-*-* 11:00:00 UTC`, y `pfos-image-prune.service` → `pfos-backup.sh image-prune`, `TimeoutStartSec=30min`, heartbeat `pfos-image-prune`):
   - **Se conservan:** las imágenes de cualquier contenedor (en marcha o detenido), las referencias de las **dos últimas líneas** de `releases.log` (columnas 3 a 6: api, web, pg y ml) y `RCLONE_IMAGE`.
   - **Se borran:** las demás, una por una con `docker image rm` **sin `-f`** (si alguna está en uso, el borrado falla y se cuenta, sin abortar), y luego `docker image prune -f` para las colgantes.
   - **Sin `releases.log` o vacío:** solo colgantes, y avisa en el log.
   - El cuerpo del heartbeat informa cuántas imágenes se borraron y el espacio liberado (`df` antes y después).
   - Las imágenes de terceros de un release anterior (Caddy, Keycloak, SeaweedFS, si cambió su digest) se pueden borrar: un rollback las vuelve a bajar por digest (`pull_policy: missing`).
   - *Alternativa descartada:* `docker image prune -a --filter until=…`: no conserva el release anterior si es más viejo que el filtro y deja el rollback sin imágenes locales.

7. **Alerta de disco en `check`.** Umbral fijo de 80 % (C6) sobre los sistemas de archivos de `/`, `/var/lib/docker` y `/var/lib/pfos` (sin repetir el mismo dispositivo), con `df --output=pcent,target`. `check` pasa a evaluar **todas** las verificaciones (disco, `pgbackrest check`, antigüedad del último backup) y falla al final con la lista de las que fallaron: hoy un `pgbackrest check` caído corta el script antes de mirar el disco, y un disco lleno es justamente lo que lo hace fallar. El mensaje nombra el punto de montaje y el porcentaje.

8. **Lock compartido con el deploy.** Drill, verify e image-prune toman `/var/lib/pfos/deploy.lock` con `flock -w 3600` y escriben en él quién lo tiene (`drill`, `verify`, `image-prune` o `deploy <sha>`). `pfos-deploy.sh` mantiene `flock -n` y, si está tomado, falla con «operación del host en curso: <quién>». Los backups (`full`, `diff`, `monthly`, `docs-replica`, `check`) no toman el lock: tienen sus propios horarios y no compiten por el volumen del drill. *Alternativa descartada:* un lock aparte para las operaciones del host: un deploy podría correr a la vez que un drill y sumar memoria en el peor momento.

9. **Clave privada de las conexiones (C10).**
   - `compose.prod.yaml`: config `connection-credentials-keys` con `file: /etc/pfos/connection-credentials.keys`, montada **solo** en `finance-worker` en `/run/pfos/connection-credentials.keys` (igual que `ml-service-token`). En Compose sin Swarm una config de archivo es un bind mount de solo lectura que conserva dueño y permisos del host. `finance-api` sigue con la clave pública solamente.
   - `pfos-deploy.sh`, función `ensure_connection_keys_file` (en `cmd_deploy` y en `redeploy_line`, como `ensure_ml_token_file`): si el archivo no existe, `install -o 1000 -g 1000 -m 0400 /dev/null`; si existe, `chown 1000:1000` y `chmod 0400` sin tocar el contenido. Así el origen del montaje siempre es un archivo y el worker (uid 1000) lo puede leer, y nadie más fuera de root.
   - Un archivo vacío equivale a no tener claves (el worker no puede descifrar y las conexiones quedan sin sincronizar), igual que hoy sin la variable. `CONNECTION_CREDENTIALS_PRIVATE_KEYS_FILE` sigue comentada en `pfos.env.example` hasta la puerta del grupo 9 de `add-banking-providers`.

10. **Pruebas de los scripts.** Los scripts del host son bash para Linux (el host no corre Node). Para probarlos sin un host:
    - las rutas fijas (`/etc/pfos`, `/var/lib/pfos`, `/opt/pfos/repo`) pasan a `${PFOS_ETC_DIR:-/etc/pfos}`, etc.; systemd y el comando forzado no las definen, así que en producción no cambian;
    - un paquete de tests `scripts/host-ops` (Vitest, TypeScript) ejecuta `bash deploy/host/pfos-backup.sh …` con dobles de `docker`, `curl`, `df` y `date` al frente del `PATH` que registran sus argumentos y devuelven salidas preparadas; comprueba comandos, orden, limpieza, líneas de log y llamadas al heartbeat;
    - en Windows esos tests se saltan (`it.skipIf(process.platform === 'win32')`) y los corre CI en Linux; `shellcheck` sobre `deploy/host/*.sh` en el mismo paquete;
    - el restore real se prueba en el PoC (fase 7) con `systemctl start pfos-backup@drill.service`, y en el primer drill programado.

## Riesgos / Trade-offs

- **Memoria:** en el pico del restore el host suma ≈ 256 MiB al stack en 2 GB. Mitigación: madrugada, techo bajo, swap de 2 GiB y medición en el PoC; si falta, subir el techo o mover el drill a un día sin backups.
- **El drill no cubre un host comprometido** (usa el mismo host y su Docker): lo cubre el trimestral fuera del host.
- **Costo de B2:** `verify` lee los dos repositorios cada semana; con menos de 10 GB almacenados la descarga queda en centavos por encima del cupo gratuito (3 × lo almacenado).
- **Heartbeat:** si el owner no crea los checks `pfos-drill`, `pfos-verify` y `pfos-image-prune` con su periodo, un drill que no corre no avisa. Tarea del runbook (fase 4), con el periodo y la gracia de cada uno.
- **Borrado de imágenes:** la lista de conservación sale de `releases.log`; si el archivo se pierde, solo se borran colgantes.
- **Lock:** un deploy que coincide con el drill falla rápido; el operador reintenta después (el mensaje dice por qué).

## Plan de migración

Sin datos ni migraciones. Orden en el host:

1. El owner crea `/etc/pfos/pgbackrest-restore.env` desde la plantilla (fase 4 del runbook) y los checks del heartbeat.
2. El siguiente deploy instala y habilita los timers nuevos y crea el archivo de la clave.
3. En el PoC (fase 7) se dispara a mano `pfos-backup@drill.service`, `pfos-backup@verify.service` y `pfos-image-prune.service`, y se mide la memoria del drill.

Vuelta atrás: `systemctl disable --now pfos-restore-drill.timer pfos-backup-verify.timer pfos-image-prune.timer` o rollback del release (los timers del release anterior no incluyen los nuevos, pero `install_host_units` no los deshabilita: se hace a mano y se anota en el runbook).

## Contratos

- **OpenAPI y eventos:** sin cambios.
- **Subcomandos del host:** `pfos-backup.sh full|diff|monthly|check|docs-replica|drill|verify|image-prune`; salida 64 ante un subcomando desconocido.
- **Heartbeat** (`PF_BACKUP_HEARTBEAT_URL`): slugs nuevos `pfos-drill`, `pfos-verify` y `pfos-image-prune`; `/fail` ante error. `pfos-drill` e `pfos-image-prune` mandan el resumen como cuerpo del `POST`.
- **Archivos del host:** `/etc/pfos/pgbackrest-restore.env` (root 0600, nuevo), `/etc/pfos/connection-credentials.keys` (1000:1000 0400), `/var/lib/pfos/drills.log` (root 0600, una línea por drill).
- **Unidades:** `pfos-restore-drill.timer`, `pfos-backup-verify.timer`, `pfos-image-prune.timer` y `pfos-image-prune.service`, instaladas y habilitadas por `install_host_units`.

## Preguntas abiertas

En [docs/73](../../../docs/73-despliegue-n1-specs-questions.md):

- **Pregunta 3 (resuelta, decisión del owner del 2026-11-24):** el drill falla cuando la duración total pasa los 60 min (RTO observado de NFR-REL-002). TC-PLATFORM-DRILL-007 pasó de provisional a firme.
