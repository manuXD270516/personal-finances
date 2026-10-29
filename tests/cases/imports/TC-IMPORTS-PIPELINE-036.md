---
id: TC-IMPORTS-PIPELINE-036
title: "Una ruptura del saldo corrido se advierte en la línea exacta con su diferencia sin bloquear"
spec: imports/import-pipeline
related_specs: []
requirement: "Saldo corrido y saldo del extracto"
scenario: "Ruptura del saldo corrido"
requirement_status: provisional
fr: ["FR-IMPORTS-011", "FR-IMPORTS-006"]
nfr: []
invariants: []
priority: medium
type: domain
level: domain
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 6
tags: ["imports", "import-pipeline"]
error_code: IMPORT_RUNNING_BALANCE_GAP
preconditions:
  - "Workspace \"W1\" con moneda base BOB y zona America/La_Paz"
  - "FixedClock en 2026-10-20T10:00:00-04:00"
  - "Cuenta \"Banco BOB\" (ASSET, activa, institución ficticia \"Banco Cumbre Demo\")"
  - "EDITOR \"Ana\" autenticada salvo indicación"
  - "Documentos ficticios con propósito extracto para importar (fixtures sintéticos marcados SINTETICO)"
input: "Datos del scenario \"Ruptura del saldo corrido\" del delta de add-import-pipeline"
steps:
  - "el extracto trae una fila de -245.30 con saldo 754.70 seguida de una de -18.00 con saldo 726.70"
expected_result:
  - "la segunda fila lleva la advertencia `IMPORT_RUNNING_BALANCE_GAP` con una diferencia de 10.00 BOB"
  - "la importación se puede aprobar"
created: 2026-10-29
updated: 2026-10-29
---

# TC-IMPORTS-PIPELINE-036 — Una ruptura del saldo corrido se advierte en la línea exacta con su diferencia sin bloquear

## Intención

Si el archivo trae un saldo por fila, el sistema DEBERÍA (SHOULD) verificar en el orden del archivo que cada saldo sea el anterior más el monto de la fila y advertir con `IMPORT_RUNNING_BALANCE_GAP`, en la línea exacta y con la diferencia, cuando no lo es, sin bloquear la importación; si se conoce el saldo final del extracto, por el archivo o porque lo ingresa el usuario, la vista previa DEBE (MUST) mostrar su diferencia con el saldo resultante.

## Escenario

```gherkin
Dado Workspace "W1" con moneda base BOB y zona America/La_Paz
  Y FixedClock en 2026-10-20T10:00:00-04:00
  Y Cuenta "Banco BOB" (ASSET, activa, institución ficticia "Banco Cumbre Demo")
  Y EDITOR "Ana" autenticada salvo indicación
  Y Documentos ficticios con propósito extracto para importar (fixtures sintéticos marcados SINTETICO)
Cuando el extracto trae una fila de -245.30 con saldo 754.70 seguida de una de -18.00 con saldo 726.70
Entonces la segunda fila lleva la advertencia `IMPORT_RUNNING_BALANCE_GAP` con una diferencia de 10.00 BOB
  Y la importación se puede aprobar
```

## Notas

- Change: `add-import-pipeline` (Phase 6). Datos ficticios; fechas fijas con `FixedClock` en America/La_Paz; ningún dato de extractos reales del owner (D255, D281).
