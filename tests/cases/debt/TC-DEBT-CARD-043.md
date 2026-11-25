---
id: TC-DEBT-CARD-043
title: "Registrar interés y seguro crea un gasto de la tarjeta con una porción por componente"
spec: debt/credit-cards
related_specs: ["transactions/transaction-recording","ledger/journal-posting"]
requirement: "Registro de los intereses y cargos de una tarjeta"
scenario: "Interés y seguro del estado de cuenta de octubre"
requirement_status: provisional
fr: ["FR-DEBT-013","FR-REPORTING-008"]
nfr: []
invariants: ["INV-004","INV-021"]
priority: critical
type: integration
level: database-integration
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 9
tags: ["credit-cards","card-charges"]
error_code: null
preconditions:
  - "Workspace \"W1 Personal Demo\" con moneda de reporte BOB y TZ America/La_Paz; tarjeta \"Visa Oro\" bimoneda con \"Visa Oro BOB\" y \"Visa Oro USD\", cierre el día 25 y vencimiento el día 15"
  - "Datos del ciclo del 2026-09-26 al 2026-10-25 de \"Visa Oro BOB\" según el scenario «Ciclo de octubre de Visa Oro BOB» (saldo al cierre 1120.50 BOB) y una compra de 400.00 BOB el 2026-10-26"
  - "FixedClock en 2026-10-28T12:00 America/La_Paz salvo que el escenario diga otra fecha; datos ficticios"
input: {}
steps:
  - "el 2026-10-28 el EDITOR registra en \"Visa Oro BOB\", que adeuda 1520.50 BOB, un cargo con fecha 2026-10-25 de 4.00 BOB de interés y 0.80 BOB de seguro"
expected_result:
  - "se crea un gasto posteado de 4.80 BOB en \"Visa Oro BOB\" con una porción de 4.00 BOB en \"Intereses pagados\" y otra de 0.80 BOB en \"Seguros\", ambas identificadas como cargo de la tarjeta"
  - "\"Visa Oro BOB\" adeuda 1525.30 BOB y las compras del ciclo del 2026-09-26 al 2026-10-25 pasan de 1170.50 BOB a 1175.30 BOB"
created: 2026-11-25
updated: 2026-11-25
---
# TC-DEBT-CARD-043 — Registrar interés y seguro crea un gasto de la tarjeta con una porción por componente

## Intención

Verifica el scenario "Interés y seguro del estado de cuenta de octubre" del requirement "Registro de los intereses y cargos de una tarjeta" de `debt/credit-cards` (FR-DEBT-013, FR-REPORTING-008).

## Escenario

```gherkin
Dado Workspace "W1 Personal Demo" con moneda de reporte BOB y TZ America/La_Paz; tarjeta "Visa Oro" bimoneda con "Visa Oro BOB" y "Visa Oro USD", cierre el día 25 y vencimiento el día 15
Cuando el 2026-10-28 el EDITOR registra en "Visa Oro BOB", que adeuda 1520.50 BOB, un cargo con fecha 2026-10-25 de 4.00 BOB de interés y 0.80 BOB de seguro
Entonces se crea un gasto posteado de 4.80 BOB en "Visa Oro BOB" con una porción de 4.00 BOB en "Intereses pagados" y otra de 0.80 BOB en "Seguros", ambas identificadas como cargo de la tarjeta
Y "Visa Oro BOB" adeuda 1525.30 BOB y las compras del ciclo del 2026-09-26 al 2026-10-25 pasan de 1170.50 BOB a 1175.30 BOB
```

## Notas

- Change `add-card-interest-ledger-portions` (Phase 9). Datos ficticios; fechas fijas con `FixedClock` en America/La_Paz; montos como strings decimales; ningún dato real del owner.
