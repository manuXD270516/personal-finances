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
