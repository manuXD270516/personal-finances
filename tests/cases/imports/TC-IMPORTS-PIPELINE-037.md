---
id: TC-IMPORTS-PIPELINE-037
title: "La vista previa muestra la diferencia entre el saldo final del extracto y el saldo resultante"
spec: imports/import-pipeline
related_specs: []
requirement: "Saldo corrido y saldo del extracto"
scenario: "Diferencia contra el saldo final en la vista previa"
requirement_status: provisional
fr: ["FR-IMPORTS-011", "FR-IMPORTS-006"]
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
tags: ["imports", "import-pipeline"]
error_code: null
preconditions:
  - "Workspace \"W1\" con moneda base BOB y zona America/La_Paz"
  - "FixedClock en 2026-10-20T10:00:00-04:00"
  - "Cuenta \"Banco BOB\" (ASSET, activa, institución ficticia \"Banco Cumbre Demo\")"
  - "EDITOR \"Ana\" autenticada salvo indicación"
  - "Documentos ficticios con propósito extracto para importar (fixtures sintéticos marcados SINTETICO)"
input: "Datos del scenario \"Diferencia contra el saldo final en la vista previa\" del delta de add-import-pipeline"
steps:
  - "la vista previa de \"extracto-octubre.csv\" da un saldo resultante de 11718.70 BOB y el usuario ingresa como saldo final del extracto 11700.70 BOB"
expected_result:
  - "la vista previa muestra una diferencia de 18.00 BOB"
created: 2026-10-29
updated: 2026-10-29
---

# TC-IMPORTS-PIPELINE-037 — La vista previa muestra la diferencia entre el saldo final del extracto y el saldo resultante

## Intención

Si el archivo trae un saldo por fila, el sistema DEBERÍA (SHOULD) verificar en el orden del archivo que cada saldo sea el anterior más el monto de la fila y advertir con `IMPORT_RUNNING_BALANCE_GAP`, en la línea exacta y con la diferencia, cuando no lo es, sin bloquear la importación; si se conoce el saldo final del extracto, por el archivo o porque lo ingresa el usuario, la vista previa DEBE (MUST) mostrar su diferencia con el saldo resultante.

## Escenario

```gherkin
Dado Workspace "W1" con moneda base BOB y zona America/La_Paz
  Y FixedClock en 2026-10-20T10:00:00-04:00
  Y Cuenta "Banco BOB" (ASSET, activa, institución ficticia "Banco Cumbre Demo")
  Y EDITOR "Ana" autenticada salvo indicación
  Y Documentos ficticios con propósito extracto para importar (fixtures sintéticos marcados SINTETICO)
Cuando la vista previa de "extracto-octubre.csv" da un saldo resultante de 11718.70 BOB y el usuario ingresa como saldo final del extracto 11700.70 BOB
Entonces la vista previa muestra una diferencia de 18.00 BOB
```

## Notas

- Change: `add-import-pipeline` (Phase 6). Datos ficticios; fechas fijas con `FixedClock` en America/La_Paz; ningún dato de extractos reales del owner (D255, D281).
