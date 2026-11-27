---
id: TC-REPORTING-UPCOMING-024
title: "El pago del ciclo abierto se marca estimado sin la indicación cuotas"
spec: reporting/cash-flow-calendar
related_specs: ["debt/credit-cards"]
requirement: "Cuotas de tarjeta futuras en los próximos pagos"
scenario: "Ciclo abierto sin la indicación de cuotas"
requirement_status: confirmed
fr: ["FR-DEBT-017","FR-REPORTING-016"]
nfr: []
invariants: []
priority: low
type: domain
level: domain
automation_status: automated
automated_tests:
  - apps/web/src/ui/debt/cards/cards.test.tsx
  - packages/contexts/debt/src/domain/payment-plan-expectation.test.ts
  - packages/contexts/reporting/src/domain/upcoming-payments.test.ts
status: automated
regression_suite: false
phase: 9
tags: ["upcoming-payments","installments"]
error_code: null
preconditions:
  - "Workspace en BOB con TZ America/La_Paz y la tarjeta \"Visa Oro BOB\" con el ciclo abierto que vence el 2026-11-15"
  - "Hoy 2026-10-20 con FixedClock"
input: {}
steps:
  - "se calcula el esperado del pago del 2026-11-15 con el saldo del ciclo abierto (1120.50 BOB)"
  - "se consultan los próximos 30 días"
expected_result:
  - "el esperado es ESTIMATED 1120.50 BOB con origen OPEN_CYCLE"
  - "el ítem de la lista no lleva la indicación \"cuotas\""
created: 2026-11-25
updated: 2026-11-26
---

# TC-REPORTING-UPCOMING-024 — El pago del ciclo abierto se marca estimado sin la indicación cuotas

## Intención

Verifica el scenario "Ciclo abierto sin la indicación de cuotas" del requirement "Cuotas de tarjeta futuras en los próximos pagos" de `reporting/cash-flow-calendar` (FR-DEBT-017, FR-REPORTING-016).

## Escenario

```gherkin
Dado Workspace en BOB con TZ America/La_Paz y la tarjeta "Visa Oro BOB" con el ciclo abierto que vence el 2026-11-15
Y Hoy 2026-10-20 con FixedClock
Cuando se calcula el esperado del pago del 2026-11-15 con el saldo del ciclo abierto (1120.50 BOB)
Y se consultan los próximos 30 días
Entonces el esperado es ESTIMATED 1120.50 BOB con origen OPEN_CYCLE
Y el ítem de la lista no lleva la indicación "cuotas"
```

## Notas

- Change `fix-phase-4-debt-followups` (Phase 9). Datos ficticios; fechas fijas con `FixedClock` en America/La_Paz; montos como strings decimales; ningún dato real del owner.
