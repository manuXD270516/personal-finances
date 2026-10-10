---
id: TC-REPORTING-UPCOMING-020
title: "Un VIEWER consulta los próximos pagos y nunca ve datos de otro workspace"
spec: reporting/cash-flow-calendar
related_specs: ["commitments/recurrence-engine"]
requirement: "Consulta de próximos pagos para todos los miembros"
scenario: "VIEWER consulta"
requirement_status: confirmed
fr: ["FR-REPORTING-016","FR-IDENTITY-006"]
nfr: []
invariants: ["INV-025"]
priority: high
type: security
level: api
automation_status: automated
automated_tests:
  - apps/api/test/api/upcoming-payments.api.test.ts
status: automated
regression_suite: false
phase: 3
tags: ["rbac","rls"]
error_code: null
preconditions:
  - "Usuario VIEWER y usuario OWNER de \"W1\""
  - "\"W2\" con la ocurrencia \"Hosting\" 80.00 BOB del 2026-10-23"
input: {"days":30}
steps:
  - "El VIEWER y el OWNER consultan los próximos pagos de \"W1\""
expected_result:
  - "Ambos reciben la misma lista y los mismos totales"
  - "\"Hosting\" de \"W2\" no aparece (RLS)"
created: 2026-10-09
updated: 2026-10-10
---

# TC-REPORTING-UPCOMING-020 — Un VIEWER consulta los próximos pagos y nunca ve datos de otro workspace

## Intención

La lectura es para todos los roles (como el resumen) y el aislamiento por workspace se prueba con datos de otro workspace.

## Escenario

```gherkin
Dado un VIEWER de W1 y la ocurrencia Hosting en W2
Cuando el VIEWER consulta los próximos pagos de W1
Entonces recibe la misma lista que el OWNER sin Hosting
```

## Notas

- Datos ficticios; fechas fijas con `FixedClock` (TZ America/La_Paz).
