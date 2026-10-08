---
id: TC-PLANNING-FISCALDAY-001
title: Cambiar el día de inicio de 1 a 25 recalcula solo los periodos en borrador conservando su identidad
spec: planning/financial-periods
related_specs: []
requirement: Cambio del día de inicio solo hacia adelante
scenario: Cambio de día 1 a día 25
requirement_status: confirmed
fr:
  - FR-PLANNING-001
  - FR-IDENTITY-005
nfr: []
invariants:
  - INV-015
priority: critical
type: integration
level: application
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: true
phase: 2
tags:
  - financial-periods
  - fiscal-day
error_code: null
preconditions:
  - Hoy es 2026-10-05; "2026-10" (2026-10-01..2026-10-31) active
  - '"2026-11", "2026-12" y "2027-01" en draft con día de inicio 1'
  - '"2026-12" tiene un plan con 1500.00 BOB para "Supermercado" (fake del plan si pf-p2b no existe)'
input:
  fiscalMonthStartDay:
    before: 1
    after: 25
steps:
  - El OWNER cambia el día de inicio a 25
  - Procesar identity.WorkspaceSettingsChanged.v1
expected_result:
  - '"2026-10" no cambia'
  - '"2026-11" = 2026-11-01..2026-12-24 marcado como transición, mismo id'
  - '"2026-12" = 2026-12-25..2027-01-24, mismo id, y su plan sigue con 1500.00 BOB para "Supermercado"'
  - '"2027-01" = 2027-01-25..2027-02-24, mismo id'
  - La auditoría de cada periodo recalculado registra el rango anterior y el nuevo
created: 2026-10-05
updated: 2026-10-08
---

# TC-PLANNING-FISCALDAY-001 — Cambiar el día de inicio de 1 a 25 recalcula solo los periodos en borrador conservando su identidad

## Intención

El setting existe desde Phase 1; cambiarlo no puede reescribir periodos activos o cerrados ni perder los planes de los futuros.

## Escenario

```gherkin
Dado "2026-10" active y "2026-11", "2026-12", "2027-01" en draft con día de inicio 1
Cuando el OWNER cambia el día de inicio a 25
Entonces "2026-10" no cambia
  Y "2026-11" va del 2026-11-01 al 2026-12-24 marcado como transición
```

## Notas

- Cubre "Planes conservados tras el recálculo"; el reverso (25 a 1) lo cubre TC-PLANNING-FISCALDAY-002.
