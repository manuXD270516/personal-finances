---
id: TC-DEBT-CARD-024
title: 'El saldo facturado descuenta cuotas futuras y el calendario lista los cargos'
spec: debt/credit-cards
related_specs: []
requirement: 'Cuotas en el saldo facturado y calendario de cargos futuros'
scenario: 'Primer ciclo de la laptop'
requirement_status: confirmed
fr: ['FR-DEBT-017', 'FR-DEBT-013']
nfr: []
invariants: []
priority: medium
type: domain
level: domain
automation_status: automated
automated_tests:
  - apps/api/test/api/credit-cards.api.test.ts
  - packages/contexts/debt/src/application/cards.service.test.ts
  - packages/contexts/debt/src/domain/card-cycle-calculator.test.ts
  - packages/contexts/debt/src/domain/credit-card.test.ts
  - packages/contexts/debt/src/domain/utilization.test.ts
status: automated
regression_suite: false
phase: 4
tags: ['credit-cards', 'installments', 'calendar']
error_code: null
preconditions:
  - 'Workspace en BOB con zona America/La_Paz'
  - 'Tarjeta "Visa Oro": cierre día 25, vencimiento día 15, ajuste NONE; cuenta "Visa Oro BOB" (credit_card, BOB) límite 10000.00 BOB, mínimo 5.00 % con piso 50.00 BOB'
  - '"Visa Oro BOB" solo tiene "Laptop" 1000.00 BOB en 3 cuotas sin interés'
input:
  today: '2026-10-20 / cierre 2026-10-25'
steps:
  - 'Calcular el ciclo que cierra el 2026-10-25'
  - 'Consultar el calendario de cargos futuros el 2026-10-20'
expected_result:
  - 'Saldo al cierre 1000.00, facturado 333.33, mínimo 50.00 BOB, utilización 10.00 %'
  - 'Calendario: 333.33 al 2026-11-15, 333.33 al 2026-12-15, 333.34 al 2027-01-15'
created: 2026-10-10
updated: 2026-10-10
---

# TC-DEBT-CARD-024 — El saldo facturado descuenta cuotas futuras y el calendario lista los cargos

## Intención

Las cuotas no facturadas consumen límite pero no se facturan.

## Escenario

```gherkin
Dado "Laptop" en 3 cuotas
Cuando cierra el ciclo del 2026-10-25
Entonces el saldo facturado es 333.33 BOB y la utilización 10.00 %
```

## Notas

- Cubre "Calendario de cargos futuros".
- Change: `add-credit-cards` (borrador; cifras con `FixedClock` en America/La_Paz).
