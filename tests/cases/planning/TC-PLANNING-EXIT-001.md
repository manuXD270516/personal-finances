---
id: TC-PLANNING-EXIT-001
title: El owner cierra un mes real con las cuatro cuentas conciliadas a diferencia cero
spec: planning/month-closing
related_specs:
  - transactions/reconciliation
requirement: Cierre de un mes real con todas las cuentas conciliadas
scenario: Cierre de octubre con cuatro cuentas conciliadas
requirement_status: provisional
fr:
  - FR-PLANNING-003
  - FR-PLANNING-004
  - FR-TRANSACTIONS-030
nfr: []
invariants:
  - INV-015
  - INV-022
priority: critical
type: e2e
level: e2e
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: true
phase: 2
tags:
  - month-closing
  - exit-criteria
  - cross-change:pf-p2c
error_code: null
preconditions:
  - "Conciliaciones al 2026-10-31 con diferencia 0.00: Bank A 5200.00 BOB, USD Savings 1500.00 USD, Binance USDT 800.000000 USDT, Visa BOB deuda 350.00 BOB"
  - Sin transacciones pending en octubre
input:
  close: 2026-10
steps:
  - Cerrar "2026-10" desde la UI
  - Abrir el reporte de cierre
expected_result:
  - '"2026-10" closed con snapshot 1'
  - Cada saldo del snapshot es igual al saldo de extracto de su conciliación y referencia esa conciliación
created: 2026-10-05
updated: 2026-10-05
---

# TC-PLANNING-EXIT-001 — El owner cierra un mes real con las cuatro cuentas conciliadas a diferencia cero

## Intención

Criterio de salida de Phase 2 (docs/24 §5.2). Además del E2E automatizado con datos sintéticos, el owner lo ejecuta con un mes real y la evidencia se registra en tasks.md (7.4).

## Escenario

```gherkin
Dado que las cuatro cuentas están conciliadas al 2026-10-31 con diferencia 0.00
Cuando el owner cierra "2026-10"
Entonces "2026-10" queda closed con el snapshot 1
  Y cada saldo del snapshot coincide con el saldo de extracto conciliado
```

## Notas

- Depende de la reconciliación completa de pf-p2c.
