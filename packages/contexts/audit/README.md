# @pf/audit — bounded context AUDIT

Pista de auditoría atómica, inmutable y aislada por workspace (openspec `add-audit-trail`; capability
`audit/audit-trail`; INV-029, NFR-DATA-007, FR-AUDIT-001..005).

| Capa | Contenido |
|---|---|
| `domain` | AR `AuditRecord` (inmutable), VO `AuditActor` (`USER{userId}` \| `SYSTEM/WORKER{process}`), `AuditOrigin`, `auditAction`, `ChangeSet` (montos como `{amount: string, currency}`, nunca `number`), `RedactionPolicy` por allow-list. Solo `@pf/shared-kernel`. |
| `application` | `AuditRecorder` (implementa `AuditPort`: falla fuera de la unidad de trabajo con `AUDIT_OUTSIDE_UNIT_OF_WORK`; completa actor/origen/correlación/HMAC de IP/user agent desde el contexto ambiental), `AuditQueries` (`GetAuditHistory`, `SearchAuditLog`, `historyOf`). Puertos en `application/ports`; dobles en memoria en `application/testing`. |
| `infrastructure` | `PgAuditLogStore` (Kysely sobre la `PgUnitOfWork` en curso: misma transacción que la mutación), `platformAuditEnvironment`, `HmacIpHasher` (`AUDIT_IP_HMAC_KEY`), `ensureAuditPartitions` (job del worker). |
| `interface` | `AuditModule` (`GET /api/v1/workspaces/{id}/audit-log`, EDITOR+) y `createAuditRuntime` para el composition root. |
| `contracts` | `AuditPort`/`AuditEntry`, `AuditHistoryQuery` (historial por entidad, p. ej. `getTransactionHistory`, D28), tipos de las allow-lists (`AuditFieldPoliciesDto`) y tokens. |

Uso desde otro contexto: declarar `AuditPort` (de `@pf/audit/contracts`) como dependencia del caso de uso, invocar
`audit.append({...})` al final del comando dentro de su `uow.run(...)`, y exportar la allow-list de sus agregados en
sus `contracts` para que `apps/api` la pase a `createAuditRuntime({ policies })`. La regla `command-handlers-audit` de
dependency-cruiser falla si un `*.command-handler.ts` o `*.service.ts` de `application/` no depende de `AuditPort`.

Esquema de BD: `apps/api/db/migrations/20261003160000_audit_audit_log.sql`. Decisiones en
`openspec/changes/add-audit-trail/design.md` § Decisiones de implementación.

| Script | Efecto |
|---|---|
| `pnpm test` | Unitarios de dominio y aplicación (`src/**/*.test.ts`) |
| `pnpm test:integration` | Almacén, inmutabilidad, RLS, particiones y atomicidad contra PostgreSQL 18 (Testcontainers) |
