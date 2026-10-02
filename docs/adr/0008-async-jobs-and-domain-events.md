# ADR-0008: Jobs asíncronos y eventos de dominio — Transactional Outbox + BullMQ (Redis/Valkey) + inbox idempotente

- Estado: Aceptado (2026-10-02, tras SPIKE-05, con enmienda; decisión del owner)
- Fecha: 2026-10-01
- Decisores: Owner (Product/Tech Lead)
- Relacionado: docs/ARCHITECTURE.md §2, §7, §10; contracts/events/; ADR-0002, ADR-0003, ADR-0005, ADR-0007, ADR-0011, ADR-0020; SPIKE-05

## Contexto y problema

En el modular monolith (ADR-0002), muchas reacciones a cambios de dominio son eventuales: proyecciones de Reporting, alertas de presupuesto (Notifications), Rules sobre transacciones importadas, generación de ocurrencias de Commitments, recálculo de snapshots, imports de archivos, envío de emails. Además hay **jobs programados** (generar recurrencias diarias, cierre de mes sugerido, fetch de tasas FX en Phase 5, limpieza de idempotency keys).

Problemas a resolver:
- **Dual write**: si el comando hace `COMMIT` en PG y luego publica en una cola, un crash entre ambos pierde el evento (o publica eventos de transacciones que hicieron rollback).
- Entrega **at-least-once** con consumidores **idempotentes**.
- Orden por agregado.
- Reintentos con backoff, DLQ, visibilidad operativa.
- Jobs cron/repetibles.
- Graceful shutdown del worker en despliegues.

## Drivers de decisión

- Atomicidad estado + evento (sin dual write).
- Simplicidad operativa y costo para 1 persona.
- Reintentos, backoff, delays, cron, DLQ, UI de inspección.
- Ecosistema Node/TypeScript y NestJS.
- Portabilidad local ↔ cloud (ADR-0013).
- Camino a broker real si se extraen servicios (ADR-0003).

## Opciones consideradas

1. **Transactional Outbox en PG + relay → BullMQ (Redis/Valkey)** para handlers async y jobs programados; inbox en PG para idempotencia (elegida).
2. **pg-boss** (cola sobre PostgreSQL) con outbox en la misma BD.
3. **RabbitMQ** (o Amazon SQS/SNS) como broker + outbox.
4. **Solo in-process** (EventEmitter de Nest / handlers síncronos post-commit).

## Decisión

Opción 1:

- Cada comando escribe sus eventos de dominio en `platform.outbox` **en la misma transacción** que el cambio de estado (vía Unit of Work, ADR-0007).
- Envelope estándar (ARCHITECTURE §7): `eventId (UUIDv7), eventType (<context>.<EventName>.v<N>), eventVersion, occurredAt, workspaceId, aggregateType, aggregateId, aggregateVersion, correlationId, causationId, actor, payload`. Esquemas JSON en `contracts/events/<context>/<EventName>.v<N>.schema.json`.
- **Relay** en el proceso `worker`: lee filas no publicadas con `SELECT … FOR UPDATE SKIP LOCKED` en lotes (polling corto + `LISTEN/NOTIFY` como señal de despertar), las encola —**dentro de la misma transacción del relay**— en **pg-boss** (una cola por consumidor; `singletonKey = eventId`) y marca `published_at`; el orden por agregado usa la política `key_strict_fifo` con `aggregateId` como clave. La cola se usa a través del puerto `JobQueue` de `@pf/platform`; BullMQ/Valkey queda como adapter alternativo.
- **Consumidores** en el `worker` registran `(consumer, event_id)` en `platform.inbox` dentro de su transacción → procesamiento **idempotente** con at-least-once.
- **Orden**: garantizado solo por agregado (relay ordena por `(aggregate_id, aggregate_version)`; consumidores sensibles al orden verifican `aggregateVersion`).
- Reintentos con backoff exponencial; tras N intentos → estado failed (DLQ lógica) + alerta/metric.
- **Jobs programados** con el scheduler de pg-boss (cron), definidos en código y registrados idempotentemente al arrancar el worker. Pendiente de verificar con 2 réplicas de worker que no se duplican (no cubierto por SPIKE-05).
- **Sin Redis/Valkey obligatorio.** pg-boss vive en PostgreSQL (schema propio). Configuración explícita de polling de pg-boss (los defaults estancan la cola — SPIKE-05). Si en el futuro se activa el adapter BullMQ/Valkey, es obligatorio AOF + un *sweeper* que republique, porque SPIKE-05 midió que una pérdida de datos en Valkey pierde jobs ya marcados como publicados.
- Graceful shutdown: SIGTERM → dejar de tomar jobs, terminar en curso (timeout), cerrar conexiones.
- Purga de outbox/inbox publicados > N días por job de mantenimiento.

## Análisis de opciones

### 1. Outbox + BullMQ (Redis/Valkey) (elegida)
- **Pros:** sin dual write; BullMQ es maduro en Node (retries, backoff, delays, rate limit, priorities, flows, job schedulers, eventos, métricas); UI disponible (Bull Board / Taskforce); integración `@nestjs/bullmq`; throughput sobrado; Redis/Valkey también útil para rate limiting e idempotency cache.
- **Contras:** una dependencia stateful más (Redis/Valkey) local y en cloud; dos lugares donde vive estado de mensajería (outbox en PG, jobs en Redis); el relay es código propio que hay que testear bien.
- **Costo:** local gratis; cloud ElastiCache/Memorystore mínimo ~USD 12–15/mes o Valkey en contenedor (sin HA) / serverless (detalle en docs/21).
- **Complejidad operativa:** media.

### 2. pg-boss
- **Pros:** **cero infraestructura adicional** (solo PG); outbox y cola pueden incluso compartir transacción (encolar dentro del mismo `COMMIT` elimina el relay); cron, retries, DLQ, throttling; activamente mantenido.
- **Contras:** carga de polling y bloat/vacuum en PG; menor ecosistema de UI/observabilidad que BullMQ; throughput menor (irrelevante a nuestra escala); integración Nest comunitaria.
- **Costo:** nulo adicional. **Complejidad operativa:** baja.

### 3. RabbitMQ / SQS+SNS
- **Pros:** brokers "de verdad": fan-out, routing, DLQ nativas; SQS sin servidor y barato; camino natural a microservicios.
- **Contras:** RabbitMQ = otro servicio stateful a operar (o Amazon MQ, caro); SQS no existe localmente (LocalStack/ElasticMQ como emulación → paridad imperfecta) y acopla a AWS; cron requiere EventBridge Scheduler; sigue necesitando outbox.
- **Costo:** RabbitMQ gestionado alto; SQS casi gratis. **Complejidad operativa:** media-alta.

### 4. Solo in-process
- **Pros:** trivial; sin infraestructura.
- **Contras:** pierde eventos ante crash; sin reintentos persistentes; handlers lentos degradan latencia HTTP; sin jobs programados robustos; imposible separar api/worker.
- **Costo:** nulo. **Complejidad:** baja, **riesgo de integridad:** alto (Audit y proyecciones inconsistentes).

## Consecuencias

**Positivas**
- Atomicidad estado+evento garantizada; consumidores idempotentes por diseño.
- Separación api/worker: HTTP no sufre por trabajos pesados (imports, recálculos).
- Eventos versionados con contratos → base para extraer servicios.

**Negativas**
- Redis/Valkey como dependencia en todos los entornos.
- Consistencia eventual visible (dashboard puede ir segundos detrás).

**Riesgos**
- Relay atascado → eventos sin publicar. *Mitigación:* métrica `outbox_lag_seconds` y `outbox_pending_count` con alerta (ADR-0020).
- Handlers no idempotentes. *Mitigación:* inbox obligatorio vía base class en `@pf/platform`; tests de re-entrega duplicada.
- Cambio de schema de evento rompe consumidores. *Mitigación:* versionado `vN`, JSON Schema + test de compatibilidad en CI.

## Validación

- **SPIKE-05 (1.5 d):** (a) kill -9 del worker entre lectura y marca → evento se re-entrega y el inbox evita doble efecto; (b) rollback de transacción → ningún evento publicado; (c) SIGTERM durante job → termina o reintenta limpio; (d) job scheduler no se duplica con 2 réplicas de worker; (e) **comparar con BullMQ v6 backend PostgreSQL y con pg-boss** (ver Notas).
- Tests de integración con Testcontainers (PG + Valkey).
- Métricas en producción: `outbox_lag_seconds` p99 < 5 s; 0 eventos en DLQ sin tratar > 24 h.

## Notas

- Verificado 2026-10-01 (bullmq.io): **BullMQ v6 incluye un backend PostgreSQL** (MIT; anunciado 2026-09-27, versión 6.3.x; ~mitad del throughput de Redis, PG 13+), y adapters para ioredis, node-redis, Bun y **Valkey GLIDE**. Esto abre una variante "outbox + BullMQ-on-PostgreSQL" que eliminaría Redis/Valkey de la topología conservando la API BullMQ.
- Verificado 2026-10-01: pg-boss activamente mantenido (12.35.x, septiembre 2026).
- Verificado 2026-10-01: Redis 8 es tri-licencia (RSALv2/SSPLv1/AGPLv3); Valkey (BSD-3, Linux Foundation) es el default en varias distros y servicios gestionados → preferimos Valkey.
- **Disenso (registrado sin cambiar la decisión):** para un usuario y cargas mínimas, una única dependencia stateful (PG) tiene menor costo y operación. Recomiendo que SPIKE-05 evalúe explícitamente BullMQ-on-PostgreSQL y pg-boss y, si cumplen (a)–(d), abrir un ADR que reemplace "Redis/Valkey obligatorio" por "Redis/Valkey opcional".

## Resultado del spike (SPIKE-05, 2026-10-01)

Informe completo: [spikes/SPIKE-05-outbox-queue/README.md](../../spikes/SPIKE-05-outbox-queue/README.md). Se implementó outbox + relay (`FOR UPDATE SKIP LOCKED` + `LISTEN/NOTIFY`) + inbox + DLQ con validación ajv del envelope, sobre (A) BullMQ 6.3 + Valkey 9, (B) BullMQ 6.3 con backend PostgreSQL (existe y funciona: `createPostgresBackend`, PG ≥ 13) y (C) pg-boss 12.35.

- **Validación (a)–(c) cumplida por las tres**: crash del relay tras publicar ⇒ 0 eventos perdidos y efecto exactamente una vez; 5 entregas duplicadas ⇒ 1 efecto; rollback del comando ⇒ sin evento; SIGTERM real (contenedor Linux) a mitad de job ⇒ job termina y commitea, exit 0; SIGKILL ⇒ rollback y re-entrega única (A 8,9 s, B 9,2 s, C 49,5 s). (d) schedulers con 2 réplicas no se probó.
- **Throughput (10k eventos)**: consumo A 1 022 ev/s, B 634 ev/s, C 1 000 ev/s; lag del outbox bajo carga p99 A 74 ms, B 218 ms, C 321 ms. Muy por encima de la carga de un usuario.
- **Orden por agregado**: sólo pg-boss lo da nativo (`key_strict_fifo`); con BullMQ OSS hay que detectar huecos de `aggregateVersion` y reintentar (0 inversiones medidas, pero 7× más lento en A). Requiere además un único relay activo.
- **Valkey caído**: la API sigue aceptando escrituras (outbox en PG) y el relay recupera al volver. **Corrección a la Decisión**: si Valkey pierde datos, el relay *no* republica lo ya marcado `published_at` (medido: 50/50 jobs perdidos); se necesita un *sweeper* (publicado sin fila en inbox tras N min ⇒ republicar) y/o AOF.
- **Windows**: `kill('SIGTERM')` no ejecuta handlers (TerminateProcess); el shutdown sólo se puede probar en contenedor.
- **Recomendación del spike** (no cambia el Estado): adoptar outbox + inbox como está, pero **Redis/Valkey opcional**: puerto de cola en `@pf/platform` con **pg-boss** como adaptador por defecto para el perfil de un usuario (orden nativo, publicación atómica con el outbox, sin infraestructura extra) y BullMQ/Valkey como adaptador opcional; BullMQ-on-PostgreSQL como alternativa a re-evaluar cuando madure. Esto confirma el disenso registrado en Notas y sugiere un ADR que lo formalice.

## Enmienda de aceptación (2026-10-02)

El owner aceptó la recomendación de SPIKE-05: **pg-boss sobre PostgreSQL** como cola por defecto detrás del puerto `JobQueue`; Redis/Valkey pasa a ser opcional. Motivos: orden por agregado nativo, encolado transaccional desde el relay (sin duplicados por el relay), una dependencia stateful menos. Costo aceptado: menor throughput (≈1 000 vs 1 022 ev/s) y mayor lag p99 (321 vs 74 ms), irrelevantes para el volumen de un usuario. Variable `JOB_QUEUE_DRIVER=pgboss|bullmq`.
