---
id: TC-PLANNING-ACTUAL-003
title: 'Un gasto se asigna al periodo por su fecha de negocio en la zona del workspace'
spec: planning/budgets
related_specs: []
requirement: 'Gasto real derivado de transacciones posteadas'
scenario: 'Gasto de medianoche asignado por fecha de negocio'
requirement_status: confirmed
fr: ['FR-PLANNING-023']
nfr: ['NFR-USAB-004']
invariants: ['INV-034']
priority: high
type: integration
level: application
automation_status: automated
automated_tests:
  - apps/api/test/api/budgets.api.test.ts
  - packages/contexts/planning/src/application/budgets.service.test.ts
status: automated
regression_suite: false
phase: 2
tags: ['budgets', 'actual', 'timezone']
error_code: null
preconditions:
  - 'Workspace con moneda base BOB, TZ America/La_Paz y día de inicio del mes 1 (FixedClock)'
  - 'Planes de "2026-11" y "2026-12" con "Restaurantes"'
input:
  expense: '40.00 BOB, fecha de negocio 2026-11-30, registrado 2026-12-01T02:30:00Z'
steps:
  - 'Registrar el gasto'
  - 'Consultar ambos planes'
expected_result:
  - 'Cuenta en "2026-11"'
  - 'No cuenta en "2026-12"'
created: 2026-10-05
updated: 2026-10-08
---

# TC-PLANNING-ACTUAL-003 — Un gasto se asigna al periodo por su fecha de negocio en la zona del workspace

## Intención

RISK-020: bordes de mes por TZ; la fecha de negocio manda, no el instante UTC.

## Escenario

```gherkin
Dado un gasto de 40.00 BOB con fecha de negocio 2026-11-30 registrado a las 22:30 de La Paz (02:30Z del 1 de diciembre)
Cuando consulto los planes
Entonces cuenta en "2026-11" y no en "2026-12"
```

## Notas

- Ejecutar también con TZ del proceso forzada a UTC.
