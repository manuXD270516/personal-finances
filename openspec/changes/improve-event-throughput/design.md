# Diseño: improve-event-throughput

## Contexto

- `PgBossJobQueue.work` (`packages/platform/src/queue/pgboss-job-queue.ts`) llama a `boss.work` con `batchSize: 1`, `localConcurrency: options.concurrency` y `pollingIntervalSeconds = JOB_QUEUE_POLLING_INTERVAL_SECONDS` (0,5 s). `EventConsumerRuntime.start` (`packages/platform/src/events/consumers.ts`) pasa `concurrency: def.concurrency ?? 1`. Resultado medido: ~2 eventos/s por consumidor.
- Las colas `events.<consumer>` usan `key_strict_fifo` con la clave del agregado: pg-boss no entrega un trabajo mientras otro de la misma clave esté activo, en reintento o fallido. El orden por agregado (NFR-REL-008) lo garantiza la cola, no el número de workers.
- Cada entrega corre en una transacción con contexto RLS (`INSERT` en `platform.inbox` + efecto del handler).

## Objetivos / No objetivos

**Objetivos:** ≥ 42 eventos/s sostenidos por consumidor con handler trivial (backlog de 5 000 eventos / 500 agregados drenado en ≤ 120 s); NFR-PERF-008 cumplido con el volumen de un import de 5 000 filas; orden por agregado intacto; métricas de backlog por consumidor.

**No objetivos:** cambiar de broker, varias réplicas del worker, orden entre agregados.

## Decisiones

1. **Concurrencia por defecto 4 por consumidor** (`EVENT_CONSUMER_CONCURRENCY`), override en `ConsumerDefinition.concurrency`. Los consumidores con efectos externos (email) pueden fijar 1.
2. **Lotes de 10 trabajos por consulta** (`EVENT_CONSUMER_BATCH_SIZE`). Cada trabajo del lote se procesa y confirma (o falla) **individualmente**: un fallo no reintenta el lote completo. Alternativa a evaluar en la tarea 2.1: mantener `batchSize: 1` y subir solo `localConcurrency`; se elige la opción que cumpla el objetivo con menos complejidad, y se documenta la medición.
3. **Presupuesto de conexiones:** Σ concurrencia de consumidores + relay + jobs ≤ `DATABASE_POOL_MAX` del worker − margen; test de arranque que falla con un mensaje claro si la configuración lo excede.
4. **Costo por evento:** perfilar con el benchmark (tarea 2.3) antes de optimizar; optimizaciones sin cambio observable (cache por transacción, consultas agrupadas).
5. **Métricas:** `event_consumer_backlog{consumer}` (gauge, muestreo periódico de la cola) y `event_consumer_duration_seconds{consumer}` (histograma). Sin etiquetas de workspace, usuario ni agregado.

## Riesgos / Trade-offs

- Paralelismo entre agregados ⇒ los efectos sobre recursos compartidos (p. ej. el mismo presupuesto actualizado por eventos de transacciones distintas) pueden competir: los handlers ya usan control optimista/locks por fila; el TC de concurrencia lo cubre con eventos de transacciones distintas que afectan al mismo presupuesto.
- Más conexiones concurrentes ⇒ ver decisión 3.

## Preguntas abiertas

1. ¿El objetivo de 42 eventos/s alcanza para Phase 6 o el owner prefiere fijarlo según el volumen real de sus extractos? (Recomendación: mantenerlo; se revisa con el benchmark de imports.)
