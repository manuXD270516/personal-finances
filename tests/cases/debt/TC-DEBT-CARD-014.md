---
id: TC-DEBT-CARD-014
title: 'Los montos informados por el banco prevalecen y muestran la diferencia'
spec: debt/credit-cards
related_specs: []
requirement: 'Montos informados por el banco'
scenario: 'Extracto del banco con intereses no registrados'
requirement_status: provisional
fr: ['FR-DEBT-013']
nfr: []
invariants: []
priority: low
type: api
level: api
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 4
tags: ['credit-cards', 'reported']
error_code: null
preconditions:
  - 'Workspace en BOB con zona America/La_Paz'
  - 'Tarjeta "Visa Oro": cierre día 25, vencimiento día 15, ajuste NONE; cuenta "Visa Oro BOB" (credit_card, BOB) límite 10000.00 BOB, mínimo 5.00 % con piso 50.00 BOB'
  - 'Movimientos posteados de "Visa Oro BOB": saldo 1200.00 BOB al 2026-09-25; pago 1200.00 BOB el 2026-10-10; compras 350.00 (2026-10-03) y 820.50 BOB (2026-10-18); reembolso 50.00 BOB (2026-10-20); compra 400.00 BOB (2026-10-26)'
  - 'Usuario EDITOR'
input:
  reportedBilled: '1125.30 BOB'
  reportedMinimum: '56.30 BOB'
steps:
  - 'PATCH del estado de cuenta con If-Match'
expected_result:
  - 'Sin intereses 1125.30, mínimo 56.30 BOB, diferencia 4.80 BOB'
  - 'Ningún asiento nuevo'
created: 2026-10-10
updated: 2026-10-10
---

# TC-DEBT-CARD-014 — Los montos informados por el banco prevalecen y muestran la diferencia

## Intención

Permite alinear el cálculo con el extracto real sin tocar el ledger.

## Escenario

```gherkin
Dado el estado de cuenta calculado en 1120.50 BOB
Cuando registro 1125.30 BOB y mínimo 56.30 BOB del banco
Entonces se usan esos montos con una diferencia de 4.80 BOB
```

## Notas

- Change: `add-credit-cards` (borrador; cifras con `FixedClock` en America/La_Paz).
