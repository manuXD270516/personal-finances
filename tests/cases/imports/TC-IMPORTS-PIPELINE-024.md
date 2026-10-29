---
id: TC-IMPORTS-PIPELINE-024
title: "Un valor numérico de XLSX que excede la escala invalida la fila sin redondear"
spec: imports/import-pipeline
related_specs: []
requirement: "Lectura de hojas de cálculo XLSX"
scenario: "Valor numérico fuera de escala"
requirement_status: provisional
fr: ["FR-IMPORTS-017", "FR-IMPORTS-006"]
nfr: []
invariants: ["INV-001", "INV-003"]
priority: low
type: domain
level: import
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 6
tags: ["imports", "import-pipeline"]
error_code: IMPORT_INVALID_AMOUNT
preconditions:
  - "Workspace \"W1\" con moneda base BOB y zona America/La_Paz"
  - "FixedClock en 2026-10-20T10:00:00-04:00"
  - "Cuenta \"Banco BOB\" (ASSET, activa, institución ficticia \"Banco Cumbre Demo\")"
  - "EDITOR \"Ana\" autenticada salvo indicación"
  - "Documentos ficticios con propósito extracto para importar (fixtures sintéticos marcados SINTETICO)"
input: "Datos del scenario \"Valor numérico fuera de escala\" del delta de add-import-pipeline"
steps:
  - "una celda del monto guarda el valor numérico 0.30000000000000004"
expected_result:
  - "la fila queda inválida con `IMPORT_INVALID_AMOUNT` y no se convierte en 0.30 BOB"
created: 2026-10-29
updated: 2026-10-29
---

# TC-IMPORTS-PIPELINE-024 — Un valor numérico de XLSX que excede la escala invalida la fila sin redondear

## Intención

El sistema DEBERÍA (SHOULD) importar hojas de cálculo XLSX leyendo la hoja indicada en el perfil como una tabla delimitada, con el mismo mapeo que un CSV; una celda numérica DEBE (MUST) leerse como su representación decimal más corta y, si excede la escala de la moneda, la fila DEBE (MUST) quedar inválida con `IMPORT_INVALID_AMOUNT` sin redondear; las fórmulas NO DEBEN (MUST NOT) evaluarse: se usa el último valor guardado en la celda.

## Escenario

```gherkin
Dado Workspace "W1" con moneda base BOB y zona America/La_Paz
  Y FixedClock en 2026-10-20T10:00:00-04:00
  Y Cuenta "Banco BOB" (ASSET, activa, institución ficticia "Banco Cumbre Demo")
  Y EDITOR "Ana" autenticada salvo indicación
  Y Documentos ficticios con propósito extracto para importar (fixtures sintéticos marcados SINTETICO)
Cuando una celda del monto guarda el valor numérico 0.30000000000000004
Entonces la fila queda inválida con `IMPORT_INVALID_AMOUNT` y no se convierte en 0.30 BOB
```

## Notas

- Change: `add-import-pipeline` (Phase 6). Datos ficticios; fechas fijas con `FixedClock` en America/La_Paz; ningún dato de extractos reales del owner (D255, D281).
