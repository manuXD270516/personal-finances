# Propuesta: optimize-consumer-throughput

## Why

El owner difirió este change a Phase 6 para hacerlo **junto con la escritura masiva del import** (D301, [docs/52](../../../docs/52-perf-under-load-owner-decisions.md)), porque esa escritura cambia el perfil de eventos: hoy un import de 5 000 filas se persiste en ~120–250 s y los consumidores van drenando mientras tanto; con la persistencia en ≤ 20 s (NFR-PERF-007, D152) los mismos eventos llegan casi juntos.

Cifras del código vigente (verificadas en `main`):

- Cada transacción importada publica 3 eventos (`transactions.TransactionCreated.v1`, `transactions.TransactionPosted.v1`, `ledger.JournalEntryPosted.v1`), cada uno en su propio agregado. Un import de 5 000 filas son **15 000 eventos** y, con las suscripciones actuales, **45 000 entregas**: `reporting.data-version` 15 000, `debt.card-activity` 10 000 y 5 000 cada uno para `planning.journal-entry-posted`, `planning.budget-thresholds`, `commitments.occurrence-matcher` y `goals.balance-watch`.
- Cada entrega es una transacción de base de datos propia (inbox + efecto). La plantilla del host corre los consumidores con **concurrencia 1** (`EVENT_CONSUMER_CONCURRENCY=1`) y un pool de 34 conexiones en el worker con 28 consumidores + 4 reservadas = 32 (D249): **no hay lugar para consumidores ni concurrencia nuevos**.
- Para drenar 15 000 entregas en 120 s (D112) con concurrencia 1, `reporting.data-version` necesita ≥ 125 entregas/s sostenidas con su handler real. Nadie midió el costo por evento de cada consumidor con handler real (E6–E8 del change 48 no corrieron, D303), y el benchmark del import mide con la concurrencia del código (4), no con la del host (D307, [docs/54](../../../docs/54-imports-perf-questions.md)).

Este change mide primero (D299: «medir antes de corregir») y después agrega una **entrega agrupada** para los consumidores que recalculan estado, de modo que una ráfaga de eventos del mismo workspace se aplique con una sola transacción por lote en lugar de una por evento, sin conexiones nuevas. Va **antes** de `add-bulk-imported-transactions` y de `add-import-pipeline` (D112 ya exigía que el throughput estuviera resuelto antes de los imports de Phase 6).

## What Changes

- **Medición por consumidor con handler real (E6–E8, D300):** duración por evento (p50/p95), esperas de bloqueos y throughput de un consumidor a la vez, con dos configuraciones (la del código y la de la plantilla del host) y con el perfil de una ráfaga de import de 5 000 filas (consumidores detenidos durante la persistencia y arrancados juntos: el peor caso del perfil de `add-bulk-imported-transactions`). Informe en un doc `docs/NN-consumer-throughput-findings.md`.
- **Entrega agrupada (requirement Must):** un consumidor puede declarar que su efecto recalcula estado y no depende del orden de los eventos dentro de un lote; el runtime le entrega los eventos nuevos del mismo workspace de un lote en una sola transacción (inbox multi-fila + una invocación del handler). Si el grupo falla, se reintenta evento por evento y solo el culpable queda en reintento (se conserva el requirement vigente). Los consumidores que no lo declaran siguen como hoy.
- **Consumidores que se pasan a la entrega agrupada:** los que la medición identifique como insuficientes para la ráfaga con la configuración del host. Candidatos por diseño: `reporting.data-version`, `planning.journal-entry-posted`, `planning.budget-thresholds` (reemplaza su coalescencia en memoria), `goals.balance-watch`, `debt.card-activity` y `commitments.occurrence-matcher` (búsqueda de candidatas por conjunto). Cada uno con su test de equivalencia (mismo estado final entregado de a uno o agrupado).
- **Ráfaga de un import con la configuración del host (requirement Must):** cada consumidor deja procesados los eventos de 5 000 transacciones importadas en ≤ 120 s con concurrencia 1, pool del worker de 34 y API de 22, sin consumidores ni concurrencia nuevos.
- **Benchmark con la configuración del host (D307, opción c):** el benchmark del import publica una segunda fila con la configuración del host; es **bloqueante** y la de la configuración del código queda informativa (D311, docs/57). La fila de throughput con handler real del nightly sigue informativa (D300) y este change propone los umbrales por consumidor en un doc de preguntas.
- **Métricas:** tamaño de grupo y entregas por invocación del handler, y reintentos evento por evento tras un fallo de grupo.
- **Fuera de alcance:** la escritura masiva (`add-bulk-imported-transactions`); el pipeline del import (`add-import-pipeline`); cambiar umbrales sin decisión del owner (D300, D306, TC-PLATFORM-PIPELINE-028); subir `max_connections`, el pool del worker o la concurrencia del host (D249); cambiar el runner del job `perf` (D302); agregar consumidores; cambiar el contrato de cualquier evento.

## Capabilities

### New Capabilities

- Ninguna.

### Modified Capabilities

- `platform/event-delivery`: entrega agrupada para consumidores que recalculan estado, ráfaga de un import grande con la configuración del host y métricas de la entrega agrupada (3 requirements ADDED: 2 Must, 1 Should).
- `platform/delivery-pipeline`: costo por evento de cada consumidor con handler real y benchmark del import con la configuración del host (2 requirements ADDED, Should).

## Impact

**Specs impactadas:** `platform/event-delivery` (3 ADDED; no cambia «Rendimiento sostenido de los consumidores», «Consumidores idempotentes por evento» ni «Orden de entrega por agregado», que siguen valiendo para la entrega agrupada), `platform/delivery-pipeline` (2 ADDED; no toca los requirements de `fix-imports-perf-connection-budget`, sin archivar). Leída sin cambios: `imports/import-pipeline` («Volumen de eventos de un import grande», TC-IMPORTS-CSV-029).

**Componentes/contextos impactados:** `@pf/platform` (`events/consumers.ts`: definición opcional de agrupación, entrega por grupo, métricas), consumidores de REPORTING, PLANNING, GOALS, DEBT y COMMITMENTS que se pasen a la entrega agrupada (solo la capa `interface`/`application` de cada uno: handler por lote), harness de rendimiento `apps/api/test/perf/` (perfil de ráfaga, configuración del host, costo por evento). Sin dominio financiero nuevo.

**APIs impactadas:** ninguna (`contracts/openapi` sin cambios).

**Tablas impactadas:** ninguna nueva; `platform.inbox` recibe inserciones multi-fila (mismo esquema y misma clave `(consumer, event_id)`).

**Eventos impactados:** ninguno (sin eventos nuevos ni cambios de esquema).

**Migraciones requeridas:** ninguna.

**Test cases:** AÑADIDOS — TC-PLATFORM-THROUGHPUT-001..015 (15). MODIFICADOS — ninguno en su comportamiento esperado (TC-PLATFORM-EVENTS-014/018/019 siguen igual; al cerrar se anotan en TC-IMPORTS-CSV-029 las dos configuraciones medidas). DEPRECADOS — ninguno.

**Impacto de regresión:** cambia cómo se entregan los eventos a los consumidores que optan por agruparse; el inbox, el orden por agregado, los reintentos y la dead-letter se conservan y se prueban con los TC existentes de `platform/event-delivery` más los nuevos de equivalencia por consumidor.

**Riesgos introducidos:** un handler agrupado que no sea realmente independiente del orden aplicaría un estado intermedio incorrecto (mitigado: opt-in declarado, test de equivalencia por consumidor y propiedad de un trabajo por agregado en cada lote); lotes más grandes retienen trabajos más tiempo (mitigado: tope del lote y medición de reintentos sin excepción, HI6 de docs/53).

**Invariantes afectadas:** ninguna (no toca dinero, ledger, FX, periodos ni redondeo; los efectos de los consumidores no cambian).
