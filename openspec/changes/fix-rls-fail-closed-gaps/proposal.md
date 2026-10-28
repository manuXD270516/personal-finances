# Propuesta: fix-rls-fail-closed-gaps

## Why

El requirement «Aislamiento fail-closed sin contexto de workspace» de `security/access-control` exige que, sin workspace fijado, toda consulta o escritura sobre tablas de negocio falle con el error explícito de contexto ausente (`PF002`, D19) y nunca devuelva un vacío en silencio. La matriz `RLS-FAIL-CLOSED-MATRIX` de TC-SECURITY-RLS-007 (job `integration` de #162, como `pf_app` sin `app.workspace_id` ni `app.user_id`) encontró dos tablas que no cumplen con la política vigente:

- `platform.idempotency_key`, **lectura filtrada** por un workspace existente: vacío sin `PF002`.
- `iam.workspace_export`, **lectura filtrada y lectura sin filtro**: vacío sin `PF002`.

El owner decidió que un hueco así se corrige en un change de seguridad aparte, con su propio diseño, sin tocar el change 49 (D296, [docs/48](../../../docs/48-perf-and-rls-owner-decisions.md)), y luego que las 125 políticas de la forma `workspace_id = platform.current_workspace_id()` no se migran a otra forma (D298, [docs/49](../../../docs/49-rls-no-migration-decision.md)). Este change es esa corrección: acotada a las dos políticas que no cumplen, sin reescribir las que ya cumplen.

## What Changes

- **`platform.idempotency_key`:** la política `idempotency_key_scope` (un `CASE` que solo se evalúa fila por fila) gana un conjunto previo `scope_id = platform.current_idempotency_scope_id()`. La función nueva devuelve el workspace fijado o, si no hay, el usuario fijado, y lanza `PF002` si no hay ninguno. Como compara una columna con una función `STABLE`, el planner la evalúa al planificar, igual que la forma vigente: sin contexto, la consulta falla aunque la tabla esté vacía o el filtro no encuentre filas. Las claves de alcance de usuario (operaciones sin workspace, como crear un workspace) siguen funcionando con solo el usuario fijado.
- **`iam.workspace_export`:** la política `ws_isolation` pasa de `platform.current_workspace_id_if_set()` (devuelve `NULL` sin contexto y nunca lanza) a la forma vigente `workspace_id = platform.current_workspace_id()`. El barrido de retención entre workspaces (job `identity.export-retention`), que hoy lee sin contexto gracias a esa tolerancia y a la política `retention_scan` de `pf_worker`, pasa a leer con el rol `pf_maintenance` asumido solo en esa transacción (`SET LOCAL ROLE`), como ya hacen las purgas de idempotencia y del outbox (ADR-0023). `retention_scan` se reasigna a `pf_maintenance` y conserva su filtro (`READY` vencidos); `pf_maintenance` recibe solo `SELECT` de las columnas que el barrido lee.
- **Verificación más estricta:** TC-SECURITY-RLS-007 deja de solo listar hallazgos y falla ante cualquier vacío sin `PF002`; se agrega la misma matriz con el rol del worker (con una lista declarada de políticas entre workspaces por diseño) y una regla de catálogo que limita el uso de `current_workspace_id_if_set()` a las tablas de alcance de usuario.
- **Spec:** dos requirements ADDED (claves de idempotencia y exportaciones sin contexto) y el MODIFIED de la verificación tabla por tabla. El requirement «Aislamiento fail-closed sin contexto de workspace» no cambia.
- **Fuera de alcance:** reescribir las políticas que ya cumplen o cambiar su forma (D298); el benchmark de RLS y sus filas (D286, D298); las tablas de alcance de usuario por diseño (`iam.user`, `iam.workspace`, `iam.workspace_membership`, `iam.workspace_import`, `platform.demo_workspace_run`), que con solo el usuario fijado devuelven filas de ese usuario (ADR-0023) y sin usuario fallan con `PF002`; las políticas de `pf_worker` entre workspaces por diseño (relay del outbox, dead-letter); las políticas del dueño de la purga demo y de las sondas (`demo_purge_*`, `workspace_existence_probe`, `audit_actor_probe`), que no son de `pf_app` ni de `pf_worker`.

## Capabilities

### New Capabilities

- Ninguna.

### Modified Capabilities

- `security/access-control`: fail-closed sin contexto en las claves de idempotencia y en las exportaciones del workspace, con el barrido de retención por un rol de mantenimiento; la verificación tabla por tabla pasa a fallar ante un vacío sin error (2 requirements ADDED, Must; 1 MODIFIED, Must).

## Impact

**Specs impactadas:** `security/access-control` (2 ADDED y 1 MODIFIED: «Verificación del aislamiento y del fail-closed de las políticas vigentes tabla por tabla»). Leídas sin cambios: `platform/api-conventions` (idempotencia: el alcance por usuario o workspace no cambia) e `identity/workspace-portability` (retención del export: el comportamiento observable no cambia).

**Componentes/contextos impactados:** `@pf/identity` infraestructura (`PgExportRepository.findExpired` en `pg-portability.ts`: `SET LOCAL ROLE pf_maintenance` antes de leer los vencidos) y el comentario de `WorkspaceExportService.expireDue`; `apps/api/test/db/rls-isolation.int.test.ts` y `apps/api/test/db/idempotency-key.int.test.ts` (pruebas). `@pf/platform` (`PgIdempotencyStore`) no cambia: sus consultas ya filtran por `scope_id`.

**APIs impactadas:** ninguna (`contracts/openapi` sin cambios; oasdiff limpio).

**Tablas impactadas:** `platform.idempotency_key` (política `idempotency_key_scope`), `iam.workspace_export` (políticas `ws_isolation` y `retention_scan`; grants de columnas a `pf_maintenance`). Sin cambios de estructura.

**Eventos impactados:** ninguno.

**Migraciones requeridas:** una, expand y no destructiva (`<timestamp>_platform_rls_fail_closed_gaps.sql`, posterior a la última de `main`): crea `platform.current_idempotency_scope_id()`, cambia las dos políticas con `ALTER POLICY` (mismos nombres), reasigna `retention_scan` y concede `USAGE ON SCHEMA iam` y `SELECT (id, workspace_id, requested_by, status, expires_at)` a `pf_maintenance`. Su `migrate:down` restaura las expresiones y los roles anteriores.

**Test cases:** AÑADIDOS — TC-SECURITY-RLS-013 a 018. MODIFICADOS — TC-SECURITY-RLS-007 (la matriz falla ante un hallazgo en lugar de listarlo). Regresión sin cambios — TC-SECURITY-RLS-001..006, TC-SECURITY-ISOLATION-001, TC-IDENTITY-EXPORT-007 (expiración por el job real) y los TC de idempotencia de `platform/api-conventions`. DEPRECADOS — ninguno.

**Impacto de regresión:** con contexto de workspace, una transacción ya no ve las claves de alcance de usuario del mismo usuario (antes sí); ninguna consulta de la aplicación las busca así (el store filtra por `scope_id`). El job de retención de exports depende del rol `pf_maintenance`; si la migración se aplica antes que el código del worker, el barrido falla con `PF002` hasta el despliegue del worker y reintenta en la hora siguiente (la descarga ya responde 410 por `expires_at`). Sin efecto en el benchmark de RLS: no se toca ninguna política del ledger ni de cuentas.

**Riesgos introducidos:** que el fail-closed de las lecturas sin filtro sobre una tabla vacía dependa de que el planner evalúe la función al estimar la selectividad (mitigado: es el mismo mecanismo que ya protege a las 125 políticas vigentes, y la matriz lo verifica con tablas vacías en cada corrida de `integration`); que `pf_maintenance` lea entre workspaces más de lo necesario (mitigado: solo `SELECT` de cinco columnas y solo filas `READY` vencidas, sin escritura).

**Invariantes afectadas:** ninguna financiera. Protege NFR-SEC-003 y NFR-SEC-004.
