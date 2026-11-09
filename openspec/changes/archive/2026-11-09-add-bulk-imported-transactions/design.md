# Diseño: add-bulk-imported-transactions

## Contexto

Motivación y alcance: ver proposal.md. Fuentes: NFR-PERF-007 (docs/02: persistencia ≤ 20 s, Must, Phase 6), D152 (docs/35), D149 (estado `POSTED`, sin categoría), docs/13 §1 y §4.1 (etapa Persist, `RecordImportedTransactions` por lotes de 200, una transacción de BD por lote), docs/09 (INV-001..029), `add-basic-csv-import` (decisiones 9–11 y tarea 7.3: ≈ 24 ms y ≈ 60 sentencias por fila), [docs/53](../../../docs/53-imports-perf-findings.md) (persistencia de 92–254 s en el job `perf`) y el código de `main`:

| Pieza | Hoy | Problema |
|---|---|---|
| `ImportedTransactionsAdapter.recordBatch` (`packages/contexts/transactions/src/application/imported-transactions.adapter.ts`) | Lee referencias existentes por conjunto y luego llama a `TransactionsService.recordTransaction` por fila | Cada fila repite validación de cuenta, moneda, periodo, carga del catálogo de categorías, inserción de transacción, split, vínculo, asiento, movimientos, auditoría, recorrido y 3 eventos: ≈ 60 viajes a la BD |
| `LedgerPostingPort.postJournalEntry` | Un asiento por llamada (resuelve cuentas del ledger, valida periodo, inserta asiento y movimientos) | Sin variante por lote |
| `AuditPort.append`, `LifecyclePort.record` | Una entrada por llamada | Sin variante por lote |
| Outbox (`OutboxPort.append`) | Un evento por sentencia | 3 sentencias por fila |
| Disparadores de BD | `posting_balanced_trg`, `journal_entry_postings_trg` (diferidos), `journal_entry_period_open_trg`, `transaction_splits_sum_*` | Siguen activos: son la última barrera de INV-004/005/015/021 y se disparan por fila también con inserciones multi-fila |

| Elemento | Capa | Cambio |
|---|---|---|
| `RecordImportedTransactions` (caso de uso nuevo detrás de `ImportedTransactionsCommand.recordBatch`) | TRANSACTIONS application | Construye en memoria los agregados del lote con las mismas reglas del dominio y los persiste por conjunto (decisiones 1–3) |
| `TransactionRepository.insertMany` | TRANSACTIONS infrastructure | `INSERT … SELECT FROM unnest(...)` de transacciones, splits y vínculos |
| `LedgerPostingPort.postJournalEntries` | LEDGER contracts/application/infrastructure | Asientos y movimientos por conjunto, con la misma traducción y validación de periodo por fechas distintas |
| `AuditPort.appendMany`, `LifecyclePort.recordMany` | AUDIT contracts/infrastructure | Entradas por conjunto en la misma unidad de trabajo |
| `OutboxPort.appendMany` | `@pf/platform` | Eventos por conjunto, validados contra su esquema igual que hoy |
| `imports.perf.ts` | tests de rendimiento | Meta de 20 s por omisión; se retira `PF_PERF_STRICT_IMPORT` y el techo de 300 s |

## Objetivos / No objetivos

**Objetivos:** persistir 5 000 filas en ≤ 20 s en el entorno de referencia sin cambiar ningún efecto observable, ninguna invariante ni ningún evento.

**No objetivos:** el pipeline completo, las reglas, el deshacer y las transferencias o conversiones importadas (`add-import-pipeline`); la entrega de eventos (`optimize-consumer-throughput`); el registro manual (NFR-PERF-003 no cambia).

## Decisiones

1. **Mismo contrato, otra implementación.** `ImportedTransactionsCommand.recordBatch` conserva firma, resultado (`created`, `alreadyExisting`) y semántica (unidad de trabajo del llamador; error de dominio ⇒ excepción que revierte el lote). Imports no cambia su código de persistencia. El nombre de docs/13, `RecordImportedTransactions`, pasa a ser el del caso de uso.
2. **Validación por conjunto con el mismo resultado que por fila.** Por lote: una lectura de la cuenta (activa, no archivada, moneda), una del catálogo de la moneda (escala), una de los periodos cerrados para las fechas distintas del lote (`assertPeriodOpen` por conjunto), una de las referencias existentes (ya existe) y una de las categorías de sistema («sin categoría», «ingreso sin categoría», D9). Las reglas del dominio por fila (monto > 0, escala, fecha) se aplican en memoria con los mismos objetos de dominio que `recordTransaction` (`Money`, `Transaction.create`), de modo que el código que decide no se duplica: solo cambia cómo se persiste. Si una fila falla, se lanza el mismo `DomainError` que lanzaría el camino individual y el lote completo se revierte (sin cambio respecto de hoy).
3. **Persistencia por conjunto.** Orden dentro de la unidad de trabajo: transacciones → splits → asientos y movimientos (`postJournalEntries`) → vínculos transacción–asiento → auditoría (`appendMany`) → recorrido (`recordMany`) → outbox (`appendMany`). Cada paso es una sentencia multi-fila con `unnest` de arreglos tipados (sin concatenar SQL). Los identificadores (UUIDv7) se generan en la aplicación antes de insertar. Los montos viajan como texto decimal y se insertan en `NUMERIC(38,18)` (INV-001). Los disparadores diferidos del ledger validan cada asiento al confirmar; un asiento descuadrado revierte el lote entero (no puede pasar si el dominio es correcto, pero la barrera sigue).
4. **Tamaño de lote.** Se mantiene `IMPORT_PERSIST_BATCH_SIZE = 200` (los scenarios de fallo parcial y reintento de `imports/import-pipeline` lo usan). Presupuesto: 25 lotes en 20 s ⇒ ≤ 800 ms por lote de 200 (≤ 4 ms por fila). Si la medición en el job `perf` muestra que 200 no alcanza, se sube el valor por omisión (hasta el tope de 1 000 del contrato) solo con esa evidencia, sin tocar los scenarios (que fijan el valor del ejemplo, no el por omisión): se registra en el informe de la tarea 5.2.
5. **Equivalencia probada, no supuesta.** Test por propiedad (fast-check) que genera lotes de filas (montos y escalas válidos, fechas en periodos abiertos, descripciones con caracteres especiales, filas idénticas) y los registra por ambos caminos en dos workspaces del mismo estado inicial; compara transacciones, movimientos por cuenta y moneda, auditoría, recorrido y eventos, normalizando identificadores e instantes (TC-TRANSACTIONS-BULKIMPORT-005). El camino individual (`recordTransaction`) queda como referencia y se sigue usando para el registro manual.
6. **Campos que agregan otros changes.** El contrato de la fila crecerá con la clasificación (`ImportedClassificationDto`, `add-rule-engine`) y con el tipo de movimiento y los datos de transferencia o conversión (`add-import-pipeline`). Regla: el change que agrega un campo lo implementa en el camino por lote (y, si corresponde, en el individual) y amplía el test de equivalencia. Este change no los anticipa.
7. **Eventos y auditoría sin cambios de contenido.** Mismos tipos, versiones y payloads (`TransactionCreated.v1`, `TransactionPosted.v1`, `JournalEntryPosted.v1`), mismo `correlationId` del lote y mismo `aggregateVersion` inicial; la auditoría conserva `origin = 'import'`, el actor de la aprobación y el `import_job_id`. El volumen de eventos del lote llega al outbox en una sentencia y lo publica el relay como hoy.
8. **Benchmark.** `imports.perf.ts` pasa a exigir 20 s por omisión (se retira `PF_PERF_STRICT_IMPORT` y el techo de regresión de 300 s); el test de política (TC-PLATFORM-PIPELINE-028) se actualiza para fijar 20 s, que es el valor de docs/02 (no es un cambio de umbral: es aplicar el que estaba diferido por D152). El drenado de 120 s no cambia y se apoya en `optimize-consumer-throughput`.

## Contratos

- **OpenAPI:** sin cambios.
- **Eventos:** sin cambios.
- **Contratos públicos (aditivos):**
  - `@pf/ledger/contracts`: `LedgerPostingPort.postJournalEntries(commands: readonly PostJournalEntryCommand[]): Promise<readonly PostedEntryDto[]>` — misma semántica que `postJournalEntry` para cada comando, en la unidad de trabajo del llamador; valida periodo abierto por las fechas distintas; tope 1 000 comandos.
  - `@pf/audit/contracts`: `AuditPort.appendMany(entries: readonly AuditEntry[]): Promise<void>` y `LifecyclePort.recordMany(items: readonly { entry: AuditEntry; steps: readonly LifecycleStepInput[] }[]): Promise<void>`.
  - `@pf/platform`: `OutboxPort.appendMany(events)` (o el equivalente del outbox transaccional vigente), con la validación de envelope y payload por evento (requirement «Envelope y payload validados contra el contrato al escribir»).
  - `@pf/transactions/contracts`: `ImportedTransactionsCommand.recordBatch` sin cambios de firma.
- **Configuración:** sin variables nuevas; `IMPORT_PERSIST_BATCH_SIZE` sigue en 200 salvo la decisión 4. Se retira `PF_PERF_STRICT_IMPORT` (variable del harness, no de producto).

## Riesgos / Trade-offs

- **Divergencia de caminos:** mitigada con la decisión 5 y con la suite de imports existente; cualquier campo nuevo debe ampliar el test.
- **Lote más pesado en una transacción:** 200 asientos y 600 eventos por transacción de BD; bloqueos más largos sobre las tablas del ledger durante ≤ 800 ms. Aceptable: un import es una operación del usuario y el registro manual concurrente espera a lo sumo un lote.
- **Ráfaga de eventos más concentrada:** los 15 000 eventos de 5 000 filas llegan en ≈ 20 s; lo cubre `optimize-consumer-throughput` (va antes).
- **Disparadores por fila:** con inserciones multi-fila siguen siendo por fila; si fueran el cuello de botella, se mide y se pregunta antes de tocar cualquier disparador (no se desactivan).

## Plan de migración

Sin migraciones previstas. Orden: tests primero (equivalencia y casos de lote) → puertos por lote en LEDGER, AUDIT y plataforma → caso de uso en TRANSACTIONS → benchmark. Rollback: volver a la implementación por fila del adapter (el contrato es el mismo); no hay datos que migrar.

## Dependencias entre changes

- **Requiere aplicado:** `optimize-consumer-throughput` (su ráfaga con la configuración del host es la que este change concentra en ≈ 20 s). Si se implementara antes, el drenado de TC-IMPORTS-CSV-029 con la concurrencia del código sigue siendo el que bloquea.
- **Antes de:** `add-import-pipeline` (usa este camino y lo amplía con tipos de movimiento) y de la medición del 70 % de `add-rule-engine` (su `ImportedClassificationDto` se implementa sobre este camino: quien llegue segundo lo integra, decisión 6).
- **Independiente de:** `add-document-attachments`.

## Preguntas abiertas

Ninguna bloquea. Puede abrirse una con la medición: si los disparadores por fila del ledger impiden los 20 s, se pregunta al owner antes de cambiar la forma de validar (por ejemplo, un disparador por sentencia) con opciones y la evidencia.

## Cambios a docs compartidos

- **docs/13** §1 y §4.1 (etapa Persist): `RecordImportedTransactions` escribe por conjunto; puertos por lote de LEDGER, AUDIT y plataforma.
- **docs/09**: nota de que los disparadores de INV-004/005/015/021 se mantienen para las inserciones multi-fila.
- **docs/23** §5.5 y **docs/02** NFR-PERF-007: la persistencia ≤ 20 s se exige en el nightly (fin de D152).
- **docs/35** (nota de cumplimiento de D152) y **docs/38** §3 (quitar «Persistencia del import CSV ≤ 20 s» de diferidos) y §4 «Importación CSV».
- **docs/05/06**: puertos por lote en el mapa de contextos (TRANSACTIONS → LEDGER, AUDIT).
