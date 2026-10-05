---
id: TC-PLANNING-BUDGET-013
title: 'VIEWER lee el plan sin poder editarlo y cada cambio queda auditado'
spec: planning/budgets
related_specs: ['security/access-control', 'audit/audit-trail']
requirement: 'Permisos y auditoría del plan'
scenario: 'Cambio auditado'
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
tags: ['budgets', 'rbac', 'audit']
error_code: INSUFFICIENT_ROLE
preconditions:
  - 'Periodo "2026-11" (2026-11-01 a 2026-11-30) en estado activo con plan en BOB'
  - 'Miembros: EDITOR y VIEWER'
  - '"Supermercado" con máximo 1500.00 BOB'
input:
  viewerLine: 'Restaurantes MAXIMUM 600.00 BOB'
  editorChange: 'Supermercado 1500.00 → 1400.00 BOB'
steps:
  - 'El VIEWER consulta el plan'
  - 'El VIEWER intenta agregar una línea'
  - 'El EDITOR cambia el máximo de "Supermercado"'
  - 'Consultar el historial del plan'
expected_result:
  - 'El VIEWER obtiene 200 con el progreso'
  - 'La escritura del VIEWER responde 403 INSUFFICIENT_ROLE'
  - 'El historial registra al EDITOR, la línea, antes 1500.00 BOB y después 1400.00 BOB, en la misma transacción que el cambio'
created: 2026-10-05
updated: 2026-10-05
---

# TC-PLANNING-BUDGET-013 — VIEWER lee el plan sin poder editarlo y cada cambio queda auditado

## Intención

FR-IDENTITY-006 y FR-AUDIT-001 (INV-029): la configuración del plan es auditada y solo EDITOR/OWNER la cambian.

## Escenario

```gherkin
Dado un VIEWER y un EDITOR del workspace
Cuando el VIEWER consulta el plan e intenta agregar una línea
Entonces la consulta responde y la escritura se rechaza con INSUFFICIENT_ROLE
Cuando el EDITOR cambia "Supermercado" de 1500.00 a 1400.00 BOB
Entonces el historial registra antes 1500.00 BOB y después 1400.00 BOB
```

## Notas

- Cubre también el scenario "VIEWER lee pero no edita".
