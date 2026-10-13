---
id: TC-DEBT-CARD-038
title: "El próximo vencimiento de una tarjeta recién registrada con deuda previa es el del ciclo abierto, nunca uno pasado"
spec: debt/credit-cards
related_specs: ["reporting/cash-flow-calendar", "reporting/dashboard"]
requirement: "Próximo vencimiento de la tarjeta"
scenario: "Tarjeta recién registrada con deuda previa"
requirement_status: confirmed
fr: ["FR-DEBT-013"]
nfr: []
invariants: []
priority: high
type: domain
level: domain
automation_status: automated
automated_tests:
  - apps/api/test/api/credit-cards.api.test.ts
  - apps/web/src/ui/debt/cards/cards.test.tsx
  - packages/contexts/debt/src/application/cards.service.test.ts
  - packages/contexts/debt/src/domain/next-due-resolver.test.ts
status: automated
regression_suite: false
phase: 5
tags: ["credit-cards", "due-date", "fix-phase-4-gaps"]
error_code: null
preconditions:
  - "Hoy es 2026-10-20 en America/La_Paz (FixedClock)"
  - "\"Visa Oro BOB\" (credit_card, BOB) adeuda 1200.00 BOB antes de registrar la tarjeta"
input: {"closingDay": 25, "dueDay": 15, "balance": "1200.00", "currency": "BOB"}
steps:
  - "Registrar \"Visa Oro\" con cierre el día 25 y vencimiento el día 15 sobre \"Visa Oro BOB\""
  - "Consultar el detalle de la tarjeta"
expected_result:
  - "El próximo vencimiento de \"Visa Oro BOB\" es 2026-11-15 (ciclo abierto del 2026-09-26 al 2026-10-25)"
  - "No se informa el 2026-10-15, vencimiento del ciclo cerrado el 2026-09-25 sin estado de cuenta emitido"
  - "La lista de estados atrasados está vacía"
created: 2026-10-13
updated: 2026-10-13
---

# TC-DEBT-CARD-038 — El próximo vencimiento de una tarjeta recién registrada con deuda previa es el del ciclo abierto, nunca uno pasado

## Intención

Protege contra el defecto conocido de Phase 4 (docs/38 §4): recién registrada una tarjeta con deuda previa, el próximo vencimiento apuntaba al vencimiento pasado de un ciclo calculado y no emitido, y Q5 y Q8 lo leían.

## Escenario

```gherkin
Dado que hoy es 2026-10-20 en America/La_Paz
  Y "Visa Oro BOB" adeuda 1200.00 BOB
Cuando el EDITOR registra "Visa Oro" con cierre 25 y vencimiento 15
Entonces el próximo vencimiento de "Visa Oro BOB" es 2026-11-15
  Y no se informa 2026-10-15
```

## Notas

- PBT asociado en `NextDueResolver`: para ciclos y fechas aleatorias el próximo vencimiento nunca es anterior a hoy.
