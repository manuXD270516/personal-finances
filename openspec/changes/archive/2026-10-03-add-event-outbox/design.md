# Diseño

## Contexto

ADR-0008 (Aceptado; enmienda del 2026-10-02) fija el patrón: outbox transaccional en PostgreSQL, relay en el proceso `worker`, cola **pg-boss** detrás del puerto `JobQueue` (Redis/Valkey opcional), una cola por consumidor con orden por agregado (`key_strict_fifo`), encolado dentro de la transacción del relay, inbox `(consumer, event_id)` y dead-letter. SPIKE-05 lo validó (relay que cae tras publicar ⇒ 0 pérdidas y efecto único; 5 entregas ⇒ 1 efecto; rollback ⇒ sin evento; SIGTERM a mitad de job ⇒ termina limpio) y dejó hallazgos obligatorios: polling explícito de pg-boss (los defaults estancan la cola), estadísticas de pg-boss cacheadas (no sirven como verdad inmediata), `key_strict_fifo` congela el agregado con un evento en DLQ, varios relays concurrentes pueden reordenar.

Estado de partida: `@pf/platform` ya tiene el puerto `JobQueue` con adapter `PgBossJobQueue` (envelope de correlación + `traceparent` en los datos del job), la `PgUnitOfWork` (transacción + contexto RLS por `AsyncLocalStorage`), `unitOfWorkKysely()` y el patrón de purga con `SET LOCAL ROLE pf_maintenance`. `add-workspace-identity` ya invoca un `OutboxPort` en sus casos de uso, pero el composition root lo resuelve con un adapter que solo escribe en el log (su tarea 6.3). Los roles `pf_app` (api) y `pf_worker` (miembro de `pf_app`, sin contraseña) existen; el worker hoy se conecta como `pf_app`.

## Objetivos / No objetivos

**Objetivos**
- Capability `platform/event-delivery` implementada y verificada contra PostgreSQL real (Testcontainers `postgres:18` fijado por digest).
- Productores de `add-workspace-identity` conectados al outbox real (cierra su tarea 6.3 y habilita TC-IDENTITY-WORKSPACE-003).
- API de plataforma estable para los changes siguientes: escribir eventos desde un caso de uso y registrar consumidores idempotentes con una línea de composición.

**No objetivos**
- Consumidores de negocio (Audit, Reporting, Classification…), comandos admin de replay/discard, reconstrucción de proyecciones.
- Adapter BullMQ/Valkey y su *sweeper*; jobs cron; verificación de schedulers con 2 réplicas.
- Tableros y alertas de Grafana (las métricas sí se emiten; las alertas se configuran con el perfil `observability`).

## Decisiones

### 1. Capas y componentes

| Capa | Componente | Cambio |
|---|---|---|
| domain/application (contextos) | puertos propios (`OutboxPort` de IDENTITY) | sin dependencia de `@pf/platform/events`; el evento de IDENTITY suma `actor` |
| infrastructure (`@pf/platform/events`) | `EventSchemaRegistry`, `PgOutboxWriter`, `OutboxRelay`, `EventConsumerRuntime`, `purgeDeliveredEvents`, `readOutboxBacklog`, `EventDeliveryMetrics` | nuevo subpath |
| infrastructure (`@pf/platform/queue`) | puerto `JobQueue` + `PgBossJobQueue` | `ensureQueue(name, options)` con orden por clave/reintentos/DLQ y `enqueueInTransaction(queue, jobs, tx)` |
| composition root (`apps/api`) | api: `OutboxPort` de IDENTITY → `PgOutboxWriter`; worker: relay + consumidores + purga + métricas, conexión `pf_worker` | |
| BD | migraciones `20261003120000_platform_event_outbox` y `20261003150000_platform_outbox_pending_aggregate_idx` | expand |

El código de contexto nunca importa `@pf/platform/events` desde `domain`/`application` (dependency-cruiser): define su puerto y el composition root lo adapta. Un contexto puede usar `PgOutboxWriter` directamente en su `infrastructure` si lo prefiere.

### 2. Escritura en la transacción del comando (`PgOutboxWriter`)

- `append(draft)` exige una unidad de trabajo en curso (`requireSqlExecutor()`): fuera de una falla. Inserta con Kysely sobre la conexión de la UoW (`unitOfWorkKysely`), así el `INSERT` comparte transacción y contexto RLS con el cambio de estado. Si el comando se revierte, la fila desaparece con él.
- Completa el envelope v1: `correlationId` = el del contexto de correlación actual si es un UUID (si no, UUIDv7 nuevo), `causationId` y `actor` del borrador (por defecto `null` y `{type: SYSTEM, id: null}`), `occurredAt` normalizado a RFC 3339 UTC con `Z`.
- Valida el envelope completo (tras un *round-trip* JSON, para que objetos de valor como `Money` se serialicen igual que se publicarán) con `EventSchemaRegistry`: Ajv 2020-12 `strict` + `ajv-formats`, precargando **todos** los `*.schema.json` de `contracts/events` (los `$ref` relativos entre schemas se resuelven por `$id`). Se elige el schema por su `title` (`<eventType>.v<eventVersion>`). Tipo sin schema ⇒ `EventContractError` ⇒ el comando falla sin efectos.
- Guarda además el contexto de traza W3C (`propagation.inject`) en `trace_context`: el relay lo pone en los datos del job y el worker continúa la traza (docs/18 §3.3, SPIKE-10 hallazgo 5). No va en el envelope (cuyo cambio exige ADR).
- Los schemas llegan a la imagen igual que el OpenAPI: el build de `finance-api` copia `contracts/events/**` a `apps/api/contract/events/` (`scripts/copy-contract.mjs`); en el repo se lee la fuente.

### 3. Modelo de datos (`platform`, expand; migración `20261003120000_platform_event_outbox`)

| Tabla | Columnas clave | RLS / grants |
|---|---|---|
| `platform.outbox` | `id` (= eventId, PK), `sequence` (identity, único), `workspace_id`, `event_type`, `event_version`, `aggregate_type`, `aggregate_id`, `aggregate_version`, `occurred_at`, `correlation_id`, `envelope jsonb`, `trace_context jsonb`, `created_at` (`clock_timestamp()`), `published_at`, `publish_attempts`, `last_error`; único `(aggregate_id, aggregate_version, event_type, event_version)` (admite la publicación dual vN/vN+1) | RLS **forzada**. `pf_app`: solo `INSERT` con `WITH CHECK workspace_id = current_workspace_id()`. `pf_worker`: `SELECT` + `UPDATE (published_at, publish_attempts, last_error)` con política `USING (true)` (relay entre workspaces). `pf_maintenance`: `SELECT, DELETE` solo de filas publicadas |
| `platform.inbox` | PK `(consumer, event_id)`, `workspace_id`, `processed_at` | Sin datos de negocio, en la allowlist del chequeo de catálogo RLS (ya prevista). `pf_worker`: `SELECT, INSERT`; `pf_maintenance`: `SELECT, DELETE`; `pf_app` sin grants |
| `platform.dead_letter` | PK `(consumer, event_id)`, `workspace_id`, `event_type`, `envelope`, `error`, `attempts`, `first_failed_at`, `last_failed_at`, `status OPEN\|REPLAYED\|DISCARDED`, `resolved_at` | RLS forzada; política `TO pf_worker USING (true)`; `pf_worker`: `SELECT, INSERT, UPDATE`; `pf_app` sin grants |

- Índices: `outbox (sequence) WHERE published_at IS NULL` (relay y métricas), `outbox (published_at) WHERE published_at IS NOT NULL` (purga), `inbox (processed_at)`, `dead_letter (status) WHERE status = 'OPEN'`.
- `platform.outbox_notify()` + trigger `AFTER INSERT … FOR EACH STATEMENT` ⇒ `pg_notify('pf_outbox', '')` al confirmar (despertador del relay; el polling sigue como red de seguridad).
- Sin FK a `iam.workspace`: el outbox es técnico, se purga por retención y el borrado de workspace (FR-IDENTITY-012) lo tratará explícitamente; así la tabla no acopla `platform` a `iam` (docs/08 §5.18 mostraba la FK; se corrige allí).
- Como los *default privileges* del schema `platform` conceden DML a `pf_app` sobre toda tabla nueva, la migración **revoca** explícitamente lo que no corresponde.
- `pf_worker` recibe `pf_maintenance` con `INHERIT FALSE, SET TRUE` (como `pf_app`): la cadena `pf_worker → pf_app` no tiene `SET`, así que sin este grant el worker no podría asumir `pf_maintenance` para las purgas (incluida la de idempotencia, que ya corría en el worker).

### 4. El worker se conecta como `pf_worker` (`WORKER_DATABASE_URL`)

El relay necesita leer el outbox de **todos** los workspaces sin `BYPASSRLS`; docs/08/docs/12 ya asignan eso a `pf_worker`. Nueva variable `WORKER_DATABASE_URL` (secreta; obligatoria en `worker` y validada con el rol `pf_worker`; opcional en `migrate`, que alinea la contraseña del rol con el mismo mecanismo SCRAM que `pf_app`/`pf_bff`). El worker usa esa conexión para su pool y para pg-boss. `.env.example` (`PF_DEV_DB_WORKER_PASSWORD=__generate__`), Compose y el global setup de Testcontainers la definen. `pf_worker` hereda los grants de `pf_app` (incluido pg-boss), así que nada más cambia.

### 5. Relay (`OutboxRelay`)

- Un lote por transacción: `pg_try_advisory_xact_lock(<clave del relay>)` (si otra réplica lo tiene, no hace nada este ciclo ⇒ **un único relay activo**, condición de SPIKE-05 para no reordenar), `SELECT … WHERE published_at IS NULL AND NOT EXISTS (evento anterior pendiente del mismo workspace+agregado) ORDER BY sequence LIMIT n FOR UPDATE OF o SKIP LOCKED` (**solo la cabeza pendiente de cada agregado**, ver Decisiones de implementación 12), por cada fila y cada consumidor suscrito a `(eventType, eventVersion)` un job en `events.<consumer>` con `id = eventId` y `singletonKey = aggregateId`, encolado con `JobQueue.enqueueInTransaction` **sobre la misma conexión** (pg-boss `insert(..., { db })`), y `UPDATE published_at` en la misma transacción. Encolar y marcar son atómicos: una caída antes del `COMMIT` revierte ambos (sin pérdida ni duplicado del relay).
- **Deduplicación y orden en pg-boss:** con la política `key_strict_fifo` la `singletonKey` *es* la clave de orden, así que se usa `aggregateId`; la deduplicación por evento la da el `id` del job (= `eventId`, `ON CONFLICT DO NOTHING` por cola) más el inbox. Esto precisa la redacción de la tarea ("singletonKey = eventId") con lo que validó SPIKE-05.
- Sin consumidores suscritos, el evento se marca publicado sin encolar.
- Error al encolar: `ROLLBACK`, luego `publish_attempts + 1` y `last_error` (best effort, fuera de la transacción), métrica de fallos, y reintento con backoff 100 ms → 5 s. El comando que escribió el evento ya se confirmó: la indisponibilidad de la cola nunca afecta a las escrituras.
- Despertar: `LISTEN pf_outbox` en una conexión dedicada + polling (`pollIntervalMs`, 500 ms por defecto); lote lleno ⇒ siguiente lote inmediato.
- `stop()`: deja de iterar, despierta el bucle, espera el lote en curso y cierra el `LISTEN`.

### 6. Consumidores (`EventConsumerRuntime`)

- Registro declarativo: `{ consumer, events: [{ type, version }], handler, concurrency?, retryLimit? (5), retryDelaySeconds? (1), retryDelayMaxSeconds? (3600) }`. Cola `events.<consumer>` (`key_strict_fifo`, `retryBackoff`, `deadLetter = events.<consumer>.dlq`) y cola DLQ.
- Procesamiento: `PgUnitOfWork.run({ userId: null, workspaceId: envelope.workspaceId })` ⇒ contexto RLS del workspace del evento (NFR-OBS-002/aislamiento); dentro, `INSERT INTO platform.inbox … ON CONFLICT DO NOTHING RETURNING 1`: sin fila ⇒ duplicado (no-op + métrica); con fila ⇒ `handler(envelope, ctx)` en la **misma** transacción. Si el handler falla, se revierte también el inbox ⇒ el reintento puede aplicar.
- El adapter `PgBossJobQueue.work` ya restaura `correlationId` y `traceparent` desde los datos del job (logs correlacionados con la petición original).
- Dead-letter: en el último intento fallido se inserta `platform.dead_letter` (`OPEN`, error saneado, intentos) en una transacción propia y se incrementa la métrica; pg-boss además copia el job a la cola DLQ, cuyo worker hace `INSERT … ON CONFLICT DO NOTHING` (cubre la caída del proceso en el último intento). La métrica se cuenta solo cuando la fila se crea. Con `key_strict_fifo` el job fallido retiene al resto del agregado en ese consumidor (docs/11 §6: "el consumidor que exige orden pausa ese agregado") y no afecta a otros agregados.
- Tolerant reader: el consumidor no valida estrictamente el payload (docs/11 §4); solo exige un envelope con `eventId`/`workspaceId`.

### 7. Purga

`purgeDeliveredEvents(pool, { outboxRetentionDays = 7, inboxRetentionDays = 30 })`: una transacción con `SET LOCAL ROLE pf_maintenance`; borra `outbox` publicados más viejos que la retención e `inbox` vencido. Las políticas de `pf_maintenance` solo exponen filas publicadas, así que un pendiente nunca se borra aunque la consulta tuviera un error. El worker la ejecuta cada hora (idempotente entre réplicas). `dead_letter` no se purga (se resuelve a mano).

### 8. Métricas (OTel, docs/18 §5.3)

| Instrumento | Tipo | Labels | Prometheus |
|---|---|---|---|
| `pf.outbox.pending` | ObservableGauge | — | `pf_outbox_pending` |
| `pf.outbox.lag` (unidad `s`) | ObservableGauge | — | `pf_outbox_lag_seconds` |
| `pf.outbox.published` | Counter | `event_type` | `pf_outbox_published_total` |
| `pf.outbox.publish_failures` | Counter | — | `pf_outbox_publish_failures_total` |
| `pf.inbox.duplicates` | Counter | `consumer` | `pf_inbox_duplicates_total` |
| `pf.events.dead_lettered` | Counter | `consumer` | `pf_events_dead_lettered_total` |
| `pf.queue.dead_letter` | ObservableGauge | — | `pf_queue_dead_letter` (OPEN) |

Los gauges se leen de PostgreSQL en cada recolección (`readOutboxBacklog`: `count(*)` y `clock_timestamp() - min(created_at)` sobre el índice parcial), no de las estadísticas cacheadas de pg-boss (SPIKE-05 hallazgo 5). Sin `workspace_id`/agregado como label. El sufijo `.total` de la tabla de docs/18 lo agrega el exportador Prometheus; docs/18 se alinea.

### 9. Apagado ordenado

`WorkerRuntime.close()`: readiness 503 → `relay.stop()` → `queue.drain()` (pg-boss `offWork({ wait: true })`: no toma jobs nuevos y espera los activos) → cierre de timers, cola, pool y telemetría. Un job interrumpido por SIGKILL vuelve a la cola al expirar (`expireInSeconds`) y el inbox impide el doble efecto.

### 10. Eventos producidos/consumidos

- Producidos en este change: ninguno nuevo. Transporta `identity.WorkspaceCreated.v1` e `identity.WorkspaceSettingsChanged.v1` (IDENTITY) con envelope v1; `actor = {type: USER, id: <userId>}`.
- Consumidos: ninguno en producción todavía (los registran los changes de Audit, Classification, Reporting…). Idempotencia: inbox `(consumer, eventId)` + clave natural documentada en docs/11.

## Riesgos / Trade-offs

- **Un único relay activo** (advisory lock): limita el throughput a un proceso (SPIKE-05: ~1 000 ev/s, sobrado para un usuario) a cambio de orden por agregado sin coordinación extra.
- **Agregado congelado por un dead-letter** en un consumidor: buscado (no aplicar eventos fuera de orden), visible por `pf.queue.dead_letter`; el replay/discard llega con la consola de operación.
- **Validación en escritura**: un schema mal escrito hace fallar comandos. Mitigado por los tests de contrato de cada productor y la meta-validación de schemas en CI.
- **Crecimiento** de `outbox`/`inbox` y de las tablas de pg-boss: purga horaria + retención de pg-boss.
- **Credencial nueva** (`pf_worker`): un `.env` anterior necesita `pnpm setup:env`; el worker falla rápido (config) si falta.

## Plan de migración

Expand puro: tablas nuevas, políticas, trigger y grants; ningún dato existente. Rollback de la migración = `DROP` de las tablas nuevas (sin datos de negocio). Orden de despliegue: `migrate` (alinea `pf_worker`) → api → worker. Una API nueva con un worker viejo solo acumula eventos pendientes (sin pérdida) hasta que el worker nuevo arranca.

## Preguntas abiertas

1. Retención de `outbox` publicados: 7 días (docs/08) ¿suficiente como fuente de replay, o el replay se hace siempre desde tablas fuente (docs/11 §6)? Se deja configurable en código; no bloquea.
2. Consola de operación para dead-letters (`ReplayDeadLetter`/`DiscardDeadLetter`, auditados): ¿change propio o parte de `add-audit-trail`? No bloquea.

## Decisiones de implementación

1. **`singletonKey` = `aggregateId`, id del job = `eventId`.** En pg-boss la política `key_strict_fifo` usa la `singletonKey` como clave de orden, así que no puede ser a la vez `eventId`. La deduplicación por evento la dan el id del job (`insert … ON CONFLICT DO NOTHING` por cola) y el inbox; es lo mismo que validó SPIKE-05 (variante C).
2. **Relay único por advisory lock de transacción** (`pg_try_advisory_xact_lock`): si otra réplica publica, el lote se salta sin error. Sin esto, dos relays con `SKIP LOCKED` podrían encolar fuera de orden versiones consecutivas de un agregado.
3. **Rol del worker:** nueva variable `WORKER_DATABASE_URL` (obligatoria en `worker`, validada con el usuario `pf_worker`; opcional en `migrate`, que alinea la contraseña con SCRAM). El worker ya no lee `DATABASE_URL`. `pf_worker` recibe `pf_maintenance` con `SET TRUE` para seguir purgando claves de idempotencia y ahora también eventos. `.env.example` agrega `PF_DEV_DB_WORKER_PASSWORD=__generate__` (un `.env` existente la recibe con `pnpm setup:env`).
4. **Tests de BD que tocaban la contraseña de `pf_worker`:** TC-SECURITY-RLS-005 fijaba una contraseña efímera y la anulaba al final; ahora usa la credencial que `migrate` alinea (`workerDatabaseUrl` del global setup), porque la comparten los tests del outbox en la misma corrida.
5. **Puerto `JobQueue` ampliado** (no un puerto nuevo): `ensureQueue(name, options)` (orden por clave, reintentos, backoff, DLQ, expiración) y `enqueueInTransaction(queue, jobs, tx)` (pg-boss `insert` con `db` = la conexión del relay). El job sigue viajando en el `JobEnvelope` de correlación, con el `correlationId` del evento y el `traceparent` guardado en `outbox.trace_context`.
6. **Dead-letter en dos caminos:** el último intento fallido inserta `platform.dead_letter` (con el error saneado y el número de intentos) y pg-boss copia el job a `events.<consumer>.dlq`, cuyo worker hace `INSERT … ON CONFLICT DO NOTHING` (cubre la caída del proceso en el último intento). La métrica `pf.events.dead_lettered` solo cuenta cuando la fila se crea.
7. **Schemas en la imagen:** `scripts/copy-contract.mjs` copia `contracts/events/**` (sin `.md`) a `apps/api/contract/events/`; `turbo.json` agrega `contracts/events/**` a las entradas de `build` para invalidar la caché.
8. **Testcontainers por digest:** `apps/api/test/support/images.ts` fija `postgres:18.6-trixie@sha256:5a5a84b1…` (el mismo digest que Compose).
9. **Validación en escritura tras round-trip JSON** (`buildEnvelope`): `occurredAt` se normaliza a UTC con `Z` y el payload se serializa antes de validar, así lo validado es exactamente lo publicado (p. ej. `Money` de IDENTITY).
10. **Correlación:** el escritor toma el `correlationId` del contexto de logging solo si es un UUID (el envelope lo exige); si no, genera un UUIDv7.
11. **Tabla de efectos de prueba** `platform.it_event_effect` (RLS forzada por workspace) creada y borrada por el test de integración: permite verificar aislamiento (TC-PLATFORM-EVENTS-012) sin depender de tablas de negocio futuras.
12. **Corrección de orden en el relay (PR #8, CI rojo en TC-PLATFORM-EVENTS-008).** Causa: pg-boss elige la cabeza de cada clave `key_strict_fifo` por `(created_on, id)`; todos los jobs que el relay encola en una transacción comparten `created_on` (`now()`), así que dos eventos del mismo agregado publicados en el mismo lote se desempataban por `eventId`, un UUIDv7 cuyos bits bajos son aleatorios dentro del mismo milisegundo: ~50 % de inversiones cuando un comando confirma dos eventos del mismo agregado (o cuando se acumulan durante una caída de la cola y salen juntos al volver). El backoff del relay no interviene: un lote fallido se revierte entero y se reintenta por `sequence`. Arreglo: el relay solo selecciona la **cabeza pendiente por (workspace, agregado)** (`NOT EXISTS` sobre pendientes anteriores, índice parcial `outbox_pending_aggregate_idx`); los sucesores salen en lotes posteriores, con `created_on` mayor, y el bucle encadena lotes mientras publique algo. Coste: un agregado con N pendientes necesita N lotes (irrelevante a la escala de un usuario). Test determinista TC-PLATFORM-EVENTS-013 (eventIds elegidos para que el desempate invierta el orden; falla con el relay anterior). La migración (aún no mergeada) se editó en el mismo PR para agregar el índice.
13. **Dead-letter y orden (decisión):** un evento en dead-letter **congela su agregado en ese consumidor** hasta que se resuelva (el job fallido de pg-boss retiene la clave); los demás agregados y los demás consumidores siguen. Se eligió frente a "continuar tras mover a dead-letter" porque los consumidores de Phase 1 (proyecciones de saldo, actuals, auditoría) dejarían de ser correctos si aplicaran v2 sin v1; coincide con docs/11 §6 y SPIKE-05 hallazgo 7. Mitigación: el dead-letter abierto se ve en `pf.queue.dead_letter`/`pf.events.dead_lettered` (alerta de docs/18) y la resolución (`ReplayDeadLetter`/`DiscardDeadLetter`, que liberan la clave) llega con la consola de operación. A nivel relay no hay dead-letter: un fallo al encolar es de la cola completa, el evento queda pendiente (visible en `outbox_pending`/`outbox_lag_seconds`) y retiene a sus sucesores. Si un consumidor futuro tolera desorden, podrá optar por una política "continuar" explícita. Cubierto por la spec (scenario "Un evento en dead-letter congela su agregado en ese consumidor") y TC-PLATFORM-EVENTS-007.
