---
id: TC-DEBT-CARD-052
title: "El registro de un cargo se audita con actor y componentes"
spec: debt/credit-cards
related_specs: []
requirement: "Permisos, auditoría e idempotencia de los cargos de la tarjeta"
scenario: "Cargo auditado"
requirement_status: provisional
fr: ["FR-DEBT-012","FR-AUDIT-001"]
nfr: []
invariants: []
priority: high
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
  - "el EDITOR registra el cargo de 4.00 BOB de interés y 0.80 BOB de seguro del 2026-10-25 en \"Visa Oro BOB\""
expected_result:
  - "la auditoría de \"Visa Oro\" registra al EDITOR como actor y los componentes interés 4.00 BOB y seguro 0.80 BOB"
created: 2026-11-25
updated: 2026-11-25
---
# TC-DEBT-CARD-052 — El registro de un cargo se audita con actor y componentes

## Intención

Verifica el scenario "Cargo auditado" del requirement "Permisos, auditoría e idempotencia de los cargos de la tarjeta" de `debt/credit-cards` (FR-DEBT-012, FR-AUDIT-001).

## Escenario

```gherkin
Dado Workspace "W1 Personal Demo" con moneda de reporte BOB y TZ America/La_Paz; tarjeta "Visa Oro" bimoneda con "Visa Oro BOB" y "Visa Oro USD", cierre el día 25 y vencimiento el día 15
Cuando el EDITOR registra el cargo de 4.00 BOB de interés y 0.80 BOB de seguro del 2026-10-25 en "Visa Oro BOB"
Entonces la auditoría de "Visa Oro" registra al EDITOR como actor y los componentes interés 4.00 BOB y seguro 0.80 BOB
```

## Notas

- Change `add-card-interest-ledger-portions` (Phase 9). Datos ficticios; fechas fijas con `FixedClock` en America/La_Paz; montos como strings decimales; ningún dato real del owner.
