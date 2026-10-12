---
id: TC-DEBT-SUMMARY-001
title: 'Total adeudado por moneda y consolidado en BOB'
spec: debt/loans
related_specs: ['debt/credit-cards']
requirement: 'Total adeudado por moneda y en moneda base'
scenario: 'Préstamo, tarjeta bimoneda y otro pasivo'
requirement_status: confirmed
fr: ['FR-DEBT-018', 'FR-FX-006']
nfr: []
invariants: ['INV-002', 'INV-022', 'INV-031']
priority: high
type: integration
level: application
automation_status: automated
automated_tests:
  - apps/api/test/api/debt-summary.api.test.ts
  - apps/web/src/ui/debt/summary/summary.test.tsx
  - packages/contexts/debt/src/application/debt-summary.queries.test.ts
  - packages/contexts/debt/src/domain/debt-summary.test.ts
status: automated
regression_suite: false
phase: 4
tags: ['debt-summary', 'totals', 'fx']
error_code: null
preconditions:
  - 'Workspace con moneda base BOB y zona America/La_Paz; hoy 2026-10-28'
  - '"Préstamo auto" (loan) adeuda 45000.00 BOB; "Visa Oro BOB" 1120.50 BOB y "Visa Oro USD" 100.00 USD (tarjeta "Visa Oro"); "Deuda familiar" (manual_liability) 2000.00 BOB'
  - 'Tasa de valoración USD/BOB de hoy 9.80'
input:
  request: 'GET W/debts/summary'
steps:
  - 'Consultar el resumen de deudas'
  - 'Comparar con los pasivos del patrimonio neto (todos incluidos)'
expected_result:
  - 'Total 48120.50 BOB y 100.00 USD; consolidado 49100.50 BOB completo'
  - 'Deudas: "Préstamo auto" (préstamo), "Visa Oro" (tarjeta con BOB y USD), "Deuda familiar" (otro pasivo)'
  - 'El consolidado coincide con los pasivos del patrimonio neto'
created: 2026-10-10
updated: 2026-10-12
---

# TC-DEBT-SUMMARY-001 — Total adeudado por moneda y consolidado en BOB

## Intención

FR-DEBT-018: total por moneda y en base sin mezclar monedas, coherente con el patrimonio (INV-031).

## Escenario

```gherkin
Dado un préstamo, una tarjeta bimoneda y un pasivo manual
Cuando consulto el resumen de deudas
Entonces el total es 48120.50 BOB y 100.00 USD
  Y el consolidado es 49100.50 BOB
```

## Notas

- Change: `add-debt-summary` (borrador; cifras con `FixedClock` en America/La_Paz).
