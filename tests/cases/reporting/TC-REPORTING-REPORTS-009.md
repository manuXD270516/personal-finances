---
id: TC-REPORTING-REPORTS-009
title: "El historial de saldo de una cuenta escalona los días y marca las conciliaciones cerradas"
spec: reporting/financial-reports
related_specs: ["ledger/balances", "transactions/reconciliation"]
requirement: "Reporte de historial de saldo de una cuenta"
scenario: "Octubre de Banco BOB"
requirement_status: confirmed
fr: ["FR-REPORTING-008", "FR-LEDGER-012"]
nfr: []
invariants: ["INV-022"]
priority: high
type: integration
level: repository-integration
automation_status: automated
automated_tests:
  - apps/api/test/api/financial-reports.api.test.ts
  - packages/contexts/reporting/src/application/financial-reports.queries.test.ts
  - packages/contexts/reporting/src/domain/reports.domain.test.ts
status: automated
regression_suite: true
phase: 7
tags: ["balance-history"]
error_code: null
preconditions:
  - "Workspace W1 con moneda de reporte BOB y zona America/La_Paz"
  - "\"Banco BOB\" 10000.00 BOB al 2026-09-30; +12000.00 el 2026-10-05; −3500.00 el 2026-10-10; +200.00 el 2026-10-12"
  - "Conciliación cerrada con fecha de extracto 2026-10-10"
input:
  from: "2026-10-01"
  to: "2026-10-31"
steps:
  - "GET W/reports/accounts/{id}/balance-history del rango"
expected_result:
  - "10000.00 del 01 al 04; 22000.00 del 05 al 09; 18500.00 el 10 y 11; 18700.00 del 12 al 31"
  - "El 2026-10-10 lleva la marca de conciliación"
  - "Cada día coincide con el saldo contable a esa fecha"
created: 2026-11-04
updated: 2026-11-05
---

# TC-REPORTING-REPORTS-009 — El historial de saldo de una cuenta escalona los días y marca las conciliaciones cerradas

## Intención

Reporte Must 15: el saldo de cada día es el del ledger, sin huecos.

## Escenario

```gherkin
Dado los movimientos de "Banco BOB" en octubre
Cuando se pide su historial de 2026-10
Entonces informa 10000.00, 22000.00, 18500.00 y 18700.00 BOB en los tramos de días esperados
```

## Notas

- Datos ficticios; fechas fijas con `FixedClock` (TZ America/La_Paz); montos como strings decimales.
- Change `add-financial-reports` (Phase 7).
