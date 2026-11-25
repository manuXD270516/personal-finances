---
id: TC-REPORTING-UPCOMING-023
title: "La cuota de la laptop se rotula cuotas en la tarjeta Q8 del Home"
spec: reporting/cash-flow-calendar
related_specs: ["debt/credit-cards","reporting/dashboard"]
requirement: "Cuotas de tarjeta futuras en los próximos pagos"
scenario: "Cuota en la tarjeta Q8 del Home"
requirement_status: provisional
fr: ["FR-DEBT-017","FR-REPORTING-016"]
nfr: []
invariants: []
priority: low
type: api
level: api
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 9
tags: ["upcoming-payments","installments","q8"]
error_code: null
preconditions:
  - "Workspace en BOB con TZ America/La_Paz, tarjeta \"Visa Oro BOB\" con vencimiento el día 15 y el plan \"Laptop\" de 1000.00 BOB en 3 cuotas"
  - "Hoy 2026-11-20 con FixedClock; el paso diario de tarjetas ya fijó el esperado del pago del 2026-12-15"
input: {}
steps:
  - "se consultan los próximos 30 días y se abre el Home"
expected_result:
  - "el ítem del 2026-12-15 \"Pago de tarjeta · Visa Oro\" lleva 333.33 BOB, amountType ESTIMATED y expectedBasis INSTALLMENTS"
  - "la tarjeta Q8 muestra ese pago marcado como estimado con la indicación \"cuotas\""
created: 2026-11-25
updated: 2026-11-25
---

# TC-REPORTING-UPCOMING-023 — La cuota de la laptop se rotula cuotas en la tarjeta Q8 del Home

## Intención

Verifica el scenario "Cuota en la tarjeta Q8 del Home" del requirement "Cuotas de tarjeta futuras en los próximos pagos" de `reporting/cash-flow-calendar` (FR-DEBT-017, FR-REPORTING-016).

## Escenario

```gherkin
Dado Workspace en BOB con TZ America/La_Paz, tarjeta "Visa Oro BOB" con vencimiento el día 15 y el plan "Laptop" de 1000.00 BOB en 3 cuotas
Y Hoy 2026-11-20 con FixedClock; el paso diario de tarjetas ya fijó el esperado del pago del 2026-12-15
Cuando se consultan los próximos 30 días y se abre el Home
Entonces el ítem del 2026-12-15 "Pago de tarjeta · Visa Oro" lleva 333.33 BOB, amountType ESTIMATED y expectedBasis INSTALLMENTS
Y la tarjeta Q8 muestra ese pago marcado como estimado con la indicación "cuotas"
```

## Notas

- Change `fix-phase-4-debt-followups` (Phase 9). Datos ficticios; fechas fijas con `FixedClock` en America/La_Paz; montos como strings decimales; ningún dato real del owner.
- Reutiliza el escenario de `apps/api/test/api/credit-cards.api.test.ts` (TC-DEBT-CARD-033).
