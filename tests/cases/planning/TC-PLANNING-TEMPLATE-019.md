---
id: TC-PLANNING-TEMPLATE-019
title: 'VIEWER lee templates sin versionarlos y la aplicación queda auditada'
spec: planning/budget-templates
related_specs: ['planning/budgets', 'security/access-control', 'audit/audit-trail']
requirement: 'Permisos y auditoría de templates'
scenario: 'VIEWER no versiona'
requirement_status: provisional
fr: ['FR-IDENTITY-006', 'FR-AUDIT-001']
nfr: []
invariants: ['INV-029']
priority: high
type: api
level: api
automation_status: not_automated
automated_tests: []
status: ready
regression_suite: false
phase: 2
tags: ['templates', 'rbac', 'audit']
error_code: INSUFFICIENT_ROLE
preconditions:
  - '"Mes estándar" con versión 1 (Alquiler fijo 2800.00, Supermercado máximo 1500.00, Salario esperado 8000.00 BOB) y versión 2 (Supermercado 1600.00 BOB, resto igual)'
  - 'Miembros VIEWER y EDITOR'
input:
  viewerAction: 'POST versions'
  editorAction: 'apply Mes estándar v2 a 2026-11'
steps:
  - 'El VIEWER consulta y luego intenta publicar una versión'
  - 'El EDITOR aplica el template'
  - 'Consultar el historial'
expected_result:
  - 'Lectura 200; publicación 403 INSUFFICIENT_ROLE'
  - 'El historial registra al EDITOR, el plan creado, template y versión de origen y las omitidas'
created: 2026-10-05
updated: 2026-10-05
---

# TC-PLANNING-TEMPLATE-019 — VIEWER lee templates sin versionarlos y la aplicación queda auditada

## Intención

FR-IDENTITY-006 y FR-AUDIT-001.

## Escenario

```gherkin
Dado un VIEWER
Cuando intenta crear una versión de "Mes estándar"
Entonces se rechaza con INSUFFICIENT_ROLE
Cuando el EDITOR aplica la versión 2 a "2026-11"
Entonces el historial registra el origen del plan
```

## Notas

- Cubre también el scenario "Aplicación auditada".
