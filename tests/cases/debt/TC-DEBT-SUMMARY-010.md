---
id: TC-DEBT-SUMMARY-010
title: 'Tarjeta Deudas sin pasivos o con deudas saldadas sin ceros inventados'
spec: reporting/dashboard
related_specs: ['debt/loans']
requirement: 'Resumen de deudas en el Home'
scenario: 'Workspace sin pasivos'
requirement_status: provisional
fr: ['FR-REPORTING-001', 'FR-DEBT-018']
nfr: []
invariants: []
priority: medium
type: e2e
level: e2e
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 4
tags: ['home', 'empty-state']
error_code: null
preconditions:
  - 'Workspace A sin cuentas de pasivo'
  - 'Workspace B con "Visa Oro BOB" y "Préstamo auto" en 0.00 BOB'
input:
  page: 'Home'
steps:
  - 'Abrir el Home en A'
  - 'Abrir el Home en B'
expected_result:
  - 'A: "no hay deudas registradas" con acción registrar préstamo o tarjeta; sin 0.00 BOB'
  - 'B: "no hay deudas pendientes" sin fecha ni vencimiento'
created: 2026-10-10
updated: 2026-10-10
---

# TC-DEBT-SUMMARY-010 — Tarjeta Deudas sin pasivos o con deudas saldadas sin ceros inventados

## Intención

FR-REPORTING-001: nunca valores inventados.

## Escenario

```gherkin
Dado un workspace sin cuentas de pasivo
Cuando abro el Home
Entonces la tarjeta "Deudas" dice que no hay deudas registradas
  Y no muestra 0.00 BOB
```

## Notas

- Cubre "Deudas saldadas".
- Change: `add-debt-summary` (borrador; cifras con `FixedClock` en America/La_Paz).
