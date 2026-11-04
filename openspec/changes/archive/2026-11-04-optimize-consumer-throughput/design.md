# Diseño: optimize-consumer-throughput

## Contexto

Motivación y alcance: ver proposal.md. Fuentes: D112 (docs/33: drenado ≤ 120 s por consumidor, ≥ 42 ev/s con handler trivial), D152 (docs/35: persistencia del import ≤ 20 s diferida a Phase 6 con la escritura masiva), D249 (docs/41: plantilla del host), D291–D303 (docs/48 y docs/52), D306–D307 (docs/54), informes [docs/50](../../../docs/50-perf-under-load-findings.md) (S3, E6–E8 no corridos) y [docs/53](../../../docs/53-imports-perf-findings.md) (HI1–HI7), spec vigente `platform/event-delivery` («Rendimiento sostenido de los consumidores», TC-PLATFORM-EVENTS-014/018/019) y código de `main` (6292343).

Hechos del código que fijan el problema:

| Hecho | Dónde | Consecuencia |
|---|---|---|
| Una entrega = una transacción de BD (BEGIN, contexto RLS, `INSERT` en `platform.inbox`, efecto, COMMIT) | `packages/platform/src/events/consumers.ts` (`EventConsumerRuntime.deliver`) | El costo fijo por evento domina con handlers baratos |
| Cada transacción importada publica `TransactionCreated.v1`, `TransactionPosted.v1` y `JournalEntryPosted.v1`, cada uno en su agregado | `add-basic-csv-import` decisión 11 | 5 000 filas ⇒ 15 000 eventos |
| Suscripciones a esos tres eventos | módulos `interface` de cada contexto | `reporting.data-version` 3 por transacción (15 000); `debt.card-activity` 2 (10 000); `planning.journal-entry-posted`, `planning.budget-thresholds`, `commitments.occurrence-matcher` y `goals.balance-watch` 1 (5 000 cada uno). Total 45 000 entregas |
| Plantilla del host: `EVENT_CONSUMER_CONCURRENCY=1`, `EVENT_CONSUMER_BATCH_SIZE=10`, `DATABASE_POOL_MAX=34`, 28 consumidores + 4 reservadas = 32 | `deploy/host/etc-pfos/pfos.env.example`, D249 | Sin margen para consumidores ni concurrencia nuevos (2 conexiones de holgura ya las usan `imports.persist` y `debt.card-activity` para su unidad de trabajo propia) |
| En colas `orderedByKey` un lote trae a lo sumo un trabajo por clave (agregado) | `packages/platform/src/queue/job-queue.ts` | Un lote grande no rompe el orden por agregado |
| `planning.budget-thresholds` ya coalesce en memoria (`WorkspaceCoalescer`) entre ranuras concurrentes | `packages/contexts/planning/src/interface/planning.module.ts` | Con concurrencia 1 la coalescencia en memoria no ahorra nada: cada evento sigue siendo una transacción |
| El benchmark del import corre con la concurrencia del código (4) y pool 52 en el worker | `apps/api/test/perf/imports.perf.ts`, docs/53 §4 | Mide un worker más rápido que el del host (D307) |

Exigencia que se deriva: con concurrencia 1 y 120 s, `reporting.data-version` necesita ≥ 125 entregas/s y `debt.card-activity` ≥ 84/s con su handler real. Con la entrega por transacción, solo el costo fijo (≈ 5 viajes a la BD) ya acerca ese ritmo al límite antes de contar el efecto.

| Elemento | Capa | Cambio |
|---|---|---|
| `EventConsumerDefinition` | `@pf/platform` (events) | Campos opcionales aditivos `grouping` y `groupHandler` (decisión 2) |
| `EventConsumerRuntime` | `@pf/platform` (events) | Entrega por grupo de workspace con inbox multi-fila y respaldo evento por evento (decisión 2) |
| `EventDeliveryMetrics` | `@pf/platform` (events) | Histograma de eventos por invocación y contador de grupos reintentados (decisión 7) |
| Consumidores candidatos | `interface`/`application` de REPORTING, PLANNING, GOALS, DEBT, COMMITMENTS | `groupHandler` con efecto por conjunto (decisión 4), solo los que la medición pida |
| Harness `apps/api/test/perf/` | tests de rendimiento | Perfil de ráfaga, configuración del host, costo por evento (decisiones 1 y 6) |

## Objetivos / No objetivos

**Objetivos**

- Medir el costo por evento de cada consumidor con handler real y con la configuración del host (E6–E8, D300) antes de optimizar.
- Que cada consumidor drene la ráfaga de un import de 5 000 filas en ≤ 120 s con la configuración del host, sin conexiones nuevas.
- Dejar publicada la configuración del host en el benchmark (D307) y proponer al owner los umbrales por consumidor (D300).

**No objetivos**

- La escritura masiva del import (`add-bulk-imported-transactions`) y el pipeline (`add-import-pipeline`).
- Cambiar el contrato de los eventos (por ejemplo, un evento por lote en lugar de uno por transacción): los consumidores existentes dependen de los eventos por transacción y docs/11 los fija.
- Cambiar umbrales, la plantilla del host (D249), el runner (D302) o la fila de throughput del nightly (D300) sin decisión del owner.

## Decisiones

1. **Medir primero, con el perfil de la ráfaga del import.** Experimentos, por `workflow_dispatch` de `nightly` desde una rama no fusionada (regla de proceso de los changes 48 y 48b; se anota run id, hora y commit; al menos dos repeticiones):

   | Id | Qué mide | Cómo |
   |---|---|---|
   | E6 | Duración por evento de cada consumidor con handler real (p50/p95) | `event_consumer_duration_seconds` por consumidor durante la ráfaga |
   | E7 | Esperas por bloqueos durante el drenado | Muestreo de `pg_stat_activity` (`wait_event_type = 'Lock'`) y `pg_locks` cada segundo, por `application_name` |
   | E8 | Ritmo de un consumidor a la vez | La ráfaga con un solo consumidor activo, uno por corrida o en secuencia |
   | E9 (nuevo) | Ráfaga del import con la configuración del host | 5 000 transacciones persistidas con los consumidores detenidos (relay activo), luego arranque del worker con concurrencia 1 y pool 34; drenado por consumidor y del outbox desde el arranque |
   | E10b (nuevo) | Reintentos sin excepción (HI6 de docs/53) | Trabajos reintentados por cola con su motivo (expiración, `expireInSeconds`, o fallo del handler) |

   E9 es el peor caso del perfil de `add-bulk-imported-transactions` (los eventos llegan todos juntos) y no depende de que la escritura masiva exista: se persiste con el camino actual y los consumidores detenidos. El informe va a `docs/NN-consumer-throughput-findings.md` con la causa de cada consumidor lento (costo fijo, efecto, bloqueos) y la propuesta de umbrales (decisión 8).

2. **Entrega agrupada, opt-in por consumidor.** `EventConsumerDefinition` gana dos campos opcionales: `grouping: { maxBatch?: number }` y `groupHandler(events: EventEnvelope[], ctx)`. Para un consumidor con `grouping`:
   - El runtime pide a la cola lotes de `maxBatch` (por omisión `EVENT_CONSUMER_GROUP_BATCH_SIZE` = 100; tope 500); la cola `orderedByKey` garantiza a lo sumo un trabajo por agregado en cada lote.
   - Agrupa los eventos del lote por `workspaceId` (en orden de llegada) y por cada grupo abre **una** transacción con el contexto RLS de ese workspace: `INSERT INTO platform.inbox (consumer, event_id, workspace_id) SELECT … FROM unnest($1::uuid[], …) ON CONFLICT DO NOTHING RETURNING event_id`; si no queda ningún evento nuevo, confirma los trabajos sin invocar el efecto (duplicados); si quedan, invoca `groupHandler` una vez con los nuevos y confirma.
   - Si la transacción del grupo falla, hace rollback y entrega cada evento del grupo con el camino actual (`deliver`, una transacción por evento), de modo que solo el que falla queda en reintento con su backoff y su dead-letter. Así se conserva literalmente el scenario vigente «Un fallo dentro del lote no reintenta a los demás».
   - Los consumidores sin `grouping` no cambian (mismo lote `EVENT_CONSUMER_BATCH_SIZE`, una transacción por evento).
   - Un grupo usa la misma conexión que una entrega individual: la concurrencia del consumidor no cambia y `assertConsumerConnectionBudget` sigue igual.
   - **Alternativa descartada:** un evento por lote de import (`TransactionsImported.v1`) en lugar de tres por transacción. Cambiaría el contrato de eventos y obligaría a cada consumidor a manejar dos formas del mismo hecho.
   - **Alternativa descartada:** subir la concurrencia de los consumidores calientes. No hay conexiones (D249); sumaría 1 por unidad de concurrencia.

3. **Condición para optar por la agrupación.** Un consumidor puede agruparse solo si su efecto sobre un conjunto de eventos de agregados distintos es el mismo en cualquier orden y equivale a aplicarlos de a uno (por ejemplo, «recalcular el estado de la cuenta X» o «incrementar la versión de datos del workspace»). Cada consumidor que opta lleva un test de equivalencia: el mismo conjunto de eventos entregado de a uno y agrupado (en órdenes distintos, PBT) deja el mismo estado final.

4. **Consumidores candidatos y su efecto por conjunto.** Se convierten los que E6–E9 muestren por encima de 120 s con la configuración del host; el orden esperado es el de la tabla:

   | Consumidor | Entregas por import de 5 000 | Efecto agrupado |
   |---|---|---|
   | `reporting.data-version` | 15 000 | Una actualización de la versión del workspace por grupo |
   | `debt.card-activity` | 10 000 | Recalcular una vez cada cuenta de tarjeta distinta del grupo (las demás cuentas se descartan sin efecto); requiere verificar en E6 que su efecto no depende del orden entre agregados (si depende, queda fuera y se documenta) |
   | `planning.journal-entry-posted` | 5 000 | Asegurar el periodo una vez por fecha de asiento distinta |
   | `planning.budget-thresholds` | 5 000 | Una evaluación del workspace por grupo (reemplaza `WorkspaceCoalescer`, que queda sin uso con concurrencia 1) |
   | `goals.balance-watch` | 5 000 | Revisar una vez cada cuenta distinta del grupo |
   | `commitments.occurrence-matcher` | 5 000 | Búsqueda de candidatas por conjunto para las transacciones del grupo con la misma consulta set-based de `OccurrenceMatchCandidatesQuery`; las sugerencias conservan la idempotencia vigente por par (transacción, ocurrencia) («Hecho entregado dos veces»), así que una reentrega no duplica |

5. **Relay del outbox.** E9 mide también el tiempo hasta `outbox_pending = 0`. Si el relay (lotes de 200, `OutboxRelay`) es el que excede el plazo, el arreglo es del relay (inserción de los trabajos de un lote en una sola sentencia por cola), con su propio test; no se agregan conexiones (el relay ya tiene la suya, dentro de las 4 reservadas).

6. **Benchmark con dos configuraciones (D307, opción c).** `imports.perf.ts` mide dos veces: la configuración del código (informativa desde D311, TC-IMPORTS-CSV-029) y la del host (`EVENT_CONSUMER_CONCURRENCY=1`, `DATABASE_POOL_MAX=34` en el worker, 22 en la API), con la precondición de presupuesto de `fix-imports-perf-connection-budget` (suma 22 + 34 + 4 + 4 + 3 = 67 de 97) y el drenado por consumidor. **D311 (docs/57): la fila del host es la bloqueante y la del código queda informativa.** Además, la suite publica las filas de costo por evento (E6–E8) como informativas. Tiempo extra estimado: ≈ 3–4 min por corrida (docs/54 pregunta 2), lejos del tope de 240 min (D302).

7. **Métricas.** `event_consumer_group_size` (histograma de eventos por invocación) y `event_consumer_group_fallbacks_total` (grupos reintentados evento por evento), etiquetados solo por `consumer`. `event_consumer_duration_seconds` sigue observando por evento (la duración del grupo se reparte en partes iguales entre sus eventos, para que la serie siga siendo comparable).

8. **Umbrales por consumidor: propuesta, no decisión.** Con E6–E9 se redacta `docs/NN-consumer-throughput-questions.md` con la propuesta (por ejemplo, «cada consumidor drena la ráfaga del import en ≤ 120 s con la configuración del host» como fila bloqueante, y el throughput con el backlog del Large Seed sigue informativo). Hasta la respuesta del owner, ninguna fila nueva bloquea (D300, D306).

9. **Sin conexiones nuevas (D249).** Ninguna decisión agrega consumidores, concurrencia ni pool. El scenario «El worker de la plantilla arranca sin conexiones nuevas» lo verifica con `assertConsumerConnectionBudget` sobre la lista real de consumidores y la configuración del host.

## Contratos

- **OpenAPI:** sin cambios.
- **Eventos:** sin cambios (`contracts/events` intacto).
- **Contrato interno de `@pf/platform`** (aditivo): `EventConsumerDefinition.grouping?: { readonly maxBatch?: number }` y `EventConsumerDefinition.groupHandler?: (events: readonly EventEnvelope[], ctx: EventHandlerContext) => Promise<void>`; definir uno sin el otro falla al registrar el consumidor (`EventSubscriptions.add`). `handler` sigue siendo obligatorio: es el que usa el respaldo evento por evento.
- **Configuración nueva:** `EVENT_CONSUMER_GROUP_BATCH_SIZE` (worker, por omisión 100, rango 1–500), documentada en `docs/config-reference.md` (`pnpm config:docs:check`); la plantilla del host no necesita cambiarla.
- **`perf-results.json`** (artefacto interno del nightly): campos opcionales `imports.hostConfig` (mismo formato que `imports`) y `consumerCost[]` (`consumer`, `p50Ms`, `p95Ms`, `soloEventsPerSecond`, `lockWaitsMs`, `groupSize?`), con `gate: false`.

## Riesgos / Trade-offs

- **Efecto agrupado no equivalente:** un consumidor cuyo efecto dependa del orden entre agregados daría un estado distinto. Mitigación: opt-in explícito, test de equivalencia por consumidor (decisión 3) y, ante la duda (p. ej. `debt.card-activity`), dejarlo fuera.
- **Lotes más largos y expiración de trabajos:** un grupo de 100 retiene sus trabajos más tiempo; si superara `expireInSeconds` (300 s) pg-boss los reintentaría sin excepción (posible origen de HI6). Mitigación: E10b mide el motivo de cada reintento y `maxBatch` tiene tope 500.
- **Respaldo costoso:** un grupo que falla se reprocesa de a uno (100 transacciones). Es aceptable porque un fallo del efecto es excepcional; la métrica de respaldos lo hace visible.
- **La fila del host puede quedar roja:** es bloqueante (D311); el informe nombra al consumidor y la causa.
- **Corridas caras:** ≈ 60 min por nightly (D302). Mitigación: filtro de suites en la rama de experimentos.

## Plan de migración

Sin migraciones. Orden: (1) grupo 2 de tasks (instrumentación y perfil de ráfaga, se fusiona sin cambiar comportamiento); (2) grupo 3 (experimentos E6–E10b por `workflow_dispatch` desde la rama no fusionada `claude/optimize-consumer-throughput-experiments` e informe); (3) grupos 4–5 (entrega agrupada en `@pf/platform` y conversión de los consumidores que el informe señale, de a uno, cada uno con su test de equivalencia); (4) grupo 6 (verificación en dos nightlies). Rollback: quitar `grouping` de un consumidor lo devuelve a la entrega por evento; el inbox es el mismo, así que no hay datos que migrar.

## Dependencias entre changes

- **Requiere aplicados:** `improve-event-throughput` (lotes y concurrencia), `fix-imports-perf-connection-budget` (precondición de presupuesto y drenado por consumidor del benchmark; su archivado espera los nightlies programados de D306).
- **Antes de:** `add-bulk-imported-transactions` (su verificación del drenado ≤ 120 s con la persistencia ≤ 20 s se apoya en este change) y `add-import-pipeline`.
- **Independiente de:** `add-rule-engine` y `add-document-attachments` (no agregan consumidores según sus diseños; si alguno agregara uno, debe justificarlo contra el presupuesto de 32 de 34).

## Preguntas abiertas

> **Resueltas por el owner (docs/57):** la pregunta 1 con D311 (la fila del host bloquea el nightly; la del código queda informativa) y la pregunta 2 con D312 (umbral por consumidor: drenado de la ráfaga del import ≤ 120 s con la configuración del host; el throughput sobre el backlog del Large Seed sigue informativo).

1. **[B para archivar este change, no para empezarlo] ¿La fila del benchmark del import con la configuración del host pasa a bloqueante?** Contexto: D307 dejó el benchmark con la concurrencia del código y pidió revisarlo aquí; producción corre con concurrencia 1. Opciones: (a) la fila del host pasa a bloqueante y la del código queda informativa; (b) ambas bloqueantes; (c) la del host queda informativa y la del código sigue bloqueante (estado actual más una fila). **Recomendación: (a)** una vez que el grupo 6 la muestre verde en dos nightlies: el benchmark debe proteger lo que corre en producción, y la configuración del código es más rápida (si pasa la del host, pasa la otra). Se pregunta con la evidencia de E9 en el doc de preguntas de la decisión 8.
2. **Umbrales por consumidor de la fila de throughput con handler real (D300).** Se redacta con la medición (decisión 8); no bloquea la implementación. **Recomendación preliminar:** usar como umbral el drenado de la ráfaga del import (≤ 120 s por consumidor, configuración del host) y dejar el throughput sobre el backlog de 1,39 M del Large Seed como informativo, porque mide un estado que el producto no produce en uso real.

## Cambios a docs compartidos

- **docs/02** NFR-PERF-008: nota «con handler real, cada consumidor drena la ráfaga de un import de 5 000 filas en ≤ 120 s con la configuración del host» (solo si el owner acepta la pregunta 1).
- **docs/11** §entrega: entrega agrupada opt-in, condición de equivalencia y respaldo evento por evento.
- **docs/18**: métricas `event_consumer_group_size` y `event_consumer_group_fallbacks_total`.
- **docs/23** §5.5: filas del host y de costo por evento (informativas) en `perf-summary.md`.
- **docs/38** §3 y §4: `optimize-consumer-throughput` deja de estar «sin redactar»; conexiones de la plantilla sin cambios (28 consumidores, 32 de 34).
- **docs/config-reference.md**: `EVENT_CONSUMER_GROUP_BATCH_SIZE`.
- **docs/03** §7: orden de Phase 6 (este change primero).
- **CLAUDE.md** (quien lo mantiene): la cifra del presupuesto ya está corregida a 22 + 34; sin cambios por este change.
