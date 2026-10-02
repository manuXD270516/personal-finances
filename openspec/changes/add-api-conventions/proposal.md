# Propuesta: add-api-conventions

## Why

La API de `finance-api` mueve dinero: un reintento de red que registre dos veces un gasto, una edición concurrente que pise otra en silencio, un monto serializado como número de punto flotante o un error sin código estable rompen la confianza en los números. ADR-0022 y docs/10 definen las convenciones (REST `/api/v1`, RFC 9457, `Idempotency-Key`, ETag/If-Match, cursor, montos string decimal, fechas de negocio vs instantes), pero hoy no son comportamiento verificable. Este change las especifica una sola vez, como capability transversal `platform/api-conventions` (docs/03 §7, orden 10, "puede fusionarse con 1"), para que cada change de negocio de Phase 1 las herede en lugar de redefinirlas.

## What Changes

- Versión mayor en la ruta (`/api/v1`), detección automática de cambios incompatibles del contrato en CI y deprecación con cabeceras `Deprecation`/`Sunset`/`Link` (Should).
- Errores RFC 9457 `application/problem+json` con `type` estable, `code` de dominio, `requestId` y `errors[]` con JSON Pointer; catálogo de códigos con mensaje en español por código.
- Validación de toda petición contra el schema del contrato (campos desconocidos rechazados).
- `Idempotency-Key` obligatoria en POST financieros: 428 si falta, replay de la respuesta almacenada con `Idempotent-Replayed: true`, 422 `IDEMPOTENCY_KEY_REUSED` ante payload distinto, 409 `IDEMPOTENCY_REQUEST_IN_PROGRESS` ante ejecución en curso, sin almacenar 5xx/429, retención ≥ 24 h.
- Concurrencia optimista: `ETag` fuerte por versión, 304 con `If-None-Match`, `If-Match` obligatorio (428), 412 `PRECONDITION_FAILED` con `currentVersion`, 409 `CONCURRENCY_CONFLICT`.
- Paginación por cursor opaco firmado (`limit` 50/200, `nextCursor`, `hasMore`) con 400 `INVALID_CURSOR` ante manipulación o cambio de filtros.
- Montos como `{"amount": "<string decimal>", "currency": "<código>"}` con escala canónica; 422 `AMOUNT_SCALE_EXCEEDED` sin redondeo silencioso; fechas de negocio `YYYY-MM-DD` en la zona del workspace e instantes RFC 3339 UTC.
- Límite de tasa por usuario/workspace con 429 `RATE_LIMITED` (Should).
- **Fuera de alcance:** operaciones asíncronas `202 + operation` (contrato ya publicado; su comportamiento se especifica con su primer uso en Phase 6), sparse fieldsets, webhooks, endpoints bulk (Phase 2), versionado `/api/v2` (no hay breaking changes), reglas de negocio de cada recurso (las especifican sus changes), autenticación y autorización (`add-workspace-identity`).

## Capabilities

### New Capabilities
- `platform/api-conventions`: versionado, errores Problem Details y catálogo de códigos, validación contra contrato, montos y fechas, idempotencia, ETag/If-Match, paginación por cursor y límite de tasa.

### Modified Capabilities
- Ninguna.

## Impact

**Specs impactadas:** crea `platform/api-conventions` (21 requirements: 18 Must, 3 Should).

**Componentes/contextos impactados:** `@pf/platform` (interface/infrastructure: filtro de errores RFC 9457, pipe de validación Ajv compilado desde el contrato, interceptor de idempotencia, interceptor ETag/If-Match, codec de cursores, limitador de tasa, middleware de deprecación); `@pf/shared-kernel` (catálogo de `DomainError` con `code`, `Money`/`LocalDate`/`Instant` en el borde); `apps/api` (prefijo global `/api/v1`, 404 Problem Details); `apps/web` (catálogo i18n de errores en español, generación de `Idempotency-Key` por intento del usuario en el BFF, propagación de `If-Match`); CI (Spectral, oasdiff, test de catálogo de errores).

**APIs impactadas:** `contracts/openapi/finance-api.v1.yaml` — componentes transversales (`Problem`, `PageInfo`, `LocalDate`, `Instant`, cabeceras `Deprecation`/`Sunset`/`Link`, respuestas `Conflict`, `InternalServerError`, `ServiceUnavailable`) y nuevo ruleset `contracts/openapi/.spectral.yaml`. Ningún path nuevo ni cambio incompatible. Detalle exacto en design.md § Contratos.

**Tablas impactadas:** `platform.idempotency_key` (nueva, docs/08 §5.18).

**Eventos impactados:** ninguno.

**Migraciones requeridas:** expand: crear `platform.idempotency_key` con índices, RLS y grants; job de purga por `expires_at`. No destructiva.

**Test cases:** AÑADIDOS — TC-PLATFORM-API-001, TC-PLATFORM-API-002, TC-PLATFORM-API-003, TC-PLATFORM-API-004, TC-PLATFORM-API-005, TC-PLATFORM-API-006, TC-PLATFORM-API-007, TC-PLATFORM-API-008, TC-PLATFORM-API-009, TC-PLATFORM-API-010, TC-PLATFORM-API-011, TC-PLATFORM-API-012, TC-PLATFORM-API-013, TC-PLATFORM-API-014, TC-PLATFORM-API-015, TC-PLATFORM-API-016, TC-PLATFORM-API-017, TC-PLATFORM-API-018, TC-PLATFORM-API-019, TC-PLATFORM-API-020. MODIFICADOS — TC-TRANSACTIONS-IDEMPOTENCY-001 (pasa a `platform/api-conventions` / "Reproducción idempotente de POST financieros", `fr` corregido a FR-TRANSACTIONS-010; los casos de clave ausente, payload distinto y concurrencia se mueven a TC-PLATFORM-API-007/008/009; clave ausente 400 → 428). DEPRECADOS — ninguno.

**Invariantes afectadas:** INV-027 (comandos financieros idempotentes), INV-001 (sin punto flotante en montos, en el borde HTTP), INV-020 (sin redondeo silencioso: la escala excedida se rechaza).

**Impacto de regresión:** ninguno sobre comportamiento previo. Desde este change todo endpoint nuevo debe pasar Spectral (montos `Money`, `Idempotency-Key` en POST financieros, `If-Match` en PATCH, errores problem+json) y oasdiff; los tests de idempotencia, ETag y cursor entran a la Financial Regression Suite.

**Riesgos introducidos:** respuestas almacenadas en `platform.idempotency_key` contienen datos financieros (RLS por workspace + retención 24 h); clave de firma de cursores filtrada permitiría forjar cursores (no da acceso fuera del workspace gracias a RLS; rotación por `kid`); falsos positivos de oasdiff (excepción solo con label `api-breaking` + ADR); limitador de tasa en memoria válido solo con una réplica de API (adapter Valkey opcional).
