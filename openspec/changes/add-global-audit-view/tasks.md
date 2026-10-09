# Tareas

> Requiere aplicados: `add-audit-trail`, `add-workspace-identity`, `add-lifecycle-timeline`. Se beneficia de `add-bulk-edit`, `add-reconciliation`, `add-workspace-export` y de la reapertura de periodos de pf-p2a.

## 1. SPEC y TEST CASES

- [x] 1.1 Revisar con el owner los requirements añadidos a `audit/audit-trail` y las preguntas abiertas 1–2 de design.md (resueltas por el owner el 2026-10-08, docs/33); verificar con `openspec validate add-global-audit-view --strict`
  - 2026-10-08: revisado con el owner; las preguntas abiertas 1–2 de design.md quedaron resueltas en docs/33: D105 (consulta global para OWNER y EDITOR, export CSV solo OWNER) y D106 (auditar en el workspace objetivo los fallos de autorización de no miembros, con límite de 1 registro por minuto, sin datos sensibles; la IP solo como HMAC como el resto de la auditoría); `openspec validate add-global-audit-view --strict` verde (`pnpm spec:validate`).
- [x] 1.2 Revisar TC-AUDIT-GLOBAL-001..007; pasar a `ready` y `requirement_status: confirmed` al aprobar
  - 2026-10-08: TC-AUDIT-GLOBAL-001..007 revisados contra los scenarios (45.90 BOB y "Compra" no aparecen en el evento de seguridad; 2026-03-15T23:30:00-04:00 en el CSV); pasan a `automated` con sus tests. El export de TC-AUDIT-GLOBAL-006 se cubre con `audit.log.exported`: las acciones de `add-workspace-export` (23) aún no existen y deberán agregarse a `SECURITY_ACTIONS`.

## 2. DOMAIN (TDD)

- [x] 2.1 `AuditActionCategory` y test de catálogo (toda acción emitida catalogada) (TC-AUDIT-GLOBAL-006)
  - 2026-10-08: `domain/audit-action-category.ts` (`AuditActionCategory`, `SECURITY_ACTIONS` explícitas sin comodines, `DATA_ACTION_ENTITIES`, `auditActionCategory`, `isCatalogedAction`) y `audit-action-category.test.ts`: el test recorre el código de producción de todos los contextos y falla si una acción emitida (literal o plantilla `ctx.entidad.${verbo}`) no está catalogada (TC-AUDIT-GLOBAL-006). Cada entrada del log expone además `category` (campo aditivo del contrato).

## 3. APPLICATION

- [x] 3.1 `SearchAuditLog` con filtros combinables, rango máximo y cursor (TC-AUDIT-GLOBAL-001, -002)
  - 2026-10-08: `AuditQueries.list` + `validateFilters`/`pageQueryOf` (actorUserId, action en lista, aggregateType/Id, origin, correlationId, category, from/to en la zona del workspace; rango máximo de 366 días sin aggregateId ni correlationId ⇒ `VALIDATION_FAILED`; cursor firmado ligado a todos los filtros) y almacén Kysely; tests en `audit-global-view.test.ts` y `apps/api/test/api/audit-global.api.test.ts` (TC-AUDIT-GLOBAL-001, -002, -006, -007).
- [x] 3.2 `ExportAuditLog` (CSV con `CsvWriter`, TZ, neutralización, enmascarado, límite 50000, auditoría de la exportación) (TC-AUDIT-GLOBAL-003)
  - 2026-10-08: `AuditLogExporter` (application/audit-export.ts): CSV RFC 4180 con BOM, `csvCell`/`isoInTimeZone` del recorrido (D52), diff `campo: antes → después` con cada valor neutralizado, tope de 50000 filas (`VALIDATION_FAILED`), `audit.log.exported` (agregado `AuditLogExport`, con filtros y número de filas) en la misma unidad de trabajo, y 10 exportaciones por usuario y minuto en el controller (TC-AUDIT-GLOBAL-003). Desviación: la columna de actor lleva tipo e identificador (sin nombre visible), igual que el CSV del recorrido; IDENTITY no expone un directorio de nombres a AUDIT.
- [x] 3.3 `RecordAuthorizationDenial` con limitador y transacción propia; integración en el guard de `@pf/platform`; test: la falla de escritura no cambia el 403 (TC-AUDIT-GLOBAL-004, -005)
  - 2026-10-08: `AuthorizationDenialRecorder` (application/authorization-denial.ts) con limitador sobre el `RateLimiter` de la API (1 por usuario, workspace y operación por minuto), transacción propia en el workspace objetivo, comprobación de existencia (`iam.workspace_exists`), métricas `pf.authz.denied` y `pf.authz.denial_audit_failures`; el `IdentityAccessGuard` lo invoca antes de lanzar `INSUFFICIENT_ROLE`/`WORKSPACE_ACCESS_DENIED` y nunca cambia el 403 (el guard también captura una falla del puerto). Tests de aplicación y de API, incluida la falla inyectada del registrador (TC-AUDIT-GLOBAL-004, -005). `rbac-viewer.api.test.ts` ahora cuenta aparte los eventos de seguridad (los 4 rechazos quedan auditados).

## 4. INFRASTRUCTURE

- [x] 4.1 Migración expand de índices en `audit.audit_log`; plan de ejecución verificado con `EXPLAIN` sobre el dataset `large`
  - 2026-10-08: migración `20261008210000_audit_global_view.sql`: índices `audit_log_correlation_idx (workspace_id, correlation_id)` y `audit_log_action_idx (workspace_id, action, occurred_at DESC)` en la tabla padre (se propagan a las particiones) y `iam.workspace_exists(uuid)` (SECURITY DEFINER; el dueño ve solo la fila de la GUC local `pf.workspace_probe`). `test/db/audit-global-view.int.test.ts` siembra 300 000 registros en 12 meses (DEFAULT + mensuales), ejecuta ANALYZE y comprueba con `EXPLAIN` que correlación, actor+rango, acción rara y entidad usan sus índices por partición, sin `Seq Scan`. El filtro de seguridad usa `action = ANY(lista exacta)` (sin `LIKE`, que no usa el índice btree).

## 5. API

- [x] 5.1 Parámetros nuevos de `listAuditLog` y operación `exportAuditLog` (`x-required-role: OWNER`) en el contrato; tests de API por TC
  - 2026-10-08: `listAuditLog` con los parámetros nuevos (componentes `AuditActorUserId`, `AuditAction`, `AuditOriginFilter`, `AuditCorrelationId`, `AuditCategory`…) y `category` en `AuditLogEntry`; `exportAuditLog` (`x-required-role: OWNER`, `text/csv`); Spectral 0 errores y `pnpm contract:breaking` sin rupturas; `AuditLogEntry.category` queda opcional en el esquema (aditivo). Tests de API por TC en `audit-global.api.test.ts`.

## 6. UI

- [x] 6.1 Pantalla "Auditoría" (filtros, chips de categoría, detalle del diff, enlace al recorrido, botón exportar CSV solo para OWNER); i18n es/en/pt
  - 2026-10-08: pantalla `/configuracion/auditoria` (`ui/audit/AuditLogPage.tsx`, `logic.ts`): filtros (tipo de evento con chips Todos/Seguridad/Datos y `aria-pressed`, usuario, acción, tipo y elemento, operación, origen, rango), tabla con cursor ("Cargar más"), detalle con diff antes/después, enlaces a la operación, al historial del elemento y a su página, y exportar CSV solo para el OWNER (EDITOR ve la nota; VIEWER, sin acceso). Enlaces desde la configuración, desde el resultado de la edición masiva (`correlationId = bulkOperationId`) y desde el Recorrido (OWNER/EDITOR). i18n es/en/pt (`AuditLog`, `Transactions.bulk.auditLink`, `Lifecycle.auditLink`).

## 7. AUTOMATED TESTS y E2E

- [x] 7.1 Automatizar TC-AUDIT-GLOBAL-001..007 con el TC-ID en el nombre; actualizar front matter
  - 2026-10-08: TC-AUDIT-GLOBAL-001..007 automatizados con el TC-ID en el nombre de los tests (aplicación, API, plan EXPLAIN, UI y E2E) y front matter actualizado; `pnpm traceability:check` verde.
- [x] 7.2 E2E: filtrar por actor y exportar CSV como OWNER
  - 2026-10-08: `tests/e2e/specs/audit-global.spec.ts` (OWNER filtra por actor y acción, abre el detalle y exporta el CSV con BOM y celda neutralizada; EDITOR sin export; VIEWER sin acceso; el rechazo de un VIEWER aparece en la categoría Seguridad), más el enlace de la edición masiva (`bulk-edit.spec.ts`) y del Recorrido (`lifecycle.spec.ts`); `/configuracion/auditoria` en `a11y.spec.ts` (axe sin violaciones serias) y sin desborde horizontal a 360 px.

## 8. DOCUMENTATION

- [x] 8.1 Actualizar docs/10 §13 (`listAuditLog`, `exportAuditLog`), docs/12 §13.2 (fallos de autorización implementados, categoría de seguridad), docs/01 FR-AUDIT-005/006 y la matriz de trazabilidad; ejecutar `pnpm spec:validate` y `pnpm traceability:check`
  - 2026-10-08: docs/10 §13 (`listAuditLog`, `exportAuditLog`, permisos), docs/12 §13.2 (fallos de autorización implementados, categoría de seguridad), docs/01 FR-AUDIT-005/006, docs/18 (métricas `pf.authz.*`) y estado de los TC; `pnpm spec:validate` y `pnpm traceability:check` verdes. La matriz de trazabilidad se genera de los TC (`pnpm traceability:matrix`).
