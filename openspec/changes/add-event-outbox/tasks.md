# Tareas

> Requiere `add-api-conventions` (Unit of Work, patrón `pf_maintenance`) y `add-workspace-identity` (roles `pf_worker`, productores de IDENTITY). Flujo por slice: SPEC → TEST CASE → DOMAIN → APPLICATION → INFRASTRUCTURE → API → UI → AUTOMATED TESTS → E2E → DOCUMENTATION. Este change es de plataforma: no tiene dominio financiero ni UI.

## 1. Spec, documentación de arquitectura y test cases

- [x] 1.1 Redactar `platform/event-delivery` (11 requirements Must) y validar con `openspec validate add-event-outbox --strict` y `openspec show add-event-outbox --json`
- [x] 1.2 Agregar `platform/event-delivery` a docs/ARCHITECTURE.md §14, el change a docs/03 §7 (antes de `add-audit-trail`) y la decisión D30 a docs/31
- [x] 1.3 Escribir TC-PLATFORM-EVENTS-001..013 (`requirement_status: confirmed`) y actualizar TC-IDENTITY-WORKSPACE-003; verificar con `pnpm traceability:check` que ningún requirement Must queda sin TC

## 2. Base de datos

- [x] 2.1 Migración expand `platform.outbox`, `platform.inbox`, `platform.dead_letter`, índices, trigger `outbox_notify`, políticas RLS y grants (`pf_app` solo INSERT en outbox; `pf_worker` relay/inbox/dead-letter; `pf_maintenance` purga; `pf_maintenance` asumible por `pf_worker`); verificar con el chequeo de catálogo RLS (TC-SECURITY-RLS-004) y con tests de grants por rol
- [x] 2.2 Variable `WORKER_DATABASE_URL` (rol `pf_worker`) en el contrato de configuración, `migrate` alinea su contraseña, `.env.example`, Compose y global setup de Testcontainers; regenerar `docs/config-reference.md`; verificar con tests de `loadConfig` y `pnpm config:docs:check`

## 3. Plataforma (`@pf/platform`)

- [x] 3.1 Escribir primero (TDD) los tests unitarios del registro de schemas y del escritor (envelope completo, correlación, payload fuera de contrato, tipo sin schema) — TC-PLATFORM-EVENTS-003
- [x] 3.2 Implementar `EventSchemaRegistry` (Ajv 2020 strict, precarga de `contracts/events`) y `PgOutboxWriter` (Kysely sobre la `PgUnitOfWork`, `trace_context`)
- [x] 3.3 Extender el puerto `JobQueue` y `PgBossJobQueue`: `ensureQueue(name, options)` (orden por clave, reintentos con backoff, dead-letter) y `enqueueInTransaction(queue, jobs, tx)`
- [x] 3.4 Implementar `OutboxRelay` (advisory lock de relay único, `FOR UPDATE SKIP LOCKED`, encolado en la transacción del relay, `LISTEN/NOTIFY` + polling, backoff ante fallos, `stop()` ordenado)
- [x] 3.5 Implementar `EventConsumerRuntime` (cola por consumidor `key_strict_fifo`, inbox en la transacción del efecto con contexto RLS del workspace, duplicados, dead-letter en el último intento y desde la cola DLQ)
- [x] 3.6 Implementar `purgeDeliveredEvents`, `readOutboxBacklog` y `EventDeliveryMetrics` (OTel); verificar con tests unitarios con un `Meter` falso (TC-PLATFORM-EVENTS-010)

## 4. Composition root (`apps/api`)

- [x] 4.1 Worker: conexión `pf_worker`, relay + consumidores registrados + purga horaria + métricas; apagado ordenado (relay → drain → cierre)
- [x] 4.2 API: `OutboxPort` de IDENTITY → `PgOutboxWriter` con el registro de schemas (repo o copia en la imagen); el build copia `contracts/events` a `apps/api/contract/events`
- [x] 4.3 IDENTITY: el evento lleva `actor` (usuario que originó el cambio); actualizar fakes y tests; cerrar la tarea 6.3 de `add-workspace-identity` si queda verificada

## 5. Tests automatizados (integración, Testcontainers `postgres:18` por digest)

- [x] 5.1 TC-PLATFORM-EVENTS-001/002: commit ⇒ evento pendiente con envelope completo; rollback ⇒ ningún evento ni entrega
- [x] 5.2 TC-PLATFORM-EVENTS-004: el relay cae tras encolar y antes de marcar ⇒ sin pérdida y efecto único tras reiniciar
- [x] 5.3 TC-PLATFORM-EVENTS-005: 5 entregas del mismo evento ⇒ 1 efecto y 4 duplicados; efecto fallido no marca el inbox
- [x] 5.4 TC-PLATFORM-EVENTS-006: orden por agregado con eventos intercalados y concurrencia; retención detrás de un evento en reintento
- [x] 5.5 TC-PLATFORM-EVENTS-007: dead-letter tras agotar reintentos sin bloquear otros agregados
- [x] 5.6 TC-PLATFORM-EVENTS-008: cola caída ⇒ el comando se confirma y el evento se publica al volver
- [x] 5.9 Corrección (CI del PR #8): el relay publica solo la cabeza pendiente por agregado; TC-PLATFORM-EVENTS-013 determinista y TC-PLATFORM-EVENTS-007 verifica que un dead-letter congela su agregado; `event-delivery.int.test.ts` 20 corridas seguidas en verde (design, Decisiones de implementación 12–13)
- [x] 5.7 TC-PLATFORM-EVENTS-009/010/011/012: purga, métricas, apagado ordenado, contexto RLS y correlación en el consumidor
- [x] 5.8 TC-IDENTITY-WORKSPACE-003 y productores de IDENTITY: `identity.WorkspaceSettingsChanged.v1`/`WorkspaceCreated.v1` en el outbox real vía API

## 6. Documentación y cierre

- [x] 6.1 Actualizar docs/08 §5.18 (as-built de outbox/inbox/dead-letter), docs/11 §2/§6 (pg-boss, cola por consumidor), docs/18 §5.3 (nombres de métricas), docs/19 (`WORKER_DATABASE_URL`) y README de `@pf/platform`
- [x] 6.2 Marcar los TC automatizados, regenerar la matriz de trazabilidad y ejecutar `pnpm format:check`, `pnpm turbo run typecheck lint test build`, `pnpm test:integration`, `pnpm arch:check`, `pnpm traceability:check`, `pnpm spec:validate`, `pnpm config:docs:check`
