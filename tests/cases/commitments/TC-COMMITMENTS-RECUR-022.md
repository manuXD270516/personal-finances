---
id: TC-COMMITMENTS-RECUR-022
title: 'En solo aviso la ocurrencia avisa sin crear transacción ni entrar en la bandeja'
spec: commitments/recurrence-engine
related_specs: []
requirement: 'Modo solo aviso'
scenario: 'Débito automático del banco'
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
tags: ['recurrence', 'notify-only']
error_code: null
preconditions:
  - 'Luz ESTIMATED 150.00 BOB, NOTIFY_ONLY, vencimiento 2026-10-25, leadDays 3'
  - 'Hoy 2026-10-22'
input: {}
steps:
  - 'Ejecutar el job'
  - 'Listar la bandeja por aprobar'
expected_result:
  - 'RecurringOccurrenceDue.v1 con requiresApproval false'
  - 'Sin transacción'
  - 'La ocurrencia no está en la bandeja'
created: 2026-10-09
updated: 2026-10-09
---

# TC-COMMITMENTS-RECUR-022 — En solo aviso la ocurrencia avisa sin crear transacción ni entrar en la bandeja

## Intención

FR-COMMITMENTS-007: modo recordatorio para débitos automáticos.

## Escenario

```gherkin
Dado la "Luz" estimada en 150.00 BOB en solo aviso
Cuando pasa a próxima
Entonces se genera el aviso y no se crea ninguna transacción
```

## Notas

- Depende de la pregunta abierta 1 de design.md.
