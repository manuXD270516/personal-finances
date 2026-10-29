---
id: TC-IMPORTS-PIPELINE-033
title: "Una columna indicadora D/C convierte el monto en salida o entrada"
spec: imports/import-pipeline
related_specs: []
requirement: "Opciones de lectura de extractos bancarios"
scenario: "Indicador de débito o crédito"
requirement_status: provisional
fr: ["FR-IMPORTS-005", "FR-IMPORTS-006"]
nfr: []
invariants: []
priority: high
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
input: "Datos del scenario \"Indicador de débito o crédito\" del delta de add-import-pipeline"
steps:
  - "el perfil usa la columna \"D/C\" como indicador y una fila trae \"245,30\" con \"D\""
expected_result:
  - "la fila es una salida de 245.30 BOB"
created: 2026-10-29
updated: 2026-10-29
---

# TC-IMPORTS-PIPELINE-033 — Una columna indicadora D/C convierte el monto en salida o entrada

## Intención

El perfil o el mapeo DEBEN (MUST) poder declarar filas de encabezado y de pie que se omiten, la columna de un indicador de débito o crédito, una descripción formada por varias columnas, una columna de moneda con sus alias (como "Bs." para BOB) y una columna de referencia con la indicación de si es única; las filas omitidas NO DEBEN (MUST NOT) aparecer como filas ni como inválidas, y una fila cuya moneda no es la de la cuenta DEBE (MUST) quedar inválida con `IMPORT_CURRENCY_MISMATCH`.

## Escenario

```gherkin
Dado Workspace "W1" con moneda base BOB y zona America/La_Paz
  Y FixedClock en 2026-10-20T10:00:00-04:00
  Y Cuenta "Banco BOB" (ASSET, activa, institución ficticia "Banco Cumbre Demo")
  Y EDITOR "Ana" autenticada salvo indicación
  Y Documentos ficticios con propósito extracto para importar (fixtures sintéticos marcados SINTETICO)
Cuando el perfil usa la columna "D/C" como indicador y una fila trae "245,30" con "D"
Entonces la fila es una salida de 245.30 BOB
```

## Notas

- Change: `add-import-pipeline` (Phase 6). Datos ficticios; fechas fijas con `FixedClock` en America/La_Paz; ningún dato de extractos reales del owner (D255, D281).
