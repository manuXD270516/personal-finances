# Tareas

> Requiere `bootstrap-platform-foundation` aplicado. Se coordina con `add-workspace-identity` (AuthContext + UnitOfWork con RLS). Flujo: SPEC → TEST CASE → DOMAIN → APPLICATION → INFRASTRUCTURE → API → UI → AUTOMATED TESTS → E2E → DOCUMENTATION.
>
> Implementado el 2026-10-02 (rama `feat/add-api-conventions`). Decisiones de implementación en design.md § "Decisiones de implementación".

## 1. Specs, contratos y test cases

- [x] 1.1 Revisar y aprobar la delta spec `platform/api-conventions` en el PR de planificación; verificar con `openspec validate add-api-conventions --strict --no-interactive` — `pnpm spec:validate`: 15/15 válidos.
- [x] 1.2 Aplicar (o confirmar que se consolidaron) los cambios de design.md § Contratos y crear `contracts/openapi/.spectral.yaml`; verificar con `redocly lint` y Spectral sin errores sobre el contrato completo — consolidados; además `FieldError.in` y `x-deprecated-at` + función Spectral `pfos-sunset-window` (design, decisiones 4 y 11). Redocly 2.57.0: válido (3 avisos `no-unused-components` de `Deprecation`/`Sunset`/`Link`, que hoy ninguna operación referencia); Spectral 6.17.0: 0 errores.
- [x] 1.3 Confirmar en `ready` TC-PLATFORM-API-001..020 y TC-TRANSACTIONS-IDEMPOTENCY-001; verificar que la matriz no reporta requirements Must sin TC — `pnpm traceability:check` OK (286 TC, 0 advertencias); hoy los 21 TC están `automated` (8.2).

## 2. Dominio (shared-kernel)

- [x] 2.1 Escribir primero (TDD + property-based) los tests de `Money.parse`/`toFixed` en el borde: 1500 BOB → "1500.00", 100.000000 USDT preservado, 685.005 BOB y 100.0000001 USDT → `AMOUNT_SCALE_EXCEEDED` sin redondeo, round-trip string ↔ Decimal sin pérdida; verificar mutation score ≥ 80 % en el módulo — `packages/shared-kernel/src/money/money.test.ts` (fast-check); Stryker (`pnpm --filter @pf/shared-kernel test:mutation`): 88,66 % en `money/`, 84,05 % global.
- [x] 2.2 Implementar `DomainError` con `code` y `LocalDate`/`Instant` (rechazo de fecha-hora como fecha de negocio); verificar con tests unitarios nombrados TC-PLATFORM-API-017, 018 y 019 — `money.test.ts`, `time/time.test.ts`, `errors/domain-error.test.ts`.

## 3. Aplicación (platform)

- [x] 3.1 Escribir primero (TDD) los tests de la política de idempotencia con un `IdempotencyStore` en memoria: replay, payload distinto, en curso, reserva vencida, 5xx/429 liberan, 4xx se almacenan, retención; verificar que cubren TC-PLATFORM-API-007..011 y TC-TRANSACTIONS-IDEMPOTENCY-001 — `packages/platform/src/api/idempotency/policy.test.ts` (TC-007 se cubre a nivel API: el 428 lo emite la validación de contrato, no la política).
- [x] 3.2 Implementar `ErrorCatalog` y la política de idempotencia; implementar el puerto `RateLimiter` con token bucket; verificar con tests unitarios — `error-catalog.test.ts`, `policy.test.ts`, `rate-limiter.test.ts`. El adapter usa ventana deslizante exacta en vez de token bucket (design, decisión 10).

## 4. Infraestructura (platform)

- [x] 4.1 Migración expand de `platform.idempotency_key` (índices, RLS forzada con la política de design.md §3, grants a `pf_app`/`pf_maintenance`); verificar con test de catálogo RLS y test de repositorio contra PostgreSQL real — `apps/api/db/migrations/20261002130000_platform_idempotency_key.sql`; `apps/api/test/db/idempotency-key.int.test.ts` (RLS habilitada y forzada, políticas, PF002 sin contexto, aislamiento W1/W2/usuario, CHECKs).
- [x] 4.2 Implementar `PgIdempotencyStore` (reserva en transacción corta, completar en la UoW del comando, liberar) y el job de purga; verificar con test de integración de concurrencia (dos peticiones simultáneas → un solo efecto) nombrado TC-PLATFORM-API-009 — `pg-store.ts`, `PgCommandTransaction`, purga cada 15 min en el worker (`SET LOCAL ROLE pf_maintenance`); tests TC-PLATFORM-API-009 (reservas simultáneas, rollback ⇒ respuesta no guardada) y TC-PLATFORM-API-011 (purga solo de vencidas).
- [x] 4.3 Implementar `CursorCodec` (HMAC, `kid`, ámbito de recurso/workspace/filtros) e `InMemoryRateLimiter`/`ValkeyRateLimiter`; verificar con tests unitarios y TC-PLATFORM-API-016 — `cursor-codec.test.ts`, `rate-limiter.test.ts`. `ValkeyRateLimiter` NO se implementó (Should, opcional en design §8): sin cliente Valkey en el repo; `RATE_LIMIT_STORE=valkey` falla al arrancar con mensaje explícito.

## 5. Interface / API

- [x] 5.1 Implementar `ContractValidationPipe` (Ajv 2020-12 compilado desde el contrato) y `ProblemDetailsFilter` (incluye 404 de rutas desconocidas, 500 sin stack, 503 con `Retry-After`); verificar con TC-PLATFORM-API-001, 004 y 006 — como `ContractValidationInterceptor` (design, decisión 2); `apps/api/test/api/api-conventions.api.test.ts`.
- [x] 5.2 Implementar `IdempotencyInterceptor` dirigido por el contrato; verificar con tests de API (supertest) nombrados TC-TRANSACTIONS-IDEMPOTENCY-001 y TC-PLATFORM-API-007..010 contra un controller de prueba y, cuando exista, `POST /workspaces` — contra los controllers del harness (operaciones reales `createTransaction`/`createWorkspace`), con `fetch` sobre la API escuchando (mismo patrón que los tests existentes) y PostgreSQL real.
- [x] 5.3 Implementar `ConditionalRequestInterceptor` (ETag, 304, 428, 412) y el manejo de `CONCURRENCY_CONFLICT` en repositorios; verificar con TC-PLATFORM-API-012..014 — `preconditionFailed()`/`concurrencyConflict()` disponibles para los repositorios de los contextos.
- [x] 5.4 Implementar serialización de colecciones con `page` y cursores, y `RateLimitGuard`/`DeprecationInterceptor`; verificar con TC-PLATFORM-API-015, 016, 020 y 003.
- [x] 5.5 Agregar a CI `oasdiff breaking` contra `main` y el test de catálogo de errores (contrato ↔ `ErrorCatalog` ↔ `errors.es.json`); verificar con fixtures que fallan a propósito (TC-PLATFORM-API-002 y 005) — job `contract` en `.github/workflows/pr.yml` (Redocly + Spectral + `pnpm contract:breaking`); fixtures en `scripts/contract/test/oasdiff.int.test.ts` (job `integration`) y catálogo en `packages/platform/src/api/errors/error-catalog.test.ts` + `apps/web/src/errors/error-messages.test.tsx`.

## 6. UI / BFF

- [x] 6.1 En el BFF, generar `Idempotency-Key` UUIDv7 por intento del usuario y reutilizarla en reintentos técnicos; propagar `ETag`/`If-Match`; verificar con tests del cliente que un reintento de red reenvía la misma clave — `apps/web/src/bff/finance-api-client.ts` + `.test.ts`.
- [x] 6.2 Crear `errors.es.json` (y esqueletos `en`, `pt`) con mensajes accionables por `code`, y el componente que muestra errores por `code`; verificar con TC-PLATFORM-API-005 y lint i18n sin strings literales — `apps/web/messages/errors.{es,en,pt}.json` (en/pt traducidos completos, mismas claves), namespace `Errors` en next-intl, componente `ProblemMessage` sin literales. El repo no tiene regla de lint i18n de strings literales; el componente se verifica por test (renderiza solo el mensaje del catálogo).

## 7. E2E

- [ ] 7.1 Playwright: doble clic en "Guardar" de un formulario que crea un registro produce un único registro y la UI muestra el resultado una vez; edición concurrente en dos pestañas muestra el mensaje en español de conflicto (412); verificar en Chromium en CI — **diferido** a `add-workspace-identity` (primer formulario que crea registros, con sesión): hoy finance-web no tiene formularios, sesión ni proxy hacia la API, y agregar Playwright + Chromium para una página ficticia no verificaría el flujo real. Cubierto mientras tanto por TC-PLATFORM-API-009/014 a nivel API y por los tests del cliente BFF (misma clave en reintentos, `If-Match`).

## 8. Documentación y cierre

- [x] 8.1 Actualizar docs/10 (estado de convenciones, regla Spectral nueva, nota sobre 422 vs INV-027), docs/09 INV-027 si el owner confirma 422, docs/19 (variables `CURSOR_SIGNING_KEY`, `IDEMPOTENCY_RETENTION`, `RATE_LIMIT_STORE`) y el README de `@pf/platform`; verificar enlaces — docs/10 §19 (as-built), docs/09 INV-027 ya decía 422 (D1), docs/19 §6.1, `docs/config-reference.md` regenerado, READMEs de `@pf/platform`, `@pf/shared-kernel` y `@pf/api`, `.env.example`.
- [ ] 8.2 Actualizar `status`/`automation_status` de los TC, regenerar la matriz de trazabilidad, ejecutar `openspec validate --all --strict --no-interactive` y archivar el change — TC-PLATFORM-API-001..020 y TC-TRANSACTIONS-IDEMPOTENCY-001 → `automated` con `automated_tests`; `pnpm traceability:check` y `pnpm spec:validate` OK. **Pendiente:** archivar el change (lo hace el lead tras el merge; 7.1 sigue diferida).
