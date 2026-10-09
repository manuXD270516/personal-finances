# Propuesta: add-global-audit-view

## Why

Phase 1 dejó el log de auditoría consultable por entidad y por rango de fechas (`GET W/audit-log`, OWNER/EDITOR, D22/D28), pero sin la **vista global** que pide FR-AUDIT-006 (Should, Phase 2): filtros por actor, acción y entidad, y export CSV solo para el OWNER. Phase 2 agrega operaciones que la necesitan: ediciones masivas con `bulkOperationId` (`add-bulk-edit`), sesiones de reconciliación (`add-reconciliation`), exportaciones e importaciones del workspace (`add-workspace-export`) y reaperturas de periodos (pf-p2a), varias de ellas eventos de seguridad de FR-AUDIT-005 (Phase 2: fallo de autorización, export, reapertura de periodo, cambio de configuración). docs/24 §5.2 incluye "audit global" en el alcance de Phase 2. La capability existente `audit/audit-trail` es el lugar natural (no se necesita una nueva).

## What Changes

- `GET W/audit-log` gana filtros combinables: `actorUserId`, `action` (lista), `aggregateType`, `aggregateId`, `origin`, `correlationId`, `category` (`SECURITY` | `DATA`) y rango; orden del más reciente al más antiguo, cursor.
- Agrupación por operación: filtro por `correlationId` (que en una edición masiva es el `bulkOperationId`).
- Exportación CSV del log (`GET W/audit-log/export?format=csv&…`, solo OWNER, síncrona hasta 50000 registros, CSV injection neutralizada, TZ del workspace, campos sensibles enmascarados) auditada como `audit.log.exported`.
- Auditoría de **fallos de autorización** (`INSUFFICIENT_ROLE`, `WORKSPACE_ACCESS_DENIED`) como eventos de seguridad, con limitación a uno por (usuario, workspace, operación) por minuto.
- Clasificación de acciones en categoría `SECURITY` o `DATA` (catálogo en código) para la vista de eventos de seguridad.
- Pantalla "Auditoría" en la configuración del workspace (OWNER/EDITOR) con filtros, detalle del diff y enlace al recorrido del elemento.
- **Fuera de alcance:** retención configurable (FR-AUDIT-007, Phase 9), hash encadenado (FR-AUDIT-008, Phase 9), export PDF del log, alertas sobre eventos de seguridad (Phase 9), auditoría de lecturas fuera de las descargas de exports y documentos.

## Capabilities

### New Capabilities
- Ninguna.

### Modified Capabilities
- `audit/audit-trail`: ADDED 5 requirements (consulta global con filtros, agrupación por operación, export CSV, fallos de autorización auditados, vista de eventos de seguridad). No se modifican los requirements de Phase 1 (la lectura sigue restringida a OWNER/EDITOR, D28).

## Impact

**Specs impactadas:** `audit/audit-trail` (+5 requirements: 1 Must, 4 Should).

**Componentes/contextos impactados:** AUDIT (`@pf/audit`): query `SearchAuditLog` (application) y `ExportAuditLog`; catálogo `AuditActionCategory`; registrador de fallos de autorización `AuthorizationDenialRecorder` invocado por el guard de roles/membresía de `@pf/platform` (interface) con escritura en una transacción propia (el request rechazado no tiene UoW). `apps/api` y `apps/web` (pantalla de auditoría).

**APIs impactadas:** `contracts/openapi/finance-api.v1.yaml` — `listAuditLog` con parámetros nuevos `actorUserId`, `action`, `origin`, `correlationId`, `category` (aditivos); nueva `exportAuditLog` (`GET W/audit-log/export`, `text/csv`, `x-required-role: OWNER`). Sin códigos nuevos.

**Tablas impactadas:** `audit.audit_log` — índices nuevos `(workspace_id, correlation_id)` y `(workspace_id, action, occurred_at DESC)`; sin columnas nuevas (la categoría se deriva de `action`).

**Eventos impactados:** ninguno.

**Migraciones requeridas:** expand, no destructiva: índices sobre la tabla particionada `audit.audit_log` (creados por partición y en la tabla padre).

**Invariantes afectadas:** INV-029 (los fallos de autorización se registran sin una mutación asociada: excepción documentada, ver design.md), INV-025/RLS (aislamiento de la consulta).

**Test cases:** AÑADIDOS — TC-AUDIT-GLOBAL-001..007 (`draft`/`ready`, `not_automated`). MODIFICADOS — ninguno (TC-AUDIT-RANGE-001 y TC-AUDIT-ACCESS-* siguen válidos). DEPRECADOS — ninguno.

**Impacto de regresión:** la consulta existente por entidad y rango no cambia; el guard de autorización gana un efecto lateral (escritura de auditoría en transacción propia, con límite por minuto) que no debe alterar la respuesta 403; si la escritura falla, la respuesta sigue siendo 403 y se registra la falla en logs y métricas.

**Riesgos introducidos:** amplificación de escrituras por fallos de autorización repetidos (mitigado con límite por minuto); consultas costosas sobre particiones antiguas (mitigado con índices y rango máximo de 366 días por consulta sin `aggregateId`).
