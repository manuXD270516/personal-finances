# ADR-0022: Estilo de API y versionado — REST `/api/v1`, OpenAPI 3.1 contract-first, RFC 9457, Idempotency-Key, ETag

- Estado: Propuesto
- Fecha: 2026-10-01
- Decisores: Owner (Product/Tech Lead)
- Relacionado: docs/ARCHITECTURE.md §5, §8; contracts/openapi/finance-api.v1.yaml; ADR-0006, ADR-0010, ADR-0015, ADR-0016, ADR-0019, ADR-0023; OpenSpec capability `platform/api-conventions`

## Contexto y problema

`finance-api` expone las capacidades de ~18 contextos a un consumidor principal (el BFF de Next.js) y, potencialmente, a futuros consumidores (app móvil, integraciones, asistente IA vía tools, scripts del owner). La API mueve dinero (crear transacciones, conversiones, pagos de préstamos), por lo que necesita: semántica clara, reintentos seguros (idempotencia), control de concurrencia (dos pestañas editando la misma transacción), errores precisos y una política de versionado que no rompa clientes.

## Drivers de decisión

- Seguridad y corrección en operaciones financieras (idempotencia, concurrencia optimista).
- Contrato explícito, versionado y validable en CI.
- Simplicidad para un consumidor principal y cacheabilidad HTTP.
- Tipado end-to-end (generación de cliente TS).
- Evolución sin romper consumidores.

## Opciones consideradas

1. **REST + OpenAPI 3.1 contract-first** (elegida).
2. REST code-first (OpenAPI generado desde decorators de Nest).
3. GraphQL.
4. tRPC.
5. gRPC (+ gRPC-Web/Connect).

**Versionado:** A. **en la ruta (`/api/v1`)** (elegida) · B. por header/media type · C. por fecha (estilo Stripe).

## Decisión

- **REST/JSON** con **OpenAPI 3.1** escrito **contract-first** en `contracts/openapi/finance-api.v1.yaml`; el código (DTOs/validación) se alinea al contrato y CI valida conformidad (lint Spectral/Redocly + tests de respuesta contra schema).
- **Rutas:** `/api/v1/workspaces/{workspaceId}/<resource>` (workspace explícito, validado contra membership + RLS); endpoints de usuario `/api/v1/me`, `/api/v1/workspaces`. Recursos según ARCHITECTURE §8 (`accounts`, `transactions`, `transfers`, `conversions`, …, `audit-log`). Acciones de dominio no-CRUD como sub-recursos/verbos explícitos (`POST …/transactions/{id}/void`, `POST …/periods/{id}/close`).
- **Formato:** JSON camelCase; montos como **string decimal** con `currency` (`{"amount":"685.00","currency":"BOB"}`); fechas de negocio `YYYY-MM-DD`; instantes RFC 3339 UTC; IDs UUIDv7 string.
- **Paginación por cursor** (`limit`, `cursor` opaco, `nextCursor`), filtros explícitos por query param, `sort` con allow-list.
- **Errores:** RFC 9457 `application/problem+json` con `type` URI estable, `title`, `status`, `detail`, `instance` y extensiones `code` (código de dominio: `LEDGER_UNBALANCED_ENTRY`, `PERIOD_CLOSED`, `CURRENCY_MISMATCH`, …), `errors[]` para validación por campo, `traceId`.
- **`Idempotency-Key` obligatorio** en POST que crean registros financieros: almacenado en `platform.idempotency_key` (clave, workspace, hash del request, respuesta, TTL ≥ 24 h); misma clave + mismo cuerpo → misma respuesta; misma clave + cuerpo distinto → `422`/`409` con `code: IDEMPOTENCY_KEY_REUSED`.
- **Concurrencia optimista:** `ETag` (derivado de `version`) en GET de agregados; `If-Match` **obligatorio** en PATCH/PUT/DELETE lógicos → `412 Precondition Failed` si cambió; `428` si falta.
- **Versionado:** mayor en ruta (`/api/v1`). Cambios aditivos (campos opcionales nuevos, endpoints nuevos) dentro de v1; los clientes deben ignorar campos desconocidos. Breaking changes → `/api/v2` o versionado de recurso documentado; deprecación con headers `Deprecation` y `Sunset` y enlace a guía de migración; ventana mínima documentada.
- Detección de breaking changes automática en CI (diff de OpenAPI: oasdiff o equivalente) bloquea merges que rompen v1.
- Seguridad: Bearer JWT (ADR-0010); rate limiting por usuario/IP; tamaño máximo de payload; CORS cerrado (solo BFF server-to-server).

## Análisis de opciones

### 1. REST contract-first (elegida)
- **Pros:** el contrato se revisa en PR antes que el código (encaja con OpenSpec: el `proposal.md` declara APIs impactadas, ADR-0024); generación de cliente TS para el BFF; semántica HTTP (caché, ETag, idempotencia, códigos) bien entendida; herramientas maduras de lint y diff; consumible por cualquier cliente futuro.
- **Contras:** mantener YAML a mano (verboso); riesgo de drift código↔contrato (mitigado con tests de conformidad); overfetching en dashboards (mitigado con endpoints de read model específicos de Reporting).
- **Costo:** 0. **Complejidad operativa:** baja.

### 2. REST code-first
- **Pros:** menos duplicación; `@nestjs/swagger` genera spec.
- **Contras:** el contrato es consecuencia del código (decorators en `interface`) → cambios accidentales de contrato; OpenAPI 3.1 y JSON Schema avanzados con soporte parcial en generadores.
- **Complejidad:** baja; riesgo de contrato implícito.

### 3. GraphQL
- **Pros:** consultas flexibles para dashboards; un endpoint; tipado fuerte.
- **Contras:** idempotencia, caché HTTP y control de concurrencia no estándar; autorización por campo compleja; N+1 y coste de queries; más complejidad de la necesaria para un consumidor.
- **Complejidad operativa:** media-alta.

### 4. tRPC
- **Pros:** tipado end-to-end sin codegen; DX excelente en monorepo TS.
- **Contras:** acopla cliente y servidor a TypeScript y al monorepo; no hay contrato language-agnostic (app móvil, ML Python, terceros); semántica HTTP limitada.
- **Complejidad:** baja; lock-in alto.

### 5. gRPC
- **Pros:** contratos protobuf eficientes; streaming.
- **Contras:** navegador requiere gRPC-Web/Connect; decimales sin tipo nativo (string o mensajes custom); tooling de debugging menos accesible; overkill.
- **Complejidad:** media-alta.

### Versionado
- Ruta: explícito, visible en logs y fácil de enrutar; contras: "versionar todo" en un salto mayor. Header/media type: más purista, menos visible y peor DX. Por fecha (Stripe): excelente para APIs públicas con muchos clientes, excesivo aquí.

## Consecuencias

**Positivas**
- Reintentos seguros desde el BFF y redes inestables (idempotencia).
- Sin "lost updates" en ediciones concurrentes (ETag/If-Match).
- Errores accionables y trazables (code + traceId).

**Negativas**
- Más headers/tablas de soporte (idempotency keys con purga periódica).
- Disciplina de mantener el contrato a mano.

**Riesgos**
- Drift entre OpenAPI e implementación. *Mitigación:* validación de requests/responses contra el schema en tests de integración; diff en CI.
- Fuga de existencia de recursos entre workspaces. *Mitigación:* `404` (no `403`) para recursos de otro workspace; RLS (ADR-0023).

## Validación

- CI: Spectral/Redocly sin errores; oasdiff sin breaking changes en v1; tests de contrato por endpoint.
- Tests de integración: doble POST con misma `Idempotency-Key` → un solo registro y misma respuesta; PATCH con `If-Match` obsoleto → 412.
- Revisión de cada cambio OpenSpec que declare APIs impactadas (ADR-0024).

## Notas

- RFC 9457 (2023) reemplaza a RFC 7807 para Problem Details.
- El header `Idempotency-Key` sigue el borrador IETF *httpapi-idempotency-key-header*; los headers `Deprecation` (RFC 9745) y `Sunset` (RFC 8594) se usan para deprecación. Estado de estos documentos: a verificar al implementar (no verificado por web en esta redacción).
