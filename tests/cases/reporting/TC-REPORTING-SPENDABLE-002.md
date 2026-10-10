---
id: TC-REPORTING-SPENDABLE-002
title: "El comprometido de Q5 cuenta solo pagos desde cuentas líquidas, incluye el pago de la tarjeta y no la compra cargada a ella"
spec: reporting/dashboard
related_specs: ["reporting/cash-flow-calendar", "goals/savings-goals"]
requirement: "Compromisos descontados del disponible"
scenario: "Comprometido desde cuentas líquidas"
requirement_status: provisional
fr: ["FR-COMMITMENTS-011", "FR-PLANNING-024"]
nfr: []
invariants: []
priority: critical
type: domain
level: domain
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 4
tags: ["spendable", "q5", "committed"]
error_code: null
preconditions:
  - "Workspace \"W1\" con moneda de reporte BOB, TZ America/La_Paz y día de inicio del mes financiero 1"
  - "FixedClock en 2026-10-20T10:00:00-04:00 (periodo \"2026-10\")"
  - "Ocurrencias no resueltas del periodo: \"Internet\" 199.00 y \"Luz\" ESTIMATED 180.00 desde \"Banco BOB\"; \"Pago Tarjeta X\" 2500.00 BOB \"Banco BOB\" → \"Tarjeta X\"; \"Netflix\" 49.00 BOB cargado a \"Tarjeta X\"; \"Agua\" VARIABLE desde \"Banco BOB\""
  - "Pendiente \"Cena\" 300.00 BOB de \"Banco BOB\""
input: {}
steps:
  - "Calcular el término comprometido"
expected_result:
  - "committed 3179.00 BOB"
  - "\"Netflix\" excluido (cuenta no líquida)"
  - "withoutAmountCount = 1"
created: 2026-10-10
updated: 2026-10-10
---

# TC-REPORTING-SPENDABLE-002 — El comprometido de Q5 cuenta solo pagos desde cuentas líquidas, incluye el pago de la tarjeta y no la compra cargada a ella

## Intención

Evita contar dos veces la compra con tarjeta y su pago (D27/D127) y no inventar montos (D115).

## Escenario

```gherkin
Dados "Internet", "Luz", "Pago Tarjeta X" y la pendiente "Cena" desde "Banco BOB" y "Netflix" cargado a "Tarjeta X"
Cuando calculo el comprometido de Q5
Entonces es 3179.00 BOB
  Y no incluye "Netflix"
```

## Notas

- Datos ficticios; fechas fijas con `FixedClock` (TZ America/La_Paz).
