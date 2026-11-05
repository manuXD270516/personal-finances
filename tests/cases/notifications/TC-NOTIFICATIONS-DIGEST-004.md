---
id: TC-NOTIFICATIONS-DIGEST-004
title: "Sin opt-in el digest resume con cantidades, porcentajes, estados y fechas sin ningún monto"
spec: notifications/alerts
related_specs: []
requirement: "Digest sin montos salvo opt-in"
scenario: "Digest sin opt-in"
requirement_status: provisional
fr: ["FR-NOTIFY-006","FR-NOTIFY-007"]
nfr: ["NFR-COMP-001"]
invariants: []
priority: critical
type: unit
level: unit
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 7
tags: ["notifications","digest","privacy"]
error_code: null
preconditions:
  - "3 pagos en 7 días, tasa de ahorro 41.5 %, riesgo alto en BOB desde el 2026-11-15, disponible 5521.00 BOB"
input: {}
steps:
  - "Renderizar el digest sin opt-in"
  - "Renderizar con opt-in"
expected_result:
  - "3 pagos, 41.5 %, riesgo alto desde 15/11/2026, disponible positivo; ningún monto (regex con límites sobre 5521)"
  - "Con opt-in: 5521.00 BOB y montos consolidados"
created: 2026-11-04
updated: 2026-11-04
---

# TC-NOTIFICATIONS-DIGEST-004 — Sin opt-in el digest resume con cantidades, porcentajes, estados y fechas sin ningún monto

## Intención

FR-NOTIFY-006 en el digest (pregunta 10 de design.md).

## Escenario

```gherkin
Dado 3 pagos en 7 días, tasa de ahorro 41.5 %, riesgo alto en BOB desde el 2026-11-15, disponible 5521.00 BOB
Cuando Renderizar el digest sin opt-in
Entonces 3 pagos, 41.5 %, riesgo alto desde 15/11/2026, disponible positivo; ningún monto (regex con límites sobre 5521)
  Y Con opt-in: 5521.00 BOB y montos consolidados
```

## Notas

- Change `add-cash-flow-forecast` (Phase 7); requirement "Digest sin montos salvo opt-in" de `notifications/alerts`.
- Datos ficticios; fechas fijas con `FixedClock` (TZ America/La_Paz); montos como strings decimales.
