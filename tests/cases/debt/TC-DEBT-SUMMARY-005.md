---
id: TC-DEBT-SUMMARY-005
title: 'Interés del año anterior excluido y otros intereses'
spec: debt/loans
related_specs: ['debt/credit-cards']
requirement: 'Interés pagado en el año'
scenario: 'Interés sin deuda asociada'
requirement_status: provisional
fr: ['FR-DEBT-018']
nfr: []
invariants: []
priority: medium
type: domain
level: application
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 4
tags: ['debt-summary', 'interest', 'timezone']
error_code: null
preconditions:
  - 'Workspace con moneda base BOB y zona America/La_Paz; hoy 2026-10-28'
  - 'Datos de TC-DEBT-SUMMARY-004'
  - 'Interés 300.00 BOB del 2025-12-28 en "Préstamo auto"'
  - 'Interés 25.00 BOB por sobregiro en "Banco BOB"'
input:
  range: '2026-01-01..2026-10-28'
steps:
  - 'Consultar el resumen'
  - 'Repetir a las 2027-01-01T03:30Z (23:30 del 2026-12-31 en La Paz)'
expected_result:
  - '300.00 BOB de 2025 excluidos'
  - 'Interés BOB 3275.40 con 25.00 BOB en "otros intereses"'
  - 'A las 23:30 del 31-12 en La Paz el año sigue siendo 2026'
created: 2026-10-10
updated: 2026-10-10
---

# TC-DEBT-SUMMARY-005 — Interés del año anterior excluido y otros intereses

## Intención

Año calendario en la zona del workspace (RISK-020) y atribución que cuadra por moneda.

## Escenario

```gherkin
Dado un interés de 300.00 BOB del 2025-12-28 y 25.00 BOB por sobregiro
Cuando consulto el resumen el 2026-10-28
Entonces el interés BOB es 3275.40 con 25.00 BOB en otros intereses
```

## Notas

- Cubre "Interés del año anterior excluido".
- Change: `add-debt-summary` (borrador; cifras con `FixedClock` en America/La_Paz).
