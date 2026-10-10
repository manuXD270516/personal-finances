---
id: TC-DEBT-SUMMARY-009
title: 'Tarjeta Deudas del Home con total, interés, fecha libre y próximo vencimiento'
spec: reporting/dashboard
related_specs: ['debt/loans']
requirement: 'Resumen de deudas en el Home'
scenario: 'Tarjeta Deudas del owner'
requirement_status: provisional
fr: ['FR-REPORTING-001', 'FR-DEBT-018']
nfr: []
invariants: []
priority: high
type: e2e
level: e2e
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 4
tags: ['home', 'debt-summary']
error_code: null
preconditions:
  - 'Workspace con moneda base BOB y zona America/La_Paz; hoy 2026-10-28'
  - '"Préstamo auto" (loan) adeuda 45000.00 BOB; "Visa Oro BOB" 1120.50 BOB y "Visa Oro USD" 100.00 USD (tarjeta "Visa Oro"); "Deuda familiar" (manual_liability) 2000.00 BOB'
  - 'Tasa de valoración USD/BOB de hoy 9.80'
  - 'Datos de TC-DEBT-SUMMARY-004/-006/-007'
input:
  page: 'Home'
steps:
  - 'Abrir el Home'
  - 'Repetir sin tasa USD/BOB'
expected_result:
  - '"Deudas": 49100.50 BOB, 3367.40 BOB de interés en 2026, "libre de deudas en junio de 2029 (sin contar Deuda familiar)", "Préstamo auto · 2026-11-05 · 1850.00 BOB" con enlace'
  - 'Sin tasa: 48120.50 BOB con "sin convertir: 100.00 USD"'
created: 2026-10-10
updated: 2026-10-10
---

# TC-DEBT-SUMMARY-009 — Tarjeta Deudas del Home con total, interés, fecha libre y próximo vencimiento

## Intención

Responder en el Home "¿cuánto debo y cuándo termino?".

## Escenario

```gherkin
Dado las deudas del owner
Cuando abro el Home
Entonces la tarjeta "Deudas" muestra 49100.50 BOB y "libre de deudas en junio de 2029"
```

## Notas

- Cubre "Consolidado incompleto".
- Change: `add-debt-summary` (borrador; cifras con `FixedClock` en America/La_Paz).
