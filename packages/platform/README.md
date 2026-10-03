# @pf/platform

Capacidades técnicas transversales, sin lógica de negocio. Es el **único** paquete autorizado a leer
`process.env` (regla ESLint `no-restricted-properties`, docs/19 §0.3).

| Subpath | Contenido |
|---|---|
| `@pf/platform/config` | Registro único de variables de runtime (zod), `loadConfig(app)` fail-fast (lista todas las faltantes, sale con 78), generador de `docs/config-reference.md` |
| `@pf/platform/logging` | Logger pino JSON (`time`, `level`, `msg`, `service.name`, `deployment.environment`, `process.role`, `correlation_id`, `request_id`, `trace_id`/`span_id`) con redacción (docs/18 §3) |
| `@pf/platform/health` | `ReadinessProbe` + chequeos PostgreSQL, object storage (S3 `HeadBucket`) y Valkey (solo si `JOB_QUEUE_DRIVER=bullmq` o `SESSION_STORE=valkey`) |
| `@pf/platform/queue` | Puerto `JobQueue` + adapter pg-boss (polling explícito) con envelope que propaga `correlationId` y `traceparent` |
| `@pf/platform/storage` | Cliente S3 (path-style, checksums `WHEN_REQUIRED`) |
| `@pf/platform/lifecycle` | Apagado ordenado ante SIGTERM/SIGINT con plazo máximo |
| `@pf/platform/nest` | `HealthController`, middleware de correlación/log de peticiones, interceptor `http.route` para OTel, adaptador de logger para Nest; `apiConventionsProviders()` registra `RateLimitGuard` → `ContractValidationInterceptor` → `DeprecationInterceptor` → `IdempotencyInterceptor` → `ConditionalRequestInterceptor` y el `ProblemDetailsFilter` global; decoradores `@ExpectedVersion()`/`@ValidatedQuery()` |
| `@pf/platform/api` | Convenciones de API sin Nest (`platform/api-conventions`): contrato OpenAPI cargado con Ajv 2020-12 (`ApiContract`), `ApiProblem`/`renderProblem` (RFC 9457), `IdempotencyPolicy` + `PgIdempotencyStore`/`InMemoryIdempotencyStore`, purga `purgeExpiredIdempotencyKeys`, `PgCommandTransaction` (transacción con contexto RLS), `CursorCodec`/`buildPage`, `InMemoryRateLimiter` |
| `@pf/platform/errors` | `ErrorCatalog` (código → estado HTTP, `title`, `type`); sin dependencias, lo usa también finance-web |
| `@pf/platform/otel/register` | Bootstrap OpenTelemetry para `node --import` (ESM, Nest 12), activo solo con `OTEL_ENABLED=true` |

Carpetas: `src/<capacidad>/` (no hay capas de dominio: es infraestructura compartida). Tests unitarios colocados
(`src/**/*.test.ts`); la integración con dependencias reales vive en `apps/api/test/api`.

```bash
pnpm --filter @pf/platform test
pnpm config:docs          # regenera docs/config-reference.md
pnpm config:docs:check    # falla si está desactualizado (CI)
```
