# Propuesta: stabilize-import-persist-perf

## Why

La fila bloqueante del benchmark del import de 5 000 filas (TC-IMPORTS-CSV-029, configuración de la plantilla del host, D311) vuelve a fallar en el nightly: la persistencia supera los 20 s de NFR-PERF-007 en cuatro de los cinco nightlies programados del 2026-11-04 al 2026-11-08, después de dos semanas en verde con el change 52 (`add-bulk-imported-transactions`, ≈ 14–17 s). El 2026-11-08 también falló `throughput.perf.ts` (TC-PLATFORM-THROUGHPUT-008 y 012): la fase A no vio el outbox en 0 dentro de los 600 s de su preparación. Antes se refrescaron las estadísticas de la cola de trabajos (#205, D360) y se agruparon los consumidores (change 51, [docs/59](../../../docs/59-consumer-throughput-findings.md)), y no alcanzó.

El owner decidió (2026-11-09) tratarlo en un change aparte **sin tocar el umbral** (NFR-PERF-007, D152). Los logs del job `perf` muestran que el problema no es uno solo:

1. **Varianza del runner.** El 2026-11-04 el código era el mismo que el 2026-11-02 y 2026-11-03 (`7d825710`), y la persistencia pasó de 14,4 s a 32,7 s. Ese día todo el job fue más lento: la evaluación de reglas en memoria (CPU pura, `rules.perf.ts`) tardó 123 ms frente a 53 ms, y el matcher rindió 441 ev/s frente a 818. Del 2026-11-05 al 2026-11-07 el runner fue 1,6 veces más lento que el de referencia.
2. **Margen insuficiente del producto.** Incluso en un runner rápido la persistencia ronda 14–17 s; un runner 1,6–2,3 veces más lento la lleva a 23–34 s.
3. **Posible regresión el 2026-11-08.** Con un runner rápido (53–54 ms en la calibración de reglas), la persistencia midió 19,95 s y la fase A de `throughput.perf.ts` se estancó por primera vez. Es la primera corrida con #216 (`add-cash-flow-forecast`), que agrega trabajos programados con pasada de arranque en el worker que usa el benchmark.

Hoy el reporte solo publica la persistencia total: no dice cuánto es espera de la cola, cuánto es trabajo propio de cada lote, cuánto es contención con el relay y los consumidores, ni cómo era el runner. Sin ese desglose no se puede elegir el arreglo.

## What Changes

- **Instrumentación (se fusiona):** el benchmark del import publica el desglose de la persistencia (espera inicial, cada lote por paso, cierre, observación) y las esperas de la base, el mantenimiento concurrente (autovacuum, checkpoints), los trabajos encolados por el relay y la carga del host durante la persistencia; el job publica la **huella del runner** (CPU, memoria, calibración de CPU y de confirmaciones de la base) como dato informativo.
- **Aislamiento del benchmark:** el worker del benchmark arranca sin las pasadas de arranque de los trabajos programados ajenos a la importación (vigilancia del flujo de caja, digest), como ya se hace con el mantenimiento del ledger o el relleno de tasas, y el reporte publica los trabajos programados que corrieron dentro de la ventana medida.
- **`throughput.perf.ts` sin decidir el veredicto:** si su preparación no termina, la suite (informativa por D300 y D359) se publica «sin completar» con un diagnóstico del outbox (pendientes por tipo, intentos, último error, transacción abierta más larga) y no hace fallar el job; la causa del estancamiento se investiga en este change.
- **Experimentos en orden** (P1–P8 del design) desde una rama que no se fusiona, con pares en el mismo runner para separar la varianza del runner de la regresión del código.
- **Arreglo según el resultado:** en este change entran el arreglo del benchmark que corresponda y las optimizaciones del producto que no cambian contratos, invariantes ni la durabilidad: tamaño del lote (decisión 4 del change 52), trabajo por lote, relay y trabajos programados. Las palancas que requieren decisión del owner (disparadores por sentencia, durabilidad de la confirmación, regulación del relay) se resolvieron en [docs/64](../../../docs/64-import-persist-perf-decisions.md) (D404 a D406): solo con la evidencia y las condiciones que fijan.
- **Criterio de salida:** persistencia de la fila del host ≤ 20 s en nightlies programados seguidos (5 seguidos y objetivo interno ≤ 12 s, D403), con la causa medida registrada en docs/23 §5.5 (requirement «Causa de los rojos de rendimiento documentada antes de cambiar un umbral»).
- **Fuera de alcance:** cambiar el umbral de 20 s, el de 30 s de la vista previa o el de 120 s del drenado; pasar la fila del host a informativa; cambiar el runner del job `perf` (D302) o la protección de `main`; cambiar el contrato de `recordBatch`, los eventos, la auditoría o las invariantes del ledger; desactivar disparadores de integridad; el pipeline por documentos (OFX, PDF), cuyo tiempo hasta la revisión ya tiene margen (0,9 s y 3,1 s el 2026-11-08).

## Capabilities

### New Capabilities

- Ninguna.

### Modified Capabilities

- `platform/delivery-pipeline`: desglose de la persistencia del benchmark del import, huella del runner, suites informativas que no deciden el veredicto aunque su preparación no termine, y benchmark del import sin trabajos programados ajenos (4 requirements ADDED: 2 Must, 2 Should).

## Impact

**Specs impactadas:** `platform/delivery-pipeline` (4 requirements ADDED; no cambia los de la spec principal ni el que agrega `add-dependency-updates`, sin archivar). Leídas sin cambios: `platform/event-delivery` (publicación al menos una vez, orden por agregado, ráfaga de un import grande), `imports/import-pipeline` y `transactions/transaction-recording` (el delta del change 52, sin archivar, no se toca). Si un experimento lleva a cambiar una conducta observable del relay o de la persistencia, el delta se agrega con `/opsx:update` antes de implementarlo.

**Componentes/contextos impactados:** harness de rendimiento `apps/api/test/perf/` (`imports.perf.ts`, `throughput.perf.ts`, `burst-support.ts`, `background-load.ts`, `perf-report.ts` y su test, una calibración del runner) y `apps/api/test/support/portability.ts` (opciones de arranque del worker); instrumentación de tiempos por paso en `PersistImportService` (IMPORTS, application) detrás de un puerto opcional de medición sin efecto en producción; según el resultado de los experimentos: `RecordImportedTransactions` (TRANSACTIONS), `postJournalEntries` (LEDGER), `OutboxRelay` y `PgBossJobQueue` (`@pf/platform`), `registerCashFlowWatchJob` (worker). `.github/workflows/nightly.yml` no cambia en lo que se fusiona (la huella del runner la toma el harness con `node:os` y una consulta a la base).

**APIs impactadas:** ninguna (`contracts/openapi` sin cambios).

**Tablas impactadas:** ninguna en la instrumentación (solo lectura de `platform.outbox`, `pgboss.job_common` y las vistas `pg_stat_*` en la base efímera del benchmark). Si un experimento justifica un índice nuevo, va en una migración expand aparte, registrada en este change con `/opsx:update`.

**Eventos impactados:** ninguno (mismos tipos, versiones y payloads).

**Migraciones requeridas:** ninguna prevista.

**Test cases:** AÑADIDOS — TC-PLATFORM-PIPELINE-033..041 (9). MODIFICADOS — sin cambio de comportamiento esperado; al cerrar se anotan causa, camino y evidencia en TC-IMPORTS-CSV-029, TC-PLATFORM-THROUGHPUT-008 y TC-PLATFORM-THROUGHPUT-012. DEPRECADOS — ninguno.

**Impacto de regresión:** la persistencia por lotes no cambia de contrato; cualquier optimización del producto se prueba con la equivalencia del change 52 (TC-TRANSACTIONS-BULKIMPORT-005) y la suite de imports existente. El job `perf` suma segundos por la instrumentación y la calibración. No se quita ni se relaja ningún benchmark bloqueante.

**Riesgos introducidos:** ninguno registrado. Riesgos del diseño: la instrumentación puede alterar lo que mide (se acota a marcas de tiempo y a un muestreo cada 250 ms en una conexión aparte); los experimentos dependen de runners con varianza 1,0–2,3× (se usan pares en el mismo runner); un `workflow_dispatch` de `nightly` cancela la corrida en curso (`concurrency: nightly`), así que los experimentos usan un grupo de concurrencia propio en la rama.

**Invariantes afectadas:** ninguna se cambia. Las optimizaciones candidatas tocan la escritura de asientos y movimientos, por lo que deben conservar INV-001, INV-004, INV-005, INV-015, INV-021 e INV-029 (los disparadores de integridad siguen activos) y pasar el test de equivalencia del change 52.
