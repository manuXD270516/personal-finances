---
id: TC-REPORTING-SPENDABLE-017
title: "Q5 avisa una tarjeta con saldo adeudado sin pago programado sin cambiar el disponible"
spec: reporting/dashboard
related_specs: ["commitments/recurrence-engine", "debt/credit-cards"]
requirement: "Aviso de tarjetas sin pago programado en el disponible"
scenario: "Tarjeta con saldo adeudado sin pago programado"
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
  - "Hoy 2026-11-10 con FixedClock; \"Visa Oro BOB\" adeuda 1500.00 BOB; ninguna transferencia recurrente ni transacción pendiente hacia ella hasta el 2026-11-30"
input: {}
steps:
  - "se consulta el disponible para gastar"
expected_result:
  - "cardsWithoutPaymentCount es 1"
  - "el monto del disponible es el mismo que con la tarjeta sin saldo adeudado"
created: 2026-11-25
updated: 2026-11-25
---

# TC-REPORTING-SPENDABLE-017 — Q5 avisa una tarjeta con saldo adeudado sin pago programado sin cambiar el disponible

## Intención

Verifica el scenario "Tarjeta con saldo adeudado sin pago programado" del requirement "Aviso de tarjetas sin pago programado en el disponible" de `reporting/dashboard` (FR-REPORTING-016, FR-COMMITMENTS-011, FR-DEBT-014).

## Escenario

```gherkin
Dado Workspace en BOB con TZ America/La_Paz; periodo financiero de noviembre de 2026 (2026-11-01 a 2026-11-30)
Y Hoy 2026-11-10 con FixedClock; "Visa Oro BOB" adeuda 1500.00 BOB; ninguna transferencia recurrente ni transacción pendiente hacia ella hasta el 2026-11-30
Cuando se consulta el disponible para gastar
Entonces cardsWithoutPaymentCount es 1
Y el monto del disponible es el mismo que con la tarjeta sin saldo adeudado
```

## Notas

- Change `fix-phase-4-debt-followups` (Phase 9), D213 confirmado por D491. Datos ficticios; fechas fijas con `FixedClock` en America/La_Paz; montos como strings decimales; ningún dato real del owner.
- El comportamiento ya está implementado: los tests existentes de `cardsWithoutPaymentCount` pasan a citar este TC (tarea 3.6).
