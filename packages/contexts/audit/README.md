# @pf/audit — bounded context AUDIT

Pista de auditoría atómica, inmutable y aislada por workspace (openspec `add-audit-trail`; capability
`audit/audit-trail`; INV-029, NFR-DATA-007, FR-AUDIT-001..005) y recorrido del ciclo de vida de cada elemento con
máquina de estados (openspec `add-lifecycle-timeline`; capability `audit/lifecycle-timeline`; docs/31 D37,
FR-AUDIT-009..012).

| Capa | Contenido |
|---|---|
| `domain` | AR `AuditRecord` (inmutable), VO `AuditActor` (`USER{userId}` \| `SYSTEM/WORKER{process}`), `AuditOrigin`, `auditAction`, `ChangeSet` (montos como `{amount: string, currency}`, nunca `number`), `RedactionPolicy` por allow-list. Solo `@pf/shared-kernel`. |
| `application` | `LifecycleRecorder` (implementa `LifecyclePort` sobre el `AuditPort` compuesto), `LifecycleQueries`, job `LifecycleBackfill` (`audit.lifecycle-backfill`, deriva desde `audit_log` lo no respaldado, `derived = true`); `AuditRecorder` (implementa `AuditPort`: falla fuera de la unidad de trabajo con `AUDIT_OUTSIDE_UNIT_OF_WORK`; completa actor/origen/correlación/HMAC de IP/user agent desde el contexto ambiental), `AuditQueries` (`GetAuditHistory`, `SearchAuditLog`, `historyOf`). Puertos en `application/ports`; dobles en memoria en `application/testing`. |
| `infrastructure` | `PgLifecycleStore`, `PgLifecycleBackfillSource`, `findLifecycleDivergences` (consistencia estado ↔ última transición); `PgAuditLogStore` (Kysely sobre la `PgUnitOfWork` en curso: misma transacción que la mutación), `platformAuditEnvironment`, `HmacIpHasher` (`AUDIT_IP_HMAC_KEY`), `ensureAuditPartitions` (job del worker). |
| `interface` | `AuditModule` (`GET /api/v1/workspaces/{id}/audit-log`, EDITOR+) y `createAuditRuntime` para el composition root. |
| `contracts` | `LifecyclePort.record(entry, steps)` (auditoría + transiciones/anotaciones en la misma unidad de trabajo), `LifecycleQuery` (`GetLifecycle`, `machineOf`) y sus DTO; `AuditPort`/`AuditEntry`, `AuditHistoryQuery` (historial por entidad, p. ej. `getTransactionHistory`, D28), tipos de las allow-lists (`AuditFieldPoliciesDto`) y tokens. |

Uso desde otro contexto: declarar `AuditPort` (de `@pf/audit/contracts`) como dependencia del caso de uso, invocar
`audit.append({...})` al final del comando dentro de su `uow.run(...)`, y exportar la allow-list de sus agregados en
sus `contracts` para que `apps/api` la pase a `createAuditRuntime({ policies })`. La regla `command-handlers-audit` de
dependency-cruiser falla si un `*.command-handler.ts` o `*.service.ts` de `application/` no depende de `AuditPort`.

Esquema de BD: `apps/api/db/migrations/20261003160000_audit_audit_log.sql` y
`20261004150000_audit_lifecycle_transition.sql`. Las máquinas de estado NO viven aquí: cada contexto las declara en su
dominio (sobre `LifecycleMachine` del shared-kernel) y `apps/api` las pasa a `createAuditRuntime({ machines })`. Decisiones en
`openspec/changes/add-audit-trail/design.md` § Decisiones de implementación.

| Script | Efecto |
|---|---|
| `pnpm test` | Unitarios de dominio y aplicación (`src/**/*.test.ts`) |
| `pnpm test:integration` | Almacén, inmutabilidad, RLS, particiones y atomicidad contra PostgreSQL 18 (Testcontainers) |
