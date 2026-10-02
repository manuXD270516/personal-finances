# Tareas

> Requiere `bootstrap-platform-foundation` aplicado (skeleton, Compose con Keycloak/PostgreSQL, migración de bootstrap). Flujo por slice: SPEC → TEST CASE → DOMAIN → APPLICATION → INFRASTRUCTURE → API → UI → AUTOMATED TESTS → E2E → DOCUMENTATION.

## 1. Catálogo de monedas `fx.currency` (prerrequisito de `iam.workspace.base_currency`)

> Se adelanta aquí porque `iam.workspace.base_currency` referencia `fx.currency(code)` (decisión D24 de [docs/31](../../../docs/31-phase-1-consolidation-decisions.md)). Solo se crea la tabla y sus datos de referencia; el comportamiento del catálogo (escala inmutable una vez usada, monedas habilitadas por workspace, endpoints) sigue especificado en `fx/market-rates` (`add-manual-conversions`), que reutiliza esta migración en lugar de crearla.

- [x] 1.1 Escribir primero (TDD) el test de integración de la migración contra PostgreSQL con Testcontainers: tras `migrate`, `fx.currency` contiene exactamente los datos de referencia BOB (`FIAT`, escala 2), USD (`FIAT`, 2), USDT (`CRYPTO`, 6), BTC (`CRYPTO`, 8) y ETH (`CRYPTO`, 18); verificar que falla sin la migración
- [x] 1.2 Migración expand: `CREATE SCHEMA fx` y tabla global `fx.currency` (`code` PK, `name`, `symbol`, `kind`, `scale`, columnas según docs/08 §5.10) con seed idempotente (`ON CONFLICT DO NOTHING`) de BOB 2, USD 2, USDT 6, BTC 8 y ETH 18; solo `SELECT` para `pf_app`/`pf_worker` y `fx.currency` en la allowlist del chequeo de catálogo RLS; verificar que `migrate` es idempotente (segunda ejecución sin cambios)
- [x] 1.3 Verificar que `iam.workspace.base_currency` (y la moneda de la reserva mínima de liquidez) referencia `fx.currency(code)` mediante FK: crear un workspace con moneda base `BOB` se acepta y con un código inexistente falla; verificar con un test de repositorio contra PostgreSQL real

## 2. Specs, contratos y test cases

- [x] 2.1 Revisar y aprobar las tres delta specs en el PR de planificación; verificar con `openspec validate add-workspace-identity --strict --no-interactive`
- [x] 2.2 Aplicar en `contracts/openapi/finance-api.v1.yaml` y `contracts/events/identity/` los cambios de design.md § Contratos (o confirmar que el proceso de consolidación los aplicó); verificar con Redocly/Spectral lint, oasdiff y meta-validación de los JSON Schema con sus `examples`
- [x] 2.3 Confirmar los TC en `ready` (TC-IDENTITY-AUTH-001..008, TC-IDENTITY-SESSION-001..002, TC-IDENTITY-WORKSPACE-001..008, TC-IDENTITY-MEMBERSHIP-001, TC-SECURITY-RBAC-001..003, TC-SECURITY-RLS-001..005, TC-SECURITY-ISOLATION-001); verificar que el chequeo de catálogo de trazabilidad no reporta requirements Must sin TC

## 3. Aislamiento en base de datos (security/access-control)

- [x] 3.1 Escribir primero (TDD) los tests de BD TC-SECURITY-RLS-001, RLS-002, RLS-003, RLS-004 y RLS-005 contra PostgreSQL con Testcontainers; verificar que fallan sin la migración
- [x] 3.2 Migración expand: funciones `platform.current_workspace_id()`/`platform.current_user_id()`, roles `pf_bff` y `pf_maintenance`, grants mínimos; verificar que `migrate` es idempotente
- [x] 3.3 Implementar en `@pf/platform` el `UnitOfWork.run(ctx, fn)` con `set_config(..., true)` y la regla de lint contra `SET app.` sin `LOCAL`; verificar con TC-SECURITY-RLS-002 y RLS-003 en verde
- [x] 3.4 Implementar el chequeo de catálogo RLS (allowlist explícita) como test de arquitectura en CI; verificar con un fixture de tabla sin política que hace fallar el gate (TC-SECURITY-RLS-004)

## 4. Dominio IDENTITY

- [ ] 4.1 Escribir primero (TDD) tests de dominio de `Workspace` (≥ 1 OWNER, una membresía por usuario, `fiscalMonthStartDay` 1..28, reserva mínima ≥ 0 con escala de su moneda: 1500.00 BOB válido, 1500.005 BOB → `AMOUNT_SCALE_EXCEEDED`) y de `User`/`TimeZoneId` (IANA válido/ inválido); verificar cobertura de dominio ≥ 90 %
  > Pendiente (2026-10-02): tests de dominio escritos y en verde (`src/domain/workspace.test.ts`), pero la cobertura ≥ 90 % no se midió: `@vitest/coverage-v8` no está en el catálogo del monorepo.
- [x] 4.2 Implementar AR `User`, AR `Workspace`, entidad `Membership`, VOs `WorkspaceSettings`, `TimeZoneId`, `LocaleTag`, `Role` y `roleGrants`; verificar que dependency-cruiser no reporta imports de framework en `domain`
- [x] 4.3 Implementar la regla "cambiar moneda base no toca historia" como ausencia de dependencia hacia Ledger/Transactions en `UpdateWorkspaceSettings`; verificar con test de arquitectura

## 5. Aplicación IDENTITY

- [x] 5.1 Implementar `ProvisionUserFromIdentity` (usuario + workspace personal idempotente, outbox `identity.WorkspaceCreated.v1`, `AuditPort`) con fakes de puertos; verificar con tests de aplicación nombrados TC-IDENTITY-AUTH-007, TC-IDENTITY-WORKSPACE-001 y TC-IDENTITY-WORKSPACE-002
- [x] 5.2 Implementar `GetMe`, `UpdateMyPreferences`, `ListMyWorkspaces`, `CreateWorkspace`, `GetWorkspace`, `UpdateWorkspaceSettings` (outbox `identity.WorkspaceSettingsChanged.v1`) y `AuthorizeAction`; verificar con tests de aplicación (TC-IDENTITY-AUTH-006, AUTH-008, WORKSPACE-003..007, TC-SECURITY-RBAC-001, RBAC-003)

## 6. Infraestructura IDENTITY

- [x] 6.1 Migración expand del schema `iam` (`user`, `workspace`, `workspace_membership`, `bff_session`, índices únicos, constraint trigger de OWNER, políticas RLS, función `iam.provision_user`); verificar con tests de repositorio contra PostgreSQL real, incluido el índice único de workspace personal bajo carrera
- [x] 6.2 Implementar repositorios Kysely y el adapter `CurrencyCatalogPort`; verificar con tests de integración (montos de la reserva como string, sin `number`)
  > Hecho (2026-10-02): `kysely` 0.29.6 en el catálogo; repositorios y `PgCurrencyCatalog` con Kysely sobre la conexión de la `PgUnitOfWork` (`unitOfWorkKysely()` de `@pf/platform/api`: mismo client y transacción, contexto RLS con `set_config(..., true)`; Kysely no abre transacciones). Tipos de tabla escritos a mano (`IdentityDb`, NUMERIC → string); `kysely-codegen` con override NUMERIC→string queda para cuando haya más contextos.
- [ ] 6.3 Escribir los productores de `identity.WorkspaceCreated.v1` y `identity.WorkspaceSettingsChanged.v1`; verificar con tests de contrato de eventos (Ajv strict) contra `contracts/events/identity/`
  > Parcial (2026-10-02): los payloads producidos por `IdentityService` se validan con Ajv strict contra `contracts/events/identity/` (`src/application/events.contract.test.ts`). Falta el adapter PostgreSQL del outbox (`platform.outbox` aún no existe) y validar el sobre completo.

## 7. API (`finance-api`)

- [ ] 7.1 Implementar `JwtAuthGuard` con `jose` (allowlist de alg, `iss`, `aud`, `azp`, scope, skew 30 s, `typ`, caché JWKS 10 min, refetch limitado, fallback 24 h, perfil por IdP); verificar con TC-IDENTITY-AUTH-001 usando un emisor JWKS local de prueba
  > Parcial (2026-10-02): `JwtVerifier` en `@pf/platform/api` (allowlist RS256/PS256/ES256, `iss`, `aud`, `exp`/`nbf` con skew configurable, `typ` Bearer/at+jwt, `azp` opcional, scope requerido, JWKS remoto cacheado 10 min con cooldown de refetch 30 s) configurado por `OIDC_ISSUER_URL`/`OIDC_JWKS_URI`/`OIDC_API_AUDIENCE`/`OIDC_REQUIRED_SCOPE`/`OIDC_CLOCK_SKEW_SECONDS` (contrato de config + docs/config-reference.md). TC-IDENTITY-AUTH-001 automatizado (unit con JWKS local + API). Falta: fallback de JWKS "último conocido" 24 h, perfil por IdP y `azp` desde configuración.
- [ ] 7.2 Implementar `WorkspaceMembershipGuard` y `RoleGuard` dirigidos por `x-required-role` del contrato, y el test que compara contrato y decoradores; verificar con TC-IDENTITY-MEMBERSHIP-001, TC-SECURITY-RBAC-001 y TC-SECURITY-ISOLATION-001
  > Parcial (2026-10-02): un único `IdentityAccessGuard` global (autenticación → provisión idempotente → membresía/rol) lee `x-required-role` directamente de la operación del contrato (`ContractOperation.requiredRole`), así que no hay decoradores que comparar. 403 `WORKSPACE_ACCESS_DENIED` / 403 `INSUFFICIENT_ROLE` (D2). Automatizados TC-IDENTITY-MEMBERSHIP-001 (variante PATCH /workspaces/{W1}) y TC-SECURITY-RBAC-003. RBAC-001 e ISOLATION-001 esperan a cuentas/transacciones. Nota: la provisión corre en cada request autenticado (una transacción corta); cachearla es una optimización pendiente.
- [ ] 7.3 Implementar controllers `/me` y `/workspaces` con validación contra el contrato; verificar con tests de API + contrato (TC-IDENTITY-AUTH-006, AUTH-008, WORKSPACE-003..007)
  > Parcial (2026-10-02): `IdentityModule` (`@pf/identity/interface/identity.module`) con GET/PATCH `/me`, GET/POST `/workspaces`, GET/PATCH `/workspaces/{workspaceId}`; validación de contrato, Problem Details, ETag/`If-Match`/`If-None-Match` e idempotencia de `POST /workspaces` vienen de las convenciones globales. Se monta solo si `OIDC_ISSUER_URL` está definido. Automatizados AUTH-006, AUTH-008, WORKSPACE-005, 006 y 007 (`apps/api/test/api/identity.api.test.ts`). Pendiente: WORKSPACE-003 (lee `platform.outbox`, que no existe; el outbox/auditoría se registran por log hasta 6.3/add-audit-trail), WORKSPACE-004 (necesita Ledger/FX), `PATCH /me` de `displayName`/`preferences` (el caso de uso solo cubre locale/zona), paginación real de `GET /workspaces` (hoy una página completa, `hasMore: false`) y validación de respuestas contra el schema.
- [ ] 7.4 Implementar la matriz de autorización parametrizada (OWNER, EDITOR, VIEWER, no miembro, anónimo × todas las operaciones del contrato); verificar con TC-SECURITY-RBAC-002 y dejarla en la Financial Regression Suite
  > Pendiente (2026-10-02): sin iniciar por presupuesto.

## 8. BFF y UI (`finance-web`)

- [ ] 8.1 Implementar login/callback/logout con `openid-client`, `SessionStore` sobre `iam.bff_session` (rol `pf_bff`, tokens AES-256-GCM, `sid` hasheado) y expiración idle/absoluta; verificar con tests de integración del BFF (TC-IDENTITY-AUTH-002, AUTH-004, AUTH-005)
- [ ] 8.2 Implementar refresh single-flight con `pg_advisory_xact_lock` + dedupe en proceso; verificar con TC-IDENTITY-SESSION-001 (5 peticiones concurrentes → 1 refresh)
- [ ] 8.3 Implementar middleware CSRF (synchronizer token + `Origin`/`Sec-Fetch-Site`) y proxy autenticado `/api/bff/v1/*`; verificar con TC-IDENTITY-SESSION-002
- [ ] 8.4 Implementar selector de workspace activo, pantalla de configuración del workspace, preferencias personales y pantallas de error/sesión expirada con textos en el catálogo i18n español; verificar con tests de componentes y TC-IDENTITY-WORKSPACE-008
- [ ] 8.5 Actualizar el realm de desarrollo de Keycloak (client confidencial del BFF, audience `finance-api`, scope `pfos.api`, `refreshTokenMaxReuse=0`, access token 5 min) y los usuarios del Minimal Seed (`owner`, `editor`, `viewer`, `outsider`); verificar que `pnpm db:seed -- --profile=minimal` deja W1/W2 con las membresías de docs/29

## 9. E2E

- [ ] 9.1 Playwright: login, `/me`, ausencia de tokens en `document.cookie`/`localStorage`/`sessionStorage`/HTML (TC-IDENTITY-AUTH-002, AUTH-003), logout y reuso de cookie (AUTH-004); verificar en Chromium en CI
- [ ] 9.2 Playwright: primer login de un usuario nuevo crea su workspace personal (TC-IDENTITY-WORKSPACE-001) y navegación manipulando URLs hacia W2 como `outsider`/miembro de W1 (TC-IDENTITY-MEMBERSHIP-001, TC-SECURITY-ISOLATION-001); verificar en CI

## 10. Documentación y cierre

- [ ] 10.1 Actualizar docs/12 (store de sesiones en PostgreSQL, rol `pf_bff`, código `CSRF_REJECTED`), docs/08 §5.1 (`iam.bff_session`, columnas nuevas de `iam.user`/`iam.workspace`), docs/10 §9.1 (`INVALID_TIMEZONE`), docs/19 (variables `SESSION_*`, `BFF_SESSION_ENC_KEY`, `OIDC_*`) y el README de `@pf/identity`; verificar enlaces
- [ ] 10.2 Actualizar `status`/`automation_status` de los TC, regenerar la matriz de trazabilidad, ejecutar `openspec validate --all --strict --no-interactive` y archivar el change
