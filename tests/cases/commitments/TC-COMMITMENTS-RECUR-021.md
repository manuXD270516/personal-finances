---
id: TC-COMMITMENTS-RECUR-021
title: 'En aprobación pendiente la ocurrencia próxima aparece por aprobar y no crea transacción'
spec: commitments/recurrence-engine
related_specs: []
requirement: 'Modo aprobación pendiente'
scenario: 'Alquiler por aprobar'
requirement_status: provisional
fr: ['FR-COMMITMENTS-007']
nfr: []
invariants: []
priority: high
type: integration
level: application
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 3
tags: ['recurrence', 'approval']
error_code: null
preconditions:
  - 'Alquiler FIXED 3500.00 BOB, PENDING_APPROVAL, leadDays 3'
  - 'Hoy 2026-11-02'
input: {}
steps:
  - 'Ejecutar el job'
  - 'Listar ocurrencias con requiresApproval=true'
expected_result:
  - 'La ocurrencia 2026-11-05 está DUE con requiresApproval true'
  - 'No existe transacción para ella'
  - 'Aparece en la bandeja por aprobar'
created: 2026-10-09
updated: 2026-10-09
---

# TC-COMMITMENTS-RECUR-021 — En aprobación pendiente la ocurrencia próxima aparece por aprobar y no crea transacción

## Intención

FR-COMMITMENTS-007: el usuario decide.

## Escenario

```gherkin
Dado el "Alquiler" de 3500.00 BOB en aprobación pendiente
Cuando pasa a próxima para el 2026-11-05
Entonces no se crea ninguna transacción
  Y aparece en la bandeja "por aprobar"
```

## Notas

- Depende de la pregunta abierta 1 de design.md.
