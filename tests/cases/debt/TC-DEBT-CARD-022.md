---
id: TC-DEBT-CARD-022
title: 'Compra en 3 cuotas sin interés con residuo en la última'
spec: debt/credit-cards
related_specs: []
requirement: 'Compras en cuotas sin interés'
scenario: 'Laptop en 3 cuotas'
requirement_status: confirmed
fr: ['FR-DEBT-017']
nfr: []
invariants: ['INV-020', 'INV-017']
priority: medium
type: property
level: domain
automation_status: automated
automated_tests:
  - apps/api/test/api/credit-cards.api.test.ts
  - apps/web/src/ui/debt/cards/cards.test.tsx
  - packages/contexts/debt/src/application/cards.service.test.ts
  - packages/contexts/debt/src/domain/credit-card.test.ts
  - packages/contexts/debt/src/domain/installment-scheduler.test.ts
status: automated
regression_suite: false
phase: 4
tags: ['credit-cards', 'installments']
error_code: INSTALLMENT_PLAN_INVALID
preconditions:
  - 'Workspace en BOB con zona America/La_Paz'
  - 'Tarjeta "Visa Oro": cierre día 25, vencimiento día 15, ajuste NONE; cuenta "Visa Oro BOB" (credit_card, BOB) límite 10000.00 BOB, mínimo 5.00 % con piso 50.00 BOB'
  - 'Compra posteada "Laptop" 1000.00 BOB del 2026-10-05 en "Visa Oro BOB"'
input:
  count: '3'
  annualRate: '0'
steps:
  - 'Crear el plan de cuotas'
  - 'Intentar un plan sobre un gasto de "Banco BOB"'
expected_result:
  - 'Cuotas 333.33, 333.33, 333.34 BOB en los cierres 2026-10-25, 2026-11-25, 2026-12-25'
  - 'Σ = 1000.00 BOB; deuda sigue en 1000.00 BOB; sin asientos'
  - 'Gasto de otra cuenta: 422 INSTALLMENT_PLAN_INVALID'
  - 'PBT: Σ capital = compra'
created: 2026-10-10
updated: 2026-10-10
---

# TC-DEBT-CARD-022 — Compra en 3 cuotas sin interés con residuo en la última

## Intención

FR-DEBT-017 con la regla de residuo en la última cuota (INV-017/020).

## Escenario

```gherkin
Dado la compra "Laptop" de 1000.00 BOB
Cuando creo un plan de 3 cuotas sin interés
Entonces las cuotas son 333.33, 333.33 y 333.34 BOB
```

## Notas

- Cubre "Gasto de otra cuenta".
- Change: `add-credit-cards` (borrador; cifras con `FixedClock` en America/La_Paz).
