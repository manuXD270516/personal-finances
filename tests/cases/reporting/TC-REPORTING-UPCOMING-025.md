---
id: TC-REPORTING-UPCOMING-025
title: "El pago de un estado emitido es exacto y sin la indicación cuotas"
spec: reporting/cash-flow-calendar
related_specs: ["debt/credit-cards"]
requirement: "Cuotas de tarjeta futuras en los próximos pagos"
scenario: "Estado de cuenta emitido sin la indicación de cuotas"
requirement_status: confirmed
fr: ["FR-DEBT-017","FR-REPORTING-016"]
nfr: []
invariants: []
priority: low
type: domain
level: domain
automation_status: automated
automated_tests:
  - apps/api/test/api/credit-cards.api.test.ts
  - apps/web/src/ui/debt/cards/cards.test.tsx
  - packages/contexts/debt/src/domain/payment-plan-expectation.test.ts
  - packages/contexts/reporting/src/domain/upcoming-payments.test.ts
status: automated
regression_suite: false
phase: 9
tags: ["upcoming-payments","installments"]
error_code: null
preconditions:
  - "Workspace en BOB con TZ America/La_Paz, la tarjeta \"Visa Oro BOB\" y el plan \"Laptop\" de 1000.00 BOB en 3 cuotas"
  - "Hoy 2026-11-01 con FixedClock; el estado cerrado el 2026-10-25 facturó 333.33 BOB (primera cuota)"
input: {}
steps:
  - "se calcula el esperado del pago del 2026-11-15"
  - "se consultan los próximos 30 días"
expected_result:
  - "el esperado es FIXED 333.33 BOB con origen STATEMENT"
  - "el ítem de la lista no lleva la indicación \"cuotas\""
created: 2026-11-25
updated: 2026-11-26
---

# TC-REPORTING-UPCOMING-025 — El pago de un estado emitido es exacto y sin la indicación cuotas

## Intención

Verifica el scenario "Estado de cuenta emitido sin la indicación de cuotas" del requirement "Cuotas de tarjeta futuras en los próximos pagos" de `reporting/cash-flow-calendar` (FR-DEBT-017, FR-REPORTING-016).

## Escenario

```gherkin
Dado Workspace en BOB con TZ America/La_Paz, la tarjeta "Visa Oro BOB" y el plan "Laptop" de 1000.00 BOB en 3 cuotas
Y Hoy 2026-11-01 con FixedClock; el estado cerrado el 2026-10-25 facturó 333.33 BOB (primera cuota)
Cuando se calcula el esperado del pago del 2026-11-15
Y se consultan los próximos 30 días
Entonces el esperado es FIXED 333.33 BOB con origen STATEMENT
Y el ítem de la lista no lleva la indicación "cuotas"
```

## Notas

- Change `fix-phase-4-debt-followups` (Phase 9). Datos ficticios; fechas fijas con `FixedClock` en America/La_Paz; montos como strings decimales; ningún dato real del owner.
