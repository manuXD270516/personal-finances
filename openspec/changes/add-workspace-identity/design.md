# Diseño

## Contexto

Primer change de negocio de Phase 1. Materializa ADR-0010 (aceptado con enmienda del 2026-10-02), ADR-0019 (Next.js como UI + BFF), ADR-0023 (RLS) y las secciones §3–§5 de `docs/12-security.md`, §3 y §14 de `docs/10-api-design.md` y §5.1 de `docs/08-data-model.md`. SPIKE-06 validó el flujo (Keycloak 26.8 + Next.js 16 BFF con `openid-client` 6 + Nest con `jose` 6) y dejó gaps que este change cierra: RLS cross-workspace, provisión JIT de `iam.user`, scope `pfos.api`, fallback de JWKS de 24 h. Motivación: ver proposal.md — Por qué. Depende de `bootstrap-platform-foundation` (skeleton, Compose con Keycloak, migraciones dbmate, roles base).

## Objetivos / No objetivos

**Objetivos:**
- Cadena completa navegador → BFF → `finance-api` → PostgreSQL autenticada, autorizada y aislada por workspace.
- Contexto IDENTITY con su modelo (`User`, `Workspace`, `Membership`), casos de uso y endpoints `/me` y `/workspaces`.
- Mecanismo transversal reutilizable por todos los contextos: `AuthContext` por request, guard de membresía/rol dirigido por el contrato y Unit of Work con contexto RLS.
- Suite de aislamiento (catálogo RLS, roles, pool intercalado, cross-workspace) que los changes siguientes extienden.

**No objetivos:**
- Invitaciones y gestión de miembros (Phase 11), MFA exigible (Phase 9), re-auth reciente (Phase 2), IdP cloud (ADR-0013).
- Rate limiting (lo especifica `add-api-conventions`), registro de auditoría (lo especifica `add-audit-trail`).

## Decisiones

### 1. Capas y componentes afectados

| Capa | Componente | Cambio |
|------|-----------|--------|
| domain (`@pf/identity`) | AR `User` (`id`, `idpIssuer`, `idpSubject`, `email`, `displayName`, `locale`, `timeZone`, `status`, `version`) | Nuevo. VO `Email`, `TimeZoneId` (valida IANA con `Intl.supportedValuesOf('timeZone')` + alias canónicos), `LocaleTag` |
| domain | AR `Workspace` (`id`, `name`, `settings: WorkspaceSettings`, `memberships: Membership[]`, `personalOfUserId?`, `status`, `version`) | Nuevo. VO `WorkspaceSettings` (`baseCurrency`, `timeZone`, `locale`, `fiscalMonthStartDay` 1..28, `minimumLiquidityReserve: Money \| null`), entidad `Membership` (`userId`, `role`, `status`). Invariantes: ≥ 1 OWNER activo; una membresía por usuario; reserva ≥ 0 y con escala de su moneda (`Money` del shared-kernel) |
| domain | `Role` (`OWNER`, `EDITOR`, `VIEWER`) y `Permission` (`finance:read`, `finance:write`, `period:reopen`, `import:revert`, `connection:manage`, `audit:read`, `workspace:admin`) | Tabla de permisos de docs/12 §4 como función pura `roleGrants(role, permission)` |
| application | `ProvisionUserFromIdentity` (crea/actualiza `User` y, si no tiene membresías, el workspace personal), `GetMe`, `UpdateMyPreferences`, `ListMyWorkspaces`, `CreateWorkspace`, `GetWorkspace`, `UpdateWorkspaceSettings`, `AuthorizeAction(userId, workspaceId, permission)` | Nuevos. Puertos: `UserRepository`, `WorkspaceRepository`, `MembershipReader`, `CurrencyCatalogPort` (consulta `fx.currency` vía contrato de FX; mientras FX no exista, adapter de solo lectura sobre el catálogo sembrado), `OutboxPort`, `AuditPort`, `Clock`, `IdGenerator` |
| infrastructure | Repositorios Kysely sobre `iam.*`; adapter `CurrencyCatalogPort` | Nuevos |
| interface (`apps/api`) | `JwtAuthGuard` (verificador `jose`), `WorkspaceMembershipGuard` + `RoleGuard` dirigidos por `x-required-role` del contrato, controllers `/me`, `/workspaces` | Nuevos |
| `@pf/platform` | `AuthContext` (userId, workspaceId, role, correlationId) por request; `UnitOfWork.run(ctx, fn)` que abre transacción y ejecuta `set_config('app.workspace_id', $1, true)` y `set_config('app.user_id', $2, true)` | Nuevo; único punto autorizado para fijar contexto (lint contra `SET app.` sin `LOCAL`) |
| `apps/web` (BFF) | Rutas `/api/bff/auth/login`, `/callback`, `/logout`, `/session`; proxy autenticado `/api/bff/v1/*` → `finance-api`; `SessionStore` sobre PostgreSQL; middleware CSRF; selector de workspace activo | Nuevos |

### 2. Autenticación en el BFF (ADR-0010 + enmienda)

- `openid-client` 6 directo (Auth.js descartado). Cliente confidencial + PKCE S256; `state`, `nonce`, `code_verifier` y `returnTo` guardados server-side como registro *pre-sesión* de un solo uso (TTL 10 min) en `iam.bff_session` con `kind = 'PENDING_LOGIN'`.
- Cookie `__Host-pfos_sid` (256 bits aleatorios, `HttpOnly`, `Secure`, `SameSite=Lax`, `Path=/`, sin `Domain`); en BD se guarda `sha256(sid)`, nunca el valor. Rotación del `sid` al completar login.
- Tokens cifrados AES-256-GCM (clave `BFF_SESSION_ENC_KEY` por entorno; en cloud desde secrets manager); `csrf_secret` por sesión.
- **CSRF:** synchronizer token `X-CSRF-Token = HMAC(csrf_secret, sid)` obligatorio en métodos no seguros + verificación de `Origin`/`Sec-Fetch-Site`; rechazo `403 application/problem+json` con `code: CSRF_REJECTED` (código propio del BFF, no del contrato de `finance-api`). Solo `application/json`.
- **Refresh single-flight:** si al proxyar el access token expira en < 60 s, el BFF abre una transacción y toma `pg_advisory_xact_lock(hashtextextended(session_id::text, 0))`; relee la sesión (otra petición pudo haber renovado ya), y solo si sigue por expirar llama al token endpoint; persiste los tokens nuevos y libera. Además, deduplicación en memoria por `session_id` dentro del proceso (promesa compartida) para no abrir N transacciones. Rechazo del IdP (`invalid_grant`) ⇒ borrar sesión y 401.
- **Expiración:** `idle_expires_at = last_seen_at + SESSION_IDLE_TIMEOUT` (default 30 min, se desliza como máximo una vez por minuto para no escribir en cada request) y `absolute_expires_at = created_at + SESSION_ABSOLUTE_TIMEOUT` (default 12 h). Access token del IdP ≤ 5 min.
- **Logout:** borrar fila, revocar refresh token (`revocation_endpoint`), RP-initiated logout (`end_session_endpoint`) con `id_token_hint`; la API rechaza id tokens (`typ`).
- Purga de sesiones expiradas: job del worker cada 15 min con `pf_maintenance` (DELETE sobre `iam.bff_session` permitido por ser tabla técnica no financiera).

### 3. Validación de JWT en `finance-api` (docs/12 §3.1)

- `jose` con `createRemoteJWKSet` envuelto: caché 10 min, refetch ante `kid` desconocido con límite 1/min, fallback a claves cacheadas hasta 24 h si el JWKS no responde (gap de SPIKE-06; `jose` no lo trae).
- Allowlist `RS256`/`ES256`; `iss` exacto; `aud` contiene `finance-api`; `azp` = client id del BFF; `exp`/`nbf`/`iat` con skew 30 s (dentro del límite de 60 s de NFR-SEC-002); scope `pfos.api`; `typ` ≠ `ID`.
- Verificador parametrizable por IdP (`OIDC_PROFILE=keycloak|cognito`): en Cognito se valida `client_id` + scope del resource server y `token_use=access` en lugar de `aud`/`azp`.
- Fallo ⇒ `401 UNAUTHENTICATED` con `WWW-Authenticate: Bearer` sin `error_description` detallado.

### 4. Provisión JIT y workspace personal

- `ProvisionUserFromIdentity` se ejecuta en el primer request autenticado de una identidad (en la práctica, el `GET /me` que el BFF hace tras el callback). Requiere `email_verified = true`.
- Alta del usuario vía función `iam.provision_user(iss, sub, email, display_name)` `SECURITY DEFINER` acotada (docs/08 §5.1): `INSERT … ON CONFLICT (idp_issuer, idp_subject) DO UPDATE SET email, display_name, last_login_at` → idempotente bajo concurrencia.
- Workspace personal en la **misma transacción**: `pg_advisory_xact_lock` por `user_id`; si el usuario no tiene membresías activas se crea `iam.workspace` con `personal_of_user_id = user_id` (índice único parcial ⇒ como máximo uno aun ante carreras), la membresía OWNER, el evento `identity.WorkspaceCreated.v1` en outbox y la entrada de auditoría vía `AuditPort`.
- Defaults desde configuración (`DEFAULT_BASE_CURRENCY=BOB`, `DEFAULT_TIMEZONE=America/La_Paz`, `DEFAULT_LOCALE=es-BO`), nunca hardcodeados en dominio.
- Las categorías de sistema las siembra Classification al consumir `identity.WorkspaceCreated.v1` (docs/05 §2.5); las cuentas de sistema del ledger se crean bajo demanda (FR-LEDGER-004). Ninguna se crea síncronamente aquí.

### 5. Autorización

- Pipeline por request (docs/10 §3): JWT → `userId` → membresía activa en `{workspaceId}` (consulta por request, sin caché entre requests, para que una revocación tenga efecto inmediato) → rol ≥ `x-required-role` de la operación → `UnitOfWork` con contexto RLS.
- No miembro ⇒ `403 WORKSPACE_ACCESS_DENIED`; rol insuficiente ⇒ `403 INSUFFICIENT_ROLE`; reglas dependientes de estado (p. ej. último OWNER) en políticas de `application`.
- El guard lee el rol mínimo de un mapa generado desde el contrato (`operationId → x-required-role`); un test compara el mapa con los decoradores de los controllers y otro ejecuta la matriz (TC-SECURITY-RBAC-002) con los roles del Minimal Seed (OWNER, EDITOR, VIEWER, no miembro, anónimo).

### 6. Modelo de datos (schema `iam`, expand)

| Tabla | Cambio | RLS |
|-------|--------|-----|
| `iam.user` | Según docs/08 §5.1 + columna `time_zone text NULL` (preferencia personal; FR-IDENTITY-003) | USR: `id = platform.current_user_id()`; alta solo vía `iam.provision_user` |
| `iam.workspace` | Según docs/08 §5.1 + `personal_of_user_id uuid NULL` (único parcial `WHERE personal_of_user_id IS NOT NULL`), `min_liquidity_reserve_amount NUMERIC(38,18) NULL`, `min_liquidity_reserve_currency text NULL REFERENCES fx.currency(code)` con `CHECK` de ambos nulos o ambos presentes y monto ≥ 0 | USR/WS: `SELECT` con membresía activa de `app.user_id`; `UPDATE` si `id = platform.current_workspace_id()` |
| `iam.workspace_membership` | Según docs/08 §5.1; constraint trigger diferido "≥ 1 OWNER activo" | USR: `user_id = app.user_id OR workspace_id = current_workspace_id()` |
| `iam.bff_session` (nueva) | `id uuid PK`, `sid_hash bytea UNIQUE`, `kind text CHECK IN ('PENDING_LOGIN','ACTIVE')`, `user_id uuid NULL`, `tokens_enc bytea`, `csrf_secret_enc bytea`, `login_state_enc bytea`, `active_workspace_id uuid NULL`, `created_at`, `last_seen_at`, `idle_expires_at`, `absolute_expires_at timestamptz`, `version int` | Sin RLS por workspace (tabla técnica por usuario, en la allowlist del chequeo de catálogo); solo el rol `pf_bff` tiene `SELECT/INSERT/UPDATE/DELETE`; `pf_app` sin grants |

- Funciones: `platform.current_workspace_id()` en plpgsql: si `app.workspace_id` no está fijado o está vacío lanza `SQLSTATE PF002` (*workspace context not set*), si no devuelve el uuid; `platform.current_user_id()` análoga. Sin contexto ⇒ **la consulta falla** (fail-closed ruidoso, ADR-0023, docs/08 §1.4, validado en SPIKE-02); la infraestructura mapea PF002 a error interno + métrica, nunca a 0 filas. Toda tabla de negocio: `ENABLE` + `FORCE ROW LEVEL SECURITY`, políticas `USING`/`WITH CHECK` con esas funciones.
- Roles (expand de la migración de bootstrap): `pf_app` y `pf_worker` `NOBYPASSRLS`, sin ownership ni DDL; `pf_migrator` dueño; **`pf_bff` (nuevo)** `NOBYPASSRLS` con grants solo sobre `iam.bff_session`; `pf_maintenance` para purga de sesiones.
- Chequeo de catálogo en CI (TC-SECURITY-RLS-004): toda tabla con columna `workspace_id` en schemas de negocio tiene `relrowsecurity` y `relforcerowsecurity` y ≥ 1 política; allowlist explícita (`iam.user`, `iam.bff_session`, `fx.currency`, `platform.inbox`).
- Migración solo expand; no destructiva. Rollback = revertir la versión de la app; las tablas nuevas vacías pueden quedar.

### 7. Eventos

| Evento | Cuándo | Payload | Idempotencia |
|--------|--------|---------|--------------|
| `identity.WorkspaceCreated.v1` | Creación de workspace (personal o adicional) | `workspaceId`, `name`, `baseCurrency`, `timeZone`, `locale`, `fiscalMonthStartDay`, `ownerUserId`, `origin` (`PERSONAL_DEFAULT` \| `USER_CREATED`) | Escrito en `platform.outbox` en la misma transacción; `eventId` UUIDv7; `aggregateType = Workspace`, `aggregateVersion = 1`. El índice único de workspace personal impide un segundo evento por carrera. Consumidores (Classification) deduplican por `platform.inbox (consumer, event_id)` y por unicidad natural de las categorías de sistema |
| `identity.WorkspaceSettingsChanged.v1` | `UpdateWorkspaceSettings` exitoso con cambios | `workspaceId`, `changes[]` (`field`, `before`, `after`; montos como `Money` string), `aggregateVersion` | Un evento por versión del agregado; consumidores (Reporting, para moneda base) usan `(aggregateId, aggregateVersion)` como clave idempotente |

No se consumen eventos.

### 8. Auditoría

Crear workspace, cambiar configuración y la provisión llaman a `AuditPort` en la misma transacción (FR-AUDIT-001/005). El contenido y la consulta del audit log los especifica `add-audit-trail`; mientras ese change no esté aplicado, `AuditPort` tiene un adapter que falla la prueba de arquitectura si un command handler mutante no lo invoca.

### 9. Frontend

- Pantalla de error de login y de sesión expirada en español (catálogo i18n, NFR-USAB-001/009).
- Selector de workspace activo en el layout; la elección se guarda en `iam.bff_session.active_workspace_id` y el cliente construye las rutas `/api/bff/v1/workspaces/{id}/…`. El servidor de `finance-api` nunca infiere workspace.
- Formulario de configuración del workspace (OWNER) y de preferencias personales; montos de la reserva con el input de montos tolerante (NFR-USAB-003).

## Contratos

Cambios requeridos en `contracts/openapi/finance-api.v1.yaml` (no se editan aquí; los consolida otro proceso):

1. `components.schemas.Me`: agregar `timezone` (`string`, IANA, ejemplo `America/La_Paz`) a `properties` y a `required`.
2. `components.schemas.MeUpdate`: agregar `timezone` (`string`, `maxLength: 64`).
3. `paths./me.patch` (`updateMe`): agregar respuesta `'422': { $ref: '#/components/responses/UnprocessableEntity' }` (para `INVALID_TIMEZONE`).
4. `components.schemas.Workspace`: agregar `fiscalMonthStartDay` (`integer`, `minimum: 1`, `maximum: 28`) a `properties` y `required`, y `minimumLiquidityReserve` (`oneOf: [{ $ref: Money }, { type: 'null' }]`).
5. `components.schemas.WorkspaceCreate`: agregar `fiscalMonthStartDay` (`integer`, 1..28, `default: 1`).
6. `components.schemas.WorkspaceUpdate`: agregar `fiscalMonthStartDay` (`integer`, 1..28) y `minimumLiquidityReserve` (`oneOf: [{ $ref: Money }, { type: 'null' }]`; el servidor valida monto ≥ 0 y escala).
7. `paths./workspaces.post` (`createWorkspace`): corregir `summary` a "Create a workspace (caller becomes OWNER)"; las categorías de sistema se siembran de forma asíncrona vía `identity.WorkspaceCreated.v1` y las cuentas de sistema del ledger se crean bajo demanda.
8. `paths./workspaces/{workspaceId}.get` (`getWorkspace`): agregar `'304': { $ref: '#/components/responses/NotModified' }` y el parámetro `IfNoneMatch`.
9. `components.responses.Forbidden`: sin cambios de forma; su descripción ya cubre `WORKSPACE_ACCESS_DENIED` e `INSUFFICIENT_ROLE`.
10. `components.schemas.ErrorCode`: agregar `INVALID_TIMEZONE` (HTTP 422; también en el catálogo de docs/10 §9.1, contexto identity).

Cambios requeridos en `contracts/events/`:

1. Nuevo `contracts/events/identity/WorkspaceCreated.v1.schema.json` (`eventType: identity.WorkspaceCreated`, `eventVersion: 1`, `aggregateType: Workspace`; payload: `workspaceId` Uuid, `name` string, `baseCurrency` CurrencyCode, `timeZone` string, `locale` string, `fiscalMonthStartDay` integer 1..28, `ownerUserId` Uuid, `origin` enum `PERSONAL_DEFAULT|USER_CREATED`; todos `required`, `additionalProperties: false`, con `examples`).
2. Nuevo `contracts/events/identity/WorkspaceSettingsChanged.v1.schema.json` (`eventType: identity.WorkspaceSettingsChanged`, `eventVersion: 1`, `aggregateType: Workspace`; payload: `workspaceId` Uuid, `changes` array de `{field: enum [name, baseCurrency, timeZone, locale, fiscalMonthStartDay, minimumLiquidityReserve], before, after}` con valores string/integer/Money/null).
3. `contracts/events/README.md`: agregar el directorio `identity/` a la estructura y las filas `identity.WorkspaceCreated.v1` (productor IDENTITY; consumidores CLASSIFICATION, REPORTING) e `identity.WorkspaceSettingsChanged.v1` (productor IDENTITY; consumidor REPORTING) a la tabla de eventos Phase 1.

Las rutas del BFF (`/api/bff/auth/*`, `/api/bff/v1/*`) y el código `CSRF_REJECTED` son internos de `finance-web` y no se agregan al contrato de `finance-api` (sí al catálogo i18n de errores de la UI).

> Consolidado en contracts/ el 2026-10-02.

## Dependencias con otros changes de Phase 1

- **Requiere:** `bootstrap-platform-foundation` (skeleton, Compose con Keycloak y PostgreSQL, migración de bootstrap con `pf_app`/`pf_migrator`).
- **Coordina con `add-api-conventions`:** `createWorkspace` usa `Idempotency-Key`; `updateMe`/`updateWorkspace` usan `ETag`/`If-Match`; errores RFC 9457 y paginación por cursor de `listWorkspaces`. Pueden implementarse en paralelo; el middleware de idempotencia/ETag de `@pf/platform` se reutiliza aquí.
- **Coordina con `add-audit-trail`:** `AuditPort` (definido allí) se invoca desde los comandos de este change.
- **Habilita:** todos los demás changes (accounts, ledger, classification, transactions, conversions, dashboard), que heredan el guard, el `UnitOfWork` con RLS y deben agregar sus tablas al chequeo de catálogo y sus operaciones a la matriz.
- **Consumido por `add-classification`:** `identity.WorkspaceCreated.v1` para sembrar categorías de sistema. **Consultado por `add-manual-conversions`/FX:** catálogo `fx.currency` para validar la moneda base (FK `iam.workspace.base_currency → fx.currency`; si FX aún no aplicó su migración, el bootstrap del catálogo de monedas debe ejecutarse antes).

## Riesgos / Trade-offs

- [Reuso de refresh rotado mata la sesión en Keycloak] → lock por sesión en PostgreSQL + dedupe en proceso; test de concurrencia (TC-IDENTITY-SESSION-001).
- [El access token sigue válido tras logout hasta `exp`] → vida ≤ 5 min; la API no tiene lista de revocación (aceptado en ADR-0010).
- [BFF con acceso a BD] → rol `pf_bff` con grants solo sobre `iam.bff_session`; credencial separada; sin acceso a tablas de negocio.
- [Escritura por request para deslizar la inactividad] → actualización de `last_seen_at` como máximo 1/min.
- [403 revela que el workspace existe] → aceptado (ADR-0010, docs/12 §17.8): IDs UUIDv7 no adivinables; recursos de otro workspace bajo la ruta propia siguen dando 404.
- [Un olvido de contexto rompe una consulta en producción] → es el comportamiento buscado: el error PF002 es inmediato y visible (alerta), preferible a un "0 filas" que se confunde con un workspace vacío; test explícito por tabla.
- [Overhead de RLS] → políticas simples con funciones `STABLE` e índices con `workspace_id` primero (medido en SPIKE-02).

## Plan de migración

Greenfield: migraciones expand (schema `iam`, funciones de contexto, roles `pf_bff`/`pf_maintenance`, grants). Realm de desarrollo de Keycloak actualizado con el client del BFF (audience `finance-api`, scope `pfos.api`) y los usuarios del Minimal Seed. Rollback = revertir la app; las tablas quedan vacías e inofensivas.

## Preguntas abiertas

- Ninguna bloqueante. Pendiente de ADR-0013: IdP cloud (Keycloak gestionado vs Cognito); el verificador ya es parametrizable.
- Resuelto por el lead (2026-10-02): prevalece ADR-0023 — sin contexto la consulta falla con PF002. docs/12 §5 se alinea.

## Decisiones de implementación

Registradas durante la implementación autónoma del 2026-10-02 (owner ausente; decididas con ADR-0023, docs/08 §1.4/§5.1, docs/31 D2/D19/D23/D24).

1. **`platform.current_workspace_id()` / `current_user_id()` no se redefinen.** La migración de `add-api-conventions` ya las creó con el comportamiento de D19 (sin contexto ⇒ `RAISE … ERRCODE 'PF002'`); TC-SECURITY-RLS-002 lo verifica. Se agrega `platform.current_workspace_id_if_set()` (devuelve NULL sin contexto) **solo** para las políticas USR de `iam` que además exigen `current_user_id()` (que sí falla con PF002); las tablas WS usan siempre la variante que falla.
2. **Alta de workspaces bajo RLS:** crear un workspace (personal o adicional) se ejecuta con `app.workspace_id` = id del workspace nuevo; así `INSERT` de `iam.workspace`/`iam.workspace_membership` usa el `WITH CHECK id/workspace_id = current_workspace_id()` estándar. El INSERT de `iam.workspace` no usa `RETURNING` (la política SELECT exige la membresía, que se inserta después).
3. **Visibilidad de `iam.workspace` con contexto:** la política SELECT exige membresía activa del usuario y, si hay workspace en contexto, además `id = current_workspace_id()`. Corrige la tensión entre el diseño ("SELECT con membresía") y TC-SECURITY-RLS-001 ("con contexto W1 solo se ven filas de W1" para un usuario miembro de W1 y W2). Sin contexto de workspace (`/me`, `listWorkspaces`) se ven todas las del usuario.
4. **`iam.user` con RLS habilitada pero no forzada:** el alta va por `iam.provision_user` (`SECURITY DEFINER`, `search_path` fijo), que necesita atravesar RLS como owner; `pf_app` no tiene `INSERT`/`DELETE` y solo `UPDATE` de columnas de preferencias. Es tabla allowlistada del chequeo de catálogo.
5. **Invariante "≥ 1 OWNER activo" en BD:** constraint triggers diferidos sobre `iam.workspace` (INSERT) y `iam.workspace_membership` (INSERT/UPDATE), con el rol invocador (con FORCE RLS el owner no ve filas). La transacción que modifica membresías siempre tiene el workspace en contexto.
6. **Roles:** `pf_worker` se crea como miembro de `pf_app` (`INHERIT TRUE, SET FALSE`): hereda grants y políticas `TO pf_app` sin duplicarlas. `pf_bff` y `pf_worker` se crean `LOGIN` **sin contraseña** (no pueden iniciar sesión todavía); la credencial separada del BFF llega con la tarea 8.1. `pf_maintenance` ya existía (add-api-conventions); aquí recibe `SELECT, DELETE` sobre `iam.bff_session`.
7. **Chequeo de catálogo RLS (TC-SECURITY-RLS-004):** se evalúan todas las tablas de schemas de negocio (todos salvo sistema, `platform`, `pgboss`, `public`) **y** toda tabla con columna `workspace_id` en cualquier schema (cubre `platform.idempotency_key`); allowlist exacta de la TC (`iam.user`, `iam.bff_session`, `fx.currency`, `platform.inbox`). Vive en `apps/api/test/support/db.ts` y corre en `pnpm test:integration`.
8. **`fx.currency`:** columnas de docs/08 §5.10; `owner_workspace_id` sin FK (la FK y la política de monedas CUSTOM las agrega FX). Símbolos e `iso_numeric` sembrados para BOB/USD.
9. **Persistencia sin Kysely (superado por la decisión 13):** Kysely no está en el catálogo de dependencias del monorepo y la instalación no estaba disponible offline; los repositorios usan SQL parametrizado sobre la conexión de la `PgUnitOfWork` (`requireSqlExecutor()`), con montos como string (`numeric::text`). Migrar a Kysely es mecánico (mismos puertos) y queda pendiente en la tarea 6.2.
10. **`PgUnitOfWork` en `@pf/platform/api`:** `run(ctx, fn)` abre transacción, fija `app.user_id`/`app.workspace_id` con `set_config(..., true)`, expone la conexión por `currentSqlExecutor()`/`requireSqlExecutor()` y reutiliza la transacción en curso si se anida; `bind(ctx)` re-fija el contexto (la provisión conoce el `userId` tras `iam.provision_user`). Regla ESLint `no-restricted-syntax` contra `SET app.` de sesión y `set_config('app.*', …, false)` en código de producción (los tests quedan exentos).
11. **Integración de `@pf/identity`:** su `vitest.integration.config.ts` reutiliza el global setup de `apps/api` (Testcontainers + comando `migrate` real) para no duplicar el arranque de la base.
12. **Outbox/Audit:** `platform.outbox` aún no existe (lo crea el change que materialice el relay) y `AuditPort` lo define `add-audit-trail`; los casos de uso ya invocan ambos puertos y los tests usan fakes. Los payloads producidos ya se validan con Ajv strict contra `contracts/events/identity/`; el adapter PostgreSQL del outbox (sobre completo: `correlationId`, `causationId`, `actor`) queda pendiente (6.3). **Actualización 2026-10-03:** resuelto por `add-event-outbox` (`PgOutboxWriter` en el composition root; el evento de IDENTITY suma `actor`); la auditoría sigue por log hasta `add-audit-trail`.
13. **Kysely sobre la `PgUnitOfWork`:** `unitOfWorkKysely<DB>()` (`@pf/platform/api`) es un dialecto PostgreSQL cuyo driver ejecuta toda consulta compilada en `requireSqlExecutor()`: mismo client, misma transacción y el contexto RLS fijado por la UoW. Kysely no abre conexiones ni transacciones (lanzan error). Los tipos de tabla de IDENTITY se escriben a mano con NUMERIC como `string` (ADR-0007).
14. **Autenticación/autorización HTTP dirigidas por el contrato:** `IdentityAccessGuard` (global, `APP_GUARD` del `IdentityModule`) valida el JWT con `JwtVerifier` (jose), provisiona la identidad (idempotente) y, para operaciones con `{workspaceId}`, compara el rol activo con `x-required-role` (OWNER ⊃ EDITOR ⊃ VIEWER): no miembro ⇒ 403 `WORKSPACE_ACCESS_DENIED`; rol inferior ⇒ 403 `INSUFFICIENT_ROLE`. Toda operación del contrato exige token; health y diagnósticos quedan fuera. Sin `OIDC_ISSUER_URL` (solo local/ci) las rutas de identidad no se montan; en staging/production la variable es obligatoria.
15. **`dependency-cruiser`:** `exclude` ya no descarta `dist/` dentro de `node_modules` (ocultaba aristas hacia paquetes con entry point en `dist/`, como kysely o vitest, y `domain-no-framework` dejaba de dispararse); `domain-only-shared-kernel` permite `vitest` en los tests de dominio.
16. **Nombre visible editable (7.3):** `PATCH /me` acepta `displayName` (1..100, recortado) y `preferences` (merge-patch: `null` borra la clave; ≤ 16 KiB). Como la provisión JIT corre en cada request y copiaba siempre el nombre del IdP, la migración `20261002170000_iam_user_idp_display_name` agrega `iam.user.idp_display_name` y redefine `iam.provision_user`: `display_name` solo se reemplaza cuando el nombre **cambia en el IdP** (spec: "actualizar email y nombre si cambiaron"); el email se sincroniza siempre.
17. **Paginación de `GET /workspaces` (7.3):** keyset por `w.id` (UUIDv7, orden estable) con el `CursorCodec` firmado de add-api-conventions (ámbito `resource=workspaces`, `workspaceId=<userId>`): un cursor de otro usuario o manipulado ⇒ 400 `INVALID_CURSOR`. El orden pasó de `joined_at` a `id`.
18. **BFF framework-free (8.1–8.3):** `apps/web/src/bff/bff.ts` recibe/devuelve `Request`/`Response` estándar; las route handlers de Next solo delegan (`getBff()` compone desde `loadConfig('web')`, sin `process.env`). Así los TC de sesión corren como integración contra PostgreSQL real sin levantar Next.
19. **Rutas del BFF:** `/api/bff/auth/{login,callback,logout}`, `GET|PUT /api/bff/session` (token CSRF y workspace activo; `PUT` valida la membresía con `GET /api/v1/workspaces/{id}`) y el proxy `/api/bff/v1/*` (design §1/§9; el brief mencionaba `/api/*`, pero `/api/health/*` ya pertenece a finance-web).
20. **Pre-sesión ligada al navegador:** además de `state` de un solo uso, el registro `PENDING_LOGIN` se busca por `sha256` de una cookie opaca `__Host-pfos_login` (TTL 10 min): un callback sin esa cookie (CSRF de login) o con `state` reutilizado/desconocido redirige a `/auth/error?reason=state` sin crear sesión.
21. **Provisión en el login:** tras el canje del código el BFF llama a `GET /api/v1/me` con el access token (provisión JIT, design §4) y guarda `user_id` (FK de `iam.bff_session`); si falla (p. ej. email no verificado ⇒ 401) revoca el refresh token y muestra `/auth/error?reason=provision`.
22. **Cifrado de sesiones:** `BFF_SESSION_ENC_KEY = [kid:]secreto[,kid:secreto…]` (como `CURSOR_SIGNING_KEY`, pero un único secreto sin `kid` vale como `k0`: la regla de `.env.example` exige que un secreto sea solo una referencia `${PF_DEV_*}`); clave AES-256-GCM derivada con HKDF-SHA256; AAD `<session id>:<tokens|csrf|login>`. Así `pnpm setup:env` genera el secreto con su generador estándar (`PF_DEV_BFF_SESSION_SECRET`).
23. **Credencial de `pf_bff`:** `migrate` alinea su contraseña con `BFF_DATABASE_URL` (verificador SCRAM, igual que `pf_app`), lo que supera la nota de la decisión 6. El contrato de configuración exige en `web` el rol `pf_bff`, `OIDC_ISSUER_URL`, `OIDC_CLIENT_SECRET`, `BFF_SESSION_ENC_KEY`, `WEB_PUBLIC_URL` y `FINANCE_API_URL`; la readiness del BFF verifica además el almacén de sesiones (`SELECT 1`).
24. **Discovery por back-channel:** en Compose (modo B) el contenedor no alcanza la URL pública de Keycloak; `OIDC_DISCOVERY_URL` (`http://keycloak:8080/realms/pfos`) se usa solo para leer el documento de discovery, que debe declarar `issuer = OIDC_ISSUER_URL` (Keycloak con `KC_HOSTNAME_BACKCHANNEL_DYNAMIC` publica endpoints de back-channel internos y de front-channel públicos). finance-api usa `OIDC_JWKS_URI` interno.
25. **Expiración y refresh:** la expiración idle/absoluta se evalúa con el reloj del BFF (inyectable en tests) y no con `now()` de la base. Refresh si el access token expira en < 60 s; un 401 de la API fuerza un único refresh + reintento (la API autentica antes de ejecutar). El TC-IDENTITY-SESSION-001 se verifica con dos instancias del BFF sobre la misma base (sin promesa compartida entre ellas) ⇒ 1 refresh.
26. **Realm de desarrollo:** al declarar `clientScopes` explícitos Keycloak deja de crear los predeterminados, así que el realm define `basic` (claim `sub`), `profile`, `email` y `pfos.api` (scope + audiencia `finance-api`) y el client `pfos-web` los tiene como default. Usuarios de la Minimal Seed con id fijo, que la seed usa como `idp_subject`.
27. **Minimal Seed (8.5):** `dataset_version` 2; siembra usuarios (vía `iam.provision_user`), W1/W2 y membresías con el rol `pf_app` bajo RLS (una transacción por workspace con contexto LOCAL; sin `ON CONFLICT` en `iam.workspace` porque el upsert exigiría la política SELECT de membresía). No pasa por casos de uso: no existe todavía un caso de uso de "agregar miembro" (invitaciones son Phase 11).
28. **UI mínima (8.4, parcial):** páginas autenticadas bajo `app/[locale]/(app)` (layout que valida la sesión en el servidor), selector de workspace activo, configuración del workspace (`If-Match`), preferencias personales y alta de workspace (clave de idempotencia por intento + guarda contra doble envío), página pública `/auth/error` (motivos `state|idp|callback|provision|expired`). `CSRF_REJECTED` tiene mensaje propio en la UI (fuera del `ErrorCatalog` de la API). Sin estilos ni tests de componentes todavía.
29. **E2E (grupo 9):** paquete `tests/e2e` (`@pf/e2e`, Playwright 1.63 + Chromium) que levanta un stack Compose desechable `pfos-e2e` (modo B, puertos 4xxxx, `.env` temporal) con Keycloak real. El job `e2e` de `pr.yml` reutiliza las imágenes del job `image`; no es check requerido todavía.
