# Tareas

> C5, C6 y C10 de [cambios-de-codigo.md](../../../docs/despliegue/cambios-de-codigo.md), antes de los datos reales (fase 8), en un solo PR (los tres tocan `pfos-deploy.sh`). La pregunta 3 de [docs/73](../../../docs/73-despliegue-n1-specs-questions.md) no bloquea: se implementa con la recomendación si el owner no responde antes del grupo 3. Gates: los de `CLAUDE.md`; sin cambios de UI ni de API, así que no hacen falta `test:e2e` ni `contract:breaking` más allá de su corrida en CI.

## 1. SPEC y TEST CASES

- [x] 1.1 Revisar con el owner el delta de `platform/delivery-pipeline` y la pregunta 3 de docs/73; registrar la decisión en el `…-decisions.md` siguiente y ajustar spec, design y TC; `openspec validate add-host-restore-drill --strict` *(2026-11-24: el owner respondió la pregunta 3: el drill FALLA si la duración total supera 60 min; la decisión se registra en el `…-decisions.md` siguiente (docs/74, en otro PR); spec, design y TC ya la reflejan)*
- [x] 1.2 Revisar TC-PLATFORM-DRILL-001..010 y TC-PLATFORM-HOSTOPS-001..006 contra los scenarios (cifras: pérdida de 3 min frente a 28 min con RPO de 15; 1,25 × 4 GiB + 2 GiB = 7 GiB > 6 GiB libres; 83 % y 79 % frente al 80 %; 72 min frente a 60); pasarlos a `ready` y `requirement_status: confirmed` (TC-PLATFORM-DRILL-007 queda `provisional` hasta la pregunta 3) *(2026-11-24: TC en `ready` o `automated`; DRILL-007 pasó de provisional a firme)*

## 2. DOMAIN

- [x] 2.1 Sin lógica de dominio: el change es del host y del despliegue

## 3. Harness de pruebas de los scripts (test-first)

- [x] 3.1 Rutas configurables en `pfos-backup.sh` y `pfos-deploy.sh` (`${PFOS_ETC_DIR:-/etc/pfos}`, `${PFOS_STATE_DIR:-/var/lib/pfos}`, `${PFOS_REPO_DIR:-/opt/pfos/repo}`) sin cambiar los valores de producción *(2026-11-24: `PFOS_ETC_DIR`, `PFOS_STATE_DIR`, `PFOS_REPO_DIR` (y `PFOS_DOCKER_DIR` en backup))*
- [x] 3.2 Paquete `scripts/host-ops` (Vitest): dobles de `docker`, `curl`, `df` y `date` en el `PATH` que registran argumentos y devuelven salidas preparadas; `it.skipIf(process.platform === 'win32')`; `shellcheck` de `deploy/host/*.sh` (versión fijada); integrarlo en `pnpm turbo test` y en CI *(2026-11-24: `scripts/host-ops` (`@pf/host-ops`) corre en el job `unit` con `pnpm turbo test`, sin check nuevo; shellcheck corre dentro del paquete si el binario está (el runner de Ubuntu de CI lo trae; la versión no se fija sin una dependencia nueva, se usa `-S warning`). Verificado en Linux (Debian, shellcheck 0.9.0) con todas las pruebas en verde; en Windows se saltan)*
- [x] 3.3 Escribir primero los tests de los grupos 4 a 6 con los TC-id en el nombre (fallan hasta implementar) *(2026-11-24)*

## 4. INFRASTRUCTURE: drill y verificación (C5)

- [x] 4.1 `pfos-backup.sh drill`: lock, limpieza de restos, precondiciones, espacio, instante de referencia de producción, restore con la clave de solo lectura, arranque con `archive_mode=off` y `listen_addresses=''` sin puertos ni la red del stack, espera de la promoción con tope de 90 min, consultas de integridad (INV-004 e INV-005), pérdida de datos, medición, línea en `drills.log`, `POST` al heartbeat `pfos-drill` y limpieza en `trap EXIT` (design, decisión 3): TC-PLATFORM-DRILL-001..003, -005, -006, -008 *(2026-11-24: `hot_standby=off` agregado a la copia (as-built, design decisión 3))*
- [x] 4.2 Umbral de 60 min de la duración total (pregunta 3): TC-PLATFORM-DRILL-007 *(2026-11-24)*
- [x] 4.3 `pfos-backup.sh verify`: contenedor efímero con la clave de solo lectura, repo1 y repo2, heartbeat `pfos-verify`: TC-PLATFORM-DRILL-009 *(2026-11-24)*
- [x] 4.4 `deploy/host/systemd/pfos-restore-drill.timer` (`*-*-02 09:00:00 UTC`) y `pfos-backup-verify.timer` (`Wed *-*-* 11:00:00 UTC`), con `Persistent=true` y `RandomizedDelaySec=5min`, sobre el template `pfos-backup@.service` *(2026-11-24)*
- [x] 4.5 `deploy/host/etc-pfos/pgbackrest-restore.env.example` (root 0600, repo1 y repo2 con la clave de solo lectura, override de prefijo del PoC comentado, nota de la dependencia con C3) *(2026-11-24: incluye la dependencia con el bucket mensual (D455))*

## 5. INFRASTRUCTURE: imágenes, disco y lock (C6)

- [x] 5.1 `pfos-backup.sh image-prune`: lista de conservación (contenedores, dos últimas líneas de `releases.log`, `RCLONE_IMAGE`), `docker image rm` sin `-f`, colgantes, informe de lo liberado, heartbeat `pfos-image-prune`: TC-PLATFORM-HOSTOPS-002, -003 *(2026-11-24)*
- [x] 5.2 `deploy/host/systemd/pfos-image-prune.timer` (`Sat *-*-* 11:00:00 UTC`) y `pfos-image-prune.service` (`TimeoutStartSec=30min`) *(2026-11-24)*
- [x] 5.3 `pfos-backup.sh check`: alerta de disco al 80 % sobre `/`, `/var/lib/docker` y `/var/lib/pfos` sin repetir dispositivo; todas las verificaciones se evalúan y el fallo lista las causas: TC-PLATFORM-HOSTOPS-004 *(2026-11-24: `run_check` evalúa todo; el ERR trap se hereda a las funciones (`set -E`) para que un fallo dentro de una función también avise `/fail`)*
- [x] 5.4 Lock compartido: drill, verify e image-prune con `flock -w 3600` sobre `deploy.lock` y nombre del dueño; `pfos-deploy.sh` informa quién lo tiene: TC-PLATFORM-HOSTOPS-001 *(2026-11-24)*

## 6. INFRASTRUCTURE: deploy y clave de las conexiones (C10)

- [x] 6.1 `pfos-deploy.sh` `install_host_units`: habilitar `pfos-restore-drill.timer`, `pfos-backup-verify.timer` y `pfos-image-prune.timer` *(2026-11-24)*
- [x] 6.2 `pfos-deploy.sh` `ensure_connection_keys_file` en `cmd_deploy` y `redeploy_line`: crear vacío 1000:1000 0400 si falta; si existe, normalizar dueño y permisos sin tocar el contenido: TC-PLATFORM-HOSTOPS-005 *(2026-11-24: también aborta si el origen del montaje es un directorio)*
- [x] 6.3 `compose.prod.yaml`: config `connection-credentials-keys` (`file: /etc/pfos/connection-credentials.keys`) montada solo en `finance-worker` en `/run/pfos/connection-credentials.keys`; test que renderiza `docker compose config` del perfil `core` y comprueba que solo el worker la monta: TC-PLATFORM-HOSTOPS-006 *(2026-11-24: la prueba parsea el YAML de `compose.yaml` y `compose.prod.yaml` (no ejecuta `docker compose config`, que exige las variables de `pfos.env`))*
- [x] 6.4 `pfos.env.example`: comentario de `CONNECTION_CREDENTIALS_PRIVATE_KEYS_FILE` con la ruta del montaje y el archivo de `/etc/pfos` que lo alimenta *(2026-11-24)*

## 7. AUTOMATED TESTS y prueba en el host

- [x] 7.1 Automatizar en `scripts/host-ops` todos los TC de tipo unit con el TC-id en el nombre; actualizar el front matter *(2026-11-24: DRILL-001, -002, -003, -005, -006, -007, -008, -009 y HOSTOPS-001 a -006 automatizados; DRILL-004 (PoC) y DRILL-010 (manual del owner) no)*
- [ ] 7.2 En el PoC (fase 7 del runbook): `systemctl start pfos-backup@drill.service`, `pfos-backup@verify.service` y `pfos-image-prune.service`; anotar memoria pico del drill (`docker stats`), duración y espacio liberado; comprobar que un `PUT` con la clave de solo lectura falla en B2: TC-PLATFORM-DRILL-001, -004, -009, TC-PLATFORM-HOSTOPS-002 (en el host)

## 8. DOCUMENTATION

- [x] 8.1 `docs/runbooks/deploy-and-restore.md` §6: el manual pasa a trimestral (primer mes del trimestre) y enlaza el drill automático; §7: estado del drill (`journalctl -u 'pfos-backup@drill'`, `drills.log`), qué hacer ante un `/fail` de drill, verify, image-prune o disco; deshabilitar los timers en un rollback *(2026-11-24)*
- [x] 8.2 `docs/despliegue/RUNBOOK-DESPLIEGUE.md`: fase 4, crear `/etc/pfos/pgbackrest-restore.env` y los checks `pfos-drill` (periodo 31 días, gracia 1 día), `pfos-verify` (7 días, gracia 1 día) y `pfos-image-prune` (7 días, gracia 1 día) en el heartbeat; fase 7, la prueba 7.2; tablas «Respaldos» y «Límites del plan» con el drill, la verificación y la alerta de disco *(2026-11-24)*
- [x] 8.3 `docs/30-backup-and-disaster-recovery.md` §8 y §12 (drill del host, heartbeat), ADR-0027 §Riesgos (nota que enlaza este change), NFR-REL-002/005 (verificación) y `docs/12-security.md` (clave de las conexiones montada solo en el worker); coordinar con C11 para no duplicar *(2026-11-24: docs/30 §8 y §12, ADR-0027, docs/02 (NFR-REL-002 y -005) y docs/12; C11 no se tocó)*
- [x] 8.4 Matriz de trazabilidad; `pnpm spec:validate`, `pnpm traceability:check` y `pnpm format:check` *(2026-11-24: spec:validate, traceability:check, format:check, arch:check y config:docs:check en verde; la matriz no cambia)*
