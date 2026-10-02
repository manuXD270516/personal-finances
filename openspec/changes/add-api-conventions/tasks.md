# Tareas

> Requiere `bootstrap-platform-foundation` aplicado. Se coordina con `add-workspace-identity` (AuthContext + UnitOfWork con RLS). Flujo: SPEC → TEST CASE → DOMAIN → APPLICATION → INFRASTRUCTURE → API → UI → AUTOMATED TESTS → E2E → DOCUMENTATION.

## 1. Specs, contratos y test cases

- [ ] 1.1 Revisar y aprobar la delta spec `platform/api-conventions` en el PR de planificación; verificar con `openspec validate add-api-conventions --strict --no-interactive`
- [ ] 1.2 Aplicar (o confirmar que se consolidaron) los cambios de design.md § Contratos y crear `contracts/openapi/.spectral.yaml`; verificar con `redocly lint` y Spectral sin errores sobre el contrato completo
- [ ] 1.3 Confirmar en `ready` TC-PLATFORM-API-001..020 y TC-TRANSACTIONS-IDEMPOTENCY-001; verificar que la matriz no reporta requirements Must sin TC

## 2. Dominio (shared-kernel)

- [ ] 2.1 Escribir primero (TDD + property-based) los tests de `Money.parse`/`toFixed` en el borde: 1500 BOB → "1500.00", 100.000000 USDT preservado, 685.005 BOB y 100.0000001 USDT → `AMOUNT_SCALE_EXCEEDED` sin redondeo, round-trip string ↔ Decimal sin pérdida; verificar mutation score ≥ 80 % en el módulo
- [ ] 2.2 Implementar `DomainError` con `code` y `LocalDate`/`Instant` (rechazo de fecha-hora como fecha de negocio); verificar con tests unitarios nombrados TC-PLATFORM-API-017, 018 y 019

## 3. Aplicación (platform)

- [ ] 3.1 Escribir primero (TDD) los tests de la política de idempotencia con un `IdempotencyStore` en memoria: replay, payload distinto, en curso, reserva vencida, 5xx/429 liberan, 4xx se almacenan, retención; verificar que cubren TC-PLATFORM-API-007..011 y TC-TRANSACTIONS-IDEMPOTENCY-001
- [ ] 3.2 Implementar `ErrorCatalog` y la política de idempotencia; implementar el puerto `RateLimiter` con token bucket; verificar con tests unitarios

## 4. Infraestructura (platform)

- [ ] 4.1 Migración expand de `platform.idempotency_key` (índices, RLS forzada con la política de design.md §3, grants a `pf_app`/`pf_maintenance`); verificar con test de catálogo RLS y test de repositorio contra PostgreSQL real
- [ ] 4.2 Implementar `PgIdempotencyStore` (reserva en transacción corta, completar en la UoW del comando, liberar) y el job de purga; verificar con test de integración de concurrencia (dos peticiones simultáneas → un solo efecto) nombrado TC-PLATFORM-API-009
- [ ] 4.3 Implementar `CursorCodec` (HMAC, `kid`, ámbito de recurso/workspace/filtros) e `InMemoryRateLimiter`/`ValkeyRateLimiter`; verificar con tests unitarios y TC-PLATFORM-API-016

## 5. Interface / API

- [ ] 5.1 Implementar `ContractValidationPipe` (Ajv 2020-12 compilado desde el contrato) y `ProblemDetailsFilter` (incluye 404 de rutas desconocidas, 500 sin stack, 503 con `Retry-After`); verificar con TC-PLATFORM-API-001, 004 y 006
- [ ] 5.2 Implementar `IdempotencyInterceptor` dirigido por el contrato; verificar con tests de API (supertest) nombrados TC-TRANSACTIONS-IDEMPOTENCY-001 y TC-PLATFORM-API-007..010 contra un controller de prueba y, cuando exista, `POST /workspaces`
- [ ] 5.3 Implementar `ConditionalRequestInterceptor` (ETag, 304, 428, 412) y el manejo de `CONCURRENCY_CONFLICT` en repositorios; verificar con TC-PLATFORM-API-012..014
- [ ] 5.4 Implementar serialización de colecciones con `page` y cursores, y `RateLimitGuard`/`DeprecationInterceptor`; verificar con TC-PLATFORM-API-015, 016, 020 y 003
- [ ] 5.5 Agregar a CI `oasdiff breaking` contra `main` y el test de catálogo de errores (contrato ↔ `ErrorCatalog` ↔ `errors.es.json`); verificar con fixtures que fallan a propósito (TC-PLATFORM-API-002 y 005)

## 6. UI / BFF

- [ ] 6.1 En el BFF, generar `Idempotency-Key` UUIDv7 por intento del usuario y reutilizarla en reintentos técnicos; propagar `ETag`/`If-Match`; verificar con tests del cliente que un reintento de red reenvía la misma clave
- [ ] 6.2 Crear `errors.es.json` (y esqueletos `en`, `pt`) con mensajes accionables por `code`, y el componente que muestra errores por `code`; verificar con TC-PLATFORM-API-005 y lint i18n sin strings literales

## 7. E2E

- [ ] 7.1 Playwright: doble clic en "Guardar" de un formulario que crea un registro produce un único registro y la UI muestra el resultado una vez; edición concurrente en dos pestañas muestra el mensaje en español de conflicto (412); verificar en Chromium en CI

## 8. Documentación y cierre

- [ ] 8.1 Actualizar docs/10 (estado de convenciones, regla Spectral nueva, nota sobre 422 vs INV-027), docs/09 INV-027 si el owner confirma 422, docs/19 (variables `CURSOR_SIGNING_KEY`, `IDEMPOTENCY_RETENTION`, `RATE_LIMIT_STORE`) y el README de `@pf/platform`; verificar enlaces
- [ ] 8.2 Actualizar `status`/`automation_status` de los TC, regenerar la matriz de trazabilidad, ejecutar `openspec validate --all --strict --no-interactive` y archivar el change
