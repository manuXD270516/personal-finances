---
id: TC-IMPORTS-PIPELINE-034
title: "La descripción se forma uniendo las columnas declaradas en el perfil"
spec: imports/import-pipeline
related_specs: []
requirement: "Opciones de lectura de extractos bancarios"
scenario: "Descripción en dos columnas"
requirement_status: provisional
fr: ["FR-IMPORTS-005", "FR-IMPORTS-006"]
nfr: []
invariants: []
priority: high
type: domain
level: import
automation_status: automated
automated_tests:
  - packages/contexts/imports/src/domain/statement-normalizer.test.ts
status: automated
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
input: "Datos del scenario \"Descripción en dos columnas\" del delta de add-import-pipeline"
steps:
  - "el perfil forma la descripción con \"Descripción\" y \"Glosa\" y una fila trae \"PAGO QR\" y \"CAFÉ CENTRAL\""
expected_result:
  - "la descripción de la fila es \"PAGO QR CAFÉ CENTRAL\""
created: 2026-10-29
updated: 2026-10-29
---

# TC-IMPORTS-PIPELINE-034 — La descripción se forma uniendo las columnas declaradas en el perfil

## Intención

El perfil o el mapeo DEBEN (MUST) poder declarar filas de encabezado y de pie que se omiten, la columna de un indicador de débito o crédito, una descripción formada por varias columnas, una columna de moneda con sus alias (como "Bs." para BOB) y una columna de referencia con la indicación de si es única; las filas omitidas NO DEBEN (MUST NOT) aparecer como filas ni como inválidas, y una fila cuya moneda no es la de la cuenta DEBE (MUST) quedar inválida con `IMPORT_CURRENCY_MISMATCH`.

## Escenario

```gherkin
Dado Workspace "W1" con moneda base BOB y zona America/La_Paz
  Y FixedClock en 2026-10-20T10:00:00-04:00
  Y Cuenta "Banco BOB" (ASSET, activa, institución ficticia "Banco Cumbre Demo")
  Y EDITOR "Ana" autenticada salvo indicación
  Y Documentos ficticios con propósito extracto para importar (fixtures sintéticos marcados SINTETICO)
Cuando el perfil forma la descripción con "Descripción" y "Glosa" y una fila trae "PAGO QR" y "CAFÉ CENTRAL"
Entonces la descripción de la fila es "PAGO QR CAFÉ CENTRAL"
```

## Notas

- Change: `add-import-pipeline` (Phase 6). Datos ficticios; fechas fijas con `FixedClock` en America/La_Paz; ningún dato de extractos reales del owner (D255, D281).
