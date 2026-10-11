---
id: TC-DEBT-CARD-020
title: 'Utilización con límite compartido, compras pendientes y sin tasa'
spec: debt/credit-cards
related_specs: []
requirement: 'Utilización y crédito disponible'
scenario: 'Límite compartido'
requirement_status: confirmed
fr: ['FR-DEBT-015', 'FR-DEBT-016']
nfr: []
invariants: ['INV-002']
priority: high
type: domain
level: application
automation_status: automated
automated_tests:
  - apps/web/src/ui/debt/cards/logic.test.ts
  - packages/contexts/debt/src/application/cards.service.test.ts
  - packages/contexts/debt/src/domain/utilization.test.ts
status: automated
regression_suite: false
phase: 4
tags: ['credit-cards', 'utilization', 'fx']
error_code: null
preconditions:
  - 'Workspace en BOB con zona America/La_Paz'
  - 'Visa Oro con límite compartido 15000.00 BOB; tasa de valoración USD/BOB 9.80'
input:
  debts: 'Visa Oro BOB 3600.00 BOB, Visa Oro USD 100.00 USD'
  separate: 'límite 10000.00 BOB, adeuda 1120.50 + pendiente 75.00 BOB'
  noRate: 'sin tasa USD/BOB'
steps:
  - 'Consultar la utilización en cada caso'
expected_result:
  - 'Compartido: usado 4580.00 BOB, 30.53 %, disponible 10420.00 BOB'
  - 'Separado: usado 1195.50 BOB, 11.96 %, disponible 8804.50 BOB'
  - 'Sin tasa: utilización no disponible por falta de USD; sin disponible; nunca 1:1'
created: 2026-10-10
updated: 2026-10-10
---

# TC-DEBT-CARD-020 — Utilización con límite compartido, compras pendientes y sin tasa

## Intención

FR-DEBT-015 y RISK-017: valoración con FlowValuation sin tasas inventadas.

## Escenario

```gherkin
Dado un límite compartido de 15000.00 BOB y USD/BOB 9.80
Cuando "Visa Oro" adeuda 3600.00 BOB y 100.00 USD
Entonces la utilización es 30.53 % y el disponible 10420.00 BOB
```

## Notas

- Cubre "Compra pendiente usa crédito" y "Sin tasa para el dólar".
- Change: `add-credit-cards` (borrador; cifras con `FixedClock` en America/La_Paz).
