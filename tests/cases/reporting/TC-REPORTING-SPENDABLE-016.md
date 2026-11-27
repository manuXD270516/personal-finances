---
id: TC-REPORTING-SPENDABLE-016
title: "Sin periodo financiero que cubra hoy Q5 usa el mes calendario sin plan"
spec: reporting/dashboard
related_specs: ["planning/financial-periods"]
requirement: "Disponible sin un periodo financiero que cubra hoy"
scenario: "Workspace nuevo sin periodos"
requirement_status: confirmed
fr: ["FR-PLANNING-024"]
nfr: ["NFR-USAB-004"]
invariants: ["INV-020"]
priority: medium
type: domain
level: application
automation_status: automated
automated_tests:
  - packages/contexts/reporting/src/application/spendable.queries.test.ts
status: automated
regression_suite: false
phase: 9
tags: ["spendable","q5","periods"]
error_code: null
preconditions:
  - "Workspace en BOB con TZ America/La_Paz y día de inicio 1, sin ningún periodo financiero creado"
  - "Hoy 2026-10-20 con FixedClock; saldo inicial de 12000.00 BOB en \"Banco BOB\", única cuenta líquida; sin reservas, compromisos, aportes planificados ni reserva mínima"
input: {}
steps:
  - "se consulta el disponible para gastar"
expected_result:
  - "el disponible es 12000.00 BOB"
  - "el periodo es {id: null, label: \"2026-10\", start: \"2026-10-01\", end: \"2026-10-31\"}"
  - "la segunda vista tiene estado NO_PLAN y la UI ofrece crear el presupuesto, sin mostrar 0.00"
created: 2026-11-25
updated: 2026-11-26
---

# TC-REPORTING-SPENDABLE-016 — Sin periodo financiero que cubra hoy Q5 usa el mes calendario sin plan

## Intención

Verifica el scenario "Workspace nuevo sin periodos" del requirement "Disponible sin un periodo financiero que cubra hoy" de `reporting/dashboard` (FR-PLANNING-024).

## Escenario

```gherkin
Dado Workspace en BOB con TZ America/La_Paz y día de inicio 1, sin ningún periodo financiero creado
Y Hoy 2026-10-20 con FixedClock; saldo inicial de 12000.00 BOB en "Banco BOB", única cuenta líquida; sin reservas, compromisos, aportes planificados ni reserva mínima
Cuando se consulta el disponible para gastar
Entonces el disponible es 12000.00 BOB
Y el periodo es {id: null, label: "2026-10", start: "2026-10-01", end: "2026-10-31"}
Y la segunda vista tiene estado NO_PLAN y la UI ofrece crear el presupuesto, sin mostrar 0.00
```

## Notas

- Change `fix-phase-4-debt-followups` (Phase 9). Datos ficticios; fechas fijas con `FixedClock` en America/La_Paz; montos como strings decimales; ningún dato real del owner.
- El test unitario existente `spendable.queries.test.ts` cita hoy TC-REPORTING-SPENDABLE-011 para este caso; pasa a citar este TC (tarea 3.5).
