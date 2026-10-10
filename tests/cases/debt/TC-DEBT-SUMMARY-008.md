---
id: TC-DEBT-SUMMARY-008
title: 'El resumen es visible para VIEWER y aislado por workspace'
spec: debt/loans
related_specs: ['debt/credit-cards']
requirement: 'Permisos y aislamiento del resumen de deudas'
scenario: 'Deudas de otro workspace'
requirement_status: provisional
fr: ['FR-DEBT-018']
nfr: ['NFR-SEC-003']
invariants: ['INV-025']
priority: critical
type: security
level: api
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 4
tags: ['debt-summary', 'rbac', 'rls']
error_code: null
preconditions:
  - 'Workspace con moneda base BOB y zona America/La_Paz; hoy 2026-10-28'
  - '"Préstamo auto" (loan) adeuda 45000.00 BOB; "Visa Oro BOB" 1120.50 BOB y "Visa Oro USD" 100.00 USD (tarjeta "Visa Oro"); "Deuda familiar" (manual_liability) 2000.00 BOB'
  - 'Tasa de valoración USD/BOB de hoy 9.80'
  - 'Workspace B con un préstamo de 9000.00 BOB'
  - 'Miembro VIEWER de A'
input:
  request: 'GET W/debts/summary'
steps:
  - 'VIEWER de A consulta'
  - 'Miembro de A consulta con datos en B'
expected_result:
  - 'VIEWER: 200 con 49100.50 BOB consolidado'
  - 'El total de A no incluye los 9000.00 BOB de B'
created: 2026-10-10
updated: 2026-10-10
---

# TC-DEBT-SUMMARY-008 — El resumen es visible para VIEWER y aislado por workspace

## Intención

Lectura para todo miembro y RLS (INV-025).

## Escenario

```gherkin
Dado un préstamo de 9000.00 BOB en el workspace B
Cuando un miembro de A consulta su resumen
Entonces el total de A sigue siendo 49100.50 BOB
```

## Notas

- Cubre "VIEWER consulta el resumen".
- Change: `add-debt-summary` (borrador; cifras con `FixedClock` en America/La_Paz).
