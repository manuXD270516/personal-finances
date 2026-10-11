---
id: TC-DEBT-CARD-032
title: 'Vencimientos de tarjeta en la lista de próximos pagos'
spec: reporting/cash-flow-calendar
related_specs: ['debt/credit-cards', 'commitments/recurrence-engine']
requirement: 'Vencimientos de tarjeta en los próximos pagos'
scenario: 'Estado de cuenta emitido en la lista de 30 días'
requirement_status: confirmed
fr: ['FR-REPORTING-016', 'FR-DEBT-013', 'FR-COMMITMENTS-011']
nfr: []
invariants: []
priority: critical
type: integration
level: application
automation_status: automated
automated_tests:
  - apps/api/test/api/credit-cards.api.test.ts
  - apps/web/src/ui/debt/cards/cards.test.tsx
  - tests/e2e/specs/credit-cards.spec.ts
status: automated
regression_suite: false
phase: 4
tags: ['upcoming-payments', 'credit-cards']
error_code: null
preconditions:
  - 'Workspace en BOB con zona America/La_Paz'
  - 'Hoy 2026-11-01; tasa USD/BOB 9.80'
  - 'Pago Visa Oro BOB 1120.50 BOB exacto y Visa Oro USD 100.00 USD exacto al 2026-11-15'
  - '"Internet" 199.00 BOB al 2026-11-20'
input:
  window: '30'
steps:
  - 'Consultar la lista de 30 días'
  - 'Consultar el 2026-10-20 (ciclo abierto)'
expected_result:
  - '"Pago de tarjeta · Visa Oro" 1120.50 BOB el 2026-11-15 y luego "Internet"; total BOB 1319.50'
  - 'Por moneda 1319.50 BOB y 100.00 USD; consolidado 2299.50 BOB'
  - '2026-10-20: 1120.50 BOB marcado como estimado'
created: 2026-10-10
updated: 2026-10-10
---

# TC-DEBT-CARD-032 — Vencimientos de tarjeta en la lista de próximos pagos

## Intención

Q8 incluye vencimientos de tarjeta (docs/00 §6) con el monto honesto.

## Escenario

```gherkin
Dado los pagos de "Visa Oro" del 2026-11-15
Cuando consulto los próximos 30 días el 2026-11-01
Entonces la lista muestra "Pago de tarjeta · Visa Oro" por 1120.50 BOB
```

## Notas

- Cubre "Ciclo abierto estimado" y "Parte en dólares valorada".
- Change: `add-credit-cards` (borrador; cifras con `FixedClock` en America/La_Paz).
