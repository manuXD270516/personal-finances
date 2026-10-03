# Propuesta: add-event-outbox

## Why

Los changes de Phase 1 (`add-workspace-identity`, `add-classification`, `add-ledger-core`, `add-transaction-recording`, `add-transfers`, …) emiten eventos de dominio y asumen un outbox transaccional (`platform.outbox`) con relay, inbox idempotente y dead-letter, pero ningún change lo crea: hoy `add-workspace-identity` solo registra sus eventos en el log (tarea 6.3 abierta). Sin esta pieza, un comando que confirma su cambio de estado puede perder el evento (o publicar uno de una transacción revertida) y los consumidores (Audit, Reporting, Planning, Classification) no tienen garantías de entrega, idempotencia ni orden. ADR-0008 (Aceptado, con la enmienda del 2026-10-02: pg-boss por defecto detrás del puerto `JobQueue`, Redis/Valkey opcional, orden por agregado con `key_strict_fifo`, encolado dentro de la transacción del relay, polling explícito) y SPIKE-05 (sin pérdida ante caída del relay, inbox `(consumer, event_id)`, DLQ, apagado ordenado) ya fijaron el diseño; este change lo convierte en comportamiento verificable de plataforma, separado de cualquier contexto de negocio (docs/31 D30).

## What Changes

- Escritura de eventos de dominio en la **misma transacción** que el cambio de estado del comando: si el comando se revierte, no existe el evento.
- Validación del envelope (`contracts/events/envelope.v1.schema.json`) y del schema del evento (`contracts/events/<context>/<EventName>.v<N>.schema.json`) al escribir: un evento inválido hace fallar el comando sin efectos.
- Relay en el proceso `worker` que publica cada evento pendiente **al menos una vez**, sin pérdida ante caídas, encolando en la cola por consumidor dentro de su propia transacción.
- Consumidores idempotentes por `(consumer, eventId)`: una re-entrega no repite el efecto.
- Orden garantizado **por agregado** (no entre agregados); un evento de un agregado no adelanta a uno anterior del mismo agregado.
- Reintentos con backoff exponencial (máximo 5 reintentos) y dead-letter observable que no bloquea a otros agregados.
- Purga periódica de eventos publicados y de registros de inbox vencidos.
- Métricas `outbox_pending`, `outbox_lag_seconds`, publicaciones, fallos, duplicados descartados y dead-letters (docs/18 §5.3).
- Degradación: el core sigue aceptando escrituras con la cola no disponible; el relay recupera al volver.
- Apagado ordenado del relay y de los consumidores (SIGTERM).
- Conecta los productores de `identity.WorkspaceCreated.v1` e `identity.WorkspaceSettingsChanged.v1` (tarea 6.3 de `add-workspace-identity`) al outbox real.
- **Fuera de alcance:** consumidores de negocio (los aporta cada contexto: Audit, Reporting, Classification…); comandos administrativos `ReplayDeadLetter`/`DiscardDeadLetter` y su API (llegan con la consola de operación); reconstrucción de proyecciones (`RebuildProjection`); adapter BullMQ/Valkey y su *sweeper* (opcional según ADR-0008); jobs programados (cron) y su prueba con 2 réplicas de worker; tablero/alertas de Grafana (las métricas sí se emiten); nuevos eventos de negocio o cambios a schemas existentes.

## Capabilities

### New Capabilities
- `platform/event-delivery`: escritura transaccional de eventos, validación del envelope y del schema, relay at-least-once sin pérdida, consumidores idempotentes vía inbox, orden por agregado, reintentos con backoff y dead-letter, purga de publicados, métricas de outbox, degradación con la cola no disponible y apagado ordenado.

### Modified Capabilities
- Ninguna. (La tarea 6.3 de `add-workspace-identity` se completa con este change sin modificar sus requirements: "se publica el evento de workspace creado" pasa a ser verificable contra el outbox real.)

## Impact

**Specs impactadas:** crea `platform/event-delivery` (11 requirements). Se agrega a la taxonomía de docs/ARCHITECTURE.md §14 y al plan de docs/03 §7 (antes de `add-audit-trail`); docs/31 registra la decisión D30.

**Componentes/contextos impactados:** `@pf/platform` (nuevo subpath `@pf/platform/events`: escritor del outbox sobre la Unit of Work, registro de schemas, relay, consumidor con inbox, dead-letter, purga y métricas; el puerto `JobQueue` gana encolado transaccional y colas ordenadas por clave); `apps/api` (composition root: el `worker` arranca relay/consumidores/purga y se conecta como `pf_worker`; la API conecta el `OutboxPort` de IDENTITY al outbox real; el build copia `contracts/events` a la imagen); contexto IDENTITY (el evento lleva `actor`); `migrate` (alinea la contraseña de `pf_worker`); Compose y `.env.example` (`WORKER_DATABASE_URL`).

**APIs impactadas:** ninguna en `contracts/openapi`. Configuración: nueva variable `WORKER_DATABASE_URL` (rol `pf_worker`, obligatoria en `worker`, opcional en `migrate`).

**Tablas impactadas:** `platform.outbox`, `platform.inbox`, `platform.dead_letter` (nuevas); función `platform.outbox_notify()` y su trigger; grants de `pf_worker` y `pf_maintenance`.

**Eventos impactados:** ninguno nuevo ni modificado. Se transportan los existentes con el envelope v1 (`contracts/events/envelope.v1.schema.json`); los primeros productores reales son `identity.WorkspaceCreated.v1` e `identity.WorkspaceSettingsChanged.v1`.

**Migraciones requeridas:** expand únicamente (tablas nuevas, índices, políticas RLS, trigger, grants). No destructiva. Sin datos previos que migrar.

**Test cases:** AÑADIDOS — TC-PLATFORM-EVENTS-001, TC-PLATFORM-EVENTS-002, TC-PLATFORM-EVENTS-003, TC-PLATFORM-EVENTS-004, TC-PLATFORM-EVENTS-005, TC-PLATFORM-EVENTS-006, TC-PLATFORM-EVENTS-007, TC-PLATFORM-EVENTS-008, TC-PLATFORM-EVENTS-009, TC-PLATFORM-EVENTS-010, TC-PLATFORM-EVENTS-011, TC-PLATFORM-EVENTS-012. MODIFICADOS — TC-IDENTITY-WORKSPACE-003 (verifica `identity.WorkspaceSettingsChanged.v1` en el outbox real). DEPRECADOS — ninguno.

**Invariantes afectadas:** INV-028 (consumidores idempotentes: reprocesar un evento no cambia el resultado). El change no toca dinero, ledger, FX, periodos ni redondeo.

**Impacto de regresión:** los comandos de IDENTITY pasan a escribir una fila de outbox dentro de su transacción (un evento inválido ahora hace fallar el comando en vez de solo registrarse en el log). El `worker` exige `WORKER_DATABASE_URL` (rol `pf_worker`): un `.env` previo necesita `pnpm setup:env` para recibir la contraseña nueva. Los tests de aislamiento RLS incorporan las tablas nuevas (chequeo de catálogo).

**Riesgos introducidos:** relay atascado ⇒ eventos sin publicar (mitigado con `outbox_lag_seconds`/`outbox_pending` y alerta de docs/18); un evento en dead-letter congela su agregado en ese consumidor hasta resolverlo (comportamiento buscado, docs/11 §6; visible por métrica); crecimiento de tablas (purga por retención); varias réplicas del relay pueden competir (filas bloqueadas con `SKIP LOCKED`; el orden por agregado lo da la cola). RISK-009 (pérdida de datos) se reduce.
