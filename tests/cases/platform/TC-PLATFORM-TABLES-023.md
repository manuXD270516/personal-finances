---
id: TC-PLATFORM-TABLES-023
title: "El detalle de un préstamo a 360 px no desborda a lo ancho y sus saldos se leen completos"
spec: platform/web-interface
related_specs: []
requirement: "Detalle de un préstamo sin desbordamiento horizontal"
scenario: "Saldos de un préstamo a 360 px"
requirement_status: confirmed
fr: []
nfr: ["NFR-USAB-006", "NFR-USAB-107"]
invariants: []
priority: medium
type: e2e
level: e2e
automation_status: automated
automated_tests:
  - tests/e2e/specs/data-tables.spec.ts
status: automated
regression_suite: false
phase: 9
tags: ["mobile", "reflow", "debt"]
error_code: null
preconditions:
  - "un préstamo de 12000.00 BOB con una diferencia no registrada de 150.00 BOB"
input:
  principal: "12000.00"
  diferencia: "150.00"
  moneda: "BOB"
steps:
  - "a 360 × 800 el OWNER abre el detalle del préstamo en la pestaña «Detalle»"
expected_result:
  - "document.documentElement.scrollWidth ≤ 360"
  - "loan-outstanding-principal, loan-account-balance, loan-unreconciled y loan-paid-totals quedan dentro del ancho de la página, sin recortes"
  - "captura a 360 px adjuntada"
created: 2026-11-26
updated: 2026-11-26
---

# TC-PLATFORM-TABLES-023 — El detalle de un préstamo a 360 px no desborda a lo ancho y sus saldos se leen completos

## Intención

Verifica el requirement «Detalle de un préstamo sin desbordamiento horizontal» del change `refine-data-tables` (lote L5 de docs/78). Corrige el desbordamiento de ~250 px de `loan-balances` que encontró el change 77.

## Escenario

```gherkin
Dado un préstamo de 12000.00 BOB con una diferencia no registrada de 150.00 BOB
Cuando a 360 × 800 el OWNER abre el detalle del préstamo en la pestaña «Detalle»
Entonces document.documentElement.scrollWidth ≤ 360
  Y loan-outstanding-principal, loan-account-balance, loan-unreconciled y loan-paid-totals quedan dentro del ancho de la página, sin recortes
  Y captura a 360 px adjuntada
```

## Notas

- Change `refine-data-tables` (lote L5, docs/78; decisiones en docs/79). Lo implementa el agente `frontend` (D512). Datos ficticios; ningún dato real del owner.
- La capability de préstamos sigue en el change activo `add-loans`; por eso `related_specs` queda vacío.
