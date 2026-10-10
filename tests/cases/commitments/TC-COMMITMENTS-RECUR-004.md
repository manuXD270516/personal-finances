---
id: TC-COMMITMENTS-RECUR-004
title: 'Una transferencia recurrente de misma moneda se materializa como una transferencia'
spec: commitments/recurrence-engine
related_specs: []
requirement: 'Transferencia recurrente de una sola moneda'
scenario: 'Aporte mensual a ahorro'
requirement_status: confirmed
fr: ['FR-COMMITMENTS-001']
nfr: []
invariants: []
priority: high
type: integration
level: application
automation_status: automated
automated_tests:
  - apps/api/test/api/recurring.api.test.ts
  - packages/contexts/commitments/src/application/recurrence.service.test.ts
  - packages/contexts/commitments/src/domain/definition.test.ts
status: automated
regression_suite: false
phase: 3
tags: ['recurrence', 'transfer']
error_code: null
preconditions:
  - 'Cuentas "Banco BOB" y "Ahorro BOB" en BOB; tarjeta "Tarjeta X" pasivo en BOB'
  - 'Hoy 2026-11-01'
input:
  definition: 'TRANSFER 500.00 BOB Banco BOB → Ahorro BOB, MONTHLY día 1, PENDING_APPROVAL'
  card: 'TRANSFER 1450.00 BOB Banco BOB → Tarjeta X, día 6'
  invalid: 'TRANSFER 100.00 USD Banco USD → Banco BOB'
steps:
  - 'Crear la definición de aporte y aprobar la ocurrencia del 2026-11-01'
  - 'Crear la transferencia a la tarjeta'
  - 'Crear la transferencia entre monedas'
expected_result:
  - 'Se crea UNA transferencia de 500.00 BOB Banco BOB → Ahorro BOB con origen recurrente'
  - 'La transferencia a la tarjeta queda activa con kind TRANSFER'
  - 'La transferencia entre monedas se rechaza con TRANSFER_CURRENCY_MISMATCH'
created: 2026-10-09
updated: 2026-10-10
---

# TC-COMMITMENTS-RECUR-004 — Una transferencia recurrente de misma moneda se materializa como una transferencia

## Intención

Las transferencias recurrentes usan el comando de transferencias de Transactions; el pago de tarjeta es transferencia (D27).

## Escenario

```gherkin
Dado una transferencia recurrente de 500.00 BOB de "Banco BOB" a "Ahorro BOB" el día 1
Cuando el EDITOR aprueba la ocurrencia del 2026-11-01
Entonces se crea una transferencia de 500.00 BOB entre esas cuentas
```

## Notas

- Cubre los scenarios "Pago de tarjeta como transferencia" y "Transferencia entre monedas rechazada".
