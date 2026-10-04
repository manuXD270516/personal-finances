# Tareas

> DESIGN GATE aprobado el 2026-10-01 (docs/DESIGN-GATE.md). Requiere `bootstrap-platform-foundation` y `add-workspace-identity` aplicados.

## 1. Spec y test cases (SPEC → TEST CASE)

- [x] 1.1 Revisar `specs/audit/audit-trail/spec.md` con el owner y confirmar que cada requirement Must tiene ≥ 1 TC; verificar con `openspec validate add-audit-trail --strict --no-interactive`
  > Hecho (2026-10-03): `openspec validate add-audit-trail --strict` y `pnpm spec:validate` en verde; cada requirement Must tiene ≥ 1 TC (`pnpm traceability:check`).
- [x] 1.2 Confirmar los TC en `tests/cases/audit/` (ATOMIC-001, CONTENT-001, ACTOR-001, REDACTION-001, IMMUTABLE-001, ISOLATION-001, HISTORY-001, RANGE-001, ACCESS-001, SESSION-001) con `status: ready`; verificar que el chequeo del catálogo los acepta
  > Hecho: los 11 TC de `tests/cases/audit/` aceptados por el chequeo de catálogo; 10 pasan a `automated` (ACCESS-002 queda `ready`: depende de `getTransactionHistory`).

## 2. Dominio (`@pf/audit/domain`)

- [x] 2.1 TDD: `AuditRecord`, `AuditActor`, `AuditOrigin`, `AuditAction` con tests unitarios nombrados `[TC-AUDIT-CONTENT-001]` / `[TC-AUDIT-ACTOR-001]`; verificar que el registro es inmutable y exige `userId` para actor USER y `process` para SYSTEM/WORKER
  > Hecho: `src/domain/{audit-record,audit-actor,audit-origin,audit-action}.ts`, tests en `audit-record.test.ts`.
- [x] 2.2 TDD: `ChangeSet` y serialización de `Money` como string decimal + moneda (nunca `number`); verificar con PBT de round-trip a escalas 0, 2, 6, 8, 18
  > Hecho: `change-set.ts` (montos `{amount: string, currency}`; enteros sí, fraccionarios no) con PBT `fast-check` a escalas 0/2/6/8/18.
- [x] 2.3 TDD: `RedactionPolicy` por allow-list (identificador de cuenta → últimos 4, sin tokens/cookies/secretos, campos desconocidos omitidos); tests `[TC-AUDIT-REDACTION-001]` con test "canario"
  > Hecho: `redaction-policy.ts` (`plain`/`money`/`last4`, allow-list por agregado aportada por cada contexto) y test canario.

## 3. Aplicación (`@pf/audit/application`)

- [x] 3.1 `AuditPort` en `contracts` y `AuditRecorder` que completa contexto (actor, workspace, correlación, origen, `Clock`) y falla fuera de una unidad de trabajo; verificar con tests de aplicación
  > Hecho: `AuditPort`/`AuditEntry` en `contracts`, `AuditRecorder` (`AUDIT_OUTSIDE_UNIT_OF_WORK`, `AUDIT_ACTOR_MISSING`) con dobles en memoria.
- [x] 3.2 Queries `GetAuditHistory` y `SearchAuditLog` (rango en zona del workspace, orden por defecto según filtro); verificar con tests `[TC-AUDIT-HISTORY-001]`, `[TC-AUDIT-RANGE-001]` usando `FixedClock`
  > Hecho: `AuditQueries` (`list` + `historyOf`), conversión `[from 00:00, to+1 00:00)` en la zona IANA del workspace.
- [x] 3.3 Propagación de actor de sistema y `correlationId`/`causationId` en jobs y consumidores del worker; verificar con `[TC-AUDIT-ACTOR-001]`
  > Hecho: `RequestContext` en `@pf/platform/api`; consumidores con actor `WORKER{consumer}`, origen `system`, correlación del evento y `causationId` (también en el outbox); job de particiones como `WORKER{audit.ensure-partitions}`. Verificado con un consumidor real (rol pf_worker) en `pg-audit-log.int.test.ts`.

## 4. Infraestructura

- [x] 4.1 Migración `audit_0001_create_audit_log` (schema, tabla particionada mensual + DEFAULT, índices, RLS WS-RO fail-closed, grants SELECT/INSERT, trigger `forbid_mutation`); verificar con test de migración y `[TC-AUDIT-IMMUTABLE-001]` (UPDATE/DELETE/TRUNCATE como `pf_app` fallan)
  > Hecho: `apps/api/db/migrations/20261003160000_audit_audit_log.sql` (nombre dbmate con timestamp en lugar de `audit_0001_…`). Ver Decisiones de implementación 9.
- [x] 4.2 `KyselyAuditLogRepository` sobre la transacción de la `UnitOfWork` y `HmacIpHasher`; verificar con `[TC-AUDIT-ATOMIC-001]` (rollback único con fallo inyectado)
  > Hecho: `PgAuditLogStore` (Kysely sobre `unitOfWorkKysely`) y `HmacIpHasher` (`AUDIT_IP_HMAC_KEY`).
- [x] 4.3 Job `audit.ensure-partitions` en el worker y alerta si la partición DEFAULT recibe filas; verificar con test de integración que crea la partición del mes siguiente
  > Hecho: `ensureAuditPartitions` en `PlatformJobsRegistrar` (al arrancar y cada 24 h) con alerta por filas en DEFAULT; test de integración que crea las particiones siguientes con RLS forzada.
- [x] 4.4 Test de aislamiento con dos workspaces; verificar con `[TC-AUDIT-ISOLATION-001]`
  > Hecho: SQL (W2 no ve W1, sin contexto PF002, escritura cruzada 42501) y HTTP (entidad ajena = inexistente = lista vacía).

## 5. API

- [x] 5.1 Consolidar en `contracts/openapi/finance-api.v1.yaml` los cambios de design.md §Contratos (lo hace el proceso de contratos); verificar con Spectral/Redocly lint
  > Hecho: `listAuditLog` ya estaba consolidado; se agregó `recordSessionEvent` + `SessionEvent` (aditivo). Respuestas validadas contra `AuditLogPage` en `audit.api.test.ts`.
- [x] 5.2 `AuditLogController` `GET /audit-log` con guard EDITOR, paginación por cursor y problem+json; verificar con tests de API `[TC-AUDIT-ACCESS-001]` y test de contrato
  > Hecho: `AuditLogController` (`AuditModule`), guard global de IDENTITY por `x-required-role: EDITOR`, cursor firmado.
- [x] 5.3 Interceptor de sesión (primer request autenticado de la sesión → `identity.session.started`; logout → `identity.session.ended`); verificar con `[TC-AUDIT-SESSION-001]`
  > Hecho con un endpoint explícito en lugar de interceptor (Decisiones de implementación 6): `POST /me/session-events`, invocado por el BFF tras el callback y en el logout.

## 6. Arquitectura

- [x] 6.1 Regla de dependency-cruiser/test de arquitectura: todo `*CommandHandler` mutante depende de `AuditPort`; verificar que un fixture sin auditoría hace fallar el chequeo
  > Hecho: regla `required` `command-handlers-audit` en `.dependency-cruiser.cjs` + fixture de violación en `scripts/architecture`.

## 7. UI

- [x] 7.1 Componente "Historial" reutilizable (lista cronológica con actor, acción, instante en zona del workspace, diff antes/después con montos formateados por locale `es-BO`), visible solo para OWNER/EDITOR; textos vía catálogo i18n; verificar con test de componente y axe sin violaciones serias
  > Hecho parcialmente: `AuditHistory` en Configuración (OWNER/EDITOR), i18n es/en/pt, test de componente con estructura accesible. **Pendiente:** verificación con axe (no hay axe-core/jsdom en el repo; no se agregaron dependencias).
  > Nota (2026-10-04): `AuditHistory` en el detalle de cuenta (`/cuentas/{id}`, rol OWNER) verificado con axe-core (`@axe-core/playwright`, WCAG 2.1 A/AA) en `tests/e2e/specs/a11y.spec.ts`: sin violaciones serious/critical (2026-10-04).

## 8. Tests automatizados y E2E

- [x] 8.1 Integración con Testcontainers para todos los TC de `tests/cases/audit/` nombrados con su TC-id; verificar en CI
  > Hecho: `packages/contexts/audit/test/integration/pg-audit-log.int.test.ts` y `apps/api/test/api/audit.api.test.ts` (Testcontainers postgres:18 por digest).
- [x] 8.2 E2E smoke: editar una entidad de fixture y ver su historial en la UI; verificar en Playwright contra Compose `core`
  > Hecho: `tests/e2e/specs/audit.spec.ts` (Historial de Configuración tras editar W1, VIEWER sin historial y 403, login/logout auditados con Keycloak real).

## 9. Documentación y cierre

- [x] 9.1 Actualizar docs/08 §5.16 (columnas `origin`, `actor_process`), docs/04 §3.17 y docs/10 (operación `listAuditLog` ya en Phase 1); verificar enlaces
  > Hecho: docs/08 §5.16 (implementación: particiones, políticas, triggers), docs/04 §3.17 y docs/10 §13 actualizados; `docs/config-reference.md` regenerado.
- [x] 9.2 Actualizar `automation_status`/`status` de los TC, regenerar la matriz de trazabilidad y ejecutar `openspec validate --all --strict --no-interactive`; archivar el change
  > Parcial: `automation_status`/`status` actualizados y matriz regenerada; `openspec validate --all` en verde. **Pendiente:** archivar el change (lo hace el lead tras el merge).
  > Revisado 2026-10-04 (no archivable aún): `TC-AUDIT-ACCESS-002` (VIEWER ve el historial de una transacción pero no `/audit-log`, D28) sigue `ready`/`not_automated` sin test con su id, y docs/17 exige que los TC del change estén `automated` al archivar. El comportamiento existe (`GET …/transactions/{id}/history` para VIEWER; 403 en `/audit-log` probado en `[TC-AUDIT-ACCESS-001]`); falta un test de API `[TC-AUDIT-ACCESS-002]`.
  > Hecho 2026-10-04: test de API `[TC-AUDIT-ACCESS-002]` en `apps/api/test/api/transactions.api.test.ts` (VIEWER obtiene `GET …/transactions/{id}/history` del gasto editado a 45.90 BOB; `GET /audit-log`, con y sin filtro por agregado, ⇒ 403 `INSUFFICIENT_ROLE`); TC `automated`. Los 11 TC del change están `automated`; matriz regenerada, `pnpm traceability:check` y `pnpm spec:validate` en verde; change archivado.
