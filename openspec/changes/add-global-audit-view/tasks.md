# Tareas

> Requiere aplicados: `add-audit-trail`, `add-workspace-identity`, `add-lifecycle-timeline`. Se beneficia de `add-bulk-edit`, `add-reconciliation`, `add-workspace-export` y de la reapertura de periodos de pf-p2a.

## 1. SPEC y TEST CASES

- [ ] 1.1 Revisar con el owner los requirements añadidos a `audit/audit-trail` y las preguntas abiertas 1–2 de design.md; verificar con `openspec validate add-global-audit-view --strict`
- [ ] 1.2 Revisar TC-AUDIT-GLOBAL-001..007; pasar a `ready` y `requirement_status: confirmed` al aprobar

## 2. DOMAIN (TDD)

- [ ] 2.1 `AuditActionCategory` y test de catálogo (toda acción emitida catalogada) (TC-AUDIT-GLOBAL-006)

## 3. APPLICATION

- [ ] 3.1 `SearchAuditLog` con filtros combinables, rango máximo y cursor (TC-AUDIT-GLOBAL-001, -002)
- [ ] 3.2 `ExportAuditLog` (CSV con `CsvWriter`, TZ, neutralización, enmascarado, límite 50000, auditoría de la exportación) (TC-AUDIT-GLOBAL-003)
- [ ] 3.3 `RecordAuthorizationDenial` con limitador y transacción propia; integración en el guard de `@pf/platform`; test: la falla de escritura no cambia el 403 (TC-AUDIT-GLOBAL-004, -005)

## 4. INFRASTRUCTURE

- [ ] 4.1 Migración expand de índices en `audit.audit_log`; plan de ejecución verificado con `EXPLAIN` sobre el dataset `large`

## 5. API

- [ ] 5.1 Parámetros nuevos de `listAuditLog` y operación `exportAuditLog` (`x-required-role: OWNER`) en el contrato; tests de API por TC

## 6. UI

- [ ] 6.1 Pantalla "Auditoría" (filtros, chips de categoría, detalle del diff, enlace al recorrido, botón exportar CSV solo para OWNER); i18n es/en/pt

## 7. AUTOMATED TESTS y E2E

- [ ] 7.1 Automatizar TC-AUDIT-GLOBAL-001..007 con el TC-ID en el nombre; actualizar front matter
- [ ] 7.2 E2E: filtrar por actor y exportar CSV como OWNER

## 8. DOCUMENTATION

- [ ] 8.1 Actualizar docs/10 §13 (`listAuditLog`, `exportAuditLog`), docs/12 §13.2 (fallos de autorización implementados, categoría de seguridad), docs/01 FR-AUDIT-005/006 y la matriz de trazabilidad; ejecutar `pnpm spec:validate` y `pnpm traceability:check`
