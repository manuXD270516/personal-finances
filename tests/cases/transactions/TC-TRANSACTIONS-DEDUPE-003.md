---
id: TC-TRANSACTIONS-DEDUPE-003
title: "Los candidatos con igual puntaje se ordenan por menor diferencia de días de forma determinista"
spec: transactions/duplicate-detection
related_specs: ["imports/import-pipeline"]
requirement: "Puntaje de posible duplicado para filas importadas"
scenario: "Desempate determinista"
requirement_status: provisional
fr: ["FR-TRANSACTIONS-032", "FR-IMPORTS-007"]
nfr: []
invariants: []
priority: high
type: property
level: property
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
input: "Datos del scenario \"Desempate determinista\" del delta de add-import-pipeline"
steps:
  - "una fila tiene dos candidatos con el mismo puntaje, uno a un día y otro a dos días"
expected_result:
  - "el candidato a un día va primero"
  - "calcular de nuevo la vista previa da el mismo orden"
created: 2026-10-29
updated: 2026-10-29
---

# TC-TRANSACTIONS-DEDUPE-003 — Los candidatos con igual puntaje se ordenan por menor diferencia de días de forma determinista

## Intención

Para cada candidato de una fila importada, el sistema DEBE (MUST) calcular un puntaje entre 0 y 1, con 4 decimales y redondeo HALF_EVEN, como 0.40 × monto + 0.25 × fecha + 0.20 × descripción + 0.10 × contraparte + 0.05 × origen, donde monto vale 1 con el mismo monto; fecha vale 1 el mismo día, 0.8 a un día, 0.5 a dos y 0.3 a tres; descripción es la similitud de las descripciones normalizadas (0.5 si el candidato no tiene descripción); contraparte vale 1 si ambas la tienen y coinciden, 0 si ambas la tienen y difieren y 0.5 en otro caso; y origen vale 0 si el candidato tiene un identificador del banco distinto del de la fila y 1 en otro caso.

## Escenario

```gherkin
Dado Workspace "W1" con moneda base BOB y zona America/La_Paz
  Y FixedClock en 2026-10-20T10:00:00-04:00
  Y Cuenta "Banco BOB" (ASSET, activa, institución ficticia "Banco Cumbre Demo")
  Y EDITOR "Ana" autenticada salvo indicación
Cuando una fila tiene dos candidatos con el mismo puntaje, uno a un día y otro a dos días
Entonces el candidato a un día va primero
  Y calcular de nuevo la vista previa da el mismo orden
```

## Notas

- Change: `add-import-pipeline` (Phase 6). Datos ficticios; fechas fijas con `FixedClock` en America/La_Paz; ningún dato de extractos reales del owner (D255, D281).
