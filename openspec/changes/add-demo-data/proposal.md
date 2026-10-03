# Propuesta: add-demo-data

## Why

El owner necesita ver PFOS "con vida" (demos, desarrollo de UI, pruebas manuales) con datos financieros realistas, pero decidió (docs/31 D36, 2026-10-03) que esos datos solo se carguen por una **acción explícita en la app**, queden **marcados como demo** y sean **completamente removibles**. PFOS es append-only por diseño (INV-007, INV-029, D7): mezclar datos demo con datos reales y "borrarlos" después rompería el ledger, la auditoría y los reportes. Este change define cómo cargar y retirar datos demo sin tocar jamás un workspace real (ADR-0026).

## What Changes

- Acción OWNER **"Cargar datos de demostración"** en la configuración del workspace: crea un **workspace de demostración dedicado** (`isDemo = true`, marca inmutable desde su creación) con el usuario como único OWNER y lo carga de forma asíncrona (`LOADING` → `READY` | `FAILED`) con el dataset Demo versionado de docs/29, anclado a "hoy" en la TZ del workspace, a través de los mismos casos de uso que la operación real (actor técnico `system:demo`).
- Contenido de Phase 1: instituciones, cuentas (BOB, USD, USDT, BTC, tarjeta de crédito, préstamo como pasivo), categorías/tags/contrapartes, ingresos, gastos con splits, reembolsos, ajustes, transferencias (incluido pago de tarjeta con QR), conversiones con fees, tasas manuales e históricas, y algunas ediciones y anulaciones (para que el recorrido de `add-lifecycle-timeline` tenga caminos interesantes). Entidades **ficticias con apariencia real**; identificadores con prefijo `DEMO-`.
- Indicador persistente **"Datos de demostración"** en la UI y `isDemo` en la API (lista y detalle de workspaces).
- Acción OWNER **"Limpiar datos de demostración"**: archiva el workspace demo **al instante** (deja de listarse; todo acceso responde como inexistente) y encola su **purga física completa** por una función de BD acotada a workspaces demo; queda una lápida sin datos de negocio y un registro de purga.
- Rechazos: limpiar un workspace real ⇒ `WORKSPACE_NOT_DEMO` (409); segunda carga con un demo vigente ⇒ `DEMO_WORKSPACE_ALREADY_EXISTS` (409); carga deshabilitada por entorno ⇒ `DEMO_DATA_DISABLED` (403); EDITOR/VIEWER ⇒ `INSUFFICIENT_ROLE`.
- Auditoría de carga y limpieza en el workspace real de origen (sobrevive a la purga).
- El perfil `demo` de `pnpm db:seed` (solo local/CI) reutiliza el mismo cargador; la Minimal Seed no cambia.
- **Fuera de alcance:** datos demo dentro de un workspace real (descartado, ADR-0026); módulos de fases posteriores (presupuestos, cierres, recurrencias, metas, deudas con amortización, documentos, imports) — el manifiesto los agregará por fase; compartir el workspace demo con otros miembros; exportar el workspace demo; borrado definitivo de workspaces reales (FR-IDENTITY-012, Won't now); datasets `large`.

## Capabilities

### New Capabilities
- `identity/demo-data`: carga explícita, aislamiento en workspace dedicado, marca demo visible e inmutable, contenido determinista, estado de carga, límite por usuario, limpieza inmediata, purga completa acotada a workspaces demo, habilitación por entorno y auditoría.

### Modified Capabilities
- Ninguna (no se modifican requirements existentes; `identity/workspace-membership` sigue igual: el workspace demo es un workspace más con una marca adicional).

## Impact

**Specs impactadas:** crea `identity/demo-data` (11 requirements: 9 Must, 2 Should).

**Componentes/contextos impactados:** IDENTITY (`@pf/identity`: agregado `Workspace` con `isDemo` y `demoStatus`, comandos `RequestDemoData`, `CleanupDemoData`, consulta `GetDemoDataStatus`); nuevo módulo de aplicación `DemoDataLoader` (orquestador en `apps/api`/worker que invoca los application services públicos de Accounts, Classification, Transactions, FX; generadores deterministas de `seeds/demo`); worker (jobs `demo.load` y `demo.purge`); `apps/api/src/seed/run-seed.ts` (perfil `demo` reutiliza el cargador); `apps/web` (configuración del workspace, indicador demo, selector de workspace). Todos los contextos con tablas acotadas por workspace quedan registrados para la purga.

**APIs impactadas:** `contracts/openapi/finance-api.v1.yaml` — `POST W/demo-data` (202), `GET W/demo-data` (estado), `POST W/demo-data/cleanup` (202); `Workspace.isDemo` y `Workspace.demoStatus`; códigos `DEMO_WORKSPACE_ALREADY_EXISTS`, `WORKSPACE_NOT_DEMO`, `DEMO_DATA_DISABLED`. Detalle en design.md § Contratos.

**Tablas impactadas:** `iam.workspace` (+ `is_demo`, `demo_status`, `demo_origin_workspace_id`, `status` admite `PURGED`), nueva `platform.demo_workspace_run`, nueva `platform.workspace_scoped_table` (registro para la purga), función `platform.purge_demo_workspace(uuid)` y ampliación de `platform.forbid_mutation()`.

**Eventos impactados:** produce `identity.DemoDataLoaded.v1` y `identity.DemoDataCleaned.v1` (nuevos, informativos; consumidor: REPORTING para invalidar caché). Los eventos de negocio del workspace demo son los normales (`TransactionPosted.v1`, etc.).

**Migraciones requeridas:** expand, no destructiva para datos reales: columnas nuevas con default `false`/`NULL`, trigger de inmutabilidad de `is_demo`, tablas de plataforma nuevas, función de purga y nueva versión de `platform.forbid_mutation()` (mismo comportamiento para workspaces no demo).

**Invariantes afectadas:** INV-007, INV-011 e INV-029 (excepción acotada: purga física solo para workspaces demo, ADR-0026); INV-025 (aislamiento por workspace) se usa como frontera de la demo; INV-004 (Σ postings = 0) se verifica sobre los datos demo cargados.

**Test cases:** AÑADIDOS — TC-IDENTITY-DEMO-001, TC-IDENTITY-DEMO-002, TC-IDENTITY-DEMO-003, TC-IDENTITY-DEMO-004, TC-IDENTITY-DEMO-005, TC-IDENTITY-DEMO-006, TC-IDENTITY-DEMO-007, TC-IDENTITY-DEMO-008, TC-IDENTITY-DEMO-009, TC-IDENTITY-DEMO-010, TC-IDENTITY-DEMO-011, TC-IDENTITY-DEMO-012, TC-IDENTITY-DEMO-013, TC-IDENTITY-DEMO-014. MODIFICADOS — ninguno. DEPRECADOS — ninguno.

**Impacto de regresión:** la ampliación de `platform.forbid_mutation()` afecta a todas las tablas append-only: TC-LEDGER-* de inmutabilidad, TC-AUDIT-IMMUTABLE-001 y los tests de roles deben seguir verdes; TC-IDENTITY-DEMO-005/-006 entran en la suite de seguridad. El test de catálogo de RLS se amplía para exigir que toda tabla con `workspace_id` esté registrada para la purga.

**Riesgos introducidos:** ruta de borrado físico sobre tablas append-only (mitigada con flag inmutable, función `SECURITY DEFINER` con triple guarda y tests de seguridad; nuevo RISK a registrar en docs/26 al aplicar); carga lenta del dataset vía casos de uso (presupuesto < 2 min, docs/29); confusión entre workspace demo y real (indicador persistente).
