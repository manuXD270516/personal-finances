---
id: TC-TRANSACTIONS-DEDUPE-006
title: "Un único candidato de 0.9000 queda preseleccionado para vincular y es editable"
spec: transactions/duplicate-detection
related_specs: ["imports/import-pipeline"]
requirement: "Vinculación preseleccionada de confianza alta"
scenario: "Único candidato de confianza alta"
requirement_status: provisional
fr: ["FR-TRANSACTIONS-032"]
nfr: []
invariants: []
priority: medium
type: api
level: api
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
input: "Datos del scenario \"Único candidato de confianza alta\" del delta de add-import-pipeline"
steps:
  - "la fila del supermercado tiene un único candidato de puntaje 0.9000"
expected_result:
  - "la fila aparece con la decisión de vincular a ese gasto ya seleccionada y editable"
created: 2026-10-29
updated: 2026-10-29
---

# TC-TRANSACTIONS-DEDUPE-006 — Un único candidato de 0.9000 queda preseleccionado para vincular y es editable

## Intención

Cuando una fila tiene un único candidato con puntaje de 0.9000 o más y ningún otro candidato llega a 0.9000, el sistema DEBERÍA (SHOULD) preseleccionar la decisión de vincular la fila a ese candidato, que el usuario puede cambiar; con dos o más candidatos de 0.9000 o más NO DEBE (MUST NOT) preseleccionar ninguno; y un candidato con puntaje menor que 0.6000 DEBE (MUST) mostrarse como de confianza baja, sin preselección y exigiendo igualmente una decisión.

## Escenario

```gherkin
Dado Workspace "W1" con moneda base BOB y zona America/La_Paz
  Y FixedClock en 2026-10-20T10:00:00-04:00
  Y Cuenta "Banco BOB" (ASSET, activa, institución ficticia "Banco Cumbre Demo")
  Y EDITOR "Ana" autenticada salvo indicación
Cuando la fila del supermercado tiene un único candidato de puntaje 0.9000
Entonces la fila aparece con la decisión de vincular a ese gasto ya seleccionada y editable
```

## Notas

- Change: `add-import-pipeline` (Phase 6). Datos ficticios; fechas fijas con `FixedClock` en America/La_Paz; ningún dato de extractos reales del owner (D255, D281).
