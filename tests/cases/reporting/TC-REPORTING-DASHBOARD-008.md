---
id: TC-REPORTING-DASHBOARD-008
title: "El resumen incluye cuentas cerradas no archivadas y excluye las archivadas"
spec: reporting/dashboard
related_specs: ["accounts/account-management"]
requirement: "Saldos por cuenta y totales por moneda"
scenario: "Cuenta cerrada incluida y archivada excluida"
requirement_status: confirmed
fr: ["FR-REPORTING-003","FR-ACCOUNTS-007"]
nfr: []
invariants: []
priority: medium
type: api
level: application
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 1
tags: ["dashboard","accounts","closed-account"]
error_code: null
preconditions:
  - "Workspace con moneda de reporte BOB y TZ America/La_Paz"
  - "\"Banco BOB\" 685.00 BOB, \"Caja BOB\" 120.50 BOB, \"Wallet USDT\" 50.000000 USDT (activas)"
  - "\"Banco Viejo\" cerrada el 2026-08-31 con saldo 0.00 BOB"
  - "\"Caja Antigua\" archivada con saldo 0.00 BOB"
input: {"asOf":"2026-09-30T18:00:00-04:00"}
steps:
  - "Consultar el resumen del workspace"
expected_result:
  - "La lista de cuentas incluye \"Banco Viejo\" con 0.00 BOB y estado CLOSED"
  - "La lista de cuentas no incluye \"Caja Antigua\""
  - "Totales por moneda: 805.50 BOB y 50.000000 USDT"
created: 2026-10-03
updated: 2026-10-03
---

# TC-REPORTING-DASHBOARD-008 — El resumen incluye cuentas cerradas no archivadas y excluye las archivadas

## Intención

Decisión del owner D35 (docs/31, 2026-10-03): el resumen muestra las cuentas no archivadas, incluidas las cerradas, para que su historia siga a la vista; archivar es la acción que las oculta.

## Escenario

```gherkin
Dado "Banco Viejo" cerrada con 0.00 BOB y "Caja Antigua" archivada con 0.00 BOB
Cuando consulto el resumen
Entonces veo "Banco Viejo" con 0.00 BOB marcada como cerrada
  Y no veo "Caja Antigua"
  Y los totales por moneda siguen en 805.50 BOB y 50.000000 USDT
```

## Notas

- La regla de cierre exige saldo cero (FR-ACCOUNTS-007), por eso la cuenta cerrada no altera los totales.
