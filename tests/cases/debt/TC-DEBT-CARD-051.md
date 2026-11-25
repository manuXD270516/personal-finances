---
id: TC-DEBT-CARD-051
title: "Un VIEWER no puede registrar cargos de la tarjeta"
spec: debt/credit-cards
related_specs: []
requirement: "Permisos, auditoría e idempotencia de los cargos de la tarjeta"
scenario: "VIEWER intenta registrar un cargo"
requirement_status: provisional
fr: ["FR-DEBT-012"]
nfr: ["NFR-SEC-003"]
invariants: []
priority: critical
type: security
level: api
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 9
tags: ["credit-cards","card-charges"]
error_code: INSUFFICIENT_ROLE
preconditions:
  - "Workspace \"W1 Personal Demo\" con moneda de reporte BOB y TZ America/La_Paz; tarjeta \"Visa Oro\" bimoneda con \"Visa Oro BOB\" y \"Visa Oro USD\", cierre el día 25 y vencimiento el día 15"
  - "Datos del ciclo del 2026-09-26 al 2026-10-25 de \"Visa Oro BOB\" según el scenario «Ciclo de octubre de Visa Oro BOB» (saldo al cierre 1120.50 BOB) y una compra de 400.00 BOB el 2026-10-26"
  - "FixedClock en 2026-10-28T12:00 America/La_Paz salvo que el escenario diga otra fecha; datos ficticios"
input: {}
steps:
  - "un VIEWER registra en \"Visa Oro BOB\" un cargo de 4.00 BOB de interés"
expected_result:
  - "se rechaza con `INSUFFICIENT_ROLE` y no se crea ninguna transacción"
created: 2026-11-25
updated: 2026-11-25
---
# TC-DEBT-CARD-051 — Un VIEWER no puede registrar cargos de la tarjeta

## Intención

Verifica el scenario "VIEWER intenta registrar un cargo" del requirement "Permisos, auditoría e idempotencia de los cargos de la tarjeta" de `debt/credit-cards` (FR-DEBT-012, NFR-SEC-003).

## Escenario

```gherkin
Dado Workspace "W1 Personal Demo" con moneda de reporte BOB y TZ America/La_Paz; tarjeta "Visa Oro" bimoneda con "Visa Oro BOB" y "Visa Oro USD", cierre el día 25 y vencimiento el día 15
Cuando un VIEWER registra en "Visa Oro BOB" un cargo de 4.00 BOB de interés
Entonces se rechaza con `INSUFFICIENT_ROLE` y no se crea ninguna transacción
```

## Notas

- Change `add-card-interest-ledger-portions` (Phase 9). Datos ficticios; fechas fijas con `FixedClock` en America/La_Paz; montos como strings decimales; ningún dato real del owner.
