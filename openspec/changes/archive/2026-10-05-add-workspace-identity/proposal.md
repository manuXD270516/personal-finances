# Propuesta: add-workspace-identity

## Why

Ningún dato financiero puede registrarse con seguridad mientras no se sepa quién es el usuario, a qué workspace pertenece y qué puede hacer en él. PFOS guarda información muy sensible y, aunque arranca con un solo usuario, su modelo es multi-usuario y multi-workspace desde el día 1 (ARCHITECTURE §1, §9). Este change convierte en comportamiento verificable las decisiones aceptadas en ADR-0010 (OIDC Code + PKCE vía BFF, RBAC por workspace; enmienda del 2026-10-02: sesiones en PostgreSQL y refresh bajo lock) y ADR-0023 (`workspace_id` + RLS fail-closed). Es el primer change de negocio de Phase 1 (docs/03 §7, orden 1): todos los demás dependen de él.

## What Changes

- Login OIDC (Authorization Code + PKCE S256) ejecutado por el BFF de `finance-web`, con cookie de sesión opaca `__Host-` (`HttpOnly`, `Secure`, `SameSite=Lax`) y tokens cifrados del lado servidor; ningún token llega al navegador.
- Sesiones del BFF persistidas en PostgreSQL, con expiración por inactividad (30 min) y absoluta (12 h), refresh *single-flight* bajo bloqueo por sesión, logout con revocación en el IdP y protección CSRF en mutaciones.
- Validación de JWT en `finance-api` (firma vía JWKS, `iss`, `aud`, `exp`/`nbf` con skew ≤ 30 s, scope) y provisión JIT idempotente del usuario en el primer acceso.
- `GET/PATCH /api/v1/me` con perfil, locale, zona horaria y membresías.
- Workspace personal creado de forma idempotente en el primer login (OWNER, BOB, America/La_Paz, es-BO, mes desde el día 1); configuración del workspace por el OWNER (incluida la reserva mínima de liquidez); listado, creación y selección de workspaces (Should).
- Autorización por rol (OWNER/EDITOR/VIEWER) en cada caso de uso, 403 `WORKSPACE_ACCESS_DENIED` a no miembros y `INSUFFICIENT_ROLE` por rol insuficiente, matriz rol × operación verificada contra el contrato.
- Aislamiento por workspace en PostgreSQL con RLS habilitado y forzado, contexto por transacción (`SET LOCAL`), comportamiento fail-closed sin contexto y roles de BD de mínimo privilegio; chequeo de catálogo que impide tablas de negocio sin política.
- **Fuera de alcance:** invitaciones, cambio de rol y revocación de miembros por API (FR-IDENTITY-008, Phase 11), transferencia de propiedad (FR-IDENTITY-011), MFA exigible por workspace (FR-IDENTITY-009, Phase 9), re-autenticación reciente para acciones sensibles (llega con export en Phase 2), export y borrado de workspace (FR-IDENTITY-010/012), elección del IdP cloud (ADR-0013), registro de auditoría de login/configuración (lo especifica `add-audit-trail`, FR-AUDIT-005), convenciones transversales de API (idempotencia, errores, paginación: `add-api-conventions`).

## Capabilities

### New Capabilities
- `identity/authentication`: login OIDC vía BFF, tokens fuera del navegador, validación de JWT en la API, provisión JIT del usuario, ciclo de vida de la sesión (refresh, expiración, logout), CSRF y perfil `/me`.
- `identity/workspace-membership`: workspace personal por defecto, configuración del workspace, cambio de moneda base sin alterar la historia, reserva mínima de liquidez, pertenencia a varios workspaces.
- `security/access-control`: verificación de membresía, autorización por rol, matriz de autorización, aislamiento por workspace con RLS, contexto por transacción, recursos ajenos indistinguibles y mínimo privilegio en BD.

### Modified Capabilities
- Ninguna.

## Impact

**Specs impactadas:** crea `identity/authentication` (10 requirements), `identity/workspace-membership` (8 requirements) y `security/access-control` (9 requirements).

**Componentes/contextos impactados:** contexto IDENTITY (`@pf/identity`: domain, application, infrastructure, interface); `@pf/platform` (contexto de autenticación por request, guard de membresía/rol, Unit of Work con `SET LOCAL app.workspace_id`/`app.user_id`); `apps/api` (composition root, verificador JWT); `apps/web` (BFF: rutas de auth, almacén de sesiones, CSRF, proxy autenticado, selector de workspace); migraciones SQL (`iam`, roles de BD); realm de desarrollo de Keycloak y Minimal Seed (usuarios y workspaces W1/W2).

**APIs impactadas:** `contracts/openapi/finance-api.v1.yaml` — `getMe`, `updateMe`, `listWorkspaces`, `createWorkspace`, `getWorkspace`, `updateWorkspace` (schemas `Me`, `MeUpdate`, `Workspace`, `WorkspaceCreate`, `WorkspaceUpdate`; nuevo código `INVALID_TIMEZONE`). Detalle exacto en design.md § Contratos. Las rutas del BFF (`/api/bff/auth/*`) no forman parte del contrato de `finance-api`.

**Tablas impactadas:** `iam.user`, `iam.workspace`, `iam.workspace_membership`, `iam.bff_session` (nueva, enmienda ADR-0010); funciones `platform.current_workspace_id()`, `platform.current_user_id()`, `iam.provision_user(...)`; roles `pf_app`, `pf_worker`, `pf_migrator`, `pf_bff`.

**Eventos impactados:** produce `identity.WorkspaceCreated.v1` e `identity.WorkspaceSettingsChanged.v1` (nuevos schemas en `contracts/events/identity/`). No consume eventos.

**Migraciones requeridas:** expand únicamente (schema `iam`, tablas, políticas RLS, funciones, roles y grants). No destructiva. Sin datos previos que migrar.

**Test cases:** AÑADIDOS — TC-IDENTITY-AUTH-002, TC-IDENTITY-AUTH-003, TC-IDENTITY-AUTH-004, TC-IDENTITY-AUTH-005, TC-IDENTITY-AUTH-006, TC-IDENTITY-AUTH-007, TC-IDENTITY-AUTH-008, TC-IDENTITY-SESSION-001, TC-IDENTITY-SESSION-002, TC-IDENTITY-WORKSPACE-001, TC-IDENTITY-WORKSPACE-002, TC-IDENTITY-WORKSPACE-003, TC-IDENTITY-WORKSPACE-004, TC-IDENTITY-WORKSPACE-005, TC-IDENTITY-WORKSPACE-006, TC-IDENTITY-WORKSPACE-007, TC-IDENTITY-WORKSPACE-008, TC-SECURITY-RBAC-003, TC-SECURITY-RLS-002, TC-SECURITY-RLS-003, TC-SECURITY-RLS-004, TC-SECURITY-RLS-005, TC-SECURITY-ISOLATION-001. MODIFICADOS — TC-IDENTITY-AUTH-001, TC-IDENTITY-MEMBERSHIP-001 (pasa a `security/access-control`; 404 `WORKSPACE_NOT_FOUND` → 403 `WORKSPACE_ACCESS_DENIED`), TC-SECURITY-RBAC-001 (`FORBIDDEN` → `INSUFFICIENT_ROLE`), TC-SECURITY-RBAC-002, TC-SECURITY-RLS-001 (los chequeos de roles y sin-contexto pasan a RLS-005 y RLS-002). DEPRECADOS — ninguno.

**Invariantes afectadas:** INV-025 (aislamiento de workspace). El change no crea asientos; el requirement "Cambio de moneda base sin alterar la historia" protege la inmutabilidad de montos y tasas históricas (INV-011 en lectura).

**Impacto de regresión:** ninguno sobre comportamiento existente (no hay capabilities de negocio previas). A partir de aquí toda ruta de negocio queda detrás de autenticación, membresía, rol y RLS: los tests de API de los changes siguientes deben autenticarse con usuarios del seed. La suite de aislamiento (RLS-001..005, ISOLATION-001, RBAC-002) entra a la Financial Regression Suite y se extiende con cada tabla/operación nueva.

**Riesgos introducidos:** reutilización de refresh token rotado que invalida la sesión en Keycloak (mitigado con lock por sesión, SPIKE-06); access token válido tras logout hasta su `exp` (vida ≤ 5 min); diferencias de claims entre Keycloak y un IdP cloud como Cognito (verificador parametrizable por IdP); olvido de política RLS en una tabla nueva (chequeo de catálogo en CI); rol `pf_bff` con acceso a BD desde el proceso web (grants limitados a `iam.bff_session`).
