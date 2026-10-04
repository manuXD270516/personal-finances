# Diseño

## Contexto

Bounded context **AUDIT** (`audit`, paquete `@pf/audit`, Generic, Phase 1 — ARCHITECTURE §3). Fuentes: ARCHITECTURE §7 (audit en la misma transacción), §9 (RLS, sin hard delete); docs/04 §3.17 (AR `AuditLog`, `AuditPort`); docs/08 §5.16 (tabla `audit.audit_log`, WS-RO, particionada) y §6 (grants); docs/12 §13 (redacción, HMAC de IP, eventos de seguridad); docs/10 §13–14 (`GET W/audit-log`, lectura OWNER/EDITOR); docs/09 INV-029; docs/02 NFR-DATA-007, NFR-SEC-003/015, NFR-OBS-007. ADRs: ADR-0002/0003 (hexagonal, módulos), ADR-0005/0007 (PostgreSQL, Kysely + dbmate), ADR-0010 (auth), ADR-0023 (RLS), ADR-0022 (API).

Relación de contexto (docs/06 #18): AUDIT es **Customer/Supplier síncrono en la misma transacción** de todos los contextos que mutan. No hay eventos involucrados.

## Objetivos / No objetivos

**Objetivos:**
- Puerto `AuditPort.append(record)` en `@pf/audit/contracts`, invocable solo dentro de la unidad de trabajo activa (`UnitOfWork` de `@pf/platform`).
- Modelo de registro completo (FR-AUDIT-002) con política de redacción por allow-list.
- Persistencia append-only, particionada, con RLS fail-closed.
- Queries `GetHistory(aggregateType, aggregateId)` y `SearchAuditLog({from, to, aggregateType?})` expuestas por `GET /audit-log`.
- Auditoría de login/logout.
- Test de arquitectura que garantiza que todo command handler mutante audita.

**No objetivos:**
- Filtros por actor/acción y export CSV (Phase 2), retención configurable y hash chain (Phase 9), auditoría de lectura de documentos (Phase 6).
- Consumir eventos de dominio para auditar (ARCHITECTURE §7 lista "Audit" entre consumidores asíncronos, pero para mutaciones financieras rige el camino síncrono; en Phase 1 **todo** se audita síncronamente).

## Decisiones

1. **Capas.**
   - *domain* (`@pf/audit/domain`): `AuditRecord` (inmutable, sin setters), VO `AuditActor` (`USER{userId}` | `SYSTEM{process}` | `WORKER{process}`), VO `AuditOrigin` (`ui|api|import|rule|recurring|system`), VO `ChangeSet` (lista `{field, before, after}`), `RedactionPolicy` (allow-list de campos por `aggregateType`; campos desconocidos se omiten, nunca se copian), `AuditAction` (`<context>.<aggregate>.<verbo-pasado>`, p. ej. `accounts.account.archived`, `transactions.transaction.voided`).
   - *application*: `AuditRecorder` (implementa `AuditPort`; completa `workspaceId`, `actor`, `correlationId`, `requestId`, `origin`, `occurredAt` desde `RequestContext` + `Clock`), queries `GetAuditHistory` y `SearchAuditLog`.
   - *infrastructure*: `KyselyAuditLogRepository` que usa **la misma transacción** que expone la `UnitOfWork` (nunca abre conexión propia); `HmacIpHasher` (clave rotativa desde secrets, docs/12).
   - *interface*: `AuditLogController` (`GET /audit-log`), guard `x-required-role: EDITOR`; interceptor de sesión en `apps/api` que registra `identity.session.started` en el primer request autenticado de cada sesión del BFF y `identity.session.ended` al logout (el BFF llama a un endpoint interno de logout ya previsto en add-workspace-identity).
2. **Serialización de montos en el diff:** todo `Money` se guarda como `{"amount": "120.00", "currency": "BOB"}` (string a la escala de la moneda, INV-001/INV-003); prohibido `number` en `changes` (validador JSON Schema en el adapter).
3. **Atomicidad (INV-029):** `AuditPort.append` lanza si no hay transacción activa (`AUDIT_OUTSIDE_UNIT_OF_WORK`, error interno, no de contrato). Un fallo del INSERT propaga y la `UnitOfWork` hace rollback de agregado + ledger + outbox. Los comandos rechazados por validación nunca llegan a `append` porque el registro se agrega al final del handler, antes del commit.
4. **Atribución de procesos:** los procesos del worker (relay, jobs, reglas, recurrentes, imports) ejecutan con `RequestContext.actor = SYSTEM|WORKER{process: '<nombre-del-job>'}` y heredan `correlationId`/`causationId` del evento o job que los originó (envelope ARCHITECTURE §7).
5. **Datos (`audit.audit_log`)**, según docs/08 §5.16 con dos columnas adicionales requeridas por FR-AUDIT-002:
   - Columnas: `id uuid`, `occurred_at timestamptz` (PK compuesta `(occurred_at, id)`), `workspace_id uuid NOT NULL`, `actor_type text CHECK IN ('USER','SYSTEM','WORKER')`, `actor_user_id uuid`, **`actor_process text`** (nuevo), `action text`, `aggregate_type text`, `aggregate_id uuid`, `aggregate_version int`, `changes jsonb`, `reason text`, **`origin text CHECK IN ('ui','api','import','rule','recurring','system')`** (nuevo), `correlation_id uuid`, `request_id uuid`, `idempotency_key text`, `client_ip_hash bytea`, `user_agent text`, `prev_hash bytea`, `row_hash bytea` (estas dos quedan NULL hasta FR-AUDIT-008).
   - Checks: `actor_type='USER' ⇒ actor_user_id IS NOT NULL`; `actor_type<>'USER' ⇒ actor_process IS NOT NULL`.
   - Índices: `(workspace_id, aggregate_type, aggregate_id, occurred_at)`, `(workspace_id, occurred_at DESC)`, `(workspace_id, actor_user_id, occurred_at DESC)`.
   - `PARTITION BY RANGE (occurred_at)` mensual; job del worker `audit.ensure-partitions` crea con 2 meses de anticipación; partición `DEFAULT` como red de seguridad con alerta si recibe filas.
   - **RLS WS-RO**: `ENABLE` + `FORCE ROW LEVEL SECURITY`, política `ws_isolation` con `platform.current_workspace_id()` (fail-closed); grants `SELECT, INSERT` a `pf_app` y `pf_worker`; trigger `platform.forbid_mutation()` `BEFORE UPDATE OR DELETE OR TRUNCATE` (TRUNCATE con trigger a nivel sentencia).
6. **Login/logout y workspace:** `audit_log.workspace_id` es `NOT NULL`; los eventos de sesión se registran en el **workspace activo** de la sesión (el BFF siempre resuelve uno vía `/me`). Si el usuario no tiene workspace aún, el evento se omite y se registra solo en logs técnicos sin PII (ver Preguntas abiertas).
7. **Consultas:** `GET /audit-log` con `aggregateType`+`aggregateId` ⇒ orden por defecto `occurredAt` ascendente (historial cronológico); sin entidad ⇒ `-occurredAt`. `from`/`to` son fechas de negocio interpretadas en la zona del workspace y convertidas a `[from 00:00, to+1 00:00)` locales en UTC. Una entidad inexistente o de otro workspace devuelve **lista vacía** (RLS), indistinguible de "sin historial" — cumple el aislamiento sin que Audit conozca los agregados de otros contextos. La respuesta nunca incluye `client_ip_hash` ni `idempotency_key`.
8. **Test de arquitectura (NFR-DATA-007):** regla que exige que cada clase `*CommandHandler` en `packages/contexts/*/src/application` que dependa de un repositorio con escritura dependa también de `AuditPort`; complementada por un test de integración genérico con un `AuditPort` que falla a demanda (TC-AUDIT-ATOMIC-001).
9. **Rendimiento:** un INSERT por comando, sin lecturas previas; dentro del presupuesto NFR-PERF-003.

## Contratos

Cambios **exactos** requeridos (no se editan aquí; los consolida el proceso de contratos):

**`contracts/openapi/finance-api.v1.yaml`:**
- Tag `Audit`: descripción → `"Phase 1: read-only audit log (history by entity and by date range)."`
- Nuevo path `/workspaces/{workspaceId}/audit-log`:
  - `get`, `operationId: listAuditLog`, `tags: [Audit]`, `x-openspec-capability: audit/audit-trail`, `x-required-role: EDITOR`.
  - Parámetros: `WorkspaceId`, `Limit`, `Cursor`, `aggregateType` (query, string, `^[A-Za-z]+$`), `aggregateId` (query, `Uuid`; requiere `aggregateType`), `from` (query, `LocalDate`), `to` (query, `LocalDate`), `sort` (query, enum `[occurredAt, -occurredAt]`; default dependiente de la presencia de `aggregateId`, documentado en la descripción).
  - Respuestas: `200` → `AuditLogPage`; `400` (`VALIDATION_FAILED`, `INVALID_CURSOR`, `INVALID_FILTER` — p. ej. `aggregateId` sin `aggregateType` o `from > to`); `401`; `403` (`WORKSPACE_ACCESS_DENIED`, `INSUFFICIENT_ROLE`); `429`.
- Nuevos schemas:
  - `AuditActorType`: enum `[USER, SYSTEM, WORKER]`.
  - `AuditOrigin`: enum `[ui, api, import, rule, recurring, system]`.
  - `AuditActor`: `{type: AuditActorType, userId: Uuid|null, process: string|null}` (required `type`).
  - `AuditChange`: `{field: string, before: <any JSON>|null, after: <any JSON>|null}`; descripción: los montos aparecen como `Money` (string decimal + moneda), nunca como número.
  - `AuditLogEntry`: required `[id, occurredAt, actor, action, aggregateType, aggregateId, changes, correlationId, origin]`; propiedades `id: Uuid`, `occurredAt: Instant`, `actor: AuditActor`, `action: string`, `aggregateType: string`, `aggregateId: Uuid`, `aggregateVersion: integer|null`, `changes: AuditChange[]`, `reason: string|null`, `correlationId: Uuid`, `origin: AuditOrigin`, `userAgent: string|null`.
  - `AuditLogPage`: `{data: AuditLogEntry[], page: PageInfo}`.
- `ErrorCode`: sin códigos nuevos.

**`contracts/events/`:** sin cambios (Audit no produce ni consume eventos en Phase 1).

> Consolidado en contracts/ el 2026-10-02.
>
> Agregado en la implementación (2026-10-03, ver Decisiones de implementación 6): path `/me/session-events` `post` (`operationId: recordSessionEvent`, `tags: [Audit]`, `x-openspec-capability: audit/audit-trail`, `x-required-role: AUTHENTICATED`, body `SessionEvent {event: STARTED|ENDED, workspaceId: Uuid|null}`, `204`; `400`, `401`, `429`, `500`, `503`) y schema `SessionEvent`. Cambio aditivo (no rompe clientes).

## Dependencias con otros changes de Phase 1

- **Requiere:** `bootstrap-platform-foundation` (roles `pf_app`/`pf_worker`, schema `platform`, dbmate, `UnitOfWork`, logging con correlación); `add-workspace-identity` (workspace, `RequestContext` con actor y rol, RLS `SET LOCAL app.workspace_id`, sesión del BFF para login/logout); `add-api-conventions` (problem+json, paginación por cursor; puede fusionarse con identity).
- **Habilita (debe aplicarse antes de):** `add-accounts-management`, `add-ledger-core`, `add-classification`, `add-transaction-recording`, `add-transfers`, `add-manual-conversions` — todos invocan `AuditPort`.
- Los TC que mencionan gastos (TC-AUDIT-ATOMIC-001, TC-AUDIT-CONTENT-001) se automatizan cuando exista `add-transaction-recording`; mientras tanto el test de integración usa un comando de prueba (`FakeMutatingCommand`) sobre una tabla de fixture con el mismo flujo de UoW.

## Riesgos / Trade-offs

- [Diff con datos sensibles por un campo nuevo no revisado] → allow-list por `aggregateType` (lo no listado se omite) + TC-AUDIT-REDACTION-001 con test "canario".
- [Escritura síncrona añade latencia y acopla todos los contextos a AUDIT] → aceptado por integridad (ARCHITECTURE §7); el puerto es mínimo y estable.
- [Partición faltante bloquea escrituras] → partición `DEFAULT` + job que crea 2 meses adelante + alerta.
- [Lista vacía para entidades ajenas puede ocultar errores de cliente] → aceptable: es lo que exige el aislamiento (404 indistinguible).
- [Eventos de sesión sin workspace] → se omiten de la auditoría de BD (ver Preguntas abiertas).

## Plan de migración

1. Migración `audit_0001_create_audit_log` (expand): `CREATE SCHEMA audit`; tabla particionada; particiones mes actual + 2; partición `DEFAULT`; índices; RLS WS-RO; grants; trigger `forbid_mutation` (crea `platform.forbid_mutation()` si no existe — idempotente con add-ledger-core).
2. Sin datos previos que migrar. Rollback: revertir la migración en entornos sin datos; en entornos con datos no hay contract (tabla append-only permanente).

## Preguntas abiertas

- ¿Los eventos de sesión deben tener un almacén por usuario (sin `workspace_id`) en lugar de registrarse en el workspace activo? Propuesta: workspace activo en Phase 1; revisar en el track de Colaboración.
- docs/08 §5.16 no incluye las columnas `origin` ni `actor_process`, exigidas por FR-AUDIT-002; este change las añade — actualizar docs/08 al archivar.

## Decisiones de implementación (2026-10-03)

1. **Paquete `@pf/audit`** (`packages/contexts/audit`) con la plantilla de `packages/contexts/README.md`. El dominio solo depende de `@pf/shared-kernel`; `AuditRecorder` y `AuditQueries` dependen de puertos propios (`AuditEnvironment`, `AuditLogStore`, `IpHasher`, `IdGenerator`, `ReadUnitOfWork`, `WorkspaceTimeZones`). `pnpm arch:check` sin violaciones.
2. **Contexto ambiental en `@pf/platform/api`** (`RequestContext`: actor, origen, user agent, IP para su HMAC, `Idempotency-Key`, `causationId`), abierto por `requestContextMiddleware()` (`@pf/platform/nest`) en `apps/api`; `setPrincipal` fija el actor USER. Los consumidores de eventos ejecutan con actor `WORKER{process: <consumer>}`, origen `system`, la correlación del evento y el evento como `causationId` (que también hereda el outbox si el borrador no la trae). Un `X-Request-Id` que no es UUID se convierte en un UUID v8 estable (`uuidFromOpaqueId`) porque `correlation_id`/`request_id` son `uuid`.
3. **Origen `ui` vs `api`:** el BFF marca sus llamadas con `X-PFOS-Origin: ui`; cualquier otro cliente queda como `api`. Es atribución informativa (no autoriza nada); falsificarla solo cambia el origen de los propios registros del llamador.
4. **IP del cliente:** el BFF reenvía `User-Agent` y el primer salto de `X-Forwarded-For`/`X-Real-IP` del navegador; la API toma el primer salto de `X-Forwarded-For` o el socket. Se guarda solo `HMAC-SHA256(AUDIT_IP_HMAC_KEY, ip)` (32 bytes). Nueva variable `AUDIT_IP_HMAC_KEY` (`kid:secreto[,…]`, la primera firma; obligatoria en staging/production, efímera en local/ci). Rotar la clave vuelve incomparables los hashes anteriores (aceptado). finance-api no se expone públicamente (docs/12 §2), por eso se confía en `X-Forwarded-For`.
5. **Redacción por allow-list aportada por cada contexto:** `RedactionPolicy` no conoce agregados ajenos; cada contexto exporta en sus `contracts` la allow-list de sus agregados (IDENTITY: `IDENTITY_AUDIT_POLICY` para `Workspace` y `User`) y `apps/api` las combina en `createAuditRuntime({ policies })` (un agregado no puede declararse dos veces). Reglas `plain`, `money` (`{amount: string, currency}`) y `last4`. Se admiten enteros en `changes` (días, contadores); un número fraccionario se rechaza (dominio y adapter). `preferences` de `User`, email e issuer/subject nunca se copian.
6. **Auditoría de login/logout (sustituye al "interceptor" de §1):** no existía el endpoint interno de logout que suponía el diseño. Se agrega al contrato `POST /api/v1/me/session-events` (`recordSessionEvent`, `x-required-role: AUTHENTICATED`, body `{event: STARTED|ENDED, workspaceId?}`, 204). El BFF lo llama una sola vez tras el callback OIDC (STARTED, nunca en los requests siguientes) y en el logout antes de revocar (ENDED, con el workspace activo de la sesión). Es *best effort*: un fallo no impide el login/logout y queda en el log técnico sin PII. Acciones `identity.session.started|ended`, agregado `User` del usuario.
7. **Workspace "hogar":** `audit_log.workspace_id` es obligatorio. Los eventos del usuario sin workspace propio (sesión, `PATCH /me`) se registran en el workspace indicado si el usuario es miembro activo; si no, en su membresía activa más antigua (UUIDv7 ⇒ normalmente el personal). Sin membresías se omiten (design §6, Pregunta abierta 1).
8. **Integración con IDENTITY:** `IdentityDeps.audit` es el `AuditPort` de `@pf/audit/contracts` (desaparece el adapter "solo log"). Se auditan: provisión (`identity.user.provisioned`), creación de workspace (`identity.workspace.created` con sus valores iniciales) y la membresía OWNER del creador (`identity.workspace.member_added`, `memberUserId`/`memberRole`), cambio de configuración (`identity.workspace.settings_changed` con diff y versión), y `PATCH /me` (`identity.user.preferences_changed` con diff de `displayName`/`locale`/`timeZone`; sin cambios efectivos no hay registro). No hay todavía comandos de membresía por API (FR-IDENTITY-008, Phase 11): cuando lleguen, auditarán con este puerto. Los eventos de IDENTITY siguen por el outbox (misma transacción).
9. **Almacenamiento (migración `20261003160000_audit_audit_log.sql`):** políticas separadas `ws_isolation_read` (SELECT) y `ws_isolation_write` (INSERT) para `pf_app` (WS-RO; `pf_worker` las hereda). `platform.forbid_mutation()` lanza PF003 (D19) y se crea con `CREATE OR REPLACE` (idempotente con add-ledger-core). Las particiones repiten RLS forzada + política y no tienen grants (acceso solo vía el padre; el chequeo de catálogo TC-SECURITY-RLS-004 las cubre). Con RLS forzada ni el owner ve filas: UPDATE/DELETE del owner afectan 0 filas, TRUNCATE lo frena el trigger de sentencia y, sin la RLS forzada, el trigger de fila (verificado). `audit.default_partition_rows()` cuenta la DEFAULT gracias a una política de solo lectura para el rol migrador; el job `audit.ensure-partitions` (worker, al arrancar y cada 24 h) crea mes actual + 2 y registra una alerta (`logger.error`, `alert=audit.default_partition_rows`) si la DEFAULT tiene filas. Si la DEFAULT ya tiene filas de un mes, esa partición no se crea (WARNING) — el caso solo aparece con relojes fijos de tests.
10. **Consultas:** `GET /audit-log` pagina por cursor firmado (keyset `occurredAt` + `id`, ámbito = recurso + workspace + filtros + orden efectivo). `from`/`to` se convierten a `[from 00:00, to+1 00:00)` locales de la zona IANA del workspace (que aporta IDENTITY con `identityWorkspaceTimeZones`). La respuesta se valida en los tests contra `AuditLogPage` del contrato.
11. **Historial por transacción (VIEWER, D28):** queda listo el puerto `AuditHistoryQuery.historyOf({userId, workspaceId, entities[]})` (token `AUDIT_HISTORY_QUERY`, exportado por `AuditModule`), que devuelve la proyección pública cronológica de un conjunto de entidades (transacción, splits, asiento). El endpoint `getTransactionHistory` lo implementa `add-transaction-recording` (debe verificar antes que el usuario puede ver la transacción); TC-AUDIT-ACCESS-002 sigue sin automatizar.
12. **Arquitectura (tarea 6.1):** regla `required` de dependency-cruiser `command-handlers-audit`: todo `*.command-handler.ts` o `*.service.ts` de `packages/contexts/*/src/application` (salvo AUDIT, tests y `testing/`) debe depender de `@pf/audit/contracts`; las consultas puras van en `*.queries.ts`. Fixture de violación en `scripts/architecture` (TC-AUDIT-ATOMIC-001). Se permite `fast-check` en los tests de dominio (como `vitest`).
13. **Atomicidad sin Transactions (tarea 8.1):** TC-AUDIT-ATOMIC-001 se ejerce con un `FakeMutatingCommand` sobre tablas de fixture (`audit_fixture.*`, RLS forzada, se borran al final): gasto + saldo + evento en el outbox real + auditoría real; el fallo es un INSERT de auditoría rechazado por la BD (RLS) y todo hace rollback. Por HTTP, un `AuditPort` con fallo inyectado hace que `PATCH /workspaces/{id}` responda 500 `INTERNAL_ERROR` sin cambio, evento ni auditoría.
14. **UI (tarea 7.1):** componente `AuditHistory` reutilizable (`apps/web/src/ui/AuditHistory.tsx`) en la página de Configuración (agregado `Workspace`), visible solo para OWNER/EDITOR; montos formateados desde el string decimal (sin `number`) con el locale del workspace; textos en `messages/{es,en,pt}.json` (`AuditHistory.*`). La verificación con axe queda pendiente: el repo no tiene axe-core ni jsdom y no se agregaron dependencias nuevas; el test de componente verifica la estructura accesible (sección rotulada, `caption`, encabezados de fila/columna).
