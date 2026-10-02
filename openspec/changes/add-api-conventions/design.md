# Diseño

## Contexto

Capability transversal que materializa ADR-0022 y `docs/10-api-design.md` (§2–§7, §9–§11) sobre el skeleton de `bootstrap-platform-foundation`. No pertenece a un bounded context: vive en `@pf/platform` (mecanismos HTTP e idempotencia) y `@pf/shared-kernel` (errores de dominio, `Money`, `LocalDate`). El contrato `contracts/openapi/finance-api.v1.yaml` ya declara la mayoría de las convenciones (parámetros `IdempotencyKey`, `IfMatch`, `Limit`, `Cursor`; schemas `Money`, `Problem`, `ErrorCode`); este change las vuelve comportamiento verificable. Motivación: ver proposal.md — Por qué.

## Objetivos / No objetivos

**Objetivos:**
- Un único conjunto de componentes reutilizables que todo controller hereda sin código específico: validación, errores, idempotencia, ETag/If-Match, cursores, serialización de montos/fechas, límite de tasa, deprecación.
- Gates de CI que impidan publicar operaciones que violen las convenciones (Spectral, oasdiff, catálogo de errores).

**No objetivos:**
- Operaciones asíncronas `202 + operation` (Phase 6), bulk (Phase 2), sparse fieldsets, webhooks.
- Autenticación, membresía y roles (`add-workspace-identity`).

## Decisiones

### 1. Capas y componentes

| Capa | Componente | Responsabilidad |
|------|-----------|-----------------|
| shared-kernel (domain) | `DomainError` con `code` estable; `Money.parse(amount: string, currency, scale)` que rechaza escala excedida (`AMOUNT_SCALE_EXCEEDED`) sin redondear; `LocalDate`; `Instant` | Errores y tipos sin dependencias de framework |
| platform (application) | Puerto `IdempotencyStore` (`reserve`, `complete`, `release`, `find`); puerto `RateLimiter`; `ErrorCatalog` (`code → httpStatus, type`) | Políticas independientes de Nest |
| platform (infrastructure) | `PgIdempotencyStore` sobre `platform.idempotency_key`; `InMemoryRateLimiter` y `ValkeyRateLimiter` (opcional, `RATE_LIMIT_STORE=memory\|valkey`); `CursorCodec` (HMAC) | Persistencia y adapters |
| platform (interface) | `ContractValidationPipe` (Ajv 2020-12 + `ajv-formats`, compilado al arranque desde el contrato, `additionalProperties: false`); `ProblemDetailsFilter` global; `IdempotencyInterceptor`; `ConditionalRequestInterceptor` (ETag / If-None-Match / If-Match); `DeprecationInterceptor` (lee `deprecated` + `x-sunset` del contrato); `RateLimitGuard`; serializadores `Money`/fechas | Mapeo HTTP |
| `apps/api` | Prefijo global `/api/v1`; handler de rutas desconocidas → 404 Problem Details `RESOURCE_NOT_FOUND`; registro de todos los componentes | Composition root |
| `apps/web` (BFF) | Generación de `Idempotency-Key` UUIDv7 **por intento del usuario** (no por reintento técnico) y reenvío en reintentos; propagación de `ETag`/`If-Match`; catálogo `errors.es.json` (+ `en`, `pt` preparados) indexado por `code` | Cliente |
| CI | `contracts/openapi/.spectral.yaml`, `redocly lint`, `oasdiff breaking` contra `main`, test de catálogo de errores, test "toda operación del contrato tiene test de API" (informativo) | Gates |

### 2. Errores RFC 9457

- `type = https://pfos.dev/problems/<code-en-kebab>` (dominio placeholder, docs/10 §18.3; RFC 9457 permite URIs no resolubles); `title`/`detail` en inglés técnico; `requestId` = correlation id del request (mismo valor que en los logs, `platform/observability`).
- `ProblemDetailsFilter` mapea `DomainError` → status por `ErrorCatalog`; errores de validación Ajv → `400 VALIDATION_FAILED` con `errors[].pointer` (JSON Pointer RFC 6901 desde `instancePath`); cualquier otra excepción → `500 INTERNAL_ERROR` sin stack/SQL (el detalle va solo al log con nivel `error`); dependencia caída → `503 SERVICE_UNAVAILABLE` con `Retry-After`.
- `ErrorCatalog` es la fuente única en código y un test verifica igualdad de conjuntos con `components.schemas.ErrorCode` del contrato y con las claves de `errors.es.json` (TC-PLATFORM-API-005).

### 3. Idempotencia (`platform.idempotency_key`, docs/10 §7, docs/08 §5.18)

- Aplica a operaciones cuyo contrato referencia `#/components/parameters/IdempotencyKey` (obligatoria) o `IdempotencyKeyOptional`. Clave ausente donde es obligatoria ⇒ `428 IDEMPOTENCY_KEY_REQUIRED` antes de cualquier efecto; formato inválido ⇒ `400 VALIDATION_FAILED`.
- Ámbito: `scope_id = workspaceId` (rutas bajo workspace) o `userId` (p. ej. `POST /workspaces`). `request_hash = SHA-256(method ‖ routeTemplate ‖ JCS(body))` (RFC 8785).
- Flujo:
  1. **Reserva** en transacción corta: `INSERT … (status 'IN_PROGRESS', locked_until = now() + 30 s) ON CONFLICT DO NOTHING`. Si hay conflicto se lee la fila: `COMPLETED` con mismo hash ⇒ replay (status, `Location`, `ETag`, body) + `Idempotent-Replayed: true`; hash distinto ⇒ `422 IDEMPOTENCY_KEY_REUSED`; `IN_PROGRESS` vigente ⇒ `409 IDEMPOTENCY_REQUEST_IN_PROGRESS` + `Retry-After: 1`; `IN_PROGRESS` vencido (proceso caído) ⇒ toma de la reserva con `UPDATE … WHERE locked_until < now()`.
  2. **Ejecución**: el comando corre en su Unit of Work y, **en la misma transacción**, se actualiza la fila a `COMPLETED` con la respuesta ⇒ efectos y respuesta se confirman juntos (exactly-once).
  3. **Fallo**: 4xx determinista (validación de dominio) ⇒ se guarda como `COMPLETED` en transacción aparte; 5xx o 429 ⇒ `release` (borra la reserva) para que el reintento re-ejecute.
- `expires_at = created_at + IDEMPOTENCY_RETENTION` (default 24 h, máx. 7 días); purga por job del worker con `pf_maintenance`. Pasada la retención la clave se trata como nueva.
- RLS: `USING/WITH CHECK ((workspace_id IS NOT NULL AND workspace_id = platform.current_workspace_id()) OR (workspace_id IS NULL AND user_id = platform.current_user_id()))`; `pf_app` con SELECT/INSERT/UPDATE/DELETE (DELETE solo para `release`).
- Elección de estado HTTP para payload distinto: **422** según docs/10 §7/§9.1, el contrato vigente y el borrador IETF *httpapi-idempotency-key-header*. INV-027 en docs/09 dice "409": se reporta como contradicción documental (ver Preguntas abiertas).

### 4. Concurrencia optimista

- `ETag: "<version>"` fuerte en GET de agregados y en respuestas de mutación; `If-None-Match` igual ⇒ `304`. Colecciones de catálogo pequeñas: `ETag` débil (hash del contenido) — opcional por recurso.
- `If-Match` obligatorio en PATCH y acciones sobre agregados existentes: ausente ⇒ `428 PRECONDITION_REQUIRED`; distinto ⇒ `412 PRECONDITION_FAILED` con `currentVersion`. El repositorio ejecuta `UPDATE … WHERE id = $1 AND version = $expected` y 0 filas ⇒ `409 CONCURRENCY_CONFLICT` (carrera entre chequeo y escritura).

### 5. Paginación por cursor

- `cursor = base64url(JSON{v:1, kid, r: resource, w: workspaceId, f: SHA-256(filtros+sort canónicos), k: [sortKeys…, id]}) "." base64url(HMAC-SHA256(key[kid], payload))`. Clave `CURSOR_SIGNING_KEY` por entorno con rotación por `kid`.
- Firma inválida, `r`/`w`/`f` distintos o versión desconocida ⇒ `400 INVALID_CURSOR`. Consulta por *keyset* (`(sortKey, id) > (…)`) con `id` UUIDv7 como desempate ⇒ orden total estable. `limit` 1..200 (default 50) validado por el contrato. Sin `totalCount`.

### 6. Montos y fechas en el borde

- Requests: Ajv exige `amount` string con el patrón `DecimalString`; la capa interface construye `Money` con `Money.parse` usando `currency.scale` del catálogo de FX; nunca `Number(...)` (regla de lint + test de arquitectura, NFR-DATA-001).
- Responses: `amount = money.toFixed(currency.scale)` (escala canónica: `"1500.00"`, `"100.000000"`).
- `LocalDate` con patrón `^\d{4}-\d{2}-\d{2}$` (rechaza fecha-hora); `Instant` serializado con `toISOString()` (UTC, `Z`, milisegundos). "Hoy" y límites de periodo se calculan con la zona del workspace (`iam.workspace.timezone`).

### 7. Versionado y deprecación

- Prefijo `/api/v1`; v2 se agregaría por recurso en el mismo proceso (docs/10 §11). `oasdiff breaking` contra `main` falla la PR salvo label `api-breaking` + ADR.
- Operaciones con `deprecated: true` + `x-sunset` en el contrato responden `Deprecation: @<epoch>` (RFC 9745), `Sunset: <HTTP-date>` (RFC 8594) y `Link: <doc>; rel="deprecation"`; Spectral exige `x-sunset` ≥ 90 días después de la fecha de deprecación declarada.

### 8. Límite de tasa (Should)

Token bucket por `(userId)` y `(workspaceId)`: 600 lecturas/min y 120 escrituras/min por usuario; 10/min en exports/imports (cuando existan). Cabeceras `RateLimit`/`RateLimit-Policy` en todas las respuestas; exceso ⇒ `429 RATE_LIMITED` + `Retry-After` sin ejecutar la operación. Adapter en memoria (Phase 1, una réplica de API); Valkey opcional para varias réplicas (Redis dejó de ser obligatorio, ADR-0008).

### 9. Modelo de datos

| Tabla | Cambio | RLS / grants | Migración |
|-------|--------|--------------|-----------|
| `platform.idempotency_key` | Nueva según docs/08 §5.18: PK `(scope_id, key)`, `workspace_id`, `user_id`, `method`, `route`, `request_hash bytea`, `status` (`IN_PROGRESS`/`COMPLETED`), `response_status`, `response_headers jsonb`, `response_body jsonb`, `locked_until`, `created_at`, `expires_at`; índice `(expires_at)` | RLS forzada con la política del §3; `pf_app` DML; `pf_maintenance` DELETE por retención | Expand, no destructiva |

### 10. Eventos

Ninguno producido ni consumido. La idempotencia de consumidores de eventos (`platform.inbox`, INV-028) pertenece al mecanismo de outbox de `@pf/platform`, no a este change.

## Contratos

Cambios requeridos en `contracts/openapi/finance-api.v1.yaml` (no se editan aquí; los consolida otro proceso):

1. `components.schemas.Problem`: agregar `requestId` a `required` (queda `[type, title, status, code, requestId]`).
2. `components.schemas.PageInfo`: agregar `nextCursor` a `required` (sigue siendo `type: [string, 'null']`) y `additionalProperties: false`.
3. `components.schemas.LocalDate`: agregar `pattern: '^\d{4}-\d{2}-\d{2}$'`.
4. `components.schemas.Instant`: agregar `pattern: '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,9})?Z$'` y precisar en `description` "RFC 3339 UTC con sufijo Z".
5. `components.headers`: agregar `Deprecation` (`string`, RFC 9745, ejemplo `@1798761600`), `Sunset` (`string`, HTTP-date RFC 8594) y `Link` (`string`, `rel="deprecation"`).
6. `components.responses.Conflict`: agregar `headers.Retry-After: { $ref: '#/components/headers/RetryAfter' }` (presente con `IDEMPOTENCY_REQUEST_IN_PROGRESS`).
7. `components.responses`: agregar `InternalServerError` (500, `INTERNAL_ERROR`, `application/problem+json`) y `ServiceUnavailable` (503, `SERVICE_UNAVAILABLE`, cabecera `Retry-After`, `application/problem+json`), y referenciarlos como `'500'` y `'503'` en todas las operaciones de `paths`.
8. Toda operación que usa `#/components/parameters/IdempotencyKey`: verificar/agregar cabecera `Idempotent-Replayed` en su respuesta 2xx y respuestas `'409'` (Conflict), `'422'` (UnprocessableEntity) y `'428'` (PreconditionRequired).
9. Toda operación PATCH o acción sobre agregado existente: verificar/agregar `'412'` y `'428'`; todo GET de agregado: `ETag` en 200, parámetro `IfNoneMatch` y `'304': { $ref: '#/components/responses/NotModified' }`.
10. Toda operación de colección: verificar `Limit` y `Cursor` y respuesta `'400'` (BadRequest con `INVALID_CURSOR`).
11. `info.description`: agregar viñetas sobre `Deprecation`/`Sunset` y cabeceras `RateLimit`/`RateLimit-Policy`.
12. Nuevo archivo `contracts/openapi/.spectral.yaml` con las reglas PFOS de docs/10 §1.2 (`x-openspec-capability` válido, dinero solo vía `Money`/`DecimalString`/`Rate` y prohibido `type: number`, `Idempotency-Key` en POST con tag financiero, `If-Match` en PATCH, errores `application/problem+json`, `camelCase`, paths `kebab-case`, `operationId` único) más: `x-required-role` presente; respuestas `'401'`, `'500'`, `'503'` presentes; `x-sunset` obligatorio si `deprecated: true`.
13. `components.schemas.ErrorCode`: sin códigos nuevos (`VALIDATION_FAILED`, `INVALID_CURSOR`, `IDEMPOTENCY_*`, `PRECONDITION_*`, `CONCURRENCY_CONFLICT`, `AMOUNT_SCALE_EXCEEDED`, `RATE_LIMITED`, `INTERNAL_ERROR`, `SERVICE_UNAVAILABLE` ya existen). Se mantiene `IDEMPOTENCY_KEY_REUSED` en 422 (descripción del parámetro `IdempotencyKey` sin cambios).

Cambios requeridos en `contracts/events/`: ninguno.

> Consolidado en contracts/ el 2026-10-02.

## Dependencias con otros changes de Phase 1

- **Requiere:** `bootstrap-platform-foundation` (skeleton, CI, logs con correlation id que alimenta `requestId`).
- **Coordina con `add-workspace-identity`:** usa su `AuthContext` y `UnitOfWork` con RLS (la tabla `platform.idempotency_key` depende de `platform.current_workspace_id()`/`current_user_id()`); `createWorkspace`, `updateMe` y `updateWorkspace` son los primeros consumidores reales. Pueden aplicarse en paralelo; si este change se aplica antes, los TC se ejecutan contra un controller de prueba del harness de plataforma.
- **Habilita:** `add-accounts-management`, `add-ledger-core`, `add-classification`, `add-transaction-recording`, `add-transfers`, `add-manual-conversions`, `add-basic-dashboard`, que solo declaran en el contrato los parámetros/respuestas estándar y heredan el comportamiento. `add-transaction-recording` y `add-manual-conversions` aportan los escenarios de dinero reales (gasto de 75.00 BOB, conversión 100.000000 USDT → 685.00 BOB) usados por los TC de idempotencia, ETag y montos.
- **Consulta a FX:** la escala de cada moneda (`fx.currency.scale`) para validar y serializar montos.

## Riesgos / Trade-offs

- [Respuestas almacenadas contienen datos financieros] → RLS por workspace, retención 24 h, purga automática; nunca se loguea `response_body`.
- [Reserva `IN_PROGRESS` huérfana tras caída] → `locked_until` de 30 s y toma de la reserva vencida.
- [Clave de firma de cursores comprometida] → solo permite forjar posiciones dentro del propio workspace (RLS y `w` en el payload); rotación por `kid`.
- [Ajv compilado desde un contrato grande ralentiza el arranque] → compilación una vez al arranque y caché; medido en el smoke de CI.
- [oasdiff marca como breaking cambios aceptables] → excepción explícita con label `api-breaking` + ADR.
- [Limitador en memoria con varias réplicas] → adapter Valkey opcional; en Phase 1 hay una réplica.

## Plan de migración

Migración expand de `platform.idempotency_key` (tabla, índices, RLS, grants) y registro del job de purga. Sin datos previos. Rollback = revertir la app; la tabla puede quedar.

## Preguntas abiertas

- Contradicción documental: INV-027 (docs/09) indica `409` para clave reutilizada con payload distinto, mientras docs/10 §7/§9.1 y el contrato indican `422`. Este change adopta `422` (alineado con el contrato y el borrador IETF); se recomienda corregir el texto de INV-027. No bloquea.
- Dominio definitivo de `type` de Problem Details (`pfos.dev` es placeholder, docs/10 §18.3). No bloquea: el `type` se construye desde configuración.
