---
id: TC-FX-COST-002
title: "Las conversiones sin contraparte se agrupan como Sin canal separadas por cuentas"
spec: fx/conversion-pricing
related_specs: []
requirement: "Conversiones sin contraparte agrupadas como Sin canal"
scenario: "Compra de USDT sin contraparte"
requirement_status: provisional
fr: ["FR-FX-011"]
nfr: []
invariants: []
priority: high
type: domain
level: domain
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 5
tags: ["fx", "conversion-cost", "channel"]
error_code: null
preconditions:
  - "Compra de 50.000000 USDT pagando 610.00 BOB, \"Banco BOB\" → \"Wallet USDT\", cotizada 12.20, referencia 12.00, sin contraparte"
  - "Otra conversión sin contraparte entre otras cuentas"
input: {}
steps:
  - "Agregar el periodo \"2026-10\""
expected_result:
  - "Grupo \"Sin canal\" (\"Banco BOB\" → \"Wallet USDT\") USDT/BOB: 1 conversión, 600.00 BOB, spread 1.6667 %, monto del spread 10.00 BOB"
  - "La otra conversión forma su propio grupo \"Sin canal\" con sus cuentas"
  - "Con nombre libre y sin contraparte registrada, el canal es ese nombre"
created: 2026-10-13
updated: 2026-10-13
---

# TC-FX-COST-002 — Las conversiones sin contraparte se agrupan como Sin canal separadas por cuentas

## Intención

D244: sin campo de canal nuevo; nunca inferir una contraparte.

## Escenario

```gherkin
Dado una compra de USDT sin contraparte
Cuando se agrega
Entonces queda en Sin canal con sus cuentas
```

## Notas

