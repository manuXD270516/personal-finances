---
id: TC-PLANNING-FISCALDAY-002
title: Cambiar el día de inicio de 25 a 1 crea un periodo de transición corto
spec: planning/financial-periods
related_specs: []
requirement: Cambio del día de inicio solo hacia adelante
scenario: Cambio de día 25 a día 1
requirement_status: confirmed
fr:
  - FR-PLANNING-001
  - FR-IDENTITY-005
nfr: []
invariants: []
priority: high
type: domain
level: domain
automation_status: automated
automated_tests:
  - packages/contexts/planning/src/domain/period-calendar.test.ts
status: automated
regression_suite: false
phase: 2
tags:
  - financial-periods
  - fiscal-day
error_code: null
preconditions:
  - '"2026-10" (2026-10-25..2026-11-24) active'
  - Periodos siguientes en draft con día 25
input:
  fiscalMonthStartDay:
    before: 25
    after: 1
steps:
  - Recalcular los periodos en draft con el nuevo día de inicio
expected_result:
  - '"2026-11" = 2026-11-25..2026-11-30 marcado como transición'
  - '"2026-12" = 2026-12-01..2026-12-31'
  - Las etiquetas siguen siendo únicas y los periodos contiguos
created: 2026-10-05
updated: 2026-10-08
---

# TC-PLANNING-FISCALDAY-002 — Cambiar el día de inicio de 25 a 1 crea un periodo de transición corto

## Intención

La regla de transición debe funcionar en ambos sentidos sin solapes ni etiquetas repetidas.

## Escenario

```gherkin
Dado "2026-10" active del 2026-10-25 al 2026-11-24
Cuando el día de inicio cambia a 1
Entonces "2026-11" va del 2026-11-25 al 2026-11-30 marcado como transición
  Y "2026-12" va del 2026-12-01 al 2026-12-31
```

## Notas

- Sin notas adicionales.
