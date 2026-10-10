---
id: TC-DEBT-CARD-023
title: 'Cuotas con interés por sistema francés al 24 % anual'
spec: debt/credit-cards
related_specs: []
requirement: 'Compras en cuotas con interés'
scenario: '1200.00 BOB en 3 cuotas al 24 % anual'
requirement_status: provisional
fr: ['FR-DEBT-017']
nfr: []
invariants: ['INV-017', 'INV-020']
priority: low
type: property
level: domain
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 4
tags: ['credit-cards', 'installments', 'french']
error_code: null
preconditions:
  - 'Compra posteada de 1200.00 BOB en "Visa Oro BOB"'
input:
  count: '3'
  annualRate: '24.00 %'
steps:
  - 'Crear el plan'
expected_result:
  - '416.11 (392.11 + 24.00), 416.11 (399.95 + 16.16), 416.10 (407.94 + 8.16) BOB'
  - 'Σ capital 1200.00 BOB, interés proyectado 48.32 BOB'
  - 'Ningún gasto de interés registrado'
created: 2026-10-10
updated: 2026-10-10
---

# TC-DEBT-CARD-023 — Cuotas con interés por sistema francés al 24 % anual

## Intención

El interés proyectado no se postea; Σ capital exacto.

## Escenario

```gherkin
Dado una compra de 1200.00 BOB
Cuando creo un plan de 3 cuotas al 24.00 % anual
Entonces las cuotas son 416.11, 416.11 y 416.10 BOB
```

## Notas

- Change: `add-credit-cards` (borrador; cifras con `FixedClock` en America/La_Paz).
