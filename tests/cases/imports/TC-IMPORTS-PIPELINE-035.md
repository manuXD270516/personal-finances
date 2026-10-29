---
id: TC-IMPORTS-PIPELINE-035
title: "El alias Bs. se reconoce como BOB y una fila en $us queda inválida por moneda"
spec: imports/import-pipeline
related_specs: []
requirement: "Opciones de lectura de extractos bancarios"
scenario: "Alias de moneda"
requirement_status: provisional
fr: ["FR-IMPORTS-005", "FR-IMPORTS-006"]
nfr: []
invariants: ["INV-002"]
priority: high
type: domain
level: import
automation_status: not_automated
automated_tests: []
status: draft
regression_suite: false
phase: 6
tags: ["imports", "import-pipeline"]
error_code: IMPORT_CURRENCY_MISMATCH
preconditions:
  - "Workspace \"W1\" con moneda base BOB y zona America/La_Paz"
  - "FixedClock en 2026-10-20T10:00:00-04:00"
  - "Cuenta \"Banco BOB\" (ASSET, activa, institución ficticia \"Banco Cumbre Demo\")"
  - "EDITOR \"Ana\" autenticada salvo indicación"
  - "Documentos ficticios con propósito extracto para importar (fixtures sintéticos marcados SINTETICO)"
input: "Datos del scenario \"Alias de moneda\" del delta de add-import-pipeline"
steps:
  - "la columna de moneda de \"Banco BOB\" trae \"Bs.\" en una fila y \"$us\" en otra"
expected_result:
  - "la primera fila es válida en BOB y la segunda queda inválida con `IMPORT_CURRENCY_MISMATCH`"
created: 2026-10-29
updated: 2026-10-29
---

# TC-IMPORTS-PIPELINE-035 — El alias Bs. se reconoce como BOB y una fila en $us queda inválida por moneda

## Intención

El perfil o el mapeo DEBEN (MUST) poder declarar filas de encabezado y de pie que se omiten, la columna de un indicador de débito o crédito, una descripción formada por varias columnas, una columna de moneda con sus alias (como "Bs." para BOB) y una columna de referencia con la indicación de si es única; las filas omitidas NO DEBEN (MUST NOT) aparecer como filas ni como inválidas, y una fila cuya moneda no es la de la cuenta DEBE (MUST) quedar inválida con `IMPORT_CURRENCY_MISMATCH`.

## Escenario

```gherkin
Dado Workspace "W1" con moneda base BOB y zona America/La_Paz
  Y FixedClock en 2026-10-20T10:00:00-04:00
  Y Cuenta "Banco BOB" (ASSET, activa, institución ficticia "Banco Cumbre Demo")
  Y EDITOR "Ana" autenticada salvo indicación
  Y Documentos ficticios con propósito extracto para importar (fixtures sintéticos marcados SINTETICO)
Cuando la columna de moneda de "Banco BOB" trae "Bs." en una fila y "$us" en otra
Entonces la primera fila es válida en BOB y la segunda queda inválida con `IMPORT_CURRENCY_MISMATCH`
```

## Notas

- Change: `add-import-pipeline` (Phase 6). Datos ficticios; fechas fijas con `FixedClock` en America/La_Paz; ningún dato de extractos reales del owner (D255, D281).
