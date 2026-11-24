# Propuesta: add-host-restore-drill

## Why

ADR-0027 y NFR-REL-001/002/005 prometen un drill de restore mensual automatizado que falla si no restaura, y no existe: el de `docs/runbooks/deploy-and-restore.md` §6 es manual, en una VM efímera, y depende de que alguien lo haga (B4). El owner decidió un drill local mensual con aviso por heartbeat más uno fuera del host cada trimestre (D456). En el mismo host faltan dos protecciones que, si fallan, detienen PostgreSQL y el archivado sin avisar: nadie limpia las imágenes viejas de los deploys y nada alerta cuando el disco de 60 GB se llena (B7). Son C5 y C6 de [cambios-de-codigo.md](../../../docs/despliegue/cambios-de-codigo.md); C10 (montar en el worker la clave privada de las conexiones) toca el mismo `pfos-deploy.sh` y va en el mismo PR de implementación.

## What Changes

- **Drill de restore mensual en el host** (`pfos-backup.sh drill`, timer `pfos-restore-drill.timer`, día 2 a las 09:00 UTC): restaura el último punto de repo1 con la clave de B2 de **solo lectura** en un volumen y una red temporales, con un contenedor `pfos-postgres` sin archivado, sin puertos ni acceso a la red del stack y con techo de memoria bajo; corre las consultas de integridad de §6, compara la pérdida de datos con el RPO, mide la duración, limpia todo aunque falle y avisa por el heartbeat (`/fail` ante cualquier error). Deja una línea por drill en `/var/lib/pfos/drills.log`.
- **Verificación semanal de los repositorios** (`pfos-backup.sh verify`, `pfos-backup-verify.timer`): `pgbackrest verify` de repo1 y repo2 en un contenedor efímero con la clave de solo lectura, fuera del techo de memoria de PostgreSQL.
- **Drill fuera del host trimestral** (§6 del runbook): el procedimiento manual pasa de mensual a trimestral y registra el RTO observado.
- **Limpieza semanal de imágenes** (`pfos-image-prune.timer` y `.service`): borra las imágenes que no usa ningún contenedor salvo las del release actual y el anterior de `releases.log` y la de rclone de la réplica.
- **Alerta de disco:** `pfos-backup.sh check` (horario) falla el heartbeat si un sistema de archivos del host pasa el 80 %.
- **Operaciones del host serializadas con el deploy:** drill, verificación y limpieza toman el lock de `pfos-deploy.sh`.
- **Clave privada de las conexiones (C10):** `compose.prod.yaml` monta `/etc/pfos/connection-credentials.keys` solo en `finance-worker`, de solo lectura; `pfos-deploy.sh` lo crea vacío con dueño 1000 y permisos 0400 si no existe y normaliza dueño y permisos sin tocar el contenido.
- **Plantilla nueva** `deploy/host/etc-pfos/pgbackrest-restore.env.example` con la clave de solo lectura.
- **Fuera de alcance:** el segundo bucket de los mensuales (C3, D455; este change solo exige que la clave de solo lectura lo lea), el prefijo del PoC (C4), el techo de PostgreSQL (C8), alertas de Grafana, un drill que ejercite repo2 o un PITR a un instante dado (lo cubre el trimestral), y medir la memoria real del drill (se mide en el PoC, fase 7).

## Capabilities

### New Capabilities

Ninguna.

### Modified Capabilities
- `platform/delivery-pipeline`: 11 ADDED (6 Must, 5 Should): drill mensual con aviso, aislamiento del drill, pérdida de datos dentro del RPO, duración dentro del objetivo de RTO, espacio previo al drill, verificación semanal, drill fuera del host trimestral, operaciones serializadas con el deploy, limpieza de imágenes, alerta de disco y clave privada de las conexiones solo en el worker. FEAT-24.2 / TS-105 («restore drill mensual automatizado») ya mapean el backup y DR a esta capability (docs/25).

## Impact

**Specs impactadas:** `platform/delivery-pipeline` (11 ADDED). Lee sin modificar: `platform/local-environment` (backup y restore locales, NFR-REL-004), `ledger/*` (invariantes que verifican las consultas de integridad).

**Componentes/contextos impactados:** solo el host y el despliegue: `deploy/host/pfos-backup.sh` (subcomandos `drill`, `verify` e `image-prune`; `check` con disco), `deploy/host/pfos-deploy.sh` (unidades nuevas, archivo de la clave, lock compartido), `deploy/host/systemd/` (`pfos-restore-drill.timer`, `pfos-backup-verify.timer`, `pfos-image-prune.timer` y `.service`), `deploy/host/etc-pfos/pgbackrest-restore.env.example` (nuevo), `deploy/compose/compose.prod.yaml` (`finance-worker`). Ningún contexto de dominio ni cambio de código de aplicación.

**APIs impactadas:** ninguna.

**Tablas impactadas:** ninguna se modifica. Las consultas de integridad leen `ledger.posting` y `ledger.journal_entry` en la copia restaurada, y `ledger.posting` en producción, solo lectura.

**Eventos impactados:** ninguno.

**Migraciones requeridas:** ninguna.

**Test cases:** AÑADIDOS — TC-PLATFORM-DRILL-001..010 (10) y TC-PLATFORM-HOSTOPS-001..006 (6). MODIFICADOS — ninguno. DEPRECADOS — ninguno.

**Impacto de regresión:** los backups `full`, `diff`, `monthly` y `docs-replica` no cambian; `check` suma la alerta de disco y deja de cortar en el primer error. Un deploy que coincide con el drill espera el lock o falla rápido con un mensaje claro. El drill compite por memoria con el stack en 2 GB una vez al mes (riesgo medido en el PoC).

**Riesgos introducidos:** RISK-009 (backups que no restauran) pasa a tener detección mensual automática. Nuevos, sin RISK-id: OOM del stack durante el drill (techo bajo, horario de madrugada y medición en el PoC); borrar por error la imagen de un rollback (lista de conservación de dos releases y sin `-f`); falsos positivos del heartbeat si el owner no crea los checks nuevos (tarea del runbook).

**Invariantes afectadas:** ninguna se modifica; el drill verifica INV-004 (los postings de cada asiento suman cero por moneda) e INV-005 (todo asiento tiene al menos dos postings) sobre la copia restaurada.
