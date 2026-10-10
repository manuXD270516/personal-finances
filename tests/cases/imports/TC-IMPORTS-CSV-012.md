---
id: TC-IMPORTS-CSV-012
title: "La fecha se interpreta con el formato elegido y una fecha inexistente es inválida con su línea"
spec: imports/import-pipeline
related_specs: ["transactions/transaction-recording"]
requirement: "Formato de fecha y separador decimal explícitos"
scenario: "Día y mes según el formato elegido"
requirement_status: provisional
fr: ["FR-IMPORTS-003","FR-IMPORTS-006"]
nfr: []
invariants: []
priority: high
type: domain
level: import
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 3
tags: ["csv-import","dates","RISK-020"]
error_code: null
preconditions:
  - "Workspace \"W1\" con moneda base BOB y TZ America/La_Paz"
  - "FixedClock en 2026-10-20T10:00:00-04:00"
  - "Cuenta \"Banco BOB\" (ASSET, activa) con saldo contable 4000.00 BOB"
  - "Usuario EDITOR autenticado salvo indicación"
input: {"values":["03/04/2026","31/02/2026"]}
steps:
  - "Normalizar \"03/04/2026\" con dd/MM/yyyy y con MM/dd/yyyy"
  - "Normalizar la línea 6 \"31/02/2026\" con dd/MM/yyyy"
expected_result:
  - "dd/MM/yyyy ⇒ 2026-04-03; MM/dd/yyyy ⇒ 2026-03-04"
  - "Línea 6 inválida con IMPORT_INVALID_DATE"
created: 2026-10-09
updated: 2026-10-09
---

# TC-IMPORTS-CSV-012 — La fecha se interpreta con el formato elegido y una fecha inexistente es inválida con su línea

## Intención

docs/13 §12: las fechas ambiguas nunca se resuelven por heurística silenciosa; el formato manda.

## Escenario

```gherkin
Dada la fecha 03/04/2026
Cuando elijo dd/MM/yyyy entonces es 2026-04-03
Cuando elijo MM/dd/yyyy entonces es 2026-03-04
Dada la línea 6 con 31/02/2026
Entonces es inválida con IMPORT_INVALID_DATE
```

## Notas

- Cubre también el scenario "Fecha inexistente" del mismo requirement.
- Datos ficticios; fechas fijas con `FixedClock` (TZ America/La_Paz).
