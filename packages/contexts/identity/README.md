# @pf/identity — bounded context IDENTITY

Usuarios, workspaces, membresías y autorización por rol (openspec `add-workspace-identity`; capabilities
`identity/authentication`, `identity/workspace-membership`, `security/access-control`).

| Capa | Contenido |
|---|---|
| `domain` | AR `User` y `Workspace`, entidad `Membership`, VO `WorkspaceSettings`, `TimeZoneId` (IANA, `INVALID_TIMEZONE`), `LocaleTag`, `Role` + `roleGrants` (docs/12 §4). Solo `@pf/shared-kernel`. |
| `application` | `IdentityService`: `provision` (JIT + workspace personal), `getMe`, `updateMyPreferences`, `listMyWorkspaces`, `createWorkspace`, `getWorkspace`, `updateWorkspaceSettings`, `authorize`. Puertos en `application/ports`. Fakes en memoria en `application/testing`. |
| `infrastructure` | Repositorios PostgreSQL sobre la `PgUnitOfWork` de `@pf/platform/api` (contexto RLS LOCAL), `PgCurrencyCatalog` sobre `fx.currency`, `uuidV7`. |
| `contracts` | Tipos públicos (payload de `identity.WorkspaceCreated.v1`). El módulo Nest (`interface/identity.module.ts`) llega con la tarea 7. |

Esquema de BD: `apps/api/db/migrations/20261002140000_fx_currency.sql`, `…150000_platform_roles_bff_worker.sql`,
`…160000_iam_identity.sql`. Decisiones en `openspec/changes/add-workspace-identity/design.md` § Decisiones de
implementación.

| Script | Efecto |
|---|---|
| `pnpm test` | Unitarios de dominio y aplicación (`src/**/*.test.ts`) |
| `pnpm test:integration` | Repositorios contra PostgreSQL 18 (Testcontainers; requiere Docker) |
