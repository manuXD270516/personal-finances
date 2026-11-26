---
id: TC-REPORTING-SPENDABLE-018
title: "Un pago programado menor que el mínimo deja la tarjeta fuera del aviso de Q5"
spec: reporting/dashboard
related_specs: ["commitments/recurrence-engine", "debt/credit-cards"]
requirement: "Aviso de tarjetas sin pago programado en el disponible"
scenario: "Pago programado menor que el mínimo"
requirement_status: provisional
fr: ["FR-REPORTING-016", "FR-COMMITMENTS-011", "FR-DEBT-014"]
nfr: []
invariants: []
priority: medium
type: domain
level: application
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 9
tags: ["spendable", "q5", "credit-cards"]
error_code: null
preconditions:
  - "Workspace en BOB con TZ America/La_Paz; periodo financiero de noviembre de 2026 (2026-11-01 a 2026-11-30)"
  - "Hoy 2026-11-10 con FixedClock; \"Visa Oro BOB\" adeuda 1500.00 BOB con pago mínimo de 300.00 BOB en su estado de cuenta"
  - "Transferencia recurrente no resuelta de 200.00 BOB desde \"Banco BOB\" (líquida) hacia \"Visa Oro BOB\" con fecha 2026-11-25"
input: {}
steps:
  - "se consulta el disponible para gastar"
expected_result:
  - "cardsWithoutPaymentCount es 0"
  - "el comprometido incluye la transferencia de 200.00 BOB"
created: 2026-11-25
updated: 2026-11-25
---

# TC-REPORTING-SPENDABLE-018 — Un pago programado menor que el mínimo deja la tarjeta fuera del aviso de Q5

## Intención

Verifica el scenario "Pago programado menor que el mínimo" del requirement "Aviso de tarjetas sin pago programado en el disponible" de `reporting/dashboard` (FR-REPORTING-016, FR-COMMITMENTS-011, FR-DEBT-014).

## Escenario

```gherkin
Dado Workspace en BOB con TZ America/La_Paz; periodo financiero de noviembre de 2026 (2026-11-01 a 2026-11-30)
Y Hoy 2026-11-10 con FixedClock; "Visa Oro BOB" adeuda 1500.00 BOB con pago mínimo de 300.00 BOB en su estado de cuenta
Y Transferencia recurrente no resuelta de 200.00 BOB desde "Banco BOB" (líquida) hacia "Visa Oro BOB" con fecha 2026-11-25
Cuando se consulta el disponible para gastar
Entonces cardsWithoutPaymentCount es 0
Y el comprometido incluye la transferencia de 200.00 BOB
```

## Notas

- Change `fix-phase-4-debt-followups` (Phase 9), D491: no se compara con el pago mínimo. Datos ficticios; fechas fijas con `FixedClock` en America/La_Paz; montos como strings decimales; ningún dato real del owner.
