# Propuesta: add-lifecycle-timeline

## Why

Hoy el ciclo de vida de una transacción, una transferencia, una conversión o una cuenta se reconstruye leyendo registros de auditoría y diffs: hay historia, pero no un **camino** legible. El owner decidió (docs/31 D37, 2026-10-03) que cada estado de cada elemento se modele como un **flujo trazable de transiciones explícitas** —no como actualizaciones sobre un registro— y que sea fácil seguir el camino completo de un elemento en el tiempo, idealmente con un reporte visual tipo máquina de estados. La misma decisión resuelve las preguntas abiertas de `add-transfers`: editar es reversa + nueva revisión con un evento explícito (`TransferRevised`), se mantiene `TRANSFER_CURRENCY_MISMATCH` y la comisión en otra moneda queda fuera de Phase 1 (propuesta pendiente de confirmación).

## What Changes

- **Máquinas de estado explícitas** para `Transaction` (todos los kinds, incluidos `TRANSFER` y `CONVERSION`), `Account` y `ExchangeRate` (manual): estados, terminales, transiciones con guarda y **evento por transición**; definición consultable por API. Las reglas de transición vigentes (FR-TRANSACTIONS-006, FR-ACCOUNTS-007, supersede de tasas) no cambian: se declaran y se registran.
- **Registro de transición** append-only (`audit.lifecycle_transition`) escrito en la misma transacción de BD que el cambio, su auditoría y su outbox; la edición financiera es la transición **revisar** (revisión n → n+1) con asientos revertido, de reversa y nuevo.
- **Consulta del recorrido**: `GET W/transactions/{id}/lifecycle`, `GET W/accounts/{id}/lifecycle`, `GET W/fx/rates/{id}/lifecycle` y `GET W/lifecycle-machines/{aggregateType}`; visible para todo miembro que pueda ver el elemento (incluido VIEWER, D28).
- **Anotaciones** para cambios descriptivos (sin cambio de estado ni ledger).
- **Reconstrucción** de transiciones previas desde `audit.audit_log`, marcadas como derivadas; nunca se inventan.
- **Reporte visual** en la UI (pestaña "Recorrido" en el detalle de transacción y de cuenta): diagrama de la máquina de estados con el camino recorrido y el estado actual destacados + línea de tiempo con enlaces a revisiones y asientos.
- **Transferencias** (`transactions/transfers`, docs/31 D37): `TransferCompleted.v1` se publica **una sola vez** (primer posteo); cada edición financiera publica el nuevo **`transactions.TransferRevised.v1`**; la anulación sigue con `TransactionVoided.v1`. Reemplaza la decisión 6 de `add-transfers` (re-emisión con upsert). Se mantiene `TRANSFER_CURRENCY_MISMATCH`.
- Campo aditivo `transition` en los eventos de transacciones y cuentas para que cada evento nombre la transición que lo originó.
- **Categorías y contrapartes** (docs/31 D52, 2026-10-05): máquinas `ACTIVE` ↔ `ARCHIVED` (crear, archivar —en cascada a subcategorías—, desarchivar; ediciones como anotaciones; sin fusión), con su recorrido por API y en la UI.
- **Exportación del recorrido** (docs/31 D52) de cualquier elemento en **CSV y PDF** (descarga síncrona, VIEWER+, sin modificar el recorrido).
- **Fuera de alcance:** reescritura a event sourcing (los agregados siguen persistiendo estado; el registro de transiciones es una proyección síncrona y auditada); máquinas de estado de Planning, Goals, Debt, Imports (las añadirá cada change en su fase con el mismo mecanismo); comisiones de transferencia en otra moneda o desde una tercera cuenta (no se soportan, docs/31 D40); fusión de categorías o contrapartes (Phase 2); máquinas de grupos de categorías y tags. (`ConversionRevised.v1` lo agregó `add-manual-conversions`, docs/31 D48.)

## Capabilities

### New Capabilities
- `audit/lifecycle-timeline`: máquinas de estado declaradas, registro de transiciones atómico e inmutable, revisión como transición, anotaciones, consulta del recorrido por agregado (incluidas categorías y contrapartes, D52), visibilidad por rol, reconstrucción desde auditoría, reporte visual y exportación en CSV y PDF (D52).

### Modified Capabilities
- `transactions/transfers`: se añade el requirement "Revisión de una transferencia como transición explícita" (`TransferRevised.v1`; `TransferCompleted.v1` una sola vez). Se agrega como ADDED porque la capability aún vive en el change activo `add-transfers` (sin spec principal archivada); no modifica ninguno de sus requirements.

## Impact

**Specs impactadas:** crea `audit/lifecycle-timeline` (16 requirements: 12 Must, 4 Should; 4 Must agregados por D52); añade 1 requirement Must a `transactions/transfers`.

**Componentes/contextos impactados:** AUDIT (`@pf/audit`: `LifecycleTransitionRecorder` detrás de `AuditPort.recordTransition`, query `GetLifecycle`, reconstrucción desde `audit_log`); TRANSACTIONS (declaración `TransactionLifecycle`, comandos que hoy cambian estado llaman al recorder; `AmendTransaction` de `kind=TRANSFER` publica `TransferRevised`); ACCOUNTS (`AccountLifecycle`); FX (`ExchangeRateLifecycle` para tasas manuales); CLASSIFICATION (`CategoryLifecycle`, `CounterpartyLifecycle`, D52); `apps/api` (controllers de lifecycle) y `apps/web` (componente `LifecycleReport`). Capas: domain (máquinas declaradas como datos puros), application (recorder en la UoW), infrastructure (tabla, trigger), interface (API/UI).

**APIs impactadas:** `contracts/openapi/finance-api.v1.yaml` — `getTransactionLifecycle`, `getAccountLifecycle`, `getRateLifecycle`, `getLifecycleMachine`; por D52 `getCategoryLifecycle`, `getCounterpartyLifecycle` y las cinco operaciones `export*Lifecycle` (CSV/PDF); schemas `Lifecycle`, `LifecycleTransition`, `LifecycleAnnotation`, `LifecycleMachine`. Detalle en design.md § Contratos.

**Tablas impactadas:** nueva `audit.lifecycle_transition` (append-only, RLS por workspace); sin cambios en tablas de negocio.

**Eventos impactados:** nuevo `transactions.TransferRevised.v1`; `transactions.TransferCompleted.v1` sin cambio de schema pero con semántica "una sola vez" (docs/11); campo opcional aditivo `transition` en `TransactionCreated.v1`, `TransactionPosted.v1`, `TransactionUpdated.v1`, `TransactionVoided.v1`, `AccountOpened.v1`, `AccountClosed.v1`, `AccountArchived.v1`, `AccountReactivated.v1` (compatible, sin nueva versión).

**Migraciones requeridas:** expand, no destructiva: tabla `audit.lifecycle_transition` con trigger `platform.forbid_mutation()`; job de reconstrucción idempotente desde `audit.audit_log` (marca `derived = true`). Si `add-demo-data` ya está aplicado, la tabla se registra en `platform.workspace_scoped_table`.

**Invariantes afectadas:** INV-007 (inmutabilidad, ahora también de las transiciones), INV-008 (la revisión enlaza la reversa exacta), INV-009 (transferencias), INV-011 (tasas reemplazadas, no modificadas), INV-023 (estados/asiento), INV-029 (transición atómica con auditoría).

**Test cases:** AÑADIDOS — TC-AUDIT-LIFECYCLE-001, TC-AUDIT-LIFECYCLE-002, TC-AUDIT-LIFECYCLE-003, TC-AUDIT-LIFECYCLE-004, TC-AUDIT-LIFECYCLE-005, TC-AUDIT-LIFECYCLE-006, TC-AUDIT-LIFECYCLE-007, TC-AUDIT-LIFECYCLE-008, TC-AUDIT-LIFECYCLE-009, TC-AUDIT-LIFECYCLE-010, TC-AUDIT-LIFECYCLE-011, TC-AUDIT-LIFECYCLE-012, TC-AUDIT-LIFECYCLE-013, TC-TRANSACTIONS-TRANSFER-009; por D52: TC-AUDIT-LIFECYCLE-014, TC-AUDIT-LIFECYCLE-015, TC-AUDIT-LIFECYCLE-016, TC-AUDIT-LIFECYCLE-017, TC-AUDIT-LIFECYCLE-018, TC-AUDIT-LIFECYCLE-019, TC-AUDIT-LIFECYCLE-020, TC-AUDIT-LIFECYCLE-021, TC-AUDIT-LIFECYCLE-022, TC-AUDIT-LIFECYCLE-023, TC-AUDIT-LIFECYCLE-024. MODIFICADOS — TC-TRANSACTIONS-TRANSFER-006 (nota: `TransferCompleted` una sola vez; ya no se re-emite tras amend, verificado por TRANSFER-009). DEPRECADOS — ninguno.

**Impacto de regresión:** todos los comandos que cambian estado de transacciones y cuentas pasan a escribir una fila más en su UoW: los TC de atomicidad (TC-AUDIT-ATOMIC-001, TC-TRANSACTIONS-*) deben seguir verdes; el consumidor `reporting.data-version` debe suscribirse a `TransferRevised.v1`; los tests del productor de `TransferCompleted` en amend cambian de expectativa (no re-emisión).

**Riesgos introducidos:** divergencia entre estado del agregado y última transición registrada (mitigado: escritura en la misma UoW + chequeo de consistencia en el invariant checker); volumen adicional (≈ 1–3 filas por transacción, trivial); consumidores que dependían de la re-emisión de `TransferCompleted` (en Phase 1 solo REPORTING, que solo invalida caché).
