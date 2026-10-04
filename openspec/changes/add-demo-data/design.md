# Diseño

## Contexto

Motivación y alcance: ver proposal.md. Decisión del owner D36 (docs/31) y ADR-0026 (opción elegida y alternativas). Dataset: docs/29 §2.2 (Demo Seed: personas ficticias, cuentas, salario, alquiler, suscripciones, conversiones P2P, tarjeta, casos especiales) y §3 (generación determinista: PRNG sembrado, `SimulatedClock`, `DeterministicIdGenerator`, ejecución por application services, golden summary).

Restricciones que gobiernan el diseño:

- Append-only: postings y asientos (INV-007), tasas (INV-011), auditoría (INV-029, FR-AUDIT-003), cuentas y categorías sin borrado (FR-ACCOUNTS-008, D7). Triggers `platform.forbid_mutation()` (PF003).
- Aislamiento por `workspace_id` con RLS forzada (ADR-0023, INV-025); roles `pf_migrator` (owner), `pf_app`, `pf_worker` sin `BYPASSRLS` (docs/12).
- Outbox/inbox de plataforma (`add-event-outbox`, D30) y jobs pg-boss en el worker (ADR-0008).

Contextos, agregados y capas:

| Contexto | Elemento | Capa | Cambio |
|---|---|---|---|
| Identity | AR `Workspace`: `isDemo` (inmutable, solo en la factory `Workspace.createDemo`), `demoStatus` (`LOADING` → `READY` \| `FAILED` → `CLEANING` → `PURGED`), `demoOriginWorkspaceId`, `demoDatasetVersion` | domain | Nuevo |
| Identity | Comandos `RequestDemoData(originWorkspaceId)`, `CleanupDemoData(demoWorkspaceId)`, `MarkDemoLoaded`, `MarkDemoFailed`, `MarkDemoPurged`; query `GetDemoDataStatus` | application | Nuevo |
| Platform (worker) | `DemoDataLoader` (job `demo.load`): lee el manifiesto `seeds/demo/manifest.yaml`, ejecuta los generadores por módulo con `SimulatedClock` y actor `system:demo` llamando a los application services públicos (`OpenAccount`, `RecordTransaction`, `RecordTransfer`, `RecordConversion`, `RecordRate`, `AmendTransaction`, `VoidTransaction`, catálogo de clasificación); al final verifica golden summary + invariantes y marca `READY` | application/infrastructure | Nuevo |
| Platform (worker) | Job `demo.purge`: llama a `platform.purge_demo_workspace(id)` y marca `PURGED` | infrastructure | Nuevo |
| Interface | `POST W/demo-data`, `GET W/demo-data`, `POST W/demo-data/cleanup`; UI de configuración, indicador demo, selector de workspace | interface | Nuevo |

Puertos: `WorkspaceRepository` (Identity), `JobQueue` (plataforma), `AuditPort`, `Clock`, `IdGenerator`; puertos públicos de comandos de los contextos financieros (no hay acceso a tablas de otros contextos desde el cargador).

## Objetivos / No objetivos

**Objetivos:** carga solo por acción explícita (OWNER); aislamiento total en un workspace dedicado; marca visible e inmutable; limpieza inmediata y purga completa; cero impacto en workspaces reales; mismo cargador para app y seed de CI/dev.

**No objetivos:** datos demo en un workspace real; módulos de fases posteriores (los añade el manifiesto por fase); colaboración en el workspace demo; borrado de workspaces reales (FR-IDENTITY-012).

## Decisiones

1. **Workspace demo dedicado (ADR-0026, opción 1).** `RequestDemoData` exige rol OWNER en el workspace de origen (el de la pantalla de configuración), verifica `DEMO_DATA_ENABLED` y que el usuario no tenga otro workspace demo con `demoStatus ∈ {LOADING, READY, FAILED, CLEANING}`; crea en una transacción el workspace (`is_demo = true`, `demo_status = LOADING`, nombre "Demo — Finanzas de Valeria", moneda base y TZ del origen), la membresía OWNER del solicitante, el registro de auditoría en el workspace de origen (`identity.demo.load_requested`) y el job `demo.load` (encolado vía outbox). Responde 202 con el id del workspace demo.
2. **Carga por casos de uso, no por SQL.** El cargador usa los mismos application services que la API, con `SimulatedClock` posicionado en cada fecha simulada (docs/29 §3) y ancla = hoy en la TZ del workspace (`--anchor=today`). Así se validan todas las invariantes (Σ = 0 por moneda, escalas, estados) y se generan auditoría y eventos coherentes. Lotes por mes, cada uno en su transacción; progreso en `platform.demo_workspace_run.progress`. Al terminar: golden summary del manifiesto (saldos por cuenta en la ancla fija; con `anchor=today` se compara el golden desplazado) + invariant checker del ledger acotado al workspace ⇒ `READY`; cualquier error ⇒ `FAILED` (el workspace nunca se marca `READY` con datos parciales; la UI ofrece limpiar).
3. **Contenido de Phase 1** (manifiesto `modules: [identity, accounts, classification, ledger, transactions, fx]`): cuentas de docs/29 §2.2 (Banco Andino Demo BOB y USD, Caja BOB, P2P Exchange Demo USDT, Cold Wallet BTC, Tarjeta Andina Demo como pasivo, Préstamo vehicular como pasivo con desembolso y pagos simples); salario, alquiler, servicios, suscripciones en USD con tarjeta, compras con QR (D27), pagos de tarjeta como transferencia ASSET→LIABILITY, conversiones P2P BOB→USDT y USDT→BTC con fees, tasas manuales diarias `PARALLEL`/`OFFICIAL` etiquetadas "Demo"; casos especiales: reembolsos, splits, un ajuste, dos ediciones financieras, una anulación y una transacción `pending` al final (para el recorrido de `add-lifecycle-timeline`). Ventana de 21 meses (docs/29; confirmada por el owner el 2026-10-04, docs/31 D41, con recorte a 6 meses si la carga desde la UI supera 2 min). Nombres ficticios con apariencia real, nunca de entidades reales; números con prefijo `DEMO-`.
4. **Marca demo inmutable.** `iam.workspace.is_demo boolean NOT NULL DEFAULT false`; trigger `iam.forbid_is_demo_change()` `BEFORE UPDATE OF is_demo` ⇒ PF003. Solo el comando de creación del workspace demo fija `true` (INSERT). La API expone `Workspace.isDemo` y `Workspace.demoStatus`; la UI muestra el indicador "Datos de demostración" en el layout del workspace (no descartable) y una etiqueta en el selector de workspaces.
5. **Limpieza = archivo inmediato + purga asíncrona.** `CleanupDemoData` exige OWNER del workspace demo (o del origen, para ofrecerla desde la configuración del workspace real), rechaza `WORKSPACE_NOT_DEMO` si `is_demo = false`; en una transacción: `demo_status = CLEANING`, `status = ARCHIVED` (el workspace deja de listarse y el middleware de workspace lo trata como inexistente, igual que un workspace ajeno), auditoría `identity.demo.cleanup_requested` en el workspace de origen, evento `identity.DemoDataCleaned.v1` y job `demo.purge`. Idempotente: limpiar un demo ya en `CLEANING`/`PURGED` devuelve 202 sin efectos.
6. **Purga física acotada.** `platform.purge_demo_workspace(p_workspace uuid)`: `SECURITY DEFINER`, owner `pf_migrator`, `SET search_path` fijo, `EXECUTE` solo para `pf_worker`. Pasos: (a) `SELECT … FOR UPDATE` del workspace y verificación `is_demo AND demo_status = 'CLEANING'`, si no ⇒ excepción `PF006` (`DEMO_PURGE_NOT_ALLOWED`); (b) `SET LOCAL pf.demo_purge_workspace = p_workspace`; (c) para cada tabla de `platform.workspace_scoped_table` en orden de `purge_order` (hijas antes que padres, particiones de auditoría por el padre), `DELETE … WHERE workspace_id = p_workspace` y registro del conteo; (d) membresías y preferencias del workspace; (e) `iam.workspace` queda como lápida (`status = PURGED`, `demo_status = PURGED`, nombre conservado, sin datos de negocio); (f) `platform.demo_workspace_run.purged_at` y `rows_deleted jsonb`. Todo en una transacción (si falla, nada se borra y el job reintenta con backoff; tras N fallos queda `CLEANING` + alerta, modo degradado = opción 3 del ADR: archivado e invisible).
7. **Ampliación de `platform.forbid_mutation()`.** Para `TG_OP = 'DELETE'` permite la fila solo si `current_user = 'pf_migrator'` **y** `current_setting('pf.demo_purge_workspace', true) = OLD.workspace_id::text` **y** `EXISTS (SELECT 1 FROM iam.workspace WHERE id = OLD.workspace_id AND is_demo)`. `UPDATE` y `TRUNCATE` siguen prohibidos siempre. Un `pf_app` que fije la GUC no gana nada: no es `pf_migrator` ni tiene grant `DELETE`.
8. **Registro de tablas acotadas por workspace.** `platform.workspace_scoped_table(schema_name, table_name, purge_order int, PRIMARY KEY(schema_name, table_name))`, poblada por las migraciones de cada contexto. El chequeo de catálogo de RLS existente se amplía: toda tabla con columna `workspace_id` en schemas de negocio y plataforma debe estar registrada (falla CI si no). Un test de integración carga la demo, la purga y verifica que ninguna tabla registrada tiene filas con ese `workspace_id`.
9. **Eventos e integraciones durante la purga.** Las filas pendientes de `platform.outbox`/`inbox`/`dead_letter` del workspace se purgan; los consumidores ignoran eventos de workspaces `PURGED` o `ARCHIVED` demo (no-op idempotente). La ingesta de providers de FX ya itera solo workspaces activos, por lo que el demo archivado deja de recibir tasas.
10. **Auditoría durable.** Las acciones del usuario se auditan en el workspace **de origen** (que es real y no se purga): `identity.demo.load_requested`, `identity.demo.loaded` (sistema), `identity.demo.cleanup_requested`, `identity.demo.purged` (sistema), con el id del workspace demo. Las mutaciones dentro del workspace demo se auditan en él (y desaparecen con la purga, que es lo esperado).
11. **Habilitación por entorno.** `DEMO_DATA_ENABLED` en el contrato de configuración (`@pf/platform/config`): default `true` para `PFOS_ENV ∈ {local, ci, dev}`, `false` para `staging`/`production` (**confirmado por el owner el 2026-10-04, docs/31 D41**). Deshabilitada: `POST W/demo-data` ⇒ 403 `DEMO_DATA_DISABLED`; `GET` y `cleanup` siguen disponibles.
12. **Seed CLI.** `pnpm db:seed -- --profile=demo` (solo local/CI, `runSeed` ya rechaza staging/production) crea el workspace demo para `owner@demo.pfos.test` con origen W1 y ejecuta el mismo `DemoDataLoader` en proceso. Nunca escribe datos financieros en W1/W2.

### Modelo de datos

| Tabla | Cambio | RLS / grants |
|---|---|---|
| `iam.workspace` | + `is_demo boolean NOT NULL DEFAULT false`, `demo_status text NULL CHECK (…)`, `demo_origin_workspace_id uuid NULL`, `demo_dataset_version text NULL`; `status` admite `PURGED`; CHECK `is_demo OR demo_status IS NULL`; trigger de inmutabilidad de `is_demo`; índice único parcial `(created_by) WHERE is_demo AND demo_status IN ('LOADING','READY','FAILED','CLEANING')` | sin cambios (WS) |
| `platform.demo_workspace_run` | Nueva: `workspace_id uuid PK`, `origin_workspace_id`, `requested_by`, `dataset_version`, `anchor_date`, `requested_at`, `loaded_at`, `failed_at`, `error_code`, `progress jsonb`, `cleanup_requested_at`, `purged_at`, `rows_deleted jsonb` | instalación (sin datos financieros); `pf_worker` INSERT/UPDATE, `pf_app` SELECT acotado al solicitante por política |
| `platform.workspace_scoped_table` | Nueva (catálogo) | `pf_migrator` escribe; lectura solo por la función |

Migración `identity_00xx_demo_data` (expand, no destructiva): columnas con default, tablas nuevas, función y nueva versión de `platform.forbid_mutation()` (`CREATE OR REPLACE`, mismo comportamiento para no demo).

### Eventos

| Evento | Cuándo | Idempotencia |
|---|---|---|
| `identity.DemoDataLoaded.v1` | El workspace demo pasa a `READY` | natural `workspaceId` |
| `identity.DemoDataCleaned.v1` | Se solicita la limpieza (`CLEANING`) | natural `workspaceId` |

Ambos en el outbox en la misma transacción BD. Consumidor: REPORTING (`reporting.data-version`, invalida caché). Sin payload financiero.

## Contratos

Cambios **exactos** requeridos (los consolida otro proceso; este change no edita `contracts/`):

**`contracts/openapi/finance-api.v1.yaml`**

1. `POST /workspaces/{workspaceId}/demo-data` (`requestDemoData`, tag `identity`, rol OWNER, `Idempotency-Key`): 202 `DemoDataStatus`; 403 `INSUFFICIENT_ROLE|DEMO_DATA_DISABLED`; 409 `DEMO_WORKSPACE_ALREADY_EXISTS`.
2. `GET /workspaces/{workspaceId}/demo-data` (`getDemoDataStatus`, cualquier miembro del workspace demo u OWNER del origen): 200 `DemoDataStatus`; 404 si no es demo ni origen de uno.
3. `POST /workspaces/{workspaceId}/demo-data/cleanup` (`cleanupDemoData`, rol OWNER): 202 `DemoDataStatus`; 409 `WORKSPACE_NOT_DEMO`.
4. Schema `DemoDataStatus`: `{demoWorkspaceId, originWorkspaceId, status: enum [LOADING, READY, FAILED, CLEANING, PURGED], datasetVersion, anchorDate, progress: {completedModules: string[], totalModules: integer}|null, requestedAt, loadedAt|null, cleanupRequestedAt|null, purgedAt|null}`.
5. `Workspace`: + `isDemo` (boolean, required), `demoStatus` (enum anterior | null).
6. `ErrorCode` (y docs/10 §9.1): `DEMO_WORKSPACE_ALREADY_EXISTS` (409), `WORKSPACE_NOT_DEMO` (409), `DEMO_DATA_DISABLED` (403).

**`contracts/events/identity/`**: `DemoDataLoaded.v1.schema.json` y `DemoDataCleaned.v1.schema.json` (envelope v1; payload `{workspaceId, originWorkspaceId, datasetVersion}`).

## Riesgos / Trade-offs

- [Ruta de `DELETE` sobre tablas append-only] → triple guarda (rol definidor, GUC, `is_demo` inmutable), `EXECUTE` solo `pf_worker`, tests de seguridad TC-IDENTITY-DEMO-005/-006, revisión de seguridad como gate de implementación (ADR-0026 aceptado por el owner el 2026-10-04, docs/31 D41; si la revisión falla, rige el modo degradado: archivado e invisible).
- [Tabla nueva con `workspace_id` no registrada para purga] → el chequeo de catálogo falla en CI; test de purga completa.
- [Carga lenta (~1 800 transacciones vía casos de uso)] → lotes por mes; presupuesto < 2 min (docs/29); progreso visible; si excede, se reduce la ventana del manifiesto de Phase 1.
- [Usuario confunde demo con real] → indicador persistente, nombre "Demo — …", etiqueta en el selector, dashboard con banner.
- [Purga que falla repetidamente] → modo degradado: el workspace queda archivado e invisible (opción 3 del ADR), alerta por métrica `pfos_demo_purge_failures_total`.
- [Datos "con apariencia de terceros" confundibles con entidades reales] → nombres inventados con sufijo "Demo" donde sea natural y prefijo `DEMO-` en identificadores; revisión del dataset en PR.

## Plan de migración

Expand-only: columnas nuevas en `iam.workspace` con default (no reescriben datos reales), tablas `platform.demo_workspace_run` y `platform.workspace_scoped_table` (poblada con las tablas existentes en la misma migración), función de purga y nueva versión de `platform.forbid_mutation()`. Rollback: revertir el despliegue; las columnas y tablas pueden quedar (sin uso); restaurar la versión anterior de `platform.forbid_mutation()` con una migración de reversa.

Dependencias: requiere aplicados todos los changes de Phase 1 hasta `add-basic-dashboard` (los casos de uso que el cargador invoca) y, idealmente, `add-lifecycle-timeline` (para que la demo muestre recorridos). `add-event-outbox` para jobs y eventos.

## Preguntas abiertas

1. ~~**Habilitación en staging/producción**~~: resuelta por el owner el 2026-10-04 (docs/31 D41): `DEMO_DATA_ENABLED` por defecto `false` en `staging`/`production`.
2. ~~**Ventana del dataset en la app**~~: resuelta por el owner el 2026-10-04 (docs/31 D41): 21 meses; se mantiene el recorte a 6 meses si la carga supera 2 min.
3. ~~**Aceptación de ADR-0026**~~: aceptado por el owner el 2026-10-04 (docs/31 D41). La revisión de seguridad del amend a `platform.forbid_mutation()` queda como gate de implementación (tareas 2.x/5.x, TC-IDENTITY-DEMO-005/-006).
4. ¿Ofrecer "Recargar datos de demostración" (limpiar + cargar en un paso)? Propuesta: no en Phase 1.
