---
id: TC-REPORTING-REPORTS-008
title: "El flujo de caja clasifica por contrapartida y cumple saldo inicial más componentes igual a saldo final"
spec: reporting/financial-reports
related_specs: []
requirement: "Reporte de flujo de caja histórico"
scenario: "Octubre con deuda, ahorro y transferencia interna"
requirement_status: provisional
fr: ["FR-REPORTING-008"]
nfr: []
invariants: ["INV-004", "INV-022"]
priority: critical
type: property
level: property
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 7
tags: ["cash-flow", "pbt"]
error_code: null
preconditions:
  - "Workspace W1 con moneda de reporte BOB y zona America/La_Paz"
  - "\"Banco BOB\" y \"Efectivo\" líquidas; saldo líquido 10000.00 BOB al 2026-09-30"
  - "Octubre: sueldo 12000.00, gastos netos 3300.00, pago de tarjeta 500.00, transferencia 1000.00 a \"Plazo fijo\", transferencia 200.00 a \"Efectivo\""
  - "Cuota de 1500.00 BOB (1100.00 principal, 320.00 interés, 80.00 cargos) en un caso aparte"
  - "Venta de 100.000000 USDT por 1190.00 BOB con USDT/BOB 12.00 en un caso aparte"
input: {}
steps:
  - "Calcular el flujo de caja de 2026-10"
  - "PBT: ledgers aleatorios balanceados por moneda"
expected_result:
  - "BOB: inicial 10000.00, operativo 8700.00, deuda −500.00, ahorro e inversión −1000.00, cambio de moneda 0.00, final 17200.00"
  - "Cuota: deuda −1100.00 y operativo −400.00 BOB"
  - "Conversión: cambio de moneda 1190.00 BOB y −100.000000 USDT; consolidado −10.00 BOB"
  - "PBT: inicial + Σ componentes = final por moneda en todo ledger generado"
created: 2026-11-04
updated: 2026-11-04
---

# TC-REPORTING-REPORTS-008 — El flujo de caja clasifica por contrapartida y cumple saldo inicial más componentes igual a saldo final

## Intención

Reporte Must 7: la clasificación por contrapartida no deja residuo gracias a INV-004.

## Escenario

```gherkin
Dado un saldo líquido de 10000.00 BOB y los movimientos de octubre
Cuando se calcula el flujo de caja de 2026-10
Entonces operativo 8700.00, deuda −500.00, ahorro −1000.00 y saldo final 17200.00 BOB
```

## Notas

- Datos ficticios; fechas fijas con `FixedClock` (TZ America/La_Paz).
- PBT con timeout explícito (CI es más lento).
