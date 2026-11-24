# Runbook: consolidación previa al primer despliegue de PFOS en Lightsail N1

**Destino:** una instancia AWS Lightsail Linux 2 GB en `sa-east-1` (São Paulo) con el stack de `compose.yaml` más `compose.prod.yaml`, respaldos de pgBackRest y réplica de documentos a Backblaze B2, y tres hostnames (`app`, `auth` y `files`) detrás de Caddy. Costo: ≈ USD 16,5 por mes con el recargo de la tarjeta (≈ 15 sin él).

**Variante:** este runbook **no reemplaza** a [deploy-and-restore.md](../runbooks/deploy-and-restore.md), que sigue siendo el procedimiento vigente para el primer despliegue, los deploys, el rollback y la restauración. Acá está lo que le falta: el estado real, las brechas que el panel encontró, el PoC con regla de corte, el plan B y el orden de las fases con su «Terminada cuando». Cuando una fase dice «§2.2», se refiere a ese runbook.

**Estado al 2026-11-24:** sin desplegar. No existe la cuenta de AWS, ni el bucket de B2, ni el dominio. La decisión de plataforma está en [DECISION-DESPLIEGUE.md](DECISION-DESPLIEGUE.md) y ratifica [ADR-0027](../adr/0027-destino-de-despliegue-inicial-vps-compose.md).

| Símbolo | Quién lo hace |
|---|---|
| **Vos** | El owner: cuentas, inicios de sesión, medios de pago, secretos, consolas web y `tofu apply` |
| **Claude** | Un agente, cuando se lo pidas: cambios de código por PR, comprobaciones desde afuera y lectura de logs. Pide tu confirmación antes de cada deploy |

## Estado actual

| Pieza | Estado | Dónde |
|---|---|---|
| IaC del host (instancia, IP estática, firewall, snapshots, cloud-init) | Escrita, nunca aplicada | `infra/modules/lightsail-host/` |
| IaC de respaldos (bucket con Object Lock, clave del host y clave de solo lectura) | Escrita, nunca aplicada | `infra/modules/b2-backups/` |
| Composición, AWS Budgets (USD 20) y VM de drill opcional | Escrita | `infra/environments/prod/` |
| Override de producción con techos de memoria | Escrito | `deploy/compose/compose.prod.yaml` |
| Caddy con HSTS, `nosniff`, `Referrer-Policy`, `/admin` de Keycloak en 404 y `files` limitado a `PUT` firmado | Escrito | `deploy/compose/caddy/Caddyfile` |
| Deploy por digest con backup previo, smoke y rollback automático | Escrito; acepta el 5.º digest | `deploy/host/pfos-deploy.sh` |
| Comando forzado del host | Escrito; **rechaza el 5.º digest** | `infra/modules/lightsail-host/cloud-init.yaml.tftpl:48-50` |
| Workflow de deploy (`workflow_dispatch`, environment `production`, Tailscale OIDC) | Escrito; **envía el 5.º digest** con `PFOS_ML_ENABLED=true`: el job `resolve` declara `outputs.ml` desde #234 | `.github/workflows/deploy.yml:43-49` |
| Timers de respaldo (full semanal, diff diario, mensual, check horario, réplica de documentos) con heartbeat opcional | Escritos | `deploy/host/systemd/`, `deploy/host/pfos-backup.sh` |
| Drill de restore programado | **No existe.** Solo el procedimiento manual de §6 | — |
| Limpieza de imágenes | **No existe** (sin `prune` en `deploy/` ni `infra/`) | — |
| Volumen de la clave privada de conexiones en el worker | **No existe** (pendiente en docs/38) | — |
| Plantillas de secretos (solo nombres) | Escritas | `deploy/host/etc-pfos/*.env.example` |
| Imágenes multi-arch para el plan B | **No.** `platforms: linux/amd64` | `.github/workflows/main.yml:64` |
| Tags, changelog y releases | No se usan (0 etiquetas). El registro de versiones es `releases.log` del host y el historial del environment `production` | — |

## Brechas a cerrar antes del primer apply

Ordenadas por riesgo. «Cuándo» indica el último momento en que se puede cerrar sin costo extra. Las tareas de código están en [cambios-de-codigo.md](cambios-de-codigo.md), con el mismo número.

| # | Brecha | Riesgo | Cuándo | Cómo se cierra |
|---|---|---|---|---|
| B1 | El comando forzado del cloud-init (`cloud-init.yaml.tftpl:48-50`) rechaza el 5.º digest (`finance-ml`) con «argumentos de más», aunque `pfos-deploy.sh` ya lo acepta y `deploy.yml` ya lo envía (#234). Con `PFOS_ML_ENABLED=true`, el deploy termina **en rojo** con ese mensaje; no falla en silencio. ADR-0033 dice que el host lo acepta, y no es así | **Alto.** Cambiar `user_data` después del apply **reemplaza la instancia**. Conviene dejar el comando preparado también para una imagen propia de Keycloak (B6) | **Antes del primer apply** | C1 |
| B2 | Object Lock de 21 días para todo el bucket, clave del host con `deleteFiles` y lifecycle que borra lo oculto al día siguiente: un host comprometido puede destruir los 12 respaldos mensuales y las versiones de documentos con más de 21 días | **Alto.** Datos sensibles; la protección contra ransomware cubre 21 días, no un año | Antes del primer respaldo, es decir, del primer deploy. Los objetos ya escritos conservan su lock | C3 |
| B3 | pgBackRest nunca se probó contra un bucket B2 con Object Lock (PUT con checksum y `expire` sobre versiones bloqueadas) | **Alto.** Si falla, cae el PITR, requisito duro (RPO ≤ 15 min). La alternativa, N3, rompe el tope | En el PoC (fase 7), antes de los datos reales | Prueba 7.4 |
| B4 | El drill de restore «automatizado» de ADR-0027 no existe. El de §6 es manual, y para un solo operador eso significa que no se hace | **Alto.** Un respaldo nunca probado no cuenta | Antes de los datos reales | C5 y prueba 7.5 |
| B5 | La custodia de las claves maestras fuera del host (pgBackRest, `DOCUMENT_ENCRYPTION_KEYS`, `EXPORT_ENCRYPTION_KEYS` y la clave privada X25519) figura como recomendación, sin un paso verificable | **Alto.** Sin ellas, los respaldos y documentos de B2 son irrecuperables | Fase 4, antes de los datos reales | Fase 4, paso 3 |
| B6 | Keycloak corre `start` sin `--optimized`: rehace el build de Quarkus en cada arranque. Pico de ≈ 908 MiB contra un techo de 704m, y base de 0,4 vCPU contra un `--wait-timeout 420` | **Medio-alto.** Un OOM o un timeout al arrancar dispara el rollback automático, que arranca todo de nuevo y gasta más créditos de CPU | Antes del primer deploy | C7 |
| B7 | Nadie limpia las imágenes viejas, y nada avisa si el disco se llena | **Medio.** El disco de 60 GB se llena en silencio (swap de 2 GiB, spool de WAL de 2 GiB, volúmenes) y detiene PostgreSQL y el archivado | Antes de los datos reales | C6 |
| B8 | pgBackRest (archive-push asíncrono y backups por `compose exec`) corre dentro del techo de 384m de PostgreSQL, con 70 conexiones posibles | **Medio.** Un full con un pico de conexiones puede tirar la base entera | Medición en el PoC; cambio solo si la medición lo pide | C8 y prueba 7.3 |
| B9 | `ufw allow 22/tcp` abre el 22 a todo el mundo en el host. El firewall de Lightsail lo limita al alias `lightsail-connect` (`lightsail-host/main.tf`), así que hay una sola capa efectiva | **Medio-bajo.** Defensa en profundidad | **Antes del primer apply** (es cloud-init) | C2 y prueba 6.5 |
| B10 | `compose.prod.yaml` no monta el archivo 0400 de la clave privada de conexiones en el worker (`CONNECTION_CREDENTIALS_PRIVATE_KEYS_FILE`) | **Medio-bajo.** Sin él no funcionan las conexiones con exchanges. Si se monta un origen inexistente, se crea un directorio | Antes de habilitar conexiones | C10 |
| B11 | El snapshot diario de Lightsail sale a las 06:00 UTC, el mismo minuto que el full o el diff. Además, levantar PostgreSQL desde un snapshot reanuda el archivado en la misma stanza y rompe la continuidad del PITR | **Medio-bajo.** Vuelta atrás que parece segura y no lo es | Antes del primer apply (horario); la advertencia, en el runbook | C9 y C11 |
| B12 | La documentación no coincide con el repo: §2.1.5 pide dos hostnames y son tres (`files`, D316); §2.1.6 no nombra `finance-ml`; §5.2 no advierte lo de B11; docs/30 §8 y §12 describen el drill y las alarmas de la era RDS | **Bajo.** Confunde durante el primer despliegue | Antes de la fase 2 | C11 |
| B13 | El margen de ≈ USD 3,5 depende de los impuestos de AWS a Bolivia y del recargo de la tarjeta, que son supuestos. AWS Budgets solo avisa | **Bajo** en monto, **alto** en consecuencia: puede romper el tope | Con la primera factura | Regla de corte 5 |
| B14 | La web no declara Content-Security-Policy (nota del 2026-10-29 en ADR-0027). Caddy agrega HSTS, `nosniff` y `Referrer-Policy`, pero no CSP ni `frame-ancestors` | **Bajo.** Defensa en profundidad para una app con datos sensibles; si se define, tiene que incluir el origen `files` en `connect-src` | Antes de los datos reales | C13 |
| B15 | **CPU con ráfagas sin medir ni vigilar (ratificación 2026-11-24).** El plan de 2 GB tiene una base sostenida del 20 % por vCPU (0,4 vCPU en total). El import y los reportes largos son CPU de un hilo y variaron 1,65–1,9× entre CPUs de CI; el stack en reposo (28 consumidores de pg-boss que sondean, la JVM de Keycloak, Next y el archivado de WAL) nunca se midió contra esa base, y nada avisa si se agotan los créditos | **Medio-alto.** Si los créditos se agotan, la plataforma no cobra de más: degrada en silencio (imports de 30–90 s, reportes lentos, timeouts de Keycloak y rollbacks en cadena) | PoC (fase 7) y antes de los datos reales | C14: regla de corte de CPU en el PoC y alerta de créditos bajos en el heartbeat o en Grafana. N2 no la cierra; si falla, plan B |
| B16 | El cobro de las llamadas de clase D de B2, nuevo en la página de precios, no está claro para el patrón de pgBackRest (muchos PUT de WAL cada 5 min) | **Bajo.** Monto chico, pero sin medir | Primera factura de B2 | Revisar la primera factura de B2 y anotar el costo real en [`.despliegue.json`](.despliegue.json) (fase 9) |

## PoC de 48 h: regla de corte

ADR-0027 ya pedía un PoC de 48 h. El panel lo endureció: hay que medir **la memoria del host completo** (dockerd, containerd, tailscaled y journald incluidos, no solo la de los contenedores) y hacer **un restore PITR real desde B2**. Se corre en la fase 7, con datos ficticios y ML apagado.

| Señal (48 h con carga E2E y datos ficticios) | Umbral de corte |
|---|---|
| `MemAvailable` del host | Menos del 15 % de `MemTotal` durante más de 30 min seguidos (memoria > 85 %) |
| Swap-in | `pswpin` del log crece en todas las muestras de 30 min seguidos |
| OOM | Cualquier `OOMKilled` o línea `Out of memory` en `journalctl -k` |
| Arranque de Keycloak | Más de 300 s, o cualquier rollback automático disparado por el arranque. Es una señal mixta: se clasifica por causa (abajo) |
| Primer login | Mediana (p50) de 5 logins > 10 s, cronometrados desde que enviás el formulario de Keycloak hasta que se ve Inicio. Señal mixta: se clasifica por causa |
| Latencia desde Bolivia (supuesto de 112 ms, medido en 2026-10) | Mediana de 20 muestras de `time_connect` > 0,3 s (comando en la medición 4): no corta, pero reabre la comparación con Oracle A1 (63 ms) |
| Restore PITR desde B2 | Falla, o tarda más de 1 h (RTO observado) |
| pgBackRest con Object Lock | `expire` falla, o una versión bloqueada se puede borrar con la clave del host |
| **CPU en reposo (C14, ratificación 2026-11-24)** | Promedio de CPU del host ≥ 20 % (100 % = 2 vCPU) en una ventana de 6 h sin carga (la base sostenida del plan es 20 % por vCPU, 0,4 vCPU en total), o `BurstCapacityPercentage` < 50 % al final de esa ventana (mediciones 1 y 2) |
| **Import de 5 000 filas en el host (C14)** | Persistencia > 20 s con créditos disponibles, o > 60 s con créditos agotados (`BurstCapacityPercentage` en 0 durante el import). La persistencia es `completed_at − approved_at` del job (medición 3). Anotar `lscpu` junto a la medición |

El reporte de tendencias a 24 meses **no se mide en el host**: el Large Seed es solo local y CI (`scripts/stack/src/db.ts:4`), y en el host llenaría la base y dejaría respaldos bloqueados 21 días. Lo cubre la fila `report-trends-24m` del nightly `perf` (NFR-PERF-006, p95 ≤ 800 ms). La CPU del host frente a la de CI la mide el import.

### Cómo se mide cada señal de CPU y de latencia

1. **CPU promedio del host** (en el host, al terminar 6 h sin carga). El timer de la fase 7 deja la línea `cpu` de `/proc/stat` cada 5 min; los contadores son acumulados, así que el promedio de la ventana sale de la primera y la última muestra. Las 6 h son 73 muestras:

   ```bash
   grep '^cpu ' /var/log/pfos-poc-mem.log | tail -n 73 | awk 'NR==1{for(i=2;i<=9;i++)t0+=$i; b0=$2+$3+$4+$7+$8; s0=$9} {t=0; for(i=2;i<=9;i++)t+=$i; b=$2+$3+$4+$7+$8; s=$9} END{printf "CPU %.1f %% del host (100 %% = 2 vCPU), steal %.1f %%\n", 100*(b-b0)/(t-t0), 100*(s-s0)/(t-t0)}'
   ```

   Fórmula: CPU % = 100 × Δ(user + nice + system + irq + softirq) / Δ(user + nice + system + idle + iowait + irq + softirq + steal). El `steal` aparte es la señal de que el hipervisor está limitando la CPU (créditos agotados).

2. **Créditos de CPU** (Git Bash en tu máquina, con el perfil SSO de la fase 2; el nombre de la instancia sale de `infra/environments/prod/main.tf`):

   ```bash
   aws lightsail get-instance-metric-data --profile pfos-admin --region sa-east-1 --instance-name pfos-prod-host --metric-name BurstCapacityPercentage --period 300 --start-time "$(date -u -d '-6 hours' +%Y-%m-%dT%H:%M:%SZ)" --end-time "$(date -u +%Y-%m-%dT%H:%M:%SZ)" --unit Percent --statistics Minimum Average --query 'sort_by(metricData,&timestamp)[].[timestamp,minimum,average]' --output table
   ```

   Para el tope y el ritmo de acumulación, corré el mismo comando con `--metric-name BurstCapacityTime` (minutos de ráfaga disponibles, `--unit Seconds`) al empezar y al terminar la ventana de 6 h: la diferencia dividida por 6 es lo que el host acumula por hora en reposo.

3. **Persistencia del import** (en el host, con el alias `$C` de [Valores que vas a necesitar](#valores-que-vas-a-necesitar), después de aprobar el import y ver `COMPLETED`). El dominio fija `approved_at` al aprobar y `completed_at` al terminar la persistencia (`packages/contexts/imports/src/domain/import-job.ts`), y los dos quedan en `imports.import_job`:

   ```bash
   $C exec -T postgres psql -U postgres -d pfos -Atc "SELECT id, status, row_count, round(extract(epoch FROM completed_at - approved_at)::numeric, 1) AS segundos FROM imports.import_job WHERE approved_at IS NOT NULL ORDER BY approved_at DESC LIMIT 3"
   ```

   El `id` es el `importJobId` que aparece en los logs de la API y del worker. Corré la medición 2 con la ventana del import para saber si había créditos.

4. **Latencia** (Git Bash en tu máquina, desde Bolivia). Imprime las muestras 10 y 11 de 20 ordenadas; la mediana es su promedio:

   ```bash
   for i in $(seq 20); do curl -s -o /dev/null -w "%{time_connect}\n" $BASE/api/health/live; done | sort -n | sed -n '10,11p'
   ```

### Cómo se clasifica una señal mixta

El arranque lento de Keycloak y el primer login lento pueden venir de la memoria o de la CPU. En el momento en que aparecen, juntá en el host `free -m`, `grep -E '^pswpin ' /proc/vmstat`, `head -1 /proc/stat` y `docker stats --no-stream --format "{{.Name}} {{.CPUPerc}} {{.MemUsage}}"`, y en tu máquina la medición 2 con la ventana del evento:

| Qué se ve | Causa | Salida |
|---|---|---|
| `MemAvailable` < 15 %, `pswpin` creciendo, un contenedor pegado a su techo de memoria u `OOMKilled` | Memoria | N2 o plan B |
| Memoria normal, `BurstCapacityPercentage` en 0 o cerca, `steal` alto y `CPUPerc` de Keycloak (o de la API) limitado | CPU | Plan B |
| Las dos cosas a la vez | CPU (N2 no la resuelve) | Plan B |
| Memoria normal y créditos disponibles | No es la plataforma | Diagnosticar (C7, configuración) antes de cortar |

**Si se corta, la salida depende de la causa** (ratificación del 2026-11-24): N2 tiene las mismas 2 vCPU con la misma base del 20 %, así que **solo resuelve la memoria**. Las señales mixtas se clasifican con la tabla de arriba.

1. Primero, confirmá que ML esté apagado, que Keycloak arranque con `--optimized` (C7) y que los techos no se hayan subido sin medir.
2. **Corte por memoria → N2** (`lightsail_bundle_id = "medium_3_0"`, ≈ USD 27–30 por mes): solo si ampliás el presupuesto por escrito. Cambiar el plan reemplaza la VM: restaurar según §5.2.
3. **Corte por CPU → plan B** (Oracle A1, 2 OCPU sin créditos): N2 no lo arregla. Antes hay que hacer la preparación de la sección siguiente.
4. **Corte por memoria sin ampliación del presupuesto → plan B.**

**Si se corta por pgBackRest con Object Lock o por el restore:** no se cargan datos reales. Se diagnostica. Si el drill falla dos veces, ADR-0027 dice N3 (Neon), que rompe el tope y requiere tu decisión.

## Plan B: Oracle Cloud A1 (N1-F)

Hoy **no está listo**. Para no empezar de cero si el PoC falla, conviene decidir en la fase 1 si se prepara de antemano o si se acepta el N2 como salida. Lo que hay que preparar (detalle en [cambios-de-codigo.md](cambios-de-codigo.md): C12a para los puntos 1 y 2, C12b para el 3 y C12c para el 4 y el 5):

1. **Imágenes multi-arch** en `.github/workflows/main.yml`: matriz imagen × plataforma con runners nativos `ubuntu-24.04` y `ubuntu-24.04-arm`, push por digest y un job que arma el índice con `docker buildx imagetools create`. Hay que cuidar las attestations (`provenance mode=max`, `sbom: true`) y que verify-by-digest registre el digest del índice.
2. **Verificar la variante arm64**: smoke del stack y verify-by-digest en el runner arm. Si se agrega un check obligatorio, cambia la protección de `main` y eso requiere tu confirmación.
3. **Digests de terceros como índices multi-arch**: Caddy, SeaweedFS, Keycloak, `rclone/rclone:1.75.1` (lo usa la réplica de documentos) y las bases de los Dockerfile (node, python, uv y postgres).
4. **IaC nueva** `infra/modules/oci-host`: VCN, subred, security list 80/443, instancia `VM.Standard.A1.Flex` (2 OCPU y 8–12 GB), block volume de datos montado en `/var/lib/pfos`, IP reservada y presupuesto con alerta. El módulo `b2-backups` no cambia.
5. **Cloud-init adaptado**: paquetes aarch64, reglas de iptables propias de la imagen Ubuntu de OCI (`netfilter-persistent`) y sin la excepción del 22 para la consola de Lightsail.
6. **Cuenta OCI en Pay-As-You-Go** (Vos), para atenuar el reclamo de instancias ociosas, con alerta de presupuesto de USD 1.
7. **Riesgos que no se resuelven con código**: capacidad A1 escasa en Santiago (región de un solo AD), reclamo de instancias ociosas (la memoria residente queda cerca del umbral del 20 %) y cambios del free tier sin aviso. La réplica de documentos es nocturna: ante la pérdida de la cuenta se pierden hasta 24 h de documentos.

Estimación del panel: más de ½–1 día, por las attestations y el módulo nuevo.

## Reglas de corte

Parate y no sigas si pasa algo de esto:

1. **La plataforma pide algo que no estaba previsto:** un medio de pago distinto, un depósito o un plan que no es el de 2 GB. Revisá antes de aceptar.
2. **Una verificación de seguridad de la fase 6 da otro resultado:** lo protegido responde 200, `/admin` de Keycloak responde, el 22 está abierto desde Internet o falta una cabecera.
3. **El PoC de la fase 7 cruza un umbral** de la tabla de la regla de corte.
4. **Aparece un dato real o un secreto** en un archivo versionado, en un log de Actions o en un comando guardado en el historial.
5. **La primera factura real supera los USD 20** con impuestos y recargo de la tarjeta. Se pausa y se decide entre recortar (apagar snapshots o ML) o ampliar el presupuesto.
6. **Un drill de restore falla.** Dos seguidos llevan a decidir N3.

No cargues datos reales hasta terminar la fase 7.

## Valores que vas a necesitar

| Valor | Ejemplo (forma, nunca el valor real) | Dónde vive |
|---|---|---|
| Dominio y hostnames | `app.<dominio>`, `auth.<dominio>`, `files.<dominio>` | DNS (Cloudflare, solo DNS) y `/etc/pfos/pfos.env` (`PF_DOMAIN_APP`, `PF_DOMAIN_AUTH`, `PF_DOMAIN_FILES`) |
| Email ACME y de alertas de Budgets | una dirección del owner | `pfos.env` (`PF_ACME_EMAIL`) y `prod.tfvars` (`budget_alert_email`) |
| Passphrase del state de OpenTofu | ≥ 16 caracteres | Gestor de contraseñas; se lee con `read -rs` |
| Clave temporal de B2 para el apply | id y secreto, vencimiento de 1 día | Variables de entorno de la sesión; se borra después |
| Claves B2 del host y de restore | `tofu output` | `/etc/pfos/pgbackrest.env` y el gestor |
| Passphrases de pgBackRest (repo1 y repo2) | `openssl rand -base64 48` | `/etc/pfos/pgbackrest.env` y **copia cifrada fuera del host** |
| Llaveros de documentos y exports, secretos de roles y de OIDC | generados en el host | `/etc/pfos/pfos.env` y **copia cifrada fuera del host** |
| Clave privada X25519 de conexiones | `kid:clave`, una por línea | Archivo 0400 en `/etc/pfos` y **copia cifrada fuera del host** |
| Token del servicio de pronósticos | `openssl rand -hex 32` | `/etc/pfos/ml-service-token` |
| OTLP de Grafana Cloud | endpoint y cabecera de solo escritura | `pfos.env` (`PF_OTLP_ENDPOINT`, `OTEL_EXPORTER_OTLP_HEADERS`) |
| URL del heartbeat | URL de healthchecks.io | `pfos.env` (`PF_BACKUP_HEARTBEAT_URL`) |
| Clave SSH de deploy y host key | `~/.ssh/pfos-deploy`, `known_hosts.pfos` | Secretos del environment `production` (`DEPLOY_SSH_KEY`, `DEPLOY_SSH_KNOWN_HOSTS`) |
| Federación OIDC de Tailscale | client id y audience | Variables del environment `production` (`TS_OIDC_CLIENT_ID`, `TS_OIDC_AUDIENCE`) |

Los comandos de tu máquina corren en **Git Bash** desde la raíz del repo. Los del host corren en bash, entrando con `ssh ubuntu@pfos-prod` por la tailnet y después `sudo -i`.

```bash
BASE=https://app.<dominio>
```

```bash
AUTH=https://auth.<dominio>
```

```bash
FILES=https://files.<dominio>
```

En el host, el alias de Compose de §5, con rutas absolutas para que funcione desde cualquier directorio:

```bash
C="docker compose -f /opt/pfos/repo/deploy/compose/compose.yaml -f /opt/pfos/repo/deploy/compose/compose.prod.yaml --env-file /etc/pfos/pfos.env --env-file /var/lib/pfos/release.env --profile core"
```

## Fase 0: cerrar las brechas de código (Claude)

1. Implementar C1 a C11, C13 y C14 (C12a a C12c solo según la decisión 2 de la fase 1) de [cambios-de-codigo.md](cambios-de-codigo.md) en una rama por cambio, con su change de OpenSpec cuando toque comportamiento (el CLAUDE.md del repo lo exige), y fusionar con los 18 checks en verde.
2. Ensayar en local el cambio de Keycloak (C7), siempre con un proyecto propio y prefijo 3 o 4:

   ```bash
   PF_E2E_PROJECT=pfos-e2e-deploystrat PF_E2E_PORT_PREFIX=3 pnpm test:e2e
   ```

3. Correr los gates del repo: `pnpm format:check`, `pnpm turbo typecheck lint test build`, `pnpm arch:check`, `pnpm spec:validate` y `pnpm config:docs:check`.
4. Comprobar que no haya secretos en el historial: lo cubre el check `secrets` de CI (gitleaks); en un worktree, gitleaks local escanea 0 commits.

**Terminada cuando:** `git grep -n 'finance-ml' -- infra/modules/lightsail-host/cloud-init.yaml.tftpl` devuelve la validación del 5.º argumento; `ls deploy/host/systemd/` lista `pfos-restore-drill.timer` (C5) y `pfos-image-prune.timer` con su `.service` (C6); C14 está reflejado en este runbook (mediciones de la regla de corte y alarma de la fase 7), sin código en el host; y `gh run list --workflow main.yml --branch main --limit 1` muestra `completed` y `success`. La salida `ml` del job `resolve` de `deploy.yml` ya está (#234): `git grep -n 'steps.refs.outputs.ml' -- .github/workflows/deploy.yml` la devuelve hoy.

## Fase 1: decisiones del owner (Vos)

Antes de abrir cuentas, respondé las preguntas de [docs/71](../71-despliegue-n1-questions.md) (opciones y recomendación en cada una) y anotá las respuestas en docs/38:

1. **Dominio** definitivo (pendiente del perfil).
2. **Salida si el PoC falla, separada por causa** (ratificación del 2026-11-24): por memoria, ampliar a N2 (≈ USD 27–30) o ir al plan B; por CPU, solo el plan B, porque N2 no suma CPU sostenida. Decidí además si la preparación del plan B (C12a y C12b, multi-arch en una rama) se hace **antes** del PoC o se acepta hacerla con el PoC caído. Recomendación del panel: decidirlo ahora, no con el host ya caído.
3. **Retención de los mensuales** (C3): bucket aparte con lock de 13 meses (recomendado) o quitar `deleteFiles` de la clave del host para el prefijo mensual.
4. **Drill programado** (C5): drill local mensual en el host con la clave de solo lectura, más el drill fuera del host (§6) cada trimestre (recomendado).
5. **Datos demo durante el PoC:** habilitar `DEMO_DATA_ENABLED=true` solo durante la fase 7 y volverlo a `false` en la limpieza (recomendado), o no usar la demo. Si no la habilitás, la [guía de pruebas](GUIA-PRUEBAS-FUNCIONALES.md#04-si-la-demo-no-se-habilita) dice qué casos dejan de ser bloqueantes.
6. **Lectura de un PDF que cuadra** en la guía: dejarla para tus extractos reales (recomendado) o pedir un PDF sintético en disco.

**Terminada cuando:** docs/38 tiene las seis respuestas con fecha.

## Fase 2: cuentas (Vos)

Seguí §2.1 de [deploy-and-restore.md](../runbooks/deploy-and-restore.md) con estas correcciones (B12):

- En §2.1.5, son **tres** hostnames: `app`, `auth` y `files` (D316), todos en modo solo DNS.
- En §2.1.6, los paquetes de GHCR son **cuatro**: `finance-api`, `finance-web`, `pfos-postgres` y `finance-ml`.
- En AWS, activá **MFA en root**, creá el usuario de IAM Identity Center y suscribite a las alertas de Budgets.
- En Git Bash, configurá el perfil SSO del CLI (región `sa-east-1`, perfil `pfos-admin`) e iniciá sesión:

  ```bash
  aws configure sso --profile pfos-admin
  ```

  ```bash
  aws sso login --profile pfos-admin
  ```

**Terminada cuando:** `aws sts get-caller-identity --profile pfos-admin` devuelve tu cuenta, la consola de B2 muestra la cuenta sin buckets todavía y `nslookup -type=NS <dominio>` responde con los nameservers de Cloudflare.

## Fase 3: infraestructura (Vos)

1. Revisá el plan **antes** de aplicar. Seguí §2.2 hasta `tofu init`. Ojo: la línea de §2.2 encadena `plan && apply`; corré solo el plan:

   ```bash
   tofu plan -var-file=prod.tfvars -out=prod.tfplan
   ```

2. En el plan, comprobá tres cosas:
   - que `user_data` incluya la validación del 5.º digest: `tofu show prod.tfplan | grep -c 'finance-ml'` da 1 o más;
   - que el bucket (o los buckets, según C3) tenga el lock decidido en la fase 1;
   - que el snapshot salga fuera de la ventana de 06:00–07:30 UTC.
3. `tofu apply prod.tfplan`, borrá la clave temporal de B2 y creá los registros A de los tres hostnames con `host_public_ip`.

**Terminada cuando:** `tofu output` muestra la IP y los ids de las claves, y `nslookup app.<dominio>`, `nslookup auth.<dominio>` y `nslookup files.<dominio>` devuelven esa IP.

## Fase 4: secretos y custodia (Vos)

Nunca pongas estos valores en un archivo versionado, en el repo, en un log de Actions ni en un chat.

1. Seguí §2.3 en la consola web de Lightsail.
   - **Prefijo del PoC (C4), antes del primer deploy:** agregá al final de `/etc/pfos/pgbackrest.env` `PGBACKREST_REPO1_PATH=/pgbackrest/poc/pitr` y `PGBACKREST_REPO2_PATH=/pgbackrest/poc/monthly`. Tiene que estar antes de la fase 6: el primer deploy crea la stanza y el primer full, y si caen en el prefijo de producción, la stanza queda atada al cluster ficticio (otro `system-id`) y `stanza-create` falla después de borrar los datos del PoC, con esos objetos bloqueados 21 días.
2. Generá el par X25519 y el token de ML según [conectar-un-exchange-y-revocar-una-clave.md](../runbooks/conectar-un-exchange-y-revocar-una-clave.md) y la nota as-built del final del runbook vigente, aunque todavía no los uses.
3. **Custodia (B5):** cifrá `pfos.env`, `pgbackrest.env` y el archivo de la clave privada X25519 con `age -p` y guardalos en tu gestor de contraseñas, **fuera del host y fuera de AWS**. Los archivos en claro nunca salen del host:
   - En el host (`sudo -i`), instalá `age` y cifrá en una carpeta que `ubuntu` pueda leer. `age -p` pide la passphrase por la terminal; usá una del gestor, distinta de las de pgBackRest:

     ```bash
     apt-get install -y age && install -d -o ubuntu -m 0700 /home/ubuntu/custodia
     ```

     ```bash
     for f in /etc/pfos/pfos.env /etc/pfos/pgbackrest.env /etc/pfos/<archivo-x25519>; do age -p -o "/home/ubuntu/custodia/$(basename "$f").age" "$f"; done; chown ubuntu /home/ubuntu/custodia/*.age
     ```

   - En tu máquina, en Git Bash y por la tailnet, copiá solo los `.age` y borrá la carpeta del host:

     ```bash
     mkdir -p ~/custodia-pfos && scp 'ubuntu@pfos-prod:custodia/*.age' ~/custodia-pfos/ && ssh ubuntu@pfos-prod 'rm -r ~/custodia'
     ```

   - En PowerShell (con `age.exe` instalado, por ejemplo con `winget install FiloSottile.age`), comprobá que cada uno se descifra sin escribir el contenido en disco. Cada línea debe imprimir `0`:

     ```powershell
     Get-ChildItem "$env:USERPROFILE\custodia-pfos\*.age" | ForEach-Object { age.exe -d $_.FullName > $null; $LASTEXITCODE }
     ```

   - Subí los `.age` al gestor de contraseñas y borralos de `custodia-pfos`.
4. Listá los nombres cargados, sin valores:

   ```bash
   grep -ohE '^[A-Z0-9_]+=' /etc/pfos/pfos.env /etc/pfos/pgbackrest.env | sort | uniq
   ```

5. Comprobá que no quede ningún marcador sin completar:

   ```bash
   grep -cE '__set__|__generate__' /etc/pfos/pfos.env /etc/pfos/pgbackrest.env
   ```

**Terminada cuando** (comandos en el host, como root):

- la diferencia entre los nombres de las plantillas y los cargados muestra solo `> PGBACKREST_REPO1_PATH=` y `> PGBACKREST_REPO2_PATH=` (los del prefijo del PoC):

  ```bash
  diff <(grep -ohE '^[A-Z0-9_]+=' /opt/pfos/repo/deploy/host/etc-pfos/pfos.env.example /opt/pfos/repo/deploy/host/etc-pfos/pgbackrest.env.example | sort -u) <(grep -ohE '^[A-Z0-9_]+=' /etc/pfos/pfos.env /etc/pfos/pgbackrest.env | sort -u)
  ```

- `grep -c '^PGBACKREST_REPO[12]_PATH=/pgbackrest/poc/' /etc/pfos/pgbackrest.env` da `2`;
- el paso 5 da `0` en ambos archivos;
- y el paso 3 imprimió `0` para cada `.age`, que ya están en el gestor.

## Fase 5: Tailscale y GitHub (Vos)

1. Seguí §2.4 y §2.5.
2. En el environment `production`, dejá `PFOS_ML_ENABLED` **sin definir** (ML apagado durante el PoC).

**Terminada cuando:** `ssh ubuntu@pfos-prod hostname` responde por la tailnet, y `gh secret list --env production` y `gh variable list --env production` muestran `DEPLOY_SSH_KEY`, `DEPLOY_SSH_KNOWN_HOSTS`, `DEPLOY_HOST`, `PFOS_APP_URL`, `TS_OIDC_CLIENT_ID` y `TS_OIDC_AUDIENCE`, y `PFOS_ML_ENABLED` no aparece en `gh variable list --env production`.

## Fase 6: primer deploy y verificación sin login (Claude, con tu confirmación)

1. Claude te muestra el SHA de `main` con `main.yml` en verde y espera tu confirmación.

   ```bash
   gh workflow run deploy.yml -f action=deploy -f commit_sha=<SHA>
   ```

2. Vos aprobás el environment en GitHub.
3. Vos, en el host: `pfos-bootstrap-storage.sh` y el primer full, según §2.6.2.
4. Claude corre desde afuera las comprobaciones 1 a 6. Las 7 y 8 las hacés Vos: la 7 en el navegador y la 8 en el host.

| # | Comprobación | Resultado esperado |
|---|---|---|
| 1 | `curl -s -o /dev/null -w "%{http_code}\n" $BASE/api/health/ready` | `200` |
| 2 | `curl -s -o /dev/null -w "%{http_code}\n" $BASE/api/bff/v1/workspaces` (sin sesión) | `401` o `403` |
| 3 | `curl -s -o /dev/null -w "%{http_code}\n" $AUTH/admin/` | `404` |
| 4 | `curl -s -o /dev/null -w "%{http_code}\n" $FILES/` y un `GET` a cualquier objeto | `404` |
| 5 | En PowerShell, con Tailscale desconectado: `22, 5432, 8080, 8333 \| ForEach-Object { Test-NetConnection -ComputerName <IP> -Port $_ -WarningAction SilentlyContinue \| Select-Object RemotePort, TcpTestSucceeded }` | `TcpTestSucceeded` en `False` para los cuatro |
| 6 | `curl -sI $BASE/ \| grep -iE 'strict-transport-security\|x-content-type-options\|referrer-policy'` | Las tres cabeceras |
| 7 | (Vos) Atajos de desarrollo: login en `$BASE` con uno de los usuarios demo de `realm-pfos-dev.json` (los dos realms se llaman `pfos`; el de producción no trae usuarios) | El login falla con credenciales inválidas |
| 8 | (Vos) En el host: `grep -E '^(DEMO_DATA_ENABLED\|IMPORTS_PROVIDER_FAKE_ENABLED)=' /etc/pfos/pfos.env` | Ninguno en `true` |

**Regla de corte:** si 2, 3, 4, 5 o 7 no coinciden, parate.

**Terminada cuando:** las ocho comprobaciones coinciden y, después de lanzar `gh workflow run deploy.yml -f action=status` y aprobarlo, `gh run list --workflow deploy.yml --limit 1` muestra `completed` y `success`, y el resumen del job muestra el SHA desplegado.

## Fase 7: PoC de 48 h con datos ficticios (Vos y Claude)

**Esta fase decide si se puede confiar en el despliegue.** Solo datos inventados.

1. **Repositorio de respaldo del PoC.** Comprobá que `pgbackrest.env` apunte al prefijo del PoC desde la fase 4 (C4): `grep -E '^PGBACKREST_REPO[12]_PATH=' /etc/pfos/pgbackrest.env` muestra las dos rutas `/pgbackrest/poc/…`. La réplica de documentos no tiene prefijo de PoC: los documentos ficticios quedan como versiones ocultas en `documents/` hasta que el lifecycle los purgue.

   **Datos demo** (si en la decisión 5 de la fase 1 elegiste habilitarlos): en el host, poné `DEMO_DATA_ENABLED=true` en `/etc/pfos/pfos.env` y redeploy del mismo SHA (fase 6, paso 1). La comprobación 8 de la fase 6 da distinto mientras dure el PoC; la limpieza lo vuelve a `false`.

2. **Medición del host completo** (Vos, en el host). Deja una muestra cada 5 minutos en un timer transitorio, con memoria y la línea `cpu` de `/proc/stat` (sin `sysstat`, que no está en los paquetes del cloud-init):

   ```bash
   systemd-run --unit=pfos-poc-mem --on-calendar='*:0/5' /bin/sh -c 'date -u -Iseconds >> /var/log/pfos-poc-mem.log; grep -E "MemTotal|MemAvailable|SwapFree" /proc/meminfo >> /var/log/pfos-poc-mem.log; grep -E "^pswpin " /proc/vmstat >> /var/log/pfos-poc-mem.log; head -1 /proc/stat >> /var/log/pfos-poc-mem.log; ps -o rss=,comm= -C dockerd,containerd,tailscaled,systemd-journald >> /var/log/pfos-poc-mem.log; docker stats --no-stream --format "{{.Name}} {{.CPUPerc}} {{.MemUsage}}" >> /var/log/pfos-poc-mem.log'
   ```

   - Anotá el modelo de CPU del host junto a la medición: `lscpu | grep -E 'Model name|^CPU\(s\)'`.
   - Dejá **6 h sin carga** al principio (sin logins ni imports) y medí la CPU en reposo y los créditos (mediciones 1 y 2 de la [regla de corte](#cómo-se-mide-cada-señal-de-cpu-y-de-latencia), incluido el tope y el ritmo de acumulación con `BurstCapacityTime`).
   - **Alarma de créditos (C14, Vos, en Git Bash):** creá el contacto por email y confirmalo desde el correo que te llega; después, la alarma del 30 % y una prueba forzada. Tiene que llegar el email de `ALARM` y, al volver, el de `OK`:

     ```bash
     aws lightsail create-contact-method --profile pfos-admin --region sa-east-1 --protocol Email --contact-endpoint <tu-email>
     ```

     ```bash
     aws lightsail put-alarm --profile pfos-admin --region sa-east-1 --alarm-name pfos-creditos-cpu --monitored-resource-name pfos-prod-host --metric-name BurstCapacityPercentage --comparison-operator LessThanThreshold --threshold 30 --evaluation-periods 1 --datapoints-to-alarm 1 --treat-missing-data breaching --contact-protocols Email --notification-triggers ALARM OK
     ```

     ```bash
     aws lightsail test-alarm --profile pfos-admin --region sa-east-1 --alarm-name pfos-creditos-cpu --state ALARM
     ```

     ```bash
     aws lightsail test-alarm --profile pfos-admin --region sa-east-1 --alarm-name pfos-creditos-cpu --state OK
     ```

3. **Carga:** datos demo por la acción de la aplicación (si los habilitaste), el import de 5 000 filas de la [guía](GUIA-PRUEBAS-FUNCIONALES.md#19-pruebas-de-operación) con su persistencia medida (medición 3 de la regla de corte), la lectura de un PDF de prueba, 5 logins cronometrados y un deploy del mismo SHA (arranque de Keycloak en frío). Claude puede generar la carga desde afuera con la suite E2E apuntada a `$BASE` si la configurás para eso.
4. **pgBackRest con Object Lock (B3):** forzá un segundo full (el primero es el de la fase 6) y un `expire` por cantidad que intente quitar el primero, todavía bloqueado, y comprobá que los dos terminen en 0. Con la retención por tiempo de `pgbackrest.conf` (14 días) el `expire` no tocaría nada:

   ```bash
   $C exec -T postgres pgbackrest --stanza=pfos --repo=1 --type=full backup
   ```

   ```bash
   $C exec -T postgres pgbackrest --stanza=pfos --repo=1 --repo1-retention-full-type=count --repo1-retention-full=1 expire
   ```

   Después, con la **clave del host** y el CLI de B2 en tu máquina, intentá borrar una versión bloqueada del prefijo `pgbackrest/poc/`: debe fallar. En Git Bash, la clave se lee sin eco y viaja por variables de entorno, nunca en los argumentos ni en el historial (`<bucket>` es `b2_bucket_name` de `prod.tfvars`):

   ```bash
   read -rs -p 'keyID del host: ' B2_APPLICATION_KEY_ID; echo; read -rs -p 'applicationKey del host: ' B2_APPLICATION_KEY; echo; export B2_APPLICATION_KEY_ID B2_APPLICATION_KEY
   ```

   ```bash
   b2 ls --versions --recursive b2://<bucket>/pgbackrest/poc/pitr/ | head -3
   ```

   ```bash
   b2 rm --versions "b2://<bucket>/<una ruta de la lista anterior>"
   ```

   ```bash
   b2 account clear; unset B2_APPLICATION_KEY_ID B2_APPLICATION_KEY
   ```

   El `rm` debe fallar por el lock. La sintaxis es la del CLI `b2` 4.x; si tenés otra versión, confirmala con `b2 rm --help`.
5. **Restore PITR real desde B2 (B4):** anotá la hora T0, creá una transacción ficticia, esperá 6 minutos (más que `archive_timeout`), anotá T1 y creá otra. Seguí §6 en la VM de drill con la clave de solo lectura, sumando a su `pgbackrest.env` las dos líneas `PGBACKREST_REPO{1,2}_PATH` del PoC y restaurando con `--type=time --target='<T entre T0 y T1>' --target-action=promote`. Debe aparecer la primera y no la segunda, y las consultas de integridad de §6.4 deben dar 0. Medí el tiempo total.
6. **Otra cuenta no entra:** creá en el realm un segundo usuario ficticio y comprobá en el navegador que no ve el workspace del primero y que la API le responde `403` o `404`.
7. **Memoria de PostgreSQL durante el full (B8):** `docker stats --no-stream postgres` mientras corre el paso 4 con carga.
8. **Limpieza de imágenes y alerta de disco (B7):** `systemctl start pfos-image-prune.service` y `df -h /`.
9. **Cierre de la medición:** `systemctl stop pfos-poc-mem.timer`.

| # | Prueba | Resultado esperado |
|---|---|---|
| 1 | Camino principal de punta a punta: login, cuenta, transacción, import y reporte | Funciona |
| 2 | Segundo dispositivo o navegador | Mismos datos |
| 3 | **Peor caso de memoria del host completo** durante 48 h | Dentro de los umbrales de la regla de corte |
| 4 | pgBackRest con Object Lock | `expire` en 0 y versión bloqueada imborrable con la clave del host |
| 5 | Restore PITR desde B2 | Datos hasta T, integridad en 0 y RTO < 1 h |
| 6 | Otra cuenta | Sin acceso |
| 7 | PostgreSQL durante el full | Pico < 85 % de su techo |
| 8 | Recargar y reiniciar el host (`sudo reboot`) | Todo vuelve solo y los datos siguen |
| 9 | CPU (C14): 6 h en reposo, créditos (tope y acumulación) e import de 5 000 filas, con `lscpu` anotado; alarma de créditos probada | Dentro de los umbrales de CPU de la regla de corte; llegaron los emails de `ALARM` y `OK` |
| 10 | Casos bloqueantes de la [guía de pruebas funcionales](GUIA-PRUEBAS-FUNCIONALES.md) | Todos pasan |

**Borrar los datos ficticios antes de seguir** (Vos, en el host):

1. `$C down` y borrar los volúmenes de PostgreSQL y SeaweedFS: `docker volume rm pfos_pg-data pfos_object-storage-data` (confirmá los nombres con `docker volume ls`). La base de Keycloak vive en el mismo PostgreSQL: se borran también el usuario ficticio, tu admin permanente y tu usuario.
2. Quitá las dos líneas `PGBACKREST_REPO{1,2}_PATH` de `/etc/pfos/pgbackrest.env` para volver a los prefijos de `pgbackrest.conf`. Si habilitaste los datos demo, volvé `DEMO_DATA_ENABLED` a `false` en `/etc/pfos/pfos.env`.
3. Deploy del mismo SHA (fase 6, paso 1): `migrate` crea el esquema vacío, Keycloak reimporta el realm y `ensure_stanza` crea la stanza limpia en el prefijo de producción, que está vacío.
4. Repetí §2.6.2 (`pfos-bootstrap-storage.sh` y el primer full) y §2.6.3 (admin permanente con OTP y tu usuario).

Los respaldos ficticios quedan en `pgbackrest/poc/` hasta que venza su lock; después el lifecycle los purga.

**Terminada cuando:** las diez pruebas pasan, `/var/log/pfos-poc-mem.log` muestra 48 h sin cruzar ningún umbral de la regla de corte (memoria y CPU), y, después de la limpieza, `$C exec -T postgres pgbackrest --stanza=pfos info` muestra solo el full nuevo en el prefijo de producción y la comprobación 8 de la fase 6 vuelve a dar ninguno en `true`.

## Fase 8: migrar los datos reales (Vos)

1. Sin datos reales en ningún sistema anterior, no hay migración: el owner empieza a cargar en producción. Si tenés un export de workspace de otro entorno, restauralo con [restaurar-workspace-desde-export.md](../runbooks/restaurar-workspace-desde-export.md).
2. Antes de cargar nada, repetí la comprobación 8 de la fase 6 en el host: ninguno de `DEMO_DATA_ENABLED` e `IMPORTS_PROVIDER_FAKE_ENABLED` en `true`.
3. Forzá un full inmediato: `systemctl start pfos-backup@full.service`.

**Terminada cuando:** la comprobación 8 de la fase 6 dio ninguno en `true`, los saldos de tus cuentas en PFOS coinciden con tus extractos del día, o con el export de origen (mismo número de transacciones por cuenta), y `journalctl -u pfos-backup@full -n 20` termina sin error.

## Fase 9: dispositivos y uso final (Vos)

1. Grafana Cloud: checks sintéticos según §2.6.4, más una alerta por el heartbeat de respaldos.
2. Alertas de Budgets confirmadas. La alarma de `BurstCapacityPercentage` (< 30 %) ya quedó creada y probada en la fase 7.
3. **Con la primera factura** (supuestos de la ratificación): anotá el recargo y los impuestos reales de la tarjeta en la de AWS (regla de corte 5) y el cobro de clase D en la de B2 (B16), y pasá los dos montos a [`.despliegue.json`](.despliegue.json).
4. Si querés ML (requiere C1 fusionado y aplicado): seguí la nota as-built del runbook vigente y repetí la medición de memoria de la fase 7 durante 48 h.

**Terminada cuando:** el check sintético está en verde y llegó un email de prueba de cada alerta.

## Publicar una actualización

1. PR contra `main` con los 18 checks en verde (auto-merge squash, trunk).
2. Las migraciones son solo expand y las aplica `migrate` **antes** de que arranquen api y worker (dependencia de `up --wait`). Antes de migrar, `pfos-deploy.sh` hace un backup incremental anotado con el SHA.
3. `main.yml` construye una vez y registra los digests. Despliegue: `gh workflow run deploy.yml -f action=deploy -f commit_sha=<SHA>` y aprobación en el environment `production`.
4. Repetir las comprobaciones 1 a 6 de la fase 6.
5. Versionado: el proyecto no usa tags ni changelog. El registro es `/var/lib/pfos/releases.log` del host y el historial del environment `production`. Si querés tags (`prod-AAAA-MM-DD`), es una decisión aparte.

## Volver atrás

**Código.** `gh workflow run deploy.yml -f action=rollback`, o en el host `sudo /usr/local/sbin/pfos-deploy rollback` (§4). Vuelve al release anterior con los mismos digests. **No revierte la base.**

**Base de datos.** PITR en el mismo host según §5.1, a un instante anterior al daño o al backup `pre-migrate` del release. Sobrescribe todo lo escrito después de ese instante: antes, tomá el backup de evidencia de §5.1.2 y congelá las escrituras.

**Snapshot de Lightsail.** Solo si se perdió el host. **No arranques PostgreSQL del snapshot con el archivado activo:** reanudaría el WAL en la misma stanza y rompería la continuidad del PITR. Restaurá encima desde B2 (§5.2.1) antes de abrir el tráfico.

**Aplicación fuera de servicio.** No hay nada más: un solo host. Los datos siguen en B2 (PITR y réplica de documentos) y en tu copia cifrada de los secretos. Se reconstruye con `tofu apply -replace=…` y §5.2.2, con un RTO objetivo ≤ 4 h.

## Respaldos

| Respaldo | Cuándo | Cubre | Límite |
|---|---|---|---|
| WAL continuo (repo1) | `archive_timeout` de 5 min | PITR, RPO ≤ 5 min | Spool de 2 GiB: si B2 no responde, se descarta WAL |
| Full semanal y diff diario (repo1) | Dom 06:00 y lun–sáb 06:00 UTC | PITR de 14 días | Lock de 21 días |
| Full mensual (repo2) | Día 1, 07:00 UTC | 12 meses | **Borrable desde el host después de 21 días hasta cerrar B2** |
| Réplica de documentos | 07:30 UTC | Bucket de documentos cifrados | Hasta 24 h de documentos sin réplica |
| Snapshot de Lightsail | Diario, 7 retenidos | Host completo | Vive en AWS, igual que los datos. Pierde hasta 24 h |
| Check horario | Cada hora | Archivado y antigüedad del último backup | Avisa solo si configuraste el heartbeat |
| Copia cifrada de los secretos | Al crearlos y en cada rotación | Claves maestras | En tu gestor, fuera del host |

B2 es el respaldo que no vive en la misma plataforma que los datos. Una vez por mes, el drill (C5) restaura y comprueba la integridad; cada trimestre, el drill fuera del host de §6. Un respaldo que nunca se probó no cuenta.

## Límites del plan

Al superar un límite, Lightsail **no bloquea**: limita la CPU a la línea base, cobra la transferencia excedente o deja que el disco se llene. AWS Budgets **avisa y no corta**.

| Recurso | Límite | Qué pasa | Cuándo revisar |
|---|---|---|---|
| RAM | 2 GB más 2 GiB de swap | OOM de un contenedor | Mensual y tras cada change que agregue servicios |
| CPU | 2 vCPU con base del 20 % por vCPU | Se limita a la base al agotar los créditos | Alarma de `BurstCapacityPercentage` |
| Disco | 60 GB SSD | PostgreSQL y el archivado se detienen | Alerta de disco (C6), semanal |
| Transferencia | 1,5 TB por mes en São Paulo | Cobra el excedente | Trimestral |
| Conexiones a PostgreSQL | 64 de 67 útiles (`max_connections=70`) | Errores de conexión | Antes de agregar consumidores |
| B2 | 10 GB gratis, después USD 6,95 por TB-mes | Cobra | Trimestral |
| Grafana Cloud Free | 50 GB de logs, 14 días | Deja de ingerir | Trimestral |
| Presupuesto | USD 20 por mes | Solo avisa (80 % real, 100 % pronosticado) | Cada factura |

## Mantenimiento

| Tarea | Frecuencia |
|---|---|
| Revisar el resultado del drill automático (heartbeat) | Mensual |
| Drill fuera del host (§6), con RTO observado | Trimestral |
| Revisar memoria, disco y créditos de CPU | Mensual |
| Revisar la factura en moneda real (con recargo de la tarjeta) | Mensual |
| Actualizar dependencias e imágenes de terceros (Renovate), en local primero | Con cada PR de Renovate |
| Parches del SO | Automáticos; revisar `/var/log/unattended-upgrades/` mensualmente |
| Rotar secretos (§7) y actualizar la copia cifrada | Semestral, o ante una sospecha |
| Revisar cambios de planes de Lightsail, B2, Tailscale y Grafana Cloud | Trimestral |

## Problemas frecuentes

| Síntoma | Causa probable | Qué hacer |
|---|---|---|
| El deploy termina en rojo con «argumentos de más» | `deploy.yml` ya manda el digest de ML, pero el cloud-init aplicado no tiene C1 | Apagar ML (`PFOS_ML_ENABLED` sin definir) y desplegar; corregir el cloud-init exige reemplazar la instancia (§5.2) |
| El deploy hace rollback solo y Keycloak aparece `unhealthy` | OOM o timeout en el arranque de Keycloak | `docker inspect -f '{{.State.OOMKilled}}'` del contenedor; aplicar C7 |
| `pfos-backup@check` falla | Credenciales de B2, red o cola de WAL llena | §7 del runbook vigente; hacer un full apenas se corrija |
| La web tarda más de 10 s en el primer login | Swap o créditos de CPU agotados | `vmstat 5`, `free -m` y la métrica de ráfaga; regla de corte |
| El disco supera el 80 % | Imágenes viejas, spool de WAL o logs | `docker system df`; correr la limpieza (C6) |
| Las subidas de documentos fallan | Falta el registro DNS de `files` o el CORS del bucket | Fase 3 y `pfos-bootstrap-storage.sh` |
| El certificado no se emite | Registros con proxy de Cloudflare activo | Pasarlos a solo DNS |

Para ver los errores de producción: Grafana Cloud (logs y trazas por OTLP), o en el host:

```bash
cd /opt/pfos/repo/deploy/compose && $C logs --since 1h finance-api finance-worker keycloak
```

## Salir de Lightsail

- **Exportar:** los respaldos de PostgreSQL ya están en B2, fuera de AWS. Los documentos, en la réplica de B2. El realm de Keycloak se exporta con `kc.sh export`. Los secretos, en tu copia cifrada.
- **Plan B:** Oracle A1 (sección Plan B) o cualquier VPS con Docker Compose: se levanta el mismo compose y se restaura con `pgbackrest restore` desde B2. Lo propio de AWS es `infra/modules/lightsail-host` (unas 280 líneas, casi la mitad en un cloud-init que se reaprovecha) y Budgets.
- **Irreversible:** `tofu destroy` borra la instancia, la IP estática y los snapshots. En B2, **Object Lock no se puede desactivar** en un bucket que lo tiene: el bucket no se puede borrar hasta que venzan los locks, y se sigue pagando ese almacenamiento (centavos).

## Cierre del despliegue

- [ ] Fase 0: brechas de código C1–C11, C13 y C14 fusionadas.
- [ ] Fase 1: decisiones del owner anotadas en docs/38.
- [ ] Fases 2 a 5: cuentas, infraestructura, secretos con custodia verificada, Tailscale y GitHub.
- [ ] Fase 6: primer deploy y verificación sin login.
- [ ] Fase 7: PoC de 48 h superado, con restore PITR real desde B2 y pgBackRest con Object Lock probado.
- [ ] Datos ficticios borrados y stanza limpia.
- [ ] Fase 8: datos reales cargados y comparados.
- [ ] Primer drill automático en verde.
- [ ] Primera factura real ≤ USD 20.
- [ ] Recordatorio trimestral del drill fuera del host creado.
- [ ] docs/38 y [`.despliegue.json`](.despliegue.json) actualizados con el estado.
