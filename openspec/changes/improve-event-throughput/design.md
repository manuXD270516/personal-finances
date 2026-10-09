# Diseño: improve-event-throughput

## Contexto

- `PgBossJobQueue.work` (`packages/platform/src/queue/pgboss-job-queue.ts`) llama a `boss.work` con `batchSize: 1`, `localConcurrency: options.concurrency` y `pollingIntervalSeconds = JOB_QUEUE_POLLING_INTERVAL_SECONDS` (0,5 s). `EventConsumerRuntime.start` (`packages/platform/src/events/consumers.ts`) pasa `concurrency: def.concurrency ?? 1`. Resultado medido: ~2 eventos/s por consumidor.
- Las colas `events.<consumer>` usan `key_strict_fifo` con la clave del agregado: pg-boss no entrega un trabajo mientras otro de la misma clave esté activo, en reintento o fallido. El orden por agregado (NFR-REL-008) lo garantiza la cola, no el número de workers.
- Cada entrega corre en una transacción con contexto RLS (`INSERT` en `platform.inbox` + efecto del handler).

## Objetivos / No objetivos

**Objetivos:** ≥ 42 eventos/s sostenidos por consumidor con handler trivial (backlog de 5 000 eventos / 500 agregados drenado en ≤ 120 s); NFR-PERF-008 cumplido con el volumen de un import de 5 000 filas; orden por agregado intacto; métricas de backlog por consumidor.

**No objetivos:** cambiar de broker, varias réplicas del worker, orden entre agregados.

## Decisiones

1. **Concurrencia por defecto 4 por consumidor** (`EVENT_CONSUMER_CONCURRENCY`), override en `ConsumerDefinition.concurrency` (y `batchSize`). Los consumidores con efectos externos (email) pueden fijar 1: no hace falta, porque los consumidores de `notifications` solo insertan la notificación y encolan la entrega en la misma transacción; el envío SMTP corre en la cola aparte de despacho de email (concurrencia 2). Los consumidores de baja frecuencia (`planning.workspace-created`, `planning.settings-changed`, `planning.rollover-finalizer`, el aprovisionamiento FX por workspace y los dos de `notifications`: una vez por workspace, cambio de ajustes, cierre de mes o cruce de umbral) fijan `concurrency: 1` para no reservar conexiones del pool.
2. **Lotes de 10 trabajos por consulta** (`EVENT_CONSUMER_BATCH_SIZE`). Cada trabajo del lote se procesa y confirma (o falla) **individualmente**: un fallo no reintenta el lote completo. Alternativa a evaluar en la tarea 2.1: mantener `batchSize: 1` y subir solo `localConcurrency`; se elige la opción que cumpla el objetivo con menos complejidad, y se documenta la medición. **Resuelta el 2026-10-09 (tarea 2.1): lotes.** Con `batchSize: 1` el techo es 2 eventos/s por worker (un trabajo por polling de 0,5 s) y cumplir 42 eventos/s exigiría ~21 workers por cola; ver "Medición" más abajo. Implementación: `boss.work` con `batchSize`, `burstWhenBatchFull` (el worker vuelve a consultar de inmediato mientras el lote viene lleno) y `perJobResults` (cada trabajo se confirma o falla por separado). Un lote trae a lo sumo un trabajo por clave (`key_strict_fifo`, `DISTINCT ON` de la cabeza de cada clave), así que se procesa **en serie dentro del lote**: la concurrencia de la cola (conexiones del pool) sigue siendo `localConcurrency`, no `localConcurrency × batchSize`.
3. **Presupuesto de conexiones:** Σ concurrencia de consumidores + relay + jobs ≤ `DATABASE_POOL_MAX` del worker − margen; test de arranque que falla con un mensaje claro si la configuración lo excede. Implementación: `assertConsumerConnectionBudget` (`@pf/platform/events`) se evalúa en `createWorkerRuntime` antes de arrancar los consumidores, con 4 conexiones reservadas (lote del relay, readiness, dead-letter y jobs periódicos) como margen; si falla, el worker libera cola, pool y contexto antes de lanzar. El pool del worker deja de recortarse a 6 (`Math.min(DATABASE_POOL_MAX, 6)`) y usa `DATABASE_POOL_MAX` completo; las conexiones se abren bajo demanda. Con 9 consumidores, 3 con la concurrencia por defecto (4) y 6 de baja frecuencia fijados en 1 la suma es 3 × 4 + 6 × 1 = 18, más 4 reservadas = 22, por lo que el default de `DATABASE_POOL_MAX` pasa de 10 a 30 (8 de holgura para consumidores nuevos) (y la plantilla del host de 2 GB usa `DATABASE_POOL_MAX=14` con `EVENT_CONSUMER_CONCURRENCY=1`: 9 + 4 = 13).
4. **Costo por evento:** perfilar con el benchmark (tarea 2.3) antes de optimizar; optimizaciones sin cambio observable (cache por transacción, consultas agrupadas). Resultado en "Costo por evento" más abajo.
5. **Métricas:** `event_consumer_backlog{consumer}` (gauge, muestreo periódico de la cola) y `event_consumer_duration_seconds{consumer}` (histograma). Sin etiquetas de workspace, usuario ni agregado.

## Riesgos / Trade-offs

- Paralelismo entre agregados ⇒ los efectos sobre recursos compartidos (p. ej. el mismo presupuesto actualizado por eventos de transacciones distintas) pueden competir: los handlers ya usan control optimista/locks por fila; el TC de concurrencia lo cubre con eventos de transacciones distintas que afectan al mismo presupuesto.
- Más conexiones concurrentes ⇒ ver decisión 3.

## Medición (tarea 2.1, 2026-10-09)

Banco: `PgBossJobQueue` + `EventConsumerRuntime` reales sobre PostgreSQL 18 (Testcontainers), handler trivial, backlog encolado directo en la cola (10 versiones por agregado, una ronda por versión), polling de 0,5 s. Equipo de desarrollo (Windows 11, Docker Desktop).

| Configuración | Eventos | Tiempo | Eventos/s |
|---|---|---|---|
| Antes: `batchSize` 1, concurrencia 1 | 100 | ~62 s | ~1,6 |
| `batchSize` 1, concurrencia 4 | 1 000 | 127 s | 7,9 |
| `batchSize` 10, concurrencia 1 | 1 000 | 3,0 s | 331 |
| `batchSize` 10, concurrencia 4 (defaults) | 1 000 | 1,0 s | 978 |
| Defaults, TC-PLATFORM-EVENTS-014 (5 000 eventos, 500 agregados) | 5 000 | 6,6 s | ~760 |

Con `batchSize: 1` cada worker hace una consulta por intervalo de polling (0,5 s) y trae un trabajo: el ritmo es `2 × localConcurrency` eventos/s sin importar lo rápido que sea el handler, así que solo subir la concurrencia exige ~21 workers por cola (21 conexiones por consumidor) para llegar a 42. Los lotes con `burstWhenBatchFull` eliminan la espera entre lotes llenos: un solo worker supera 300 eventos/s con handler trivial (8 veces la meta). **Opción elegida: lotes de 10 + concurrencia 4.** La concurrencia 4 no hace falta para la meta con handler trivial, pero sí con los consumidores reales: a ~40 ms por evento un worker serial rinde ~25 eventos/s (< 42) y cuatro rinden ~100.

Los consumidores reales sobre el dataset `large` los mide el benchmark nightly (`pnpm perf:bench`, resultados `consumer-throughput-<consumidor>`, informativos).

## Costo por evento (tarea 2.5)

Perfil de `planning.budget-thresholds` (`evaluateWorkspace`, test `budgets.api.test.ts`, workspace pequeño): ~40 ms y 71 consultas por entrega, dominado por viajes de ida y vuelta a PostgreSQL (≈0,5 ms cada uno). `BudgetCalculator.view` repetía, por línea con rollover, la lectura de todos los periodos y del plan anterior y, por periodo encadenado, el calendario, las monedas y el árbol de categorías. Optimización sin cambio observable: esas lecturas se memorizan por cálculo (el `memo` de la vista; un cálculo nuevo vuelve a leer). Resultado: 56 consultas y ~33 ms por entrega (-21 % de consultas, -17 % de tiempo). El consumidor de alertas (`notifications.*`) ya lee las preferencias en una sola consulta por lote de destinatarios y no mostró consultas repetidas: sin cambios.

Pendiente fuera del alcance: el consumidor reevalúa **todo el workspace** por cada evento de gasto. En un import de 5 000 filas de un solo workspace son 5 000 evaluaciones casi idénticas. Fusionar las evaluaciones de un mismo workspace dentro de un lote exigiría que el runtime exponga al handler el instante en que se trajo el lote (una evaluación iniciada después de la publicación cubre a los eventos anteriores del mismo workspace); es una decisión de diseño aparte, para tomar con los datos del benchmark de imports (Phase 6).

## Preguntas abiertas

1. ~~¿El objetivo de 42 eventos/s alcanza para Phase 6 o el owner prefiere fijarlo según el volumen real de sus extractos?~~ **Resuelta el 2026-10-09:** el owner confirmó la meta (backlog de 5 000 eventos en 500 agregados drenado en ≤ 120 s por consumidor con handler trivial, es decir ≥ 42 eventos/s). Se revisa con el benchmark de imports de Phase 6, no antes.
