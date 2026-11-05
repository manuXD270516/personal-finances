---
id: TC-REPORTING-FORECAST-020
title: "El calendario refleja de inmediato una ocurrencia omitida, declara su frescura y es igual para el VIEWER y aislado por workspace"
spec: reporting/cash-flow-calendar
related_specs: []
requirement: "Frescura, lectura inmediata y acceso al calendario"
scenario: "Ocurrencia omitida y consulta inmediata"
requirement_status: provisional
fr: ["FR-REPORTING-007","FR-REPORTING-014","FR-IDENTITY-006"]
nfr: ["NFR-SEC-003"]
invariants: ["INV-025"]
priority: high
type: api
level: api
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 7
tags: ["cash-flow","freshness","rls"]
error_code: null
preconditions:
  - "Workspace \"W1\" con moneda de reporte BOB, TZ America/La_Paz y día de inicio del mes financiero 1"
  - "FixedClock en 2026-10-20T10:00:00-04:00 (TZ America/La_Paz)"
  - "Datos base: \"Banco BOB\" 4000.00 BOB y \"Efectivo BOB\" 500.00 BOB líquidas; pendiente \"Cena\" 300.00 BOB del 2026-10-18; ocurrencias \"Internet\" FIXED 199.00 BOB (2026-10-22), \"Luz\" ESTIMATED 180.00 BOB (2026-10-28), ingreso \"Sueldo\" 8000.00 BOB (2026-10-31), \"Alquiler\" 2500.00 BOB (2026-11-01) y \"Pago de tarjeta · Visa Oro\" 1120.50 BOB exacto (2026-11-15), todas de \"Banco BOB\""
  - "\"W2\" con la ocurrencia \"Hosting\" 80.00 BOB del 2026-10-23"
input: {"horizon":30}
steps:
  - "Omitir \"Luz\" y pedir el calendario"
  - "Pedirlo como VIEWER de \"W1\""
expected_result:
  - "Saldo del 2026-10-28 4001.00 BOB y final 8380.50 BOB; horizonte, moneda, generatedAt y frescura"
  - "VIEWER: mismo calendario, sin \"Hosting\""
created: 2026-11-04
updated: 2026-11-04
---

# TC-REPORTING-FORECAST-020 — El calendario refleja de inmediato una ocurrencia omitida, declara su frescura y es igual para el VIEWER y aislado por workspace

## Intención

Read-your-writes (D117) y aislamiento (INV-025).

## Escenario

```gherkin
Dado "W2" con la ocurrencia "Hosting" 80.00 BOB del 2026-10-23
Cuando Omitir "Luz" y pedir el calendario
Entonces Saldo del 2026-10-28 4001.00 BOB y final 8380.50 BOB; horizonte, moneda, generatedAt y frescura
  Y VIEWER: mismo calendario, sin "Hosting"
```

## Notas

- Change `add-cash-flow-forecast` (Phase 7); requirement "Frescura, lectura inmediata y acceso al calendario" de `reporting/cash-flow-calendar`.
- Datos ficticios; fechas fijas con `FixedClock` (TZ America/La_Paz); montos como strings decimales.
