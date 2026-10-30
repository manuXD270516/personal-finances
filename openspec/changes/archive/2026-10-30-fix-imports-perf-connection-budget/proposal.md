# Propuesta: fix-imports-perf-connection-budget

## Why

Con el change `investigate-perf-under-load` aplicado, el único rojo del job `perf` del nightly es `imports.perf.ts` [TC-IMPORTS-CSV-029], y tiene dos manifestaciones que nadie ha medido:

1. **Conexiones:** en la corrida E10 (run 40154960947, 2026-10-25) la suite falló a los 34 s con `timeout exceeded when trying to connect`, el error de `pg` cuando una adquisición de conexión espera más que `connectionTimeoutMillis` ([docs/50](../../../docs/50-perf-under-load-findings.md), H6 «no medida»).
2. **Drenado marginal:** en el nightly programado 40322158874 (2026-10-26, `main`, commit 69d8388) el drenado de los consumidores tardó 123,5 s después de la persistencia frente a 120 s (`AssertionError: expected 123458.95 to be less than or equal to 120000`; la suite entera, 335 s). En esa corrida todas las demás suites pasaron, con la purga y la espera de quietud correctas.

El owner eligió un change de seguimiento propio que mida primero y corrija después, con el alcance ampliado a las dos manifestaciones (D299, [docs/52](../../../docs/52-perf-under-load-owner-decisions.md)). Subir `max_connections` del contenedor sin medir, o el umbral de 120 s, escondería un posible problema real del presupuesto de conexiones, que también afecta al despliegue.

## What Changes

- **Medición primero (diagnóstico):** la suite del import publica, durante la persistencia y el drenado, las conexiones de cada pool que participa (API, worker, sus colas pg-boss y el harness) frente a su máximo, las adquisiciones que esperan y cuánto, y las conexiones del servidor frente a `max_connections` del contenedor; y, por consumidor, los eventos pendientes al empezar el drenado, cuándo llega a 0 y su ritmo. Las corridas de diagnóstico van por `workflow_dispatch` de `nightly` desde una rama no fusionada.
- **Benchmark coherente con su presupuesto (requirement Must):** antes de medir, la suite verifica que la suma de los pools máximos del benchmark cabe en `max_connections` del contenedor menos las conexiones reservadas; si no, falla sin medir. Una adquisición de conexión que vence hace fallar la suite con el veredicto `conexiones` (pool, en uso, máximo y espera), distinto de un drenado que no cumple su presupuesto.
- **Drenado por consumidor (requirement Must):** el reporte publica el drenado por consumidor y, si el total supera 120 s después de la persistencia, el fallo nombra los consumidores que lo superan y sus tiempos. El umbral de 120 s (D112, NFR-PERF-008) no cambia.
- **Arreglo según la causa medida:** del benchmark (tamaño de los pools del harness, `max_connections` del contenedor efímero justificado por la suma medida, cierre de pools de suites anteriores) o del producto (adquisición de conexiones, concurrencia de un consumidor), con su propia tarea y test. Si la causa pide cambiar el presupuesto de conexiones de producción o el umbral de 120 s, se pregunta al owner antes.
- **Criterio de salida:** `imports.perf.ts` en verde en dos nightlies programados seguidos, con el reporte de conexiones y de drenado publicado.
- **Fuera de alcance:** la persistencia del import ≤ 20 s (Phase 6, D152); el throughput por consumidor con handler real y `optimize-consumer-throughput` (Phase 6, D300, D301); cambiar el runner o la espera de quietud (D302); cambiar umbrales sin decisión del owner (TC-PLATFORM-PIPELINE-028).

## Capabilities

### New Capabilities

- Ninguna.

### Modified Capabilities

- `platform/delivery-pipeline`: el benchmark del import mide con un presupuesto de conexiones coherente y separa el fallo por conexiones del drenado por consumidor (2 requirements ADDED, ambos Must).

## Impact

**Specs impactadas:** `platform/delivery-pipeline` (2 requirements ADDED; no cambia los de la spec principal ni los que agregan `add-dependency-updates`, `fix-nightly-pipeline` e `investigate-perf-under-load`, sin archivar). Leídas sin cambios: `imports/import-pipeline` (requirement «Volumen de eventos de un import grande», TC-IMPORTS-CSV-029) y `platform/event-delivery` (rendimiento sostenido de los consumidores y presupuesto de conexiones al arrancar el worker, TC-PLATFORM-EVENTS-019). Si la causa resulta del producto y cambia un comportamiento especificado, se agrega el delta correspondiente antes de implementarlo (tarea 4.3).

**Componentes/contextos impactados:** harness de rendimiento `apps/api/test/perf/` (`imports.perf.ts`, `perf-report.ts` y sus tests, un helper nuevo de muestreo de conexiones), `apps/api/test/support/` si el arreglo toca los pools o `max_connections` del contenedor efímero, y el test de política `scripts/delivery-policy/test/nightly-policy.test.ts`. Código de producción solo si la medición lo exige (grupo 4), con su test. `nightly.yml` no cambia en lo que se fusiona.

**APIs impactadas:** ninguna (`contracts/openapi` sin cambios).

**Tablas impactadas:** ninguna (solo lectura de `pg_stat_activity`, `pgboss.job`, `platform.outbox` y `pg_settings` en la base efímera del benchmark).

**Eventos impactados:** ninguno.

**Migraciones requeridas:** ninguna.

**Test cases:** AÑADIDOS — TC-PLATFORM-PIPELINE-029..032 (4). MODIFICADOS — ninguno en su comportamiento esperado; al cerrar se anota en TC-IMPORTS-CSV-029 la causa y el camino. DEPRECADOS — ninguno.

**Impacto de regresión:** el job `perf` gana un muestreo de conexiones en una suite; no se quita ni se relaja ningún benchmark.

**Riesgos introducidos:** ninguno registrado. Riesgos del diseño: cada corrida de diagnóstico tarda ≈ 60 min (D302) y `concurrency: nightly` cancela una corrida en curso; un ajuste de pools solo del harness podría ocultar un problema de producción (por eso se compara con la plantilla del host).

**Invariantes afectadas:** ninguna (no toca dinero, ledger, FX, periodos ni redondeo).
