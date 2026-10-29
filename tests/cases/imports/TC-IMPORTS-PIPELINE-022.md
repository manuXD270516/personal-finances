---
id: TC-IMPORTS-PIPELINE-022
title: "Una celda numérica 1234.5 de un XLSX se lee como 1234.50 BOB"
spec: imports/import-pipeline
related_specs: []
requirement: "Lectura de hojas de cálculo XLSX"
scenario: "Celda numérica"
requirement_status: provisional
fr: ["FR-IMPORTS-017", "FR-IMPORTS-006"]
nfr: []
invariants: ["INV-003"]
priority: low
type: domain
level: import
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
input: "Datos del scenario \"Celda numérica\" del delta de add-import-pipeline"
steps:
  - "la hoja \"Movimientos\" de un XLSX para \"Banco BOB\" trae en la columna del monto la celda numérica 1234.5"
expected_result:
  - "la fila tiene el monto 1234.50 BOB"
created: 2026-10-29
updated: 2026-10-29
---

# TC-IMPORTS-PIPELINE-022 — Una celda numérica 1234.5 de un XLSX se lee como 1234.50 BOB

## Intención

El sistema DEBERÍA (SHOULD) importar hojas de cálculo XLSX leyendo la hoja indicada en el perfil como una tabla delimitada, con el mismo mapeo que un CSV; una celda numérica DEBE (MUST) leerse como su representación decimal más corta y, si excede la escala de la moneda, la fila DEBE (MUST) quedar inválida con `IMPORT_INVALID_AMOUNT` sin redondear; las fórmulas NO DEBEN (MUST NOT) evaluarse: se usa el último valor guardado en la celda.

## Escenario

```gherkin
Dado Workspace "W1" con moneda base BOB y zona America/La_Paz
  Y FixedClock en 2026-10-20T10:00:00-04:00
  Y Cuenta "Banco BOB" (ASSET, activa, institución ficticia "Banco Cumbre Demo")
  Y EDITOR "Ana" autenticada salvo indicación
  Y Documentos ficticios con propósito extracto para importar (fixtures sintéticos marcados SINTETICO)
Cuando la hoja "Movimientos" de un XLSX para "Banco BOB" trae en la columna del monto la celda numérica 1234.5
Entonces la fila tiene el monto 1234.50 BOB
```

## Notas

- Change: `add-import-pipeline` (Phase 6). Datos ficticios; fechas fijas con `FixedClock` en America/La_Paz; ningún dato de extractos reales del owner (D255, D281).
