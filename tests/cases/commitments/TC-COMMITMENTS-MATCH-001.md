---
id: TC-COMMITMENTS-MATCH-001
title: 'Un gasto manual compatible genera una sugerencia de confianza alta sin resolver la ocurrencia'
spec: commitments/recurrence-engine
related_specs: []
requirement: 'Sugerencia de coincidencia para una transacción registrada'
scenario: 'Gasto manual sugerido para el internet'
requirement_status: provisional
fr: ['FR-COMMITMENTS-010']
nfr: []
invariants: ['INV-028']
priority: high
type: integration
level: application
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 3
tags: ['matching']
error_code: null
preconditions:
  - 'Ocurrencia DUE del Internet FIXED 199.00 BOB en Banco BOB, vencimiento 2026-10-20, sin contraparte en la transacción'
  - 'Tolerancias por defecto (±2 %, ±5 días)'
input:
  transaction: 'EXPENSE 199.00 BOB Banco BOB 2026-10-19 sin contraparte, origin MANUAL'
steps:
  - 'Registrar el gasto'
  - 'Procesar TransactionCreated.v1 en commitments.occurrence-matcher'
  - 'Entregar el mismo hecho otra vez'
expected_result:
  - 'Una sugerencia PROPOSED con score 85.00 (50 + 25 + 10), confianza HIGH, amountDelta 0.00 BOB, dateDeltaDays 1'
  - 'La ocurrencia sigue DUE y la transacción sin vincular'
  - 'La reentrega no crea otra sugerencia (inbox + UNIQUE)'
created: 2026-10-09
updated: 2026-10-09
---

# TC-COMMITMENTS-MATCH-001 — Un gasto manual compatible genera una sugerencia de confianza alta sin resolver la ocurrencia

## Intención

FR-COMMITMENTS-010: sugerencia explicable e idempotente.

## Escenario

```gherkin
Dado la ocurrencia del "Internet" de 199.00 BOB del 2026-10-20
Cuando el usuario registra a mano un gasto de 199.00 BOB el 2026-10-19 en "Banco BOB"
Entonces existe una sugerencia con confianza alta
  Y la ocurrencia sigue sin resolver
```

## Notas

- Cubre el scenario "Hecho entregado dos veces".
