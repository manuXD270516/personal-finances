# Propuesta: add-bulk-imported-transactions

## Why

La persistencia de un import de 5 000 filas tarda hoy ~120 s en local y 92–254 s en el job `perf` ([docs/53](../../../docs/53-imports-perf-findings.md) §2.1), frente a los **20 s** de NFR-PERF-007 (Must, Phase 6). El owner la difirió a Phase 6 «con la escritura masiva de `RecordImportedTransactions`» (D152, [docs/35](../../../docs/35-phase-3-consolidation-decisions.md)); el benchmark corre con un techo de regresión de 300 s y `PF_PERF_STRICT_IMPORT=1` exige la meta.

La causa está medida desde `add-basic-csv-import` (tarea 7.3): `ImportedTransactionsAdapter.recordBatch` llama a `recordTransaction` **una vez por fila**, con ≈ 60 sentencias SQL por transacción (≈ 24 ms por fila). Para 5 000 filas en 20 s hacen falta ≈ 4 ms por fila: solo una escritura por conjunto (multi-fila) lo permite.

Se separa del pipeline completo (`add-import-pipeline`) porque es la deuda concreta de D152, se verifica con el benchmark del CSV básico que ya existe (TC-IMPORTS-CSV-029) y cambia el perfil de eventos que mide `optimize-consumer-throughput` (D301): conviene cerrarlo antes de sumar formatos, reglas y deshacer.

## What Changes

- **Registro en lote por conjunto en TRANSACTIONS (requirement Must):** el contrato público `ImportedTransactionsCommand.recordBatch` (el `RecordImportedTransactions` de docs/13 §1) conserva su firma y su resultado, pero su implementación pasa a escribir por conjunto: una validación de cuenta, moneda, escala y periodos cerrados por lote; inserciones multi-fila de transacciones, splits, vínculos al ledger, asientos y movimientos, auditoría, recorrido y outbox. Mismo efecto observable que el registro individual (requirement Must de equivalencia).
- **Puertos por lote aditivos** en LEDGER (`LedgerPostingPort.postJournalEntries`), AUDIT (`AuditPort.appendMany`, `LifecyclePort.recordMany`) y en el outbox de la plataforma (`appendMany`), usados solo por el camino del import. Los disparadores de integridad del ledger (suma cero por moneda, periodo abierto, inmutabilidad) siguen activos: el lote no los esquiva.
- **Persistencia ≤ 20 s obligatoria:** el requirement «Volumen de eventos de un import grande» pasa a Must con la persistencia en ≤ 20 s; el benchmark quita el techo de regresión de 300 s y aplica la meta por omisión (se retira `PF_PERF_STRICT_IMPORT`).
- **Eventos sin cambios:** cada transacción sigue publicando `TransactionCreated.v1`, `TransactionPosted.v1` y `JournalEntryPosted.v1`; el import sigue publicando solo sus eventos de job (ninguno por fila).
- **Fuera de alcance:** formatos, perfiles, reglas, duplicados con puntaje, deshacer, transferencias y conversiones importadas (`add-import-pipeline`); la clasificación de la fila (`ImportedClassificationDto` la agrega `add-rule-engine` a este mismo contrato, decisión 6); la entrega agrupada de eventos (`optimize-consumer-throughput`); cambiar el estado de las transacciones importadas (`POSTED`, D149).

## Capabilities

### New Capabilities

- Ninguna.

### Modified Capabilities

- `transactions/transaction-recording`: registro en lote de transacciones importadas y equivalencia con el registro individual (2 requirements ADDED, Must).
- `imports/import-pipeline`: «Volumen de eventos de un import grande» pasa a Must con la persistencia en ≤ 20 s y la cantidad de eventos propios independiente de las filas (1 requirement MODIFIED).

## Impact

**Specs impactadas:** `transactions/transaction-recording` (2 ADDED; compatible con el ADDED «Origen de la clasificación de cada split» de `add-rule-engine`), `imports/import-pipeline` (1 MODIFIED). Leídas sin cambios: `ledger/journal-posting`, `audit/audit-trail`, `audit/lifecycle-timeline`, `platform/event-delivery`.

**Componentes/contextos impactados:** TRANSACTIONS (`application/imported-transactions.adapter.ts` → caso de uso por lote; repositorio con inserciones multi-fila), LEDGER (puerto y repositorio de asientos por lote), AUDIT (auditoría y recorrido por lote), `@pf/platform` (outbox por lote), IMPORTS sin cambios de código salvo el tamaño de lote configurable, harness `apps/api/test/perf/imports.perf.ts`.

**APIs impactadas:** ninguna (`contracts/openapi` sin cambios).

**Tablas impactadas:** ninguna nueva; inserciones multi-fila en `txn.transaction`, `txn.transaction_split`, `txn.transaction_journal_link`, `ledger.journal_entry`, `ledger.posting`, `audit.audit_log`, las tablas del recorrido y `platform.outbox`.

**Eventos impactados:** ninguno (mismos eventos y esquemas; solo cambia que se escriben en el outbox en una sentencia por lote).

**Migraciones requeridas:** ninguna prevista. Si la medición pide un índice para la verificación de referencias por conjunto, se agrega como expand (`CONCURRENTLY`), sin destruir nada.

**Test cases:** AÑADIDOS — TC-TRANSACTIONS-BULKIMPORT-001..005 (5), TC-IMPORTS-PIPELINE-001 (1). MODIFICADOS — TC-IMPORTS-CSV-029 (nota: la persistencia ≤ 20 s pasa a exigirse sin `PF_PERF_STRICT_IMPORT`; sin cambio de su resultado esperado), TC-IMPORTS-CSV-024 sigue igual (lotes de 200). DEPRECADOS — ninguno.

**Impacto de regresión:** el camino del import deja de reutilizar `recordTransaction`; la equivalencia se protege con un test por propiedad que compara ambos caminos y con la suite existente de imports (TC-IMPORTS-CSV-001..030). El registro manual no cambia (NFR-PERF-003 sigue midiéndose igual).

**Riesgos introducidos:** divergencia entre el camino individual y el masivo (mitigado por el test de equivalencia y por los disparadores del ledger, que siguen validando cada asiento); transacciones de BD más pesadas por lote (mitigado: lote de 200 configurable y medido); ráfaga de eventos más concentrada (cubierto por `optimize-consumer-throughput`, que va antes).

**Invariantes afectadas:** INV-001 y INV-003 (montos `Decimal` a la escala de la moneda, sin redondeo), INV-004 y INV-005 (asientos cuadrados por moneda, ≥ 2 movimientos), INV-007 (movimientos inmutables), INV-014 (idempotencia del import), INV-015 (periodos cerrados), INV-021 (splits suman el monto), INV-023 (una transacción posteada, un asiento activo), INV-029 (auditoría en la misma transacción): ninguna cambia, todas deben seguir verificándose en el camino por lote.
