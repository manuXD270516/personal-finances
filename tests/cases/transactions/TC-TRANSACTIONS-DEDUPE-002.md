---
id: TC-TRANSACTIONS-DEDUPE-002
title: "Un candidato con otro identificador del banco puntúa 0.8500"
spec: transactions/duplicate-detection
related_specs: ["imports/import-pipeline"]
requirement: "Puntaje de posible duplicado para filas importadas"
scenario: "Candidato con otro identificador del banco"
requirement_status: provisional
fr: ["FR-TRANSACTIONS-032", "FR-IMPORTS-007"]
nfr: []
invariants: []
priority: high
type: domain
level: domain
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 6
tags: ["imports", "duplicate-detection"]
error_code: null
preconditions:
  - "Workspace \"W1\" con moneda base BOB y zona America/La_Paz"
  - "FixedClock en 2026-10-20T10:00:00-04:00"
  - "Cuenta \"Banco BOB\" (ASSET, activa, institución ficticia \"Banco Cumbre Demo\")"
  - "EDITOR \"Ana\" autenticada salvo indicación"
input: "Datos del scenario \"Candidato con otro identificador del banco\" del delta de add-import-pipeline"
steps:
  - "el mismo candidato proviene de otro import y tiene un identificador del banco distinto del de la fila"
expected_result:
  - "el puntaje del candidato es 0.8500"
created: 2026-10-29
updated: 2026-10-29
---

# TC-TRANSACTIONS-DEDUPE-002 — Un candidato con otro identificador del banco puntúa 0.8500

## Intención

Para cada candidato de una fila importada, el sistema DEBE (MUST) calcular un puntaje entre 0 y 1, con 4 decimales y redondeo HALF_EVEN, como 0.40 × monto + 0.25 × fecha + 0.20 × descripción + 0.10 × contraparte + 0.05 × origen, donde monto vale 1 con el mismo monto; fecha vale 1 el mismo día, 0.8 a un día, 0.5 a dos y 0.3 a tres; descripción es la similitud de las descripciones normalizadas (0.5 si el candidato no tiene descripción); contraparte vale 1 si ambas la tienen y coinciden, 0 si ambas la tienen y difieren y 0.5 en otro caso; y origen vale 0 si el candidato tiene un identificador del banco distinto del de la fila y 1 en otro caso.

## Escenario

```gherkin
Dado Workspace "W1" con moneda base BOB y zona America/La_Paz
  Y FixedClock en 2026-10-20T10:00:00-04:00
  Y Cuenta "Banco BOB" (ASSET, activa, institución ficticia "Banco Cumbre Demo")
  Y EDITOR "Ana" autenticada salvo indicación
Cuando el mismo candidato proviene de otro import y tiene un identificador del banco distinto del de la fila
Entonces el puntaje del candidato es 0.8500
```

## Notas

- Change: `add-import-pipeline` (Phase 6). Datos ficticios; fechas fijas con `FixedClock` en America/La_Paz; ningún dato de extractos reales del owner (D255, D281).
